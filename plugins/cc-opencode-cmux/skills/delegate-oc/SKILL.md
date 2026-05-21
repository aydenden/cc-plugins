---
name: delegate-oc
description: Use when Claude Code (Opus orchestrator) is about to do repetitive coding work that fits the cc-opencode-cmux delegation policy — multi-file boilerplate implementation, mechanical refactors, code summarization, Korean/Chinese documentation, knowledge research, or document composition. Triggers on user requests like "구현해줘", "리팩터링", "이 파일들 요약", "한국어 문서 만들어줘", "조사해줘", or when Opus detects a task with low reasoning complexity but high token volume. Other plugins (obsidian-knowledge, cc-deep-tutor, pm, ...) call this skill via the Skill tool to delegate their own large-output subtasks.
---

# delegate-oc

Offload a task to OpenCode (cheaper model) instead of executing it in this Opus session. **The main session orchestrates the delegation directly** — no subagent indirection. The skill is a procedure for the calling session to follow.

## Architecture (v0.6.0+)

```
[main Opus session]
  │
  │  1. Decide: is this task delegable?
  │  2. Compose spec (verbatim)
  │  3. Bash: oc-daemon ensure → session create → SSE watcher bg → oc-prompt → wait → diff capture
  │  4. Classify status, surface report (grep-only — no Read of session output)
  │
  └─> [opencode serve daemon @ localhost:4096]
        └─> v2 HTTP API: POST /api/session/:id/prompt
              + x-opencode-directory header (replaces CLI --dir)
              SSE /event side-channel for permission auto-deny + idle signal
```

Removed in v0.6.0:
- ❌ `agents/oc-implementer.md` haiku subagent (was the source of mid-flight token leaks)
- ❌ `bin/oc-message.sh` (`opencode run --attach` CLI wrapper — replaced by direct HTTP API)
- ❌ `templates/AGENTS.md.snippet` prepend hack (OpenCode auto-loads `AGENTS.md` from `--dir` via `findUp`)
- ❌ `hooks/subagent-stop.sh` (no subagent → no SubagentStop)

## When to delegate

Delegate when **all** hold:

- Task is mechanical or pattern-following (CRUD scaffolding, boilerplate, renames, simple refactors, docstring writing, file summarization, external research with clear questions, structured document composition from given research).
- Expected output is large (>200 lines or >5 files touched, or several pages of prose).
- Reasoning required is shallow — no architectural decisions, no ambiguous requirements, no cross-cutting concerns.
- User has not explicitly asked for Opus-quality output.

## When NOT to delegate

- Architecture decisions, API surface design, cross-module coordination.
- User asked to "think hard" or explicitly requested Opus.
- Task small enough to do in this session for fewer tokens than delegation overhead (~3K tokens with v0.6.0; no subagent overhead).
- No clear acceptance criterion — Opus must make judgment calls iteratively.
- Codebase requires understanding subtle conventions not written down (let OpenCode read `AGENTS.md` for those instead).
- **Output exceeds OC's step-loop Write budget** (see "Sizing" below). Split the work: CC produces fixture/binary, then delegates only the code that consumes it.

## Sizing & token budget (estimate BEFORE delegating)

| Output type | Tokens/line | Safe single-delegate LOC | Hard wall |
|---|---|---|---|
| Source code (Rust/Python/TS) | ~50–80 | ≤ 1000 LOC | ~1100 |
| Markdown / Korean doc | ~60–100 | ≤ 800 LOC | ~900 |
| JSONL / CSV fixture | ~150–300 | ≤ 250 LOC | ~300 |
| Parquet / DB seed / binary | n/a | 0 — never delegate | — |

- < 30K tokens → safe single delegate
- 30–70K → still single, but split if natural seams exist
- > 70K or any binary → **must split** (CC produces the fixture, then delegates only the code that reads it)

For LOC-based estimation, use `wc -l <path>` via Bash — **do not Read source files** just to estimate size.

## Procedure (main session runs all bash directly)

`PLUGIN=${CLAUDE_PLUGIN_ROOT}` (the cc-opencode-cmux directory). Replace as appropriate if invoked from a different working set; usually CC resolves it automatically.

### Step 0 — eligibility check (decide first)

If the task fails any "When to delegate" / passes any "When NOT" — stop now and do it in this session. Don't start the pipeline.

### Step 1 — bootstrap session directory

```bash
PROJECT_ROOT="${CLAUDE_PROJECT_DIR:-$PWD}"
SESSION_DIR="$PROJECT_ROOT/.claude/oc-sessions/$(uuidgen)"
mkdir -p "$SESSION_DIR" 2>/dev/null || SESSION_DIR="/tmp/cc-oc-$(uuidgen)"
mkdir -p "$SESSION_DIR"

OC_DIR="$PWD"   # OpenCode's working directory — almost always $PWD.
                # Override only if the spec names an absolute path.
```

The session directory lives in the project's `.claude/oc-sessions/<uuid>/`. The
`session-start.sh` hook ensures `.claude/.gitignore` already excludes
`oc-sessions/`, so artifacts don't pollute commits. Fallback to `/tmp` if the
project is read-only.

### Step 2 — ensure opencode daemon

```bash
${PLUGIN}/bin/oc-daemon.sh ensure
```

On failure → abort the whole delegation with `status: error / reason: daemon ensure failed`. Do **not** silently fall back to direct execution.

### Step 3 — write the spec verbatim

```bash
cat > "$SESSION_DIR/prompt.md" <<'EOF'
<spec body — see "Spec template" below — goes here verbatim>
EOF
```

The spec body is what you'd describe to a junior engineer. **Do not paraphrase, summarize, or "simplify"** the user's request before writing.

**No `WORKING_DIRECTORY:` header is needed.** v0.6.0 passes the directory via the `x-opencode-directory` HTTP header (in step 6), and OpenCode auto-loads `AGENTS.md` from that directory via `findUp` — so project conventions are picked up automatically.

### Step 4 — create OpenCode session

```bash
OC_SID=$(${PLUGIN}/bin/oc-session.sh create --title "cc-delegate-$(date +%s)")
echo "$OC_SID" > "$SESSION_DIR/oc_sid"
```

The v1 `POST /session` body has no `directory` field (silently ignored — known issue). The directory is set per-request via the `x-opencode-directory` header in step 6.

### Step 5 — start SSE side-channel (background)

The SSE watcher does two jobs:
1. **Auto-deny** any `permission.asked` event for our session ID (safety).
2. **Detect completion** by exiting on `session.status: idle` and writing `$SESSION_DIR/done`.

```bash
${PLUGIN}/bin/oc-sse-watch.sh "$OC_SID" \
  --out "$SESSION_DIR/sse.ndjson" \
  --done-file "$SESSION_DIR/done" \
  > "$SESSION_DIR/watch.stdout" 2>> "$SESSION_DIR/watch.stderr" &
WATCH_PID=$!

# tiny grace period so the SSE stream is attached before the prompt fires.
sleep 0.3
```

### Step 6 — send prompt via HTTP API v2 (async)

```bash
${PLUGIN}/bin/oc-prompt.sh "$OC_SID" "$SESSION_DIR/prompt.md" --dir "$OC_DIR"
PROMPT_EXIT=$?
```

`oc-prompt.sh` POSTs to `/api/session/:id/prompt` with the `x-opencode-directory` header and returns as soon as the message is queued (typically <1s). The actual agent loop runs server-side.

If `PROMPT_EXIT != 0` → kill the watcher (`kill -TERM $WATCH_PID`) and report `status: error / reason: oc-prompt POST failed`.

### Step 7 — wait for completion (SSE-driven)

```bash
WAIT_TIMEOUT="${CC_OC_WAIT_TIMEOUT:-900}"   # 15 minutes default

if command -v timeout >/dev/null 2>&1; then
  timeout "$WAIT_TIMEOUT" bash -c "wait $WATCH_PID" 2>/dev/null
  WAIT_RC=$?
else
  # macOS without coreutils — poll the done-file instead
  SECS=0
  while [ ! -f "$SESSION_DIR/done" ] && [ "$SECS" -lt "$WAIT_TIMEOUT" ]; do
    sleep 1; SECS=$((SECS + 1))
  done
  [ -f "$SESSION_DIR/done" ] && WAIT_RC=0 || WAIT_RC=124
fi
```

`WAIT_RC == 124` → timeout. Abort the runaway session:

```bash
${PLUGIN}/bin/oc-session.sh abort "$OC_SID" >/dev/null 2>&1 || true
```

Then report `status: timeout`.

### Step 8 — reap the watcher and read the done signal

```bash
kill -TERM $WATCH_PID 2>/dev/null || true
wait $WATCH_PID 2>/dev/null || true

DONE_CODE=""
DONE_REASON=""
if [ -f "$SESSION_DIR/done" ]; then
  DONE_CODE=$(sed -n '1p' "$SESSION_DIR/done")
  DONE_REASON=$(sed -n '2p' "$SESSION_DIR/done")
fi
```

### Step 9 — capture diff in OC_DIR (metadata only)

```bash
( cd "$OC_DIR" && git diff > "$SESSION_DIR/diff.patch" ) 2>/dev/null || true
FILES_CHANGED=$(grep -c '^diff --git' "$SESSION_DIR/diff.patch" 2>/dev/null || echo 0)
ADD=$(grep -c '^+[^+]'                "$SESSION_DIR/diff.patch" 2>/dev/null || echo 0)
DEL=$(grep -c '^-[^-]'                "$SESSION_DIR/diff.patch" 2>/dev/null || echo 0)
```

**Never** `Read` or `cat` the diff or any session file just to "verify" what OC did. Content review belongs to `oc-result-review`.

### Step 10 — classify status (grep only — never Read these files)

```bash
HAS_PERM=$(grep -c '"permission.asked"' "$SESSION_DIR/sse.ndjson" 2>/dev/null || echo 0)
HAS_ERR=$(grep -c  '"session.error"'    "$SESSION_DIR/sse.ndjson" 2>/dev/null || echo 0)
```

Priority (first match wins):

| Condition | `status:` |
|---|---|
| `PROMPT_EXIT != 0` | `error` |
| `WAIT_RC == 124` (timeout) | `timeout` |
| `HAS_ERR > 0` or `DONE_CODE == 2` | `error` |
| `HAS_PERM > 0` (and watcher auto-denied) | `aborted-perm` |
| otherwise | `done` |

### Step 11 — surface the report

Report verbatim format:

```
status:   <done|error|aborted-perm|timeout|declined>
session:  <SESSION_DIR>
oc_sid:   <OC_SID or "(none)">
files:    +<add> -<del> (<files_changed> files)
diff:     <SESSION_DIR>/diff.patch
done:     <DONE_CODE> <DONE_REASON>
notes:    <one-line reason; relevant error message if non-done>
```

Then, if you want a structured review of the diff, invoke:

```
Skill(cc-opencode-cmux:oc-result-review, args: "<SESSION_DIR>")
```

`oc-result-review` is the **only** place where session output may be Read for content inspection — and it lives in this same main session, so it doesn't double the token cost.

## Spec template (general code work)

```
TASK_TYPE: implement | refactor | summarize | doc | research | compose | analyze
TASK: <one-line summary>

FILES TO TOUCH:
- <absolute path 1> (create / modify)
- <absolute path 2> (modify)

BEHAVIOR:
- <bullet 1>
- <bullet 2>

CONVENTIONS:
- <project rules — e.g. "use anyhow::Result for fallible functions">

ACCEPTANCE TEST:
- $ <command that verifies success>
```

Notes vs v0.5.x:
- No `WORKING_DIRECTORY:` header — directory is set via the HTTP header in step 6.
- OpenCode auto-loads `AGENTS.md` from `OC_DIR` (and parents, via findUp), so you do **not** need to list project conventions that already live there. Only mention spec-specific conventions.

## Spec variants for knowledge work

### `research` — external information gathering

```
TASK_TYPE: research
TOPIC: <one-line>

KEY QUESTIONS:
- ...

SOURCE GUIDELINES:
- Prefer official docs / 1st-party / recent material

OUTPUT SCHEMA:
- H2 per question, bullets with citations
- Each fact: claim + source URL + retrieval date
- Write raw research to OUTPUT_FILE
OUTPUT_FILE: <absolute path>
```

OC has webfetch/websearch capability via its `research` agent profile (registered via `bin/install-agents.sh`). Set `OC_DIR=/tmp/cc-oc-scratch-<id>` (or any writable scratch) and pass `OUTPUT_FILE` as an absolute path; OC's edit is permitted inside `OC_DIR`.

### `compose` — render a document from given research

```
TASK_TYPE: compose
INPUT_RESEARCH: <absolute path to raw research markdown>
OUTPUT_FILE: <absolute path>

FRONTMATTER: <YAML schema>
BODY SECTIONS:
- <section 1>
- <section 2>

CONVENTIONS:
- <project rules>
- Do NOT edit files outside OUTPUT_FILE
```

`OC_DIR` should be the vault root (or wherever the OUTPUT_FILE lives). OC has edit allowed inside the working directory; web denied.

### `analyze` — read-only document evaluation

```
TASK_TYPE: analyze
INPUTS:
- <path or glob 1>
- <path or glob 2>

EVALUATION:
- <what to extract / compare / validate>

OUTPUT: <where to write the result, or "stdout">
```

OC has read/grep/glob only. Edit and web denied.

## Knowledge pipeline pattern

When the work bundles research + composition:

1. Caller (CC, in this session) does local lookup, dedup check.
2. Run `delegate-oc` with a `research` spec → raw markdown lands at OUTPUT_FILE.
3. Caller briefly reviews (sanity, gaps).
4. Run `delegate-oc` with a `compose` spec referencing the raw research → final document.
5. (optional) Run `delegate-oc` with an `analyze` spec → validates final doc against conventions.
6. Caller handles domain post-processing (backlinks, index updates, issue linking).

The caller plugin keeps domain knowledge; this skill just delegates safely.

## Result handling

After Step 11:

- `status: done` → diff at the path in the report. For structured review, invoke `Skill(cc-opencode-cmux:oc-result-review, args: "<SESSION_DIR>")`.
- `status: error` → surface the `notes:` line. Common causes: daemon ensure failure, oc-prompt POST failed, session.error event.
- `status: aborted-perm` → OC asked for a permission the watcher auto-denied. Reconsider whether the spec is asking for something out of policy.
- `status: timeout` → the agent loop ran past `CC_OC_WAIT_TIMEOUT` (default 900s). The session has been aborted; the partial diff in the report may still be useful.
- `status: declined` → token budget exceeded before dispatch. Split the work.

**Never silently re-execute the task yourself.** If OC fails, the report says so; the caller decides next steps.

## Hard constraints

- **Read-only invariant**: never `Read`, `cat`, `head`, or `tail -n big` on `events.ndjson`, `sse.ndjson`, `diff.patch`, `watch.stdout/stderr`, or any source file in `FILES TO TOUCH`. Use `grep -c`, `grep -q`, `wc -l`, `tail -c <small N>` only. Content review is exclusively the `oc-result-review` skill's job.
- **No subagent dispatch**: as of v0.6.0 there is no `oc-implementer` agent. The Skill itself is the procedure. `Agent({subagent_type: "cc-opencode-cmux:oc-implementer", ...})` no longer exists; calling it will fail.
- **No fallback to direct execution.** If OC fails, surface the error. The user/caller decides.
- **No re-delegation loops.** One dispatch per call. If you need a second attempt with corrections, write a fresh spec and call the skill again — explicitly, not silently.
- **`--dir` (now: x-opencode-directory header) is mandatory.** `oc-prompt.sh --dir` enforces this; the HTTP API silently ignores `directory` in `POST /session` body so this header is the only path that works.
- **Never pass `--dangerously-skip-permissions` to opencode.** Watcher auto-denies; main session decides if any `aborted-perm` deserves a re-spec.

## Anti-patterns

- ❌ Vague specs like "implement the feature" — OC has no conversation history.
- ❌ Asking OC to make architectural decisions — it picks arbitrary.
- ❌ Skipping diff review (`oc-result-review`) — small wrong details accumulate.
- ❌ Parallel delegations touching the same files — sequence them or use isolated working directories.
- ❌ Leaking caller-plugin domain knowledge into this skill — inline schema in the spec instead, or rely on `AGENTS.md` in OC_DIR.
- ❌ Reading session output files in this skill to "verify" — that defeats the entire point of delegation. Use `oc-result-review` if you must inspect content.
- ❌ Calling `Bash` to invoke `opencode run --attach` directly or any legacy `safe-oc.sh` — those paths are gone.
