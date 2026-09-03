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
 *   sync   — fetch, then fast-forward only when it is unambiguously safe.
 *            Called by the SessionStart hook.
 *   commit — stage everything, derive the message from the last log.md entry,
 *            push. Called by the PostToolUse hook after lint reports a clean
 *            vault.
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

// --- git plumbing ---

/**
 * Run one git command in the vault.
 * @returns {{ok: boolean, out: string, err: string}} — never throws, so every
 *   caller decides for itself whether a failure is fatal.
 */
function git(vault, args, { timeout = LOCAL_TIMEOUT_MS } = {}) {
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
    return { ok: true, out: out.trim(), err: '' };
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
 * Fetch and fast-forward, but only when the outcome is unambiguous.
 *
 * A dirty tree or a diverged branch is reported, never resolved here: merging
 * on the user's behalf at session start is how work gets silently mangled.
 */
export function sync(vault) {
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
    return {
      status: 'diverged',
      detail: `${d.behind} remote and ${d.ahead} local commit(s) have diverged — merge or rebase before writing`,
      exit: 1,
    };
  }
  if (isDirty(vault)) {
    return {
      status: 'dirty',
      detail: `${d.behind} remote commit(s) waiting but the working tree has uncommitted changes — commit or stash, then pull`,
      exit: 1,
    };
  }

  const merged = git(vault, ['merge', '--ff-only', remote.ref]);
  if (!merged.ok) {
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
 */
export function commit(vault) {
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
  const pushed = git(vault, ['push', 'origin', `HEAD:${remote.branch}`], { timeout: NETWORK_TIMEOUT_MS });
  if (!pushed.ok) {
    const err = `${pushed.err}\n${pushed.out}`;
    // A rejected push means another machine moved the branch: that needs a merge
    // decision, so it is handed to the agent rather than force-resolved here.
    const rejected = /\[rejected\]|non-fast-forward|fetch first/i.test(err);
    const detail = rejected
      ? `${committed || 'local commits'} — push rejected, the remote has newer commits. Pull (rebase or merge), then push.`
      : `${committed || 'local commits'} — push failed (${firstLine(err)}). The commit is safe locally.`;
    return { status: rejected ? 'push-rejected' : 'push-failed', detail, exit: 1 };
  }

  const n = d ? d.ahead : 1;
  return { status: 'pushed', detail: `${committed || `${n} commit(s)`} — pushed to the remote`, exit: 0 };
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
