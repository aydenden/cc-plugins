#!/usr/bin/env node
/**
 * vault-git.mjs — git synchronization for the wiki vault.
 *
 * The vault is a git repository shared across machines, so two moments decide
 * whether that sharing works: pulling before the session reads anything, and
 * committing right after a write cycle ends. Both used to be the model's
 * discretion and were therefore skipped; this module makes them mechanical.
 *
 * Two entry points, one per moment:
 *   sync   — fetch, then fast-forward a clean branch, or rebase local commits
 *            onto the remote. Called by the SessionStart hook and by
 *            /llm-wiki:research before it reads and before it writes.
 *   commit — stage everything, derive the message from the last log.md entry,
 *            push; a rejected push is rebased and pushed again. Called by the
 *            PostToolUse hook after lint reports a clean vault.
 *
 * Every write cycle appends to log.md and regenerates index.md, so two machines
 * always collide on exactly those two files. A rebase resolves them itself:
 * log.md is append-only, so each side's new tail is kept (resolveAppendOnly),
 * and index.md is derived, so it is rebuilt rather than merged. Any other
 * conflict aborts the rebase and is handed back — that one needs a judgment.
 *
 * Dependency-free Node ESM: node: builtins plus the `git` binary. Every git
 * call runs non-interactively (GIT_TERMINAL_PROMPT=0, ssh BatchMode) and under
 * a timeout, because a hook that waits on a credential prompt hangs a session.
 *
 * Usage:
 *   node vault-git.mjs sync   [--vault PATH]
 *   node vault-git.mjs commit [--vault PATH]
 *
 * Output contract: one line on stdout, shaped `GIT <status> — <detail>`, plus a
 * process exit code of 0 (nothing to act on) or 1 (the agent or the user has to
 * act). Statuses are stable identifiers, not prose, so callers can branch.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// --- Constants ---

/** Local git plumbing is instant; the cap only guards against a wedged repo. */
const LOCAL_TIMEOUT_MS = 15_000;

/** Network calls: long enough for a slow link, short enough not to stall a session. */
const NETWORK_TIMEOUT_MS = 30_000;

/** Commit subject when log.md has no parsable entry to name the cycle after. */
const FALLBACK_SUBJECT = 'chore(vault): vault update';

/** `## [2026-09-03] ingest | 제목` — the entry header rule 6 of wiki-schema writes. */
const LOG_ENTRY_RE = /^##\s*\[(\d{4}-\d{2}-\d{2})\]\s*([a-z]+)\s*\|\s*(.+?)\s*$/;

/** Bytes of log.md read from the end to find the last entry header. */
const LOG_TAIL_BYTES = 8192;

/** Append-only file whose rebase conflicts are resolved by keeping both tails. */
const LOG_FILE = 'log.md';

/** Derived file whose rebase conflicts are resolved by regenerating it. */
const INDEX_FILE = 'index.md';

/** Upper bound on `rebase --continue` rounds — one per replayed local commit. */
const MAX_REBASE_STEPS = 200;

const LINT = path.join(path.dirname(fileURLToPath(import.meta.url)), 'lint.mjs');
const LINT_TIMEOUT_MS = 60_000;

/** Subject of the commit that carries an index rebuilt after a rebase. */
const INDEX_SUBJECT = 'lint(vault): rebase 뒤 index 재생성';

// --- git plumbing ---

/**
 * Run one git command in the vault.
 * `raw` keeps stdout byte-for-byte (file contents); otherwise it is trimmed.
 * @returns {{ok: boolean, out: string, err: string}} — never throws, so every
 *   caller decides for itself whether a failure is fatal.
 */
function git(vault, args, { timeout = LOCAL_TIMEOUT_MS, raw = false } = {}) {
  try {
    const out = execFileSync('git', ['-C', vault, ...args], {
      encoding: 'utf8',
      timeout,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND || 'ssh -oBatchMode=yes',
      },
    });
    return { ok: true, out: raw ? out : out.trim(), err: '' };
  } catch (e) {
    return { ok: false, out: (e.stdout || '').toString().trim(), err: (e.stderr || e.message || '').toString().trim() };
  }
}

function isRepo(vault) {
  return git(vault, ['rev-parse', '--git-dir']).ok;
}

function isDirty(vault) {
  const res = git(vault, ['status', '--porcelain']);
  return res.ok && res.out !== '';
}

/** Name of the checked-out branch, or null on a detached HEAD. */
function branchName(vault) {
  const res = git(vault, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  return res.ok && res.out ? res.out : null;
}

/**
 * The remote-tracking ref this vault should be compared against.
 *
 * Configured upstream first, then `origin/<branch>` — a vault cloned or
 * initialized on another machine often has the remote branch without the
 * tracking config, and refusing to sync over a missing `branch.*.merge` setting
 * would silently disable the whole feature (observed on the live vault).
 *
 * @returns {{ref: string, branch: string, tracked: boolean}|null}
 */
function remoteRef(vault) {
  const branch = branchName(vault);
  if (!branch) return null;

  const tracked = git(vault, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  if (tracked.ok && tracked.out) return { ref: tracked.out, branch, tracked: true };

  const fallback = `origin/${branch}`;
  const exists = git(vault, ['rev-parse', '--verify', '--quiet', `refs/remotes/${fallback}`]);
  return exists.ok && exists.out ? { ref: fallback, branch, tracked: false } : null;
}

/**
 * Commits the local branch is behind / ahead of the given remote ref.
 * @returns {{behind: number, ahead: number}|null}
 */
function divergence(vault, ref) {
  const res = git(vault, ['rev-list', '--left-right', '--count', `${ref}...HEAD`]);
  if (!res.ok) return null;
  const [behind, ahead] = res.out.split(/\s+/).map(Number);
  if (!Number.isInteger(behind) || !Number.isInteger(ahead)) return null;
  return { behind, ahead };
}

// --- rebase ---

/**
 * Merge two edits of an append-only file against their common base.
 *
 * Whichever side still starts with the base only appended, so its new tail is
 * carried over onto the other side. That also covers a log rotation on one side:
 * the rotated file is kept whole and the other side's new entries are added to
 * it, instead of resurrecting entries the rotation archived (a union merge does
 * exactly that — measured).
 *
 * @param {string} base   common ancestor
 * @param {string} ours   upstream side (during a rebase, the commit being built on)
 * @param {string} theirs the local commit being replayed
 * @returns {string|null} merged text, or null when neither side is a pure append
 */
export function resolveAppendOnly(base, ours, theirs) {
  if (theirs.startsWith(base)) return joinTail(ours, theirs.slice(base.length));
  if (ours.startsWith(base)) return joinTail(theirs, ours.slice(base.length));
  return null;
}

function joinTail(head, tail) {
  if (!tail || head.endsWith(tail)) return head;
  return head.endsWith('\n') || tail.startsWith('\n') ? head + tail : `${head}\n${tail}`;
}

/** Default index rebuild: the same lint run the PostToolUse hook uses. */
function lintWriteIndex(vault) {
  execFileSync(process.execPath, [LINT, '--vault', vault, '--write-index'], {
    timeout: LINT_TIMEOUT_MS,
    stdio: ['ignore', 'ignore', 'pipe'],
  });
}

function rebaseInProgress(vault) {
  const res = git(vault, ['rev-parse', '--git-path', 'rebase-merge']);
  if (!res.ok) return false;
  const p = path.isAbsolute(res.out) ? res.out : path.join(vault, res.out);
  return fs.existsSync(p);
}

/** Stage `n` (1 base, 2 upstream, 3 replayed commit) of a conflicted path, or null. */
function stage(vault, n, file) {
  const res = git(vault, ['show', `:${n}:${file}`], { raw: true });
  return res.ok ? res.out : null;
}

/**
 * Resolve the conflicts of the current rebase step, if they are all ours to resolve.
 * @returns {{ok: true, index: boolean}|{ok: false, files: string[]}}
 */
function resolveStep(vault) {
  const listed = git(vault, ['diff', '--name-only', '--diff-filter=U']);
  const files = listed.ok ? listed.out.split('\n').filter(Boolean) : [];
  const foreign = files.filter((f) => f !== LOG_FILE && f !== INDEX_FILE);
  if (foreign.length) return { ok: false, files: foreign };

  let index = false;
  for (const file of files) {
    if (file === INDEX_FILE) {
      // Any version will do: the whole file is rebuilt once the rebase ends.
      if (!git(vault, ['checkout', '--ours', '--', file]).ok) return { ok: false, files: [file] };
      index = true;
    } else {
      const [base, ours, theirs] = [1, 2, 3].map((n) => stage(vault, n, file));
      const merged = base !== null && ours !== null && theirs !== null
        ? resolveAppendOnly(base, ours, theirs)
        : null;
      if (merged === null) return { ok: false, files: [file] };
      fs.writeFileSync(path.join(vault, file), merged, 'utf8');
    }
    if (!git(vault, ['add', '--', file]).ok) return { ok: false, files: [file] };
  }
  return { ok: true, index };
}

/**
 * Replay local commits onto `ref`, resolving log.md and index.md along the way.
 *
 * Anything else that conflicts aborts the rebase, so the branch is exactly as it
 * was before the call — never left mid-rebase for the next session to trip over.
 *
 * @returns {{ok: true, indexRebuilt: boolean}|{ok: false, detail: string}}
 */
function rebaseOnto(vault, ref, regenerateIndex) {
  const editor = ['-c', 'core.editor=true'];
  let res = git(vault, [...editor, 'rebase', ref]);
  let index = false;

  for (let step = 0; !res.ok && step < MAX_REBASE_STEPS; step++) {
    if (!rebaseInProgress(vault)) return { ok: false, detail: `rebase failed (${firstLine(res.err || res.out)})` };
    const resolved = resolveStep(vault);
    if (!resolved.ok) {
      git(vault, ['rebase', '--abort']);
      return { ok: false, detail: `conflict in ${resolved.files.join(', ')}` };
    }
    index ||= resolved.index;
    res = git(vault, [...editor, 'rebase', '--continue']);
  }
  if (!res.ok) {
    git(vault, ['rebase', '--abort']);
    return { ok: false, detail: `rebase did not finish (${firstLine(res.err || res.out)})` };
  }

  if (!index) return { ok: true, indexRebuilt: false };
  try {
    regenerateIndex(vault);
  } catch (e) {
    return { ok: false, detail: `rebased, but index.md could not be regenerated (${firstLine(e.message)})` };
  }
  if (isDirty(vault)) {
    const added = git(vault, ['add', '-A']);
    const made = added.ok && git(vault, ['commit', '-m', INDEX_SUBJECT]);
    if (!made || !made.ok) return { ok: false, detail: 'rebased, but the regenerated index.md could not be committed' };
  }
  return { ok: true, indexRebuilt: true };
}

// --- commit message ---

/**
 * Derive the commit subject from the last entry appended to log.md.
 *
 * Rule 6 of the wiki-schema skill fixes that header's shape, so the write cycle
 * has already named itself — asking the model for a message again would only
 * add a step that can be skipped.
 */
export function subjectFromLog(vault) {
  const logPath = path.join(vault, 'log.md');
  let tail;
  try {
    const { size } = fs.statSync(logPath);
    const start = Math.max(0, size - LOG_TAIL_BYTES);
    const fd = fs.openSync(logPath, 'r');
    try {
      const buf = Buffer.alloc(size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      tail = buf.toString('utf8');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return FALLBACK_SUBJECT;
  }

  const lines = tail.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = LOG_ENTRY_RE.exec(lines[i]);
    if (m) return `${m[2]}(vault): ${m[3]}`;
  }
  return FALLBACK_SUBJECT;
}

// --- operations ---

/**
 * Fetch, then bring the branch level with the remote.
 *
 * A branch that is only behind is fast-forwarded, past uncommitted work as long
 * as no incoming commit touches it. A branch with local commits is rebased onto
 * the remote (see rebaseOnto for what it resolves), but only on a clean tree.
 * Uncommitted work is never moved or stashed: it is not this function's to touch.
 *
 * @param {object} [opts]
 * @param {(vault: string) => void} [opts.regenerateIndex] index rebuild after a rebase
 */
export function sync(vault, { regenerateIndex = lintWriteIndex } = {}) {
  if (!isRepo(vault)) return { status: 'not-a-repo', detail: 'vault is not a git repository', exit: 0 };
  if (!git(vault, ['remote']).out) return { status: 'no-upstream', detail: 'vault has no remote', exit: 0 };

  const fetched = git(vault, ['fetch', '--quiet'], { timeout: NETWORK_TIMEOUT_MS });
  if (!fetched.ok) {
    return { status: 'offline', detail: `fetch failed — working from the local copy (${firstLine(fetched.err)})`, exit: 0 };
  }

  const remote = remoteRef(vault);
  if (!remote) return { status: 'no-upstream', detail: 'branch has no counterpart on the remote', exit: 0 };

  const d = divergence(vault, remote.ref);
  if (!d) return { status: 'unknown', detail: 'could not compare with the remote', exit: 0 };
  if (d.behind === 0) {
    return d.ahead > 0
      ? { status: 'ahead', detail: `${d.ahead} local commit(s) not pushed yet`, exit: 0 }
      : { status: 'up-to-date', detail: 'vault matches the remote', exit: 0 };
  }

  if (d.ahead > 0) {
    if (isDirty(vault)) {
      return {
        status: 'dirty',
        detail: `${d.behind} remote and ${d.ahead} local commit(s) diverged but the working tree has uncommitted changes — commit or stash, then sync`,
        exit: 1,
      };
    }
    const rebased = rebaseOnto(vault, remote.ref, regenerateIndex);
    if (!rebased.ok) {
      return {
        status: 'rebase-conflict',
        detail: `${d.behind} remote and ${d.ahead} local commit(s) diverged and could not be rebased: ${rebased.detail} — resolve before writing`,
        exit: 1,
      };
    }
    return { status: 'rebased', detail: `${d.ahead} local commit(s) rebased onto ${d.behind} remote commit(s) — not pushed yet`, exit: 0 };
  }

  // Uncommitted work is normal here (research leaves raw/ files until its write
  // cycle). git refuses the fast-forward, changing nothing, exactly when an
  // incoming commit touches one of those paths — so that is the only refusal.
  const merged = git(vault, ['merge', '--ff-only', remote.ref]);
  if (!merged.ok) {
    if (isDirty(vault) && /overwritten|local changes|untracked working tree/i.test(`${merged.err}\n${merged.out}`)) {
      return {
        status: 'dirty',
        detail: `${d.behind} remote commit(s) touch files with uncommitted changes — commit or stash those, then sync`,
        exit: 1,
      };
    }
    return { status: 'pull-failed', detail: `fast-forward failed (${firstLine(merged.err)})`, exit: 1 };
  }
  return { status: 'pulled', detail: `fast-forwarded ${d.behind} commit(s) from the remote`, exit: 0 };
}

/**
 * Stage the whole vault, commit under the log-derived subject, push.
 *
 * `git add -A` is deliberate: the unit being synchronized is the vault, not one
 * agent's edits, so anything left uncommitted here is what goes missing on the
 * next machine.
 *
 * A push rejected because another machine moved the branch is fetched, rebased
 * and pushed once more; only a conflict rebaseOnto cannot resolve is handed back.
 *
 * @param {object} [opts]
 * @param {(vault: string) => void} [opts.regenerateIndex] index rebuild after a rebase
 */
export function commit(vault, { regenerateIndex = lintWriteIndex } = {}) {
  if (!isRepo(vault)) return { status: 'not-a-repo', detail: 'vault is not a git repository', exit: 0 };

  let committed = null;
  if (isDirty(vault)) {
    const staged = git(vault, ['add', '-A']);
    if (!staged.ok) return { status: 'commit-failed', detail: `git add failed (${firstLine(staged.err)})`, exit: 1 };

    const subject = subjectFromLog(vault);
    const res = git(vault, ['commit', '-m', subject]);
    if (!res.ok) return { status: 'commit-failed', detail: `git commit failed (${firstLine(res.err)})`, exit: 1 };
    committed = subject;
  }

  const remote = remoteRef(vault);
  if (!remote) {
    return committed
      ? { status: 'committed', detail: `${committed} — no remote counterpart, nothing pushed`, exit: 0 }
      : { status: 'nothing-to-commit', detail: 'vault has no uncommitted change', exit: 0 };
  }

  const d = divergence(vault, remote.ref);
  if (d && d.ahead === 0) {
    return committed
      ? { status: 'pushed', detail: `${committed} — already on the remote`, exit: 0 }
      : { status: 'nothing-to-commit', detail: 'vault has no uncommitted change', exit: 0 };
  }

  // Always name the refspec: an untracked branch has no default push target.
  const push = () => git(vault, ['push', 'origin', `HEAD:${remote.branch}`], { timeout: NETWORK_TIMEOUT_MS });
  const label = committed || 'local commits';
  let pushed = push();
  let rebasedNote = '';

  if (!pushed.ok && isRejected(pushed)) {
    const fetched = git(vault, ['fetch', '--quiet'], { timeout: NETWORK_TIMEOUT_MS });
    if (!fetched.ok) {
      return { status: 'push-rejected', detail: `${label} — push rejected and fetch failed (${firstLine(fetched.err)}). The commit is safe locally.`, exit: 1 };
    }
    const rebased = rebaseOnto(vault, remote.ref, regenerateIndex);
    if (!rebased.ok) {
      return {
        status: 'rebase-conflict',
        detail: `${label} — the remote has newer commits and the rebase stopped: ${rebased.detail}. The commit is safe locally; resolve that file, then push.`,
        exit: 1,
      };
    }
    rebasedNote = rebased.indexRebuilt ? ' (rebased onto the remote, index.md regenerated)' : ' (rebased onto the remote)';
    pushed = push();
  }

  if (!pushed.ok) {
    const rejected = isRejected(pushed);
    const detail = rejected
      ? `${label} — push rejected again; another machine is pushing right now. The commit is safe locally — run sync, then push.`
      : `${label} — push failed (${firstLine(`${pushed.err}\n${pushed.out}`)}). The commit is safe locally.`;
    return { status: rejected ? 'push-rejected' : 'push-failed', detail, exit: 1 };
  }

  const n = d ? d.ahead : 1;
  return { status: 'pushed', detail: `${committed || `${n} commit(s)`} — pushed to the remote${rebasedNote}`, exit: 0 };
}

/** A rejected push means another machine moved the branch, not a broken link. */
function isRejected(res) {
  return /\[rejected\]|non-fast-forward|fetch first/i.test(`${res.err}\n${res.out}`);
}

// --- CLI ---

function firstLine(text) {
  return (text || '').split('\n').map((l) => l.trim()).filter(Boolean)[0] || 'no detail';
}

export function format(result) {
  return `GIT ${result.status} — ${result.detail}`;
}

function main(argv) {
  const command = argv.find((a) => !a.startsWith('-'));
  let vault = process.env.WIKI_PATH || process.env.OBSIDIAN_VAULT_PATH || '';
  const flag = argv.indexOf('--vault');
  if (flag !== -1 && argv[flag + 1]) vault = argv[flag + 1];

  if (!command || !['sync', 'commit'].includes(command)) {
    process.stderr.write('usage: vault-git.mjs <sync|commit> [--vault PATH]\n');
    process.exit(2);
  }
  if (!vault || !fs.existsSync(vault)) {
    process.stderr.write('vault-git: no vault — set WIKI_PATH or pass --vault\n');
    process.exit(2);
  }

  const result = command === 'sync' ? sync(vault) : commit(vault);
  process.stdout.write(`${format(result)}\n`);
  process.exit(result.exit);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main(process.argv.slice(2));
