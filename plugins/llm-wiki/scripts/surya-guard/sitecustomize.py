"""Keeps surya's full-page OCR from burning GPU time on repetition loops.

`ingest-book.mjs` puts this directory on PYTHONPATH when it runs marker, so
Python imports the file at startup and it wraps two functions of
`surya.inference.backends.openai_client` once that module loads. Nothing in
the marker/surya install is edited. It shadows any other `sitecustomize` on
the path; marker's own environment has none.

What it prevents, measured on marker-pdf 2.0.0 / surya-ocr 0.22.1:

  Inside a code block, a line with a margin note far to its right makes the
  model pad with spaces to reach the note and never stop: ~3,000 single-space
  tokens up to max_tokens. surya then retries the page three times at rising
  temperature (0.2 mostly reproduces the same runaway) and, when those loop
  too, falls back to block mode, which turns the code into a table of spans.
  On code-dense pages 58-73% of the GPU time went to output that was thrown
  away.

Three measures, each inert on a page that does not loop (60 prose pages came
out byte-identical with and without the guard):

  1. A grammar that forbids more than SURYA_GUARD_SPACE_CAP consecutive
     spaces. The model writes the margin note after the cap and finishes the
     page normally. 16 is too tight (it clips real indentation and provokes a
     new loop); 64 clears every indentation seen in 46 converted books.
  2. Streaming, so a loop of any other kind (`<hr .../>` or `},` repeated) is
     cut once it has run for SURYA_GUARD_STREAM_ABORT characters instead of at
     max_tokens. surya's own retry then takes over as before.
  3. surya also checks the text with its last 50 characters removed. A capped
     run of spaces that happens to sit there is flagged as a loop and the page
     is regenerated for nothing; such a run on a response that finished by
     itself is accepted.

Rejected: DRY / repetition penalties rewrite correct code on pages that never
looped (`arr.length` -> `arr.lenght`, `i++` -> `j++`).

Environment:
  SURYA_GUARD_SPACE_CAP     max consecutive spaces, 0 = no grammar
  SURYA_GUARD_STREAM_ABORT  loop length in characters that cuts a response, 0 = no streaming
  SURYA_GUARD_STATUS        file that receives `patched ...` or `failed: ...`, so the
                            caller can tell a working guard from one surya has outgrown
"""

import importlib.abc
import importlib.util
import os
import sys
import threading

TARGET = "surya.inference.backends.openai_client"
SEAMS = ("_generate_one", "_should_retry")
SPACE_CAP = int(os.environ.get("SURYA_GUARD_SPACE_CAP") or 0)
STREAM_ABORT = int(os.environ.get("SURYA_GUARD_STREAM_ABORT") or 0)
STATUS = os.environ.get("SURYA_GUARD_STATUS")
# How often, in streamed chunks, the accumulated text is checked for a loop.
CHECK_EVERY = 32

_local = threading.local()


def _say(line):
    sys.stderr.write(f"[surya-guard] {line}\n")


def _report(status):
    """Record whether the guard is in force. Returns nothing; a status file is optional."""
    _say(status)
    if STATUS:
        with open(STATUS, "w") as fp:
            fp.write(status + "\n")


def repeat_hit(text, base_max_repeats=4, window_size=500, scaling_factor=3.0):
    """surya's `detect_repeat_token` walk, returning (unit, repeats) of the looping tail or None."""
    for seq_len in range(1, window_size // 2 + 1):
        unit = text[-seq_len:]
        max_repeats = int(base_max_repeats * (1 + scaling_factor / seq_len))
        repeats = 0
        pos = len(text) - seq_len
        if pos < 0:
            continue
        while pos >= 0 and text[pos : pos + seq_len] == unit:
            repeats += 1
            pos -= seq_len
        if repeats > max_repeats:
            return unit, repeats
    return None


def retry_cause(raw):
    """The loop surya's `_should_retry` would see in `raw`: tail as is, then with 50 chars cut."""
    hit = repeat_hit(raw)
    if hit is None and len(raw) > 50:
        hit = repeat_hit(raw[:-50])
    return hit


def long_loop(text, min_chars):
    """True when `text` ends in a loop surya would retry on that already spans `min_chars`."""
    hit = retry_cause(text)
    return hit is not None and len(hit[0]) * hit[1] >= min_chars


def space_cap_grammar(cap):
    """GBNF accepting any text whose runs of spaces are at most `cap` long."""
    return f'root ::= " "{{0,{cap}}} ([^ ] " "{{0,{cap}}})*'


class _Completion:
    """The parts of a chat completion surya reads, rebuilt from a stream."""

    def __init__(self, text, logprobs, finish, tokens, extra):
        message = type("Message", (), {"content": text})()
        choice_logprobs = type("Logprobs", (), {"content": logprobs})() if logprobs else None
        choice = type("Choice", (), {"message": message, "logprobs": choice_logprobs, "finish_reason": finish})()
        self.choices = [choice]
        self.usage = type("Usage", (), {"completion_tokens": tokens})()
        self.model_extra = extra


class _ClientProxy:
    """Stands in for the OpenAI client surya passes around, for one request."""

    def __init__(self, client):
        self._client = client
        self.chat = self
        self.completions = self

    def create(self, **kwargs):
        # A request that already constrains its output (layout JSON schema) keeps its own grammar.
        capped = bool(SPACE_CAP) and "response_format" not in kwargs
        if capped:
            kwargs["extra_body"] = {"grammar": space_cap_grammar(SPACE_CAP), **kwargs.get("extra_body", {})}
        completion = self._stream(kwargs) if STREAM_ABORT else self._client.chat.completions.create(**kwargs)
        _local.capped = capped
        _local.finish = completion.choices[0].finish_reason
        return completion

    def _stream(self, kwargs):
        stream = self._client.chat.completions.create(**kwargs, stream=True, stream_options={"include_usage": True})
        parts, logprobs, finish, usage, extra, chunks = [], [], None, None, {}, 0
        try:
            for chunk in stream:
                usage = chunk.usage or usage
                extra = chunk.model_extra or extra
                if not chunk.choices:
                    continue
                choice = chunk.choices[0]
                finish = choice.finish_reason or finish
                if choice.logprobs and choice.logprobs.content:
                    logprobs.extend(choice.logprobs.content)
                if choice.delta and choice.delta.content:
                    parts.append(choice.delta.content)
                    chunks += 1
                    if chunks % CHECK_EVERY == 0 and long_loop("".join(parts), STREAM_ABORT):
                        finish = "abort"
                        break
        finally:
            stream.close()
        text = "".join(parts)
        if finish == "abort":
            unit, repeats = retry_cause(text)
            _say(f"cut a loop after {len(text)} chars: {unit[:40]!r} x{repeats}")
        tokens = usage.completion_tokens if usage else (len(logprobs) or chunks)
        return _Completion(text, logprobs, finish, tokens, extra)


def _patch(module):
    missing = [name for name in SEAMS if not hasattr(module, name)]
    if missing:
        _report(f"failed: {TARGET} has no {', '.join(missing)}")
        return
    orig_generate = module._generate_one
    orig_should_retry = module._should_retry

    def generate_one(item, client, *args, **kwargs):
        _local.capped = False
        _local.finish = None
        return orig_generate(item, _ClientProxy(client), *args, **kwargs)

    def should_retry(result, retries, max_retries):
        verdict = orig_should_retry(result, retries, max_retries)
        if not verdict or result.error or not getattr(_local, "capped", False) or _local.finish != "stop":
            return verdict
        unit, repeats = retry_cause(result.raw) or ("", 0)
        if unit and unit.strip(" ") == "" and len(unit) * repeats <= SPACE_CAP:
            _say(f"accepted a capped run of {len(unit) * repeats} spaces")
            return False
        return verdict

    module._generate_one = generate_one
    module._should_retry = should_retry
    _report(f"patched space_cap={SPACE_CAP} stream_abort={STREAM_ABORT}")


class _Finder(importlib.abc.MetaPathFinder):
    """Wraps the target module's loader so `_patch` runs right after its import."""

    def find_spec(self, name, path, target=None):
        if name != TARGET:
            return None
        sys.meta_path.remove(self)
        spec = importlib.util.find_spec(name)
        if spec is None:
            return None
        orig_exec = spec.loader.exec_module

        def exec_module(module):
            orig_exec(module)
            _patch(module)

        spec.loader.exec_module = exec_module
        return spec


if STATUS or SPACE_CAP or STREAM_ABORT:
    sys.meta_path.insert(0, _Finder())
