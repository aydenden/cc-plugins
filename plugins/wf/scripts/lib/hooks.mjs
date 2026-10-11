/**
 * The two hook bodies of a generated workflow plugin, wired to the real project: which spec to
 * read, where files are, how an invariant runs. The decisions are in `edit-gate.mjs` and
 * `close-gate.mjs`.
 *
 * The spec is `.claude/<plugin name>.spec.jsonc` in the project, with the name taken from the
 * plugin's own manifest — these scripts are copied unchanged into every generated plugin.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';

import { relativeTo } from './artifact.mjs';
import { bypassFailing } from './bypass-file.mjs';
import { MARKER_PATH } from './bypass.mjs';
import { repositoryLookup } from './citations-file.mjs';
import { closeGate, closedTickets } from './close-gate.mjs';
import { editGate } from './edit-gate.mjs';
import { loadSpec } from './spec-file.mjs';
import { SpecError } from './spec.mjs';

const BYPASS_HINT = `To bypass one target, say why: echo '<target>: <why>, <ticket>' >> ${MARKER_PATH} (remove the line when done).`;

/** The plugin's name and the project's spec path. */
function workflow(pluginRoot, projectRoot) {
  const { name } = JSON.parse(readFileSync(resolve(pluginRoot, '.claude-plugin', 'plugin.json'), 'utf8'));
  const specRelative = `.claude/${name}.spec.jsonc`;
  return { name, specRelative, specPath: resolve(projectRoot, specRelative) };
}

/**
 * The spec, or the exit-2 result that reports why it cannot be read. A hook that died on a broken
 * spec would exit 1, which the harness treats as a non-blocking error: the close would go through
 * and the model would never see the reason.
 */
function readSpec(name, specPath) {
  try {
    return { spec: loadSpec(specPath) };
  } catch (error) {
    if (!(error instanceof SpecError)) throw error;
    const stderr = `${name}: the workflow spec cannot be read, so no check can run. Fix it first.\n${error.message}\n`;
    return { broken: { exitCode: 2, stdout: '', stderr } };
  }
}

/** An exit-0 result that hands `lines` to the model. Plain stdout and stderr are not shown on exit 0. */
function passWith(hookEventName, lines) {
  if (lines.length === 0) return { exitCode: 0, stdout: '', stderr: '' };
  const additionalContext = lines.join('\n');
  return { exitCode: 0, stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName, additionalContext } })}\n`, stderr: '' };
}

/** Markdown files under the given folders, root-relative, sorted. A missing folder is empty. */
function markdownIn(projectRoot, dirs) {
  const found = new Set();
  const walk = (folder) => {
    if (!existsSync(resolve(projectRoot, folder))) return;
    for (const entry of readdirSync(resolve(projectRoot, folder), { withFileTypes: true })) {
      const path = posix.join(folder, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.name.toLowerCase().endsWith('.md')) found.add(path);
    }
  };
  dirs.forEach((folder) => walk(posix.normalize(folder)));
  return [...found].sort();
}

/**
 * PostToolUse(Write|Edit).
 *
 * @param {object} payload the hook payload (`tool_name`, `tool_input.file_path`, and `content` or `new_string`)
 * @param {{pluginRoot: string, env: Record<string, string|undefined>}} context
 * @returns {{exitCode: 0|2, stdout: string, stderr: string}} exit 2 hands stderr back to the model;
 *   the write itself has already happened. A pass that owes something to a bypass says so.
 */
export function postEdit(payload, { pluginRoot, env }) {
  const pass = { exitCode: 0, stdout: '', stderr: '' };
  const projectRoot = env.CLAUDE_PROJECT_DIR || payload.cwd;
  const file = payload.tool_input?.file_path;
  if (!projectRoot || !file) return pass;
  const docPath = relativeTo(projectRoot, file);
  const { name, specRelative, specPath } = workflow(pluginRoot, projectRoot);
  if (docPath === null || !existsSync(specPath)) return pass;
  if (docPath !== specRelative && !docPath.toLowerCase().endsWith('.md')) return pass;

  // A spec that cannot be read is every check switched off, so it is reported, not skipped.
  const { spec, broken } = readSpec(name, specPath);
  if (broken) return broken;
  const absolute = resolve(projectRoot, docPath);
  if (!existsSync(absolute)) return pass;

  const result = editGate({
    tool: payload.tool_name,
    docPath,
    text: readFileSync(absolute, 'utf8'),
    written: payload.tool_input.new_string ?? payload.tool_input.content ?? '',
    spec,
    io: {
      lookup: repositoryLookup(projectRoot),
      bypass: (request) => bypassFailing({ ...request, cwd: projectRoot, env }),
    },
  });
  if (result.failed) {
    const hint = `Fix the cited path, or if the token is not a file citation add it to citations.ignore_patterns in ${specRelative}.`;
    return { exitCode: 2, stdout: '', stderr: `${[...result.lines, hint, BYPASS_HINT].join('\n')}\n` };
  }
  const warnings = result.warnings.length > 0 ? [`${name}: warnings (not blocking).`, ...result.warnings] : [];
  return passWith('PostToolUse', [...result.lines, ...warnings]);
}

/**
 * PreToolUse(Bash).
 *
 * @param {object} payload the hook payload (`tool_input.command`)
 * @param {{pluginRoot: string, env: Record<string, string|undefined>}} context
 * @returns {{exitCode: 0|2, stdout: string, stderr: string}} exit 2 blocks the command. A close
 *   that passes because of a bypass says what was bypassed.
 */
export function preClose(payload, { pluginRoot, env }) {
  const pass = { exitCode: 0, stdout: '', stderr: '' };
  const projectRoot = env.CLAUDE_PROJECT_DIR || payload.cwd;
  const command = payload.tool_input?.command;
  // Cheap exit for the common case: this hook sees every Bash call.
  if (!projectRoot || !command || !/\bbd\b/.test(command)) return pass;
  const { name, specPath } = workflow(pluginRoot, projectRoot);
  if (!existsSync(specPath)) return pass;
  // This hook sees every Bash call; a broken spec must not stand in the way of ones that close nothing.
  if (closedTickets(command).length === 0) return pass;
  const { spec, broken } = readSpec(name, specPath);
  if (broken) return broken;

  const result = closeGate({
    command,
    spec,
    io: {
      markdownIn: (dirs) => markdownIn(projectRoot, dirs),
      read: (path) => readFileSync(resolve(projectRoot, path), 'utf8'),
      exists: (path) => existsSync(resolve(projectRoot, path)),
      // Invariant commands are written relative to the plugin, so they run there; the document
      // goes in as an absolute path and the project root as CLAUDE_PROJECT_DIR.
      runInvariant: (run, docPath) => {
        const done = spawnSync(run[0], [...run.slice(1), resolve(projectRoot, docPath)], {
          cwd: pluginRoot,
          encoding: 'utf8',
          env: { ...env, CLAUDE_PROJECT_DIR: projectRoot },
        });
        if (done.error) return { ok: false, output: `could not run ${run.join(' ')}: ${done.error.message}` };
        return { ok: done.status === 0, output: `${done.stdout}${done.stderr}` || `exit ${done.status}` };
      },
      bypass: (request) => bypassFailing({ ...request, cwd: projectRoot, env }),
    },
  });
  if (!result.blocked) return passWith('PreToolUse', result.lines);
  const head = `${name}: bd close blocked — a document that declares the ticket does not pass its checks.`;
  return { exitCode: 2, stdout: '', stderr: `${[head, ...result.lines, 'Fix the document, then close again.', BYPASS_HINT].join('\n')}\n` };
}

/**
 * Runs a hook body as a process: payload on stdin, result on stdout, stderr and the exit code.
 *
 * @param {(payload: object, context: object) => {exitCode: number, stdout: string, stderr: string}} hook
 * @param {string} pluginRoot
 */
export function runHook(hook, pluginRoot) {
  const result = hook(JSON.parse(readFileSync(0, 'utf8')), { pluginRoot, env: process.env });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
