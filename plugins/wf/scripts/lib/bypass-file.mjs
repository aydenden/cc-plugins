/**
 * File and git adapter for the bypass marker and its log. The decision is in `bypass.mjs`.
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { MARKER_PATH, applyBypass } from './bypass.mjs';

/** File content, or `fallback` when the file does not exist. Any other failure propagates. */
function readOr(path, fallback) {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

/**
 * Where bypasses are recorded: `WF_BYPASS_LOG`, else `<git common dir>/wf-bypass.log` — shared by
 * every worktree and never committed — else `.claude/wf-bypass.log` outside a repository.
 *
 * @param {string} cwd project root
 * @param {Record<string, string|undefined>} env
 * @returns {string} absolute path
 */
export function bypassLogPath(cwd, env) {
  if (env.WF_BYPASS_LOG) return resolve(cwd, env.WF_BYPASS_LOG);
  let dir = '.claude';
  try {
    dir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // not a repository, or no git: the fallback above stands
  }
  return resolve(cwd, dir, 'wf-bypass.log');
}

/** `YYYY-MM-DD` in local time. */
function localDate(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * Bypasses the failing targets the project's marker names, recording each in the log.
 *
 * @param {{check: string, targets: string[], cwd?: string, env?: Record<string, string|undefined>, now?: Date}} args
 *   `check` is the check's name as it appears in the log; `targets` are what it is failing on
 * @returns {{bypassed: string[], notices: string[]}}
 */
export function bypassFailing({ check, targets, cwd = process.cwd(), env = process.env, now = new Date() }) {
  const logPath = bypassLogPath(cwd, env);
  return applyBypass(
    { check, targets, today: localDate(now) },
    {
      logPath,
      readMarker: () => readOr(resolve(cwd, MARKER_PATH), null),
      readLog: () => readOr(logPath, ''),
      appendLog: (text) => appendFileSync(logPath, text),
    },
  );
}
