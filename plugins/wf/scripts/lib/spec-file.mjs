/**
 * File adapter for the workflow spec. The parsing and validation it calls are in `spec.mjs`.
 */
import { readFileSync } from 'node:fs';

import { SpecError, parseSpec } from './spec.mjs';

/**
 * Reads and validates a spec file.
 *
 * @param {string} path spec path, e.g. `.claude/<plugin>.spec.jsonc`
 * @param {(path: string, encoding: 'utf8') => string} [read] file reader, replaced in tests
 * @returns {object} the spec
 * @throws {SpecError} naming the file, when it is unreadable or invalid
 */
export function loadSpec(path, read = readFileSync) {
  let text;
  try {
    text = read(path, 'utf8');
  } catch (error) {
    throw new SpecError(`${path}: cannot read spec (${error.message})`);
  }
  try {
    return parseSpec(text);
  } catch (error) {
    if (!(error instanceof SpecError)) throw error;
    throw new SpecError(`${path}: ${error.message}`, error.problems);
  }
}
