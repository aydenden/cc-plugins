/**
 * Reads a workflow spec (`.claude/<plugin>.spec.jsonc`): comment stripping, structure validation,
 * and the axis list of a stage. Pure — file access lives in `spec-file.mjs`.
 *
 * Copied into every generated plugin, so it uses `node:` builtins only.
 */

/**
 * The axis every coverage check asks on its own; a spec must not declare it.
 * Its definition is owned by `references/axis-patterns.md`.
 */
export const RESERVED_AXIS_ID = 'unlisted';

/** The evidence kinds a stage can list under `checks`. Owned by `references/evidence-patterns.md`. */
export const CHECK_KINDS = ['existence', 'citation', 'execution', 'invariant', 'negation', 'coverage'];

const STAGE_KINDS = ['seam', 'delegate'];

/** Checks that read a document, so the hooks need the stage's artifact to find it. */
const DOCUMENT_CHECKS = ['coverage', 'citation', 'negation'];

/** A spec that cannot be used. `problems` holds one line per defect. */
export class SpecError extends Error {
  /**
   * @param {string} message
   * @param {string[]} [problems]
   */
  constructor(message, problems = [message]) {
    super(message);
    this.name = 'SpecError';
    this.problems = problems;
  }
}

/**
 * 1-based `line:column` of an offset.
 *
 * @param {string} text
 * @param {number} offset
 * @returns {string}
 */
function lineColumn(text, offset) {
  const before = text.slice(0, offset);
  const line = before.split('\n').length;
  return `${line}:${offset - before.lastIndexOf('\n')}`;
}

/**
 * Walks JSONC text and calls `visit(index, char, inString)` for every character outside comments.
 * Comment characters are reported through `onComment(index)` instead.
 */
function scan(text, { visit = () => {}, onComment = () => {} }) {
  let inString = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      visit(i, char, true);
      if (char === '\\') {
        i += 1;
        if (i < text.length) visit(i, text[i], true);
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      visit(i, char, true);
      continue;
    }
    if (char === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n' && text[i] !== '\r') {
        onComment(i);
        i += 1;
      }
      i -= 1;
      continue;
    }
    if (char === '/' && text[i + 1] === '*') {
      const end = text.indexOf('*/', i + 2);
      if (end === -1) throw new SpecError(`unterminated block comment at ${lineColumn(text, i)}`);
      for (; i < end + 2; i += 1) onComment(i);
      i -= 1;
      continue;
    }
    visit(i, char, false);
  }
}

/**
 * Blanks out `//` and block comments. Offsets and line breaks are kept, so a position in the
 * result is the same position in the original.
 *
 * @param {string} text JSONC source
 * @returns {string} JSON source of the same length
 */
export function stripJsonComments(text) {
  const out = text.split('');
  scan(text, {
    onComment: (i) => {
      if (out[i] !== '\n' && out[i] !== '\r') out[i] = ' ';
    },
  });
  return out.join('');
}

/** Offset of the first comma that is followed only by whitespace and a closing bracket, or -1. */
function trailingCommaOffset(json) {
  let comma = -1;
  let found = -1;
  scan(json, {
    visit: (i, char, inString) => {
      if (found !== -1) return;
      if (!inString && char === ',') comma = i;
      else if (!inString && (char === '}' || char === ']') && comma !== -1) found = comma;
      else if (inString || !/\s/.test(char)) comma = -1;
    },
  });
  return found;
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isText = (value) => typeof value === 'string' && value.trim() !== '';
const isTextList = (value) => Array.isArray(value) && value.every(isText);

function compiles(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch {
    return false;
  }
}

function validateStage(stage, at, spec, seen, problems) {
  if (!isObject(stage)) {
    problems.push(`${at}: must be an object`);
    return;
  }
  if (!isText(stage.id)) problems.push(`${at}.id: must be a non-empty string`);
  else if (seen.stageIds.has(stage.id)) problems.push(`${at}.id: duplicate stage id '${stage.id}'`);
  else seen.stageIds.add(stage.id);

  if (!STAGE_KINDS.includes(stage.kind)) problems.push(`${at}.kind: must be one of ${STAGE_KINDS.join(', ')}`);
  if (stage.kind === 'delegate' && !isText(stage.delegate_to)) {
    problems.push(`${at}.delegate_to: a delegate stage must name the skill it calls`);
  }

  const checks = stage.checks ?? [];
  if (!Array.isArray(checks)) {
    problems.push(`${at}.checks: must be a list`);
  } else {
    const unknown = checks.filter((check) => !CHECK_KINDS.includes(check));
    if (unknown.length > 0) {
      problems.push(`${at}.checks: unknown check ${unknown.map((c) => `'${c}'`).join(', ')} (known: ${CHECK_KINDS.join(', ')})`);
    }
  }
  const listed = Array.isArray(checks) ? checks : [];

  if (listed.includes('coverage')) {
    if (!isText(stage.axes)) problems.push(`${at}.axes: a coverage stage must name a key of the top-level axes`);
    else if (!Array.isArray(spec.axes?.[stage.axes])) problems.push(`${at}.axes: no axes key '${stage.axes}'`);
  }

  if (stage.invariants !== undefined) {
    if (!Array.isArray(stage.invariants)) problems.push(`${at}.invariants: must be a list`);
    else {
      stage.invariants.forEach((invariant, i) => {
        if (!isObject(invariant)) return problems.push(`${at}.invariants[${i}]: must be an object`);
        if (!isText(invariant.name)) problems.push(`${at}.invariants[${i}].name: must be a non-empty string`);
        if (!isTextList(invariant.run) || invariant.run.length === 0) {
          problems.push(`${at}.invariants[${i}].run: must be a non-empty argument array, not a shell string`);
        }
      });
    }
  }

  if (stage.preview !== undefined && !isText(stage.preview)) problems.push(`${at}.preview: must be a path string`);

  // The close gate reaches a preview and the invariants through the stage's document.
  const needsArtifact =
    listed.some((check) => DOCUMENT_CHECKS.includes(check)) || (stage.invariants?.length ?? 0) > 0 || stage.preview !== undefined;
  if (stage.artifact === undefined) {
    if (needsArtifact) {
      problems.push(`${at}.artifact: required — the hooks find this stage's document by artifact.type and artifact.dirs`);
    }
    return;
  }
  if (!isObject(stage.artifact)) {
    problems.push(`${at}.artifact: must be an object`);
    return;
  }
  const { type, dirs } = stage.artifact;
  if (!isText(type)) problems.push(`${at}.artifact.type: must be a non-empty string`);
  else if (seen.artifactTypes.has(type)) {
    problems.push(`${at}.artifact.type: '${type}' already belongs to stage '${seen.artifactTypes.get(type)}'`);
  } else seen.artifactTypes.set(type, stage.id);
  if (!isTextList(dirs) || dirs.length === 0) problems.push(`${at}.artifact.dirs: must list at least one folder`);
}

function validateAxes(axes, problems) {
  if (axes === undefined) return;
  if (!isObject(axes)) {
    problems.push('axes: must be an object of <key>: [axis, ...]');
    return;
  }
  for (const [key, list] of Object.entries(axes)) {
    if (!Array.isArray(list)) {
      problems.push(`axes.${key}: must be a list`);
      continue;
    }
    const ids = new Set();
    list.forEach((axis, i) => {
      const at = `axes.${key}[${i}].id`;
      if (!isObject(axis) || !isText(axis.id)) return problems.push(`${at}: must be a non-empty string`);
      if (axis.id.trim().toLowerCase() === RESERVED_AXIS_ID) {
        return problems.push(`${at}: '${RESERVED_AXIS_ID}' is reserved — the coverage check asks it in every document`);
      }
      if (ids.has(axis.id)) return problems.push(`${at}: duplicate axis id '${axis.id}'`);
      ids.add(axis.id);
    });
  }
}

function validateCitations(citations, used, problems) {
  if (citations === undefined) {
    if (used) problems.push('citations: required by a stage that lists the citation check');
    return;
  }
  if (!isObject(citations)) {
    problems.push('citations: must be an object');
    return;
  }
  for (const key of ['file_extensions', 'path_roots', 'search_roots', 'index_roots']) {
    if (citations[key] !== undefined && !isTextList(citations[key])) problems.push(`citations.${key}: must be a list of strings`);
  }
  const marksCitations = ['file_extensions', 'path_roots'].some((key) => isTextList(citations[key]) && citations[key].length > 0);
  if (used && !marksCitations) {
    problems.push('citations: needs file_extensions or path_roots — without one no backtick token counts as a citation');
  }
  const ignored = citations.ignore_patterns ?? [];
  if (!Array.isArray(ignored)) {
    problems.push('citations.ignore_patterns: must be a list');
    return;
  }
  ignored.forEach((entry, i) => {
    const at = `citations.ignore_patterns[${i}]`;
    if (!isObject(entry)) return problems.push(`${at}: must be an object`);
    if (!isText(entry.pattern) || !compiles(entry.pattern)) problems.push(`${at}.pattern: must be a regular expression that compiles`);
    if (!isText(entry.why)) problems.push(`${at}.why: say what the pattern ignores`);
  });
}

function validateNegation(negation, used, problems) {
  if (negation === undefined && !used) return;
  if (negation !== undefined && !isObject(negation)) {
    problems.push('negation: must be an object');
    return;
  }
  for (const key of ['claim', 'proof']) {
    const pattern = negation?.[key];
    if (!isText(pattern) || !compiles(pattern)) problems.push(`negation.${key}: must be a regular expression that compiles`);
  }
}

/**
 * Every structural defect of a parsed spec, one line each.
 *
 * @param {unknown} spec
 * @returns {string[]}
 */
function structureProblems(spec) {
  if (!isObject(spec)) return ['spec: the top level must be an object'];
  const problems = [];
  if (spec.schema !== 1) problems.push('schema: must be 1');
  if (!isText(spec.workflow)) problems.push('workflow: must be a non-empty string');
  if (spec.domain !== null && !isText(spec.domain)) problems.push('domain: must be an axis-store domain name or null');

  validateAxes(spec.axes, problems);

  const stages = Array.isArray(spec.stages) ? spec.stages : [];
  if (stages.length === 0) problems.push('stages: must be a non-empty list');
  const seen = { stageIds: new Set(), artifactTypes: new Map() };
  stages.forEach((stage, i) => validateStage(stage, `stages[${i}]`, spec, seen, problems));

  const uses = (check) => stages.some((stage) => Array.isArray(stage?.checks) && stage.checks.includes(check));
  validateCitations(spec.citations, uses('citation'), problems);
  validateNegation(spec.negation, uses('negation'), problems);
  return problems;
}

/**
 * Parses and validates spec source.
 *
 * @param {string} text JSONC source; `//` and block comments allowed, trailing commas not
 * @returns {object} the spec
 * @throws {SpecError} on a syntax error or any structural defect (all of them listed)
 */
export function parseSpec(text) {
  const json = stripJsonComments(String(text ?? ''));
  const comma = trailingCommaOffset(json);
  if (comma !== -1) throw new SpecError(`trailing comma at ${lineColumn(json, comma)} — the spec is JSON with comments, nothing more`);

  let spec;
  try {
    spec = JSON.parse(json);
  } catch (error) {
    throw new SpecError(`not valid JSON: ${error.message}`);
  }
  const problems = structureProblems(spec);
  if (problems.length > 0) throw new SpecError(`invalid spec:\n  ${problems.join('\n  ')}`, problems);
  return spec;
}

/**
 * Axis ids under one key of the top-level `axes`, in spec order.
 *
 * @param {object} spec a spec returned by `parseSpec`
 * @param {string} key the value of a stage's `axes`
 * @returns {string[]}
 * @throws {SpecError} when the spec has no such key
 */
export function axisIds(spec, key) {
  const list = spec.axes?.[key];
  if (!Array.isArray(list)) throw new SpecError(`no axes key '${key}'`);
  return list.map((axis) => axis.id);
}
