/**
 * Filesystem adapter for the dependency report: what is on PATH, which skills and plugins are
 * installed. The report itself is in `deps.mjs`.
 */
import { constants, accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

import { locate } from '../lib/skill-locate-file.mjs';
import { installedPlugins } from './deps.mjs';

/** Whether `path` is a file this process may execute. */
function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch (error) {
    if (['ENOENT', 'ENOTDIR', 'EACCES'].includes(error.code)) return false;
    throw error;
  }
}

/**
 * A probe over the real machine.
 *
 * @param {{env?: Record<string, string|undefined>, home?: string, platform?: string, cwd?: string}} [where]
 * @returns {{command: (name: string) => boolean, skill: (name: string) => boolean, plugin: (name: string) => boolean,
 *   skillName: (name: string) => string | null}} `skillName` is the name the skill is invoked by — a plugin's
 *   skill answers to `plugin:skill` — or null when it is not installed anywhere
 */
export function probe({ env = process.env, home = homedir(), platform = process.platform, cwd = process.cwd() } = {}) {
  const folders = (env.PATH ?? '').split(delimiter).filter(Boolean);
  // On Windows a command is found by its name plus one of PATHEXT.
  const suffixes = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  const record = join(home, '.claude', 'plugins', 'installed_plugins.json');
  const plugins = installedPlugins(existsSync(record) ? readFileSync(record, 'utf8') : null);
  return {
    command: (name) => folders.some((folder) => suffixes.some((suffix) => isExecutable(join(folder, `${name}${suffix}`)))),
    // wf's own skills are not somebody else's: asking for `retro` must not answer `wf:retro`.
    skill: (name) => locate(name, { cwd, home, self: 'wf' }) !== null,
    skillName: (name) => locate(name, { cwd, home, self: 'wf' })?.invoke ?? null,
    plugin: (name) => plugins.has(name),
  };
}
