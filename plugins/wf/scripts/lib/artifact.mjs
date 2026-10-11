/**
 * How the hooks find a stage's document: by path (which folders a stage watches) and by
 * frontmatter (which ticket and artifact type a document declares). Pure.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */
import { posix, win32 } from 'node:path';

/**
 * `file` relative to `root`, `/`-separated, or null when it lies outside.
 * Windows paths are handled on any host: the payload decides the flavour, not the machine.
 *
 * @param {string} root absolute project root
 * @param {string} file absolute or root-relative path
 * @returns {string|null}
 */
export function relativeTo(root, file) {
  const windows = [root, file].some((path) => /^[A-Za-z]:[\\/]/.test(path) || path.includes('\\'));
  const flavour = windows ? win32 : posix;
  const relative = flavour.relative(root, flavour.resolve(root, file));
  if (relative === '' || relative.startsWith('..') || flavour.isAbsolute(relative)) return null;
  return relative.split(flavour.sep).join('/');
}

/** Whether `path` is inside `folder`. Both are root-relative and `/`-separated. */
function isUnder(path, folder) {
  const base = posix.normalize(folder).replace(/\/+$/, '');
  return base === '.' || path.startsWith(`${base}/`);
}

/**
 * Stages whose `artifact.dirs` contain a document.
 *
 * @param {object} spec
 * @param {string} docPath root-relative, `/`-separated
 * @returns {object[]} stages, in spec order
 */
export function watchingStages(spec, docPath) {
  return spec.stages.filter((stage) => stage.artifact?.dirs.some((folder) => isUnder(docPath, folder)));
}

/**
 * The `type` and `ticket` a document declares in its frontmatter.
 *
 * Read line by line, and only these two plain `key: value` lines: a document may contain `---`
 * anywhere below, and a YAML parser is not available.
 *
 * @param {string} text the document
 * @returns {{type: string|null, ticket: string|null}}
 */
export function declared(text) {
  const lines = String(text ?? '').replace(/^﻿/, '').split(/\r?\n/);
  const found = { type: null, ticket: null };
  if (lines[0]?.trim() !== '---') return found;
  for (const line of lines.slice(1)) {
    if (line.trim() === '---') break;
    const match = /^(type|ticket):\s*(.*?)\s*$/.exec(line);
    if (match) found[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2') || null;
  }
  return found;
}
