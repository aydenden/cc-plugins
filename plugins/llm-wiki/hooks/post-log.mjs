#!/usr/bin/env node
/**
 * post-log.mjs — PostToolUse hook: run vault maintenance right after log.md is appended.
 *
 * Rule 6 of the wiki-schema skill appends one entry to `$WIKI/log.md` at the end of
 * every ingest, so that write is the single deterministic marker that a vault write
 * cycle just finished. This hook keys on it: index regeneration and the health check
 * stop depending on the model remembering to run them.
 *
 * Fires on every Write/Edit (the matcher is tool-name only) and exits immediately
 * unless the target is the vault's log.md — the common path costs one node startup.
 *
 * Dependency-free Node ESM: node: builtins only, so it runs on macOS / Linux /
 * Windows 11 with nothing but `node` on PATH.
 *
 * Output contract (ccp-hht): the summary goes back to the agent verbatim.
 * Clean vault -> systemMessage, exit 0. Error groups present -> stderr, exit 2, so
 * the feedback is fed back to Claude and acted on in place.
 *
 * The hook never blocks the user's work: any failure of its own (bad stdin, missing
 * vault, lint crash) exits 0 silently.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const LINT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'lint.mjs');
const LINT_TIMEOUT_MS = 60_000;

/** Read all of stdin. Hooks receive their payload there and nowhere else. */
function readStdin() {
  try {
    return fs.readFileSync(0, 'utf8');
  } catch {
    return '';
  }
}

/** Absolute, symlink-resolved path for comparison; falls back to the plain resolve. */
function canonical(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync.native(abs);
  } catch {
    return abs;
  }
}

function runLint(args) {
  return execFileSync(process.execPath, [LINT, ...args], {
    encoding: 'utf8',
    timeout: LINT_TIMEOUT_MS,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function main() {
  let payload;
  try {
    payload = JSON.parse(readStdin());
  } catch {
    return;
  }

  const filePath = payload?.tool_input?.file_path;
  if (typeof filePath !== 'string' || !filePath) return;

  const vault = process.env.WIKI_PATH || process.env.OBSIDIAN_VAULT_PATH;
  if (!vault || !fs.existsSync(vault)) return;

  if (canonical(filePath) !== canonical(path.join(vault, 'log.md'))) return;

  let summary;
  try {
    // Index regeneration and the health check are separate runs: --write-index
    // returns before any check executes.
    runLint(['--vault', vault, '--write-index']);
    summary = runLint(['--vault', vault]).trim();
  } catch {
    return;
  }
  if (!summary) return;

  const message = `[llm-wiki] log.md 기록 후 자동 정비 실행 (index 재생성 + 점검)\n${summary}`;

  if (/^LINT error=/.test(summary)) {
    // error groups are "fix now" — exit 2 puts stderr in front of the agent.
    process.stderr.write(
      `${message}\n볼트 쓰기는 정상 완료됐다. error 그룹을 지금 조치한다 — 상세는 ` +
        `node "$CLAUDE_PLUGIN_ROOT/scripts/lint.mjs" --vault "$WIKI" --group <id> --json.\n`,
    );
    process.exit(2);
  }

  process.stdout.write(`${JSON.stringify({ systemMessage: message })}\n`);
}

main();
