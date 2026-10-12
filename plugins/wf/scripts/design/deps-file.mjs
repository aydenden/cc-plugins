/**
 * Filesystem adapter for the dependency report: what is on PATH, which skills and plugins are
 * installed. The report itself is in `deps.mjs`.
 */
import { constants, accessSync, existsSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, join } from 'node:path';

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
 * @param {{env?: Record<string, string|undefined>, home?: string, platform?: string}} [where]
 * @returns {{command: (name: string) => boolean, skill: (name: string) => boolean, plugin: (name: string) => boolean}}
 */
export function probe({ env = process.env, home = homedir(), platform = process.platform } = {}) {
  const folders = (env.PATH ?? '').split(delimiter).filter(Boolean);
  // On Windows a command is found by its name plus one of PATHEXT.
  const suffixes = platform === 'win32' ? ['', ...(env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';')] : [''];
  const skillFolders = [join(home, '.agents', 'skills'), join(home, '.claude', 'skills')];
  const record = join(home, '.claude', 'plugins', 'installed_plugins.json');
  const plugins = installedPlugins(existsSync(record) ? readFileSync(record, 'utf8') : null);
  return {
    command: (name) => folders.some((folder) => suffixes.some((suffix) => isExecutable(join(folder, `${name}${suffix}`)))),
    skill: (name) => skillFolders.some((folder) => existsSync(join(folder, name))),
    plugin: (name) => plugins.has(name),
  };
}
