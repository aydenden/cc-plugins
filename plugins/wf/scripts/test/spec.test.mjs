import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { loadSpec } from '../lib/spec-file.mjs';
import { RESERVED_AXIS_ID, SpecError, axisIds, parseSpec, stripJsonComments } from '../lib/spec.mjs';

const TEMPLATES = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates');

/** A spec that passes, as an object: each test breaks one thing in it. */
function validSpec() {
  return {
    schema: 1,
    workflow: 'my-workflow',
    domain: null,
    stages: [
      {
        id: 'define',
        kind: 'seam',
        checks: ['coverage', 'citation'],
        axes: 'define',
        artifact: { type: 'definition', dirs: ['docs/issues'] },
      },
      { id: 'implement', kind: 'delegate', delegate_to: '/implement' },
    ],
    axes: { define: [{ id: 'behavior' }, { id: 'style' }] },
    citations: { file_extensions: ['md'], path_roots: ['docs'] },
  };
}

function problemsOf(spec) {
  try {
    parseSpec(JSON.stringify(spec));
  } catch (error) {
    assert.ok(error instanceof SpecError, `expected SpecError, got ${error}`);
    return error.problems.join('\n');
  }
  return '';
}

// --- stripJsonComments ---

test('strips line and block comments and leaves the JSON parseable', () => {
  const text = '{\n  // line\n  "a": 1, /* block\n spans lines */ "b": 2\n}';
  assert.deepEqual(JSON.parse(stripJsonComments(text)), { a: 1, b: 2 });
});

test('keeps // and /* */ that sit inside a string literal', () => {
  const text = '{ "url": "https://example.com/a", "glob": "src/**/*.ts", "c": "/* not a comment */" }';
  assert.deepEqual(JSON.parse(stripJsonComments(text)), {
    url: 'https://example.com/a',
    glob: 'src/**/*.ts',
    c: '/* not a comment */',
  });
});

test('an escaped quote does not end the string, an escaped backslash does not escape the quote', () => {
  const text = String.raw`{ "a": "say \"hi\" // still a string", "b": "ends in backslash \\" } // gone`;
  assert.deepEqual(JSON.parse(stripJsonComments(text)), {
    a: 'say "hi" // still a string',
    b: 'ends in backslash \\',
  });
});

test('preserves offsets and line breaks so a parse error points at the original text', () => {
  const text = '{ /* x */\r\n  "a": 1 // tail\n}';
  const stripped = stripJsonComments(text);
  assert.equal(stripped.length, text.length);
  assert.equal(stripped.indexOf('"a"'), text.indexOf('"a"'));
  assert.equal(stripped.split('\n').length, text.split('\n').length);
});

test('an unterminated block comment fails with its position', () => {
  assert.throws(() => stripJsonComments('{\n  "a": 1 /* never closed\n}'), (error) => {
    assert.ok(error instanceof SpecError);
    assert.match(error.message, /2:10/);
    return true;
  });
});

// --- parseSpec: syntax ---

test('reads a commented spec and lists the axis ids of a stage key', () => {
  const text = `{
    // the workflow spec
    "schema": 1,
    "workflow": "my-workflow",
    "domain": "frontend", /* axis-store domain */
    "stages": [
      { "id": "define", "kind": "seam", "checks": ["coverage"], "axes": "define",
        "artifact": { "type": "definition", "dirs": ["docs/issues"] } }
    ],
    "axes": { "define": [ { "id": "behavior", "ask": "what // does it do" }, { "id": "style" } ] }
  }`;
  assert.deepEqual(axisIds(parseSpec(text), 'define'), ['behavior', 'style']);
});

test('a trailing comma fails with its line and column', () => {
  const text = '{\n  "schema": 1,\n  "stages": [\n    { "id": "a" },\n  ]\n}';
  assert.throws(() => parseSpec(text), (error) => {
    assert.ok(error instanceof SpecError);
    assert.match(error.message, /trailing comma/i);
    assert.match(error.message, /4:18/);
    return true;
  });
});

test('a comma inside a string before a bracket is not a trailing comma', () => {
  const spec = validSpec();
  spec.workflow = 'a,]';
  assert.equal(parseSpec(JSON.stringify(spec)).workflow, 'a,]');
});

test('any other syntax error is reported as a SpecError', () => {
  assert.throws(() => parseSpec('{ "schema": 1 "workflow": "x" }'), SpecError);
  assert.throws(() => parseSpec(''), SpecError);
});

// --- parseSpec: structure ---

test('the valid baseline passes', () => {
  assert.equal(problemsOf(validSpec()), '');
});

test('🚨 the reserved axis id in any axes key is an error', () => {
  const spec = validSpec();
  spec.axes.other = [{ id: RESERVED_AXIS_ID }];
  assert.match(problemsOf(spec), /axes\.other\[0\]\.id.*unlisted.*reserved/);
});

test('reports every problem at once, not only the first', () => {
  const spec = validSpec();
  spec.schema = 2;
  spec.workflow = '';
  delete spec.domain;
  const problems = problemsOf(spec);
  assert.match(problems, /schema/);
  assert.match(problems, /workflow/);
  assert.match(problems, /domain/);
});

test('the top level must be an object', () => {
  assert.throws(() => parseSpec('[]'), SpecError);
  assert.throws(() => parseSpec('null'), SpecError);
});

test('stages must be a non-empty list of uniquely named seam or delegate stages', () => {
  const empty = validSpec();
  empty.stages = [];
  assert.match(problemsOf(empty), /stages/);

  const duplicated = validSpec();
  duplicated.stages[1].id = 'define';
  assert.match(problemsOf(duplicated), /stages\[1\]\.id.*duplicate/);

  const unknownKind = validSpec();
  unknownKind.stages[0].kind = 'step';
  assert.match(problemsOf(unknownKind), /stages\[0\]\.kind/);

  const noTarget = validSpec();
  delete noTarget.stages[1].delegate_to;
  assert.match(problemsOf(noTarget), /stages\[1\]\.delegate_to/);
});

test('an unknown check name is an error — a typo would switch the check off silently', () => {
  const spec = validSpec();
  spec.stages[0].checks = ['coverage', 'citations'];
  assert.match(problemsOf(spec), /stages\[0\]\.checks.*citations/);
});

test('a coverage stage must name an axes key that exists', () => {
  const missing = validSpec();
  delete missing.stages[0].axes;
  assert.match(problemsOf(missing), /stages\[0\]\.axes/);

  const dangling = validSpec();
  dangling.stages[0].axes = 'design';
  assert.match(problemsOf(dangling), /stages\[0\]\.axes.*design/);
});

test('a stage with a document check must declare the artifact the hooks look for', () => {
  for (const check of ['coverage', 'citation', 'negation']) {
    const spec = validSpec();
    spec.negation = { claim: 'not found', proof: 'rg ' };
    spec.stages[0].checks = [check];
    delete spec.stages[0].artifact;
    assert.match(problemsOf(spec), /stages\[0\]\.artifact/, check);
  }
});

test('artifact needs a type and at least one folder, and a type belongs to one stage', () => {
  const noDirs = validSpec();
  noDirs.stages[0].artifact.dirs = [];
  assert.match(problemsOf(noDirs), /stages\[0\]\.artifact\.dirs/);

  const noType = validSpec();
  delete noType.stages[0].artifact.type;
  assert.match(problemsOf(noType), /stages\[0\]\.artifact\.type/);

  const shared = validSpec();
  shared.stages.push({ id: 'screen', kind: 'seam', artifact: { type: 'definition', dirs: ['docs/screens'] } });
  assert.match(problemsOf(shared), /stages\[2\]\.artifact\.type.*definition/);
});

test('invariants are named argument arrays and need an artifact to run against', () => {
  const ok = validSpec();
  ok.stages[0].invariants = [{ name: 'overturn', run: ['node', 'scripts/check-overturn.mjs'] }];
  assert.equal(problemsOf(ok), '');

  const shellString = validSpec();
  shellString.stages[0].invariants = [{ name: 'overturn', run: 'node scripts/check-overturn.mjs' }];
  assert.match(problemsOf(shellString), /stages\[0\]\.invariants\[0\]\.run/);

  const noArtifact = validSpec();
  noArtifact.stages[1].invariants = [{ name: 'x', run: ['node', 'x.mjs'] }];
  assert.match(problemsOf(noArtifact), /stages\[1\]\.artifact/);
});

test('axis ids are non-empty and unique within a key', () => {
  const duplicated = validSpec();
  duplicated.axes.define.push({ id: 'style' });
  assert.match(problemsOf(duplicated), /axes\.define\[2\]\.id.*duplicate/);

  const blank = validSpec();
  blank.axes.define[0] = { ask: 'no id' };
  assert.match(problemsOf(blank), /axes\.define\[0\]\.id/);
});

test('a citation stage needs a rule that says which backtick tokens are citations', () => {
  const none = validSpec();
  delete none.citations;
  assert.match(problemsOf(none), /citations/);

  const empty = validSpec();
  empty.citations = { search_roots: ['docs'] };
  assert.match(problemsOf(empty), /citations.*file_extensions.*path_roots/);
});

test('an ignore pattern must compile and say why it is ignored', () => {
  const broken = validSpec();
  broken.citations.ignore_patterns = [{ pattern: '(', why: 'npm package' }];
  assert.match(problemsOf(broken), /citations\.ignore_patterns\[0\]\.pattern/);

  const noWhy = validSpec();
  noWhy.citations.ignore_patterns = [{ pattern: '^@' }];
  assert.match(problemsOf(noWhy), /citations\.ignore_patterns\[0\]\.why/);
});

test('a negation stage needs claim and proof patterns that compile — there is no default', () => {
  const none = validSpec();
  none.stages[0].checks = ['negation'];
  assert.match(problemsOf(none), /negation\.claim/);
  assert.match(problemsOf(none), /negation\.proof/);

  const broken = validSpec();
  broken.negation = { claim: '[', proof: 'rg ' };
  assert.match(problemsOf(broken), /negation\.claim/);
});

// --- axisIds ---

test('axisIds fails for a key the spec does not have', () => {
  assert.throws(() => axisIds(parseSpec(JSON.stringify(validSpec())), 'design'), SpecError);
});

// --- adapter and templates ---

test('loadSpec names the file in the error when the spec is unreadable or invalid', () => {
  const missing = () => {
    throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
  };
  assert.throws(() => loadSpec('.claude/x.spec.jsonc', missing), (error) => {
    assert.ok(error instanceof SpecError);
    assert.match(error.message, /\.claude\/x\.spec\.jsonc/);
    return true;
  });
  assert.throws(() => loadSpec('.claude/x.spec.jsonc', () => '{ "schema": 2 }'), /\.claude\/x\.spec\.jsonc/);
});

test('every shipped spec template passes the reader', () => {
  const templates = readdirSync(TEMPLATES).filter((name) => name.endsWith('.spec.jsonc'));
  assert.deepEqual(templates.sort(), ['spec-software-dev.spec.jsonc', 'workflow.spec.jsonc']);
  for (const name of templates) {
    const spec = loadSpec(join(TEMPLATES, name));
    assert.equal(spec.schema, 1, name);
  }
});

test('the format template shows a commented spec with axes, so the comment path is exercised', () => {
  const text = readFileSync(join(TEMPLATES, 'workflow.spec.jsonc'), 'utf8');
  assert.match(text, /\/\//);
  assert.ok(axisIds(parseSpec(text), 'define').length > 0);
});
