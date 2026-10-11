/**
 * Filesystem lookup for the citation check. The check itself is in `citations.mjs`.
 */
import { existsSync, readdirSync } from 'node:fs';
import { posix, resolve } from 'node:path';

const PRUNED_DIRS = new Set(['.git', 'node_modules', 'venv', '.venv', '__pycache__']);

/** Every file and folder under `folder`, as `/`-separated paths relative to `root`. */
function walk(root, folder, out) {
  let entries;
  try {
    entries = readdirSync(resolve(root, folder), { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.isDirectory() && PRUNED_DIRS.has(entry.name)) continue;
    const path = posix.join(folder, entry.name);
    out.push(path);
    if (entry.isDirectory()) walk(root, path, out);
  }
}

/**
 * Lookup over a repository checkout. The index is walked once, on first use: most citations
 * resolve before it is needed.
 *
 * @param {string} root repository root
 * @returns {{exists: (path: string) => boolean, index: (roots: string[]) => string[]}}
 */
export function repositoryLookup(root) {
  let indexed = null;
  return {
    exists: (path) => existsSync(resolve(root, path)),
    index: (roots) => {
      if (indexed === null) {
        indexed = [];
        for (const folder of roots) walk(root, posix.normalize(folder), indexed);
      }
      return indexed;
    },
  };
}
