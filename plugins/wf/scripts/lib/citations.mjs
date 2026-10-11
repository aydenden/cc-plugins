/**
 * Verifies that every path a document cites exists. Catches the most expensive hallucination:
 * grounding a claim in a file that is not there. Pure — the filesystem is behind `lookup`,
 * provided by `citations-file.mjs`.
 *
 * What counts as a citation and where it is looked for come from the spec's `citations`; the
 * rule is owned by `references/evidence-patterns.md`.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */
import { posix } from 'node:path';

/**
 * File paths a document cites, in order of first appearance.
 *
 * A backtick token counts only when it ends in a known file extension or starts with a known
 * folder; otherwise API identifiers, domain names and package names read as paths.
 *
 * @param {string} text the document
 * @param {{file_extensions?: string[], path_roots?: string[], ignore_patterns?: {pattern: string}[]}} citations
 * @returns {string[]} cited paths without `:line` or `#anchor` suffixes
 */
export function citedPaths(text, citations) {
  const extensions = citations.file_extensions ?? [];
  const roots = citations.path_roots ?? [];
  const ignored = (citations.ignore_patterns ?? []).map(({ pattern }) => new RegExp(pattern));
  const found = new Set();
  for (const [, raw] of String(text ?? '').matchAll(/`([^`\r\n]+)`/g)) {
    const token = raw.trim().replace(/:\d+(-\d+)?$/, '').replace(/#.*$/, '');
    if (token === '' || /^(https?|file):\/\//.test(token) || token.startsWith('~')) continue;
    if (/[\s<>*…{}$=()|,[\]]/.test(token)) continue;
    const extension = /\.([A-Za-z0-9]{1,6})$/.exec(token)?.[1];
    // A leading slash without a file extension is a URL path (/docs/guides), not a repo path.
    const rooted = !token.startsWith('/') && token.includes('/') && roots.includes(token.split('/')[0]);
    if (!extensions.includes(extension) && !rooted) continue;
    if (ignored.some((pattern) => pattern.test(token))) continue;
    found.add(token);
  }
  return [...found];
}

/**
 * Whether a cited path resolves. Tried in order: repository root, the citing document's folder,
 * each of `search_roots`, then any file under `index_roots` whose path ends with the citation.
 *
 * @param {string} path a cited path
 * @param {string} docPath the citing document, relative to the repository root, `/`-separated
 * @param {{search_roots?: string[], index_roots?: string[]}} citations
 * @param {{exists: (path: string) => boolean, index: (roots: string[]) => string[]}} lookup
 *   paths are relative to the repository root and `/`-separated
 * @returns {boolean}
 */
export function resolves(path, docPath, citations, lookup) {
  const bare = path.replace(/^\/+/, '').replace(/\/+$/, '');
  const folders = ['.', posix.dirname(docPath), ...(citations.search_roots ?? [])];
  if (folders.some((folder) => lookup.exists(posix.join(folder, bare)))) return true;
  const tail = posix.normalize(bare);
  return lookup.index(citations.index_roots ?? []).some((entry) => entry === tail || entry.endsWith(`/${tail}`));
}

/**
 * Cited paths of a document that do not resolve.
 *
 * @param {{text: string, docPath: string, citations: object, lookup: {exists: Function, index: Function}}} args
 * @returns {string[]}
 */
export function missingCitations({ text, docPath, citations, lookup }) {
  return citedPaths(text, citations).filter((path) => !resolves(path, docPath, citations, lookup));
}

/**
 * The lines a citation run prints and whether it blocks.
 *
 * @param {{docPath: string, missing: string[], bypassed?: string[]}} args
 *   `bypassed` are cited paths a bypass let through
 * @returns {{lines: string[], failed: boolean}}
 */
export function citationReport({ docPath, missing, bypassed = [] }) {
  const skipped = new Set(bypassed);
  const open = missing.filter((path) => !skipped.has(path));
  if (open.length === 0) return { lines: [], failed: false };
  return {
    lines: [
      ...open.map((path) => `MISSING ${path}  (cited in ${docPath})`),
      `check-citations: ${open.length} unverifiable citation(s). A path that does not exist is not evidence.`,
    ],
    failed: true,
  };
}
