import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { postEdit, preClose } from '../lib/hooks.mjs';

const SCRIPTS = join(dirname(fileURLToPath(import.meta.url)), '..');
const PLUGIN_ROOT = join(SCRIPTS, '..');

// The spec is found by the plugin's own name, so the fixture project carries `.claude/wf.spec.jsonc`.
const SPEC = `{
  // fixture: a definition stage with coverage, a preview and one invariant
  "schema": 1,
  "workflow": "fixture",
  "domain": null,
  "stages": [
    {
      "id": "define",
      "kind": "seam",
      "checks": ["coverage", "citation", "negation"],
      "axes": "define",
      "artifact": { "type": "definition", "dirs": ["docs/issues"] },
      "preview": "docs/previews/<ticket>/index.html",
      // exits 1 for a document named *-oneway.md
      "invariants": [{ "name": "overturn", "run": ["node", "-e", "process.exit(process.argv.at(-1).endsWith('-oneway.md') ? 1 : 0)"] }]
    }
  ],
  "axes": { "define": [{ "id": "behavior" }, { "id": "style" }] },
  "citations": { "file_extensions": ["md"], "path_roots": ["docs"], "search_roots": ["docs"], "index_roots": ["docs"] },
  "negation": { "claim": "찾지 못", "proof": "rg |검색" }
}`;

const ROWS = {
  behavior: '| behavior | 목록을 조회해 표로 보인다 | 기획서 3.2절 |',
  style: '| style | 기존 토큰 준용 | 목업 |',
  unlisted: '| unlisted | 해당 없음 — 변경 파일 목록과 위 축을 대조했다 |',
};

const definition = (ticket, axes, body = '') =>
  ['---', 'type: definition', `ticket: ${ticket}`, '---', '', '| 축 | 정의 | 출처 |', '|---|---|---|', ...axes.map((axis) => ROWS[axis]), '', body].join('\n');

/** A throwaway project. `files` maps root-relative paths to content. */
function project(t, files = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wf-hooks-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const all = { '.claude/wf.spec.jsonc': SPEC, ...files };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(root, dirname(path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  const env = { CLAUDE_PROJECT_DIR: root, WF_BYPASS_LOG: join(root, 'bypass.log'), PATH: process.env.PATH };
  return { root, env, context: { pluginRoot: PLUGIN_ROOT, env } };
}

const closing = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const writing = (root, path, content) => ({ tool_name: 'Write', tool_input: { file_path: join(root, path), content } });

// --- preClose ---

test('🚨 closing a ticket whose document lacks an axis exits 2 with UNADDRESSED <axis>', (t) => {
  const { context } = project(t, {
    'docs/issues/t1-login.md': definition('abc-1', ['behavior', 'unlisted']),
    'docs/previews/abc-1/index.html': '<html>',
  });
  const result = preClose(closing('cd x && bd close abc-1 --reason "done"'), context);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /^wf: bd close blocked/);
  assert.match(result.stderr, /^UNADDRESSED style$/m);
  assert.match(result.stderr, /wf-skip-checks/);
});

test('a ticket whose document passes closes, and the invariant ran against it', (t) => {
  const { context } = project(t, {
    'docs/issues/t1-login.md': definition('abc-1', ['behavior', 'style', 'unlisted']),
    'docs/previews/abc-1/index.html': '<html>',
  });
  assert.deepEqual(preClose(closing('bd close abc-1'), context), { exitCode: 0, stdout: '', stderr: '' });
});

test('a failing invariant and a missing preview each block', (t) => {
  const { context } = project(t, {
    'docs/issues/t2-oneway.md': definition('abc-2', ['behavior', 'style', 'unlisted']),
    'docs/previews/abc-2/index.html': '<html>',
    'docs/issues/t3-board.md': definition('abc-3', ['behavior', 'style', 'unlisted']),
  });
  const invariant = preClose(closing('bd close abc-2'), context);
  assert.equal(invariant.exitCode, 2);
  assert.match(invariant.stderr, /\[abc-2 docs\/issues\/t2-oneway\.md invariant\(overturn\)\]/);

  const preview = preClose(closing('bd close abc-3'), context);
  assert.equal(preview.exitCode, 2);
  assert.match(preview.stderr, /^MISSING docs\/previews\/abc-3\/index\.html$/m);
});

test('a ticket with no document, and a command that is not bd close, pass', (t) => {
  const { context } = project(t, { 'docs/issues/t1-login.md': definition('abc-1', ['behavior']) });
  for (const command of ['bd close abc-9', 'bd show abc-1', 'git status', 'echo "bd close abc-1"']) {
    assert.equal(preClose(closing(command), context).exitCode, 0, command);
  }
});

test('a project without the spec is not gated', (t) => {
  const { root, context } = project(t, { 'docs/issues/t1-login.md': definition('abc-1', ['behavior']) });
  rmSync(join(root, '.claude/wf.spec.jsonc'));
  assert.equal(preClose(closing('bd close abc-1'), context).exitCode, 0);
});

test('🚨 a bypass in the marker passes the axis it names, is recorded, and leaves the rest blocking', (t) => {
  const { root, env, context } = project(t, {
    'docs/issues/t1-login.md': definition('abc-1', ['unlisted']),
    'docs/previews/abc-1/index.html': '<html>',
    '.claude/wf-skip-checks': 'style: 목업 미수령, abc-1\n',
  });
  const partial = preClose(closing('bd close abc-1'), context);
  assert.equal(partial.exitCode, 2);
  assert.match(partial.stderr, /^UNADDRESSED behavior$/m);
  assert.doesNotMatch(partial.stderr, /^UNADDRESSED style$/m);

  writeFileSync(join(root, '.claude/wf-skip-checks'), 'style: 목업 미수령, abc-1\nbehavior: 기획 확정 전, abc-1\n');
  const passed = preClose(closing('bd close abc-1'), context);
  assert.equal(passed.exitCode, 0);
  // A close that passed because of a bypass must not look like a close that passed its checks.
  const told = JSON.parse(passed.stdout).hookSpecificOutput;
  assert.equal(told.hookEventName, 'PreToolUse');
  assert.match(told.additionalContext, /check-coverage: bypass: style: 목업 미수령, abc-1/);
  assert.match(told.additionalContext, /check-coverage: bypass: behavior: 기획 확정 전, abc-1/);
  const log = readFileSync(env.WF_BYPASS_LOG, 'utf8').trim().split('\n');
  assert.equal(log.length, 2);
  assert.match(log[0], /^\d{4}-\d\d-\d\d check-coverage: style: 목업 미수령, abc-1$/);
});

test('🚨 a spec that cannot be read blocks the close and says why, instead of switching the checks off', (t) => {
  const { context } = project(t, { '.claude/wf.spec.jsonc': '{ "schema": 1, }' });
  const result = preClose(closing('bd close abc-1'), context);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /\.claude[\\/]wf\.spec\.jsonc/);
  assert.match(result.stderr, /trailing comma/);
});

test('a broken spec does not block bd commands that close nothing', (t) => {
  const { context } = project(t, { '.claude/wf.spec.jsonc': '{ "schema": 1, }' });
  for (const command of ['bd show abc-1', 'bd ready', 'git status']) {
    assert.equal(preClose(closing(command), context).exitCode, 0, command);
  }
});

test('a pass with no bypass prints nothing', (t) => {
  const { context } = project(t, {
    'docs/issues/t1-login.md': definition('abc-1', ['behavior', 'style', 'unlisted']),
    'docs/previews/abc-1/index.html': '<html>',
  });
  assert.deepEqual(preClose(closing('bd close abc-1'), context), { exitCode: 0, stdout: '', stderr: '' });
});

// --- postEdit ---

test('🚨 an edit whose missing citations are all bypassed passes and says what was bypassed', (t) => {
  const body = '근거는 `docs/ghost.md` 에 있다.';
  const { root, context } = project(t, {
    'docs/issues/t1-login.md': definition('abc-1', ['behavior'], body),
    '.claude/wf-skip-checks': 'docs/ghost.md: 다음 티켓에서 쓴다, abc-1\n',
  });
  const result = postEdit(writing(root, 'docs/issues/t1-login.md', definition('abc-1', ['behavior'], body)), context);
  assert.equal(result.exitCode, 0);
  const told = JSON.parse(result.stdout).hookSpecificOutput;
  assert.equal(told.hookEventName, 'PostToolUse');
  assert.match(told.additionalContext, /check-citations: bypass: docs\/ghost\.md: 다음 티켓에서 쓴다, abc-1/);
});

test('🚨 a spec that cannot be read is reported after an edit to a watched document', (t) => {
  const { root, context } = project(t, {
    '.claude/wf.spec.jsonc': '{ "schema": 1, }',
    'docs/issues/t1-login.md': definition('abc-1', ['behavior']),
  });
  const result = postEdit(writing(root, 'docs/issues/t1-login.md', 'x'), context);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /trailing comma/);
});

test('🚨 an existing file cited relative to the document is not MISSING; a file that does not exist is', (t) => {
  const { root, context } = project(t, { 'docs/issues/research/findings.md': '# findings' });
  const fine = definition('abc-1', ['behavior'], '근거: `research/findings.md`, `issues/research/findings.md`, `findings.md`');
  writeFileSync(join(root, 'docs/issues/t1-login.md'), fine);
  assert.deepEqual(postEdit(writing(root, 'docs/issues/t1-login.md', fine), context), { exitCode: 0, stdout: '', stderr: '' });

  const broken = definition('abc-1', ['behavior'], '근거: `research/ghost.md`');
  writeFileSync(join(root, 'docs/issues/t1-login.md'), broken);
  const result = postEdit(writing(root, 'docs/issues/t1-login.md', broken), context);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /^MISSING research\/ghost\.md {2}\(cited in docs\/issues\/t1-login\.md\)$/m);
  assert.match(result.stderr, /citations\.ignore_patterns in \.claude\/wf\.spec\.jsonc/);
});

test('editing a file outside the watched folders, or one that is not markdown, is ignored', (t) => {
  const { root, context } = project(t, { 'README.md': '`docs/ghost.md`', 'docs/issues/data.json': '{}', 'src/a.ts': '' });
  for (const path of ['README.md', 'docs/issues/data.json', 'src/a.ts']) {
    assert.deepEqual(postEdit(writing(root, path, '`docs/ghost.md`'), context), { exitCode: 0, stdout: '', stderr: '' }, path);
  }
  assert.equal(postEdit(writing('/somewhere/else', 'docs/issues/a.md', 'x'), context).exitCode, 0);
});

test('warnings arrive as additionalContext and do not fail the edit', (t) => {
  const { root, context } = project(t);
  const text = '# 근거 표\n\n공식 문서를 찾지 못했다.\n';
  mkdirSync(join(root, 'docs/issues'), { recursive: true });
  writeFileSync(join(root, 'docs/issues/s1.md'), text);
  const result = postEdit(writing(root, 'docs/issues/s1.md', text), context);
  assert.equal(result.exitCode, 0);
  const { hookSpecificOutput } = JSON.parse(result.stdout);
  assert.equal(hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.match(hookSpecificOutput.additionalContext, /^wf: warnings \(not blocking\)\./);
  assert.match(hookSpecificOutput.additionalContext, /frontmatter declares no type \(definition\) and ticket/);
  assert.match(hookSpecificOutput.additionalContext, /UNPROVEN docs\/issues\/s1\.md:3/);
});

test('an Edit payload is judged by its replacement text', (t) => {
  const { root, context } = project(t, { 'docs/issues/s1.md': `${definition('abc-1', ['behavior'])}\n공식 문서를 찾지 못했다.\n\n새 문장.\n` });
  const payload = { tool_name: 'Edit', tool_input: { file_path: join(root, 'docs/issues/s1.md'), old_string: '옛 문장.', new_string: '새 문장.' } };
  assert.deepEqual(postEdit(payload, context), { exitCode: 0, stdout: '', stderr: '' });
});

test('saving a broken spec reports the defect', (t) => {
  const { root, context } = project(t, { '.claude/wf.spec.jsonc': '{ "schema": 2 }' });
  const result = postEdit(writing(root, '.claude/wf.spec.jsonc', '{ "schema": 2 }'), context);
  assert.equal(result.exitCode, 2);
  assert.match(result.stderr, /wf\.spec\.jsonc: invalid spec/);
});

// --- entry points and the hooks.json template ---

test('the entry scripts read the payload from stdin and exit with the verdict', (t) => {
  const { root, env } = project(t, { 'docs/issues/t1-login.md': definition('abc-1', ['behavior'], '근거: `docs/ghost.md`') });
  const run = (script, payload) => spawnSync(process.execPath, [join(SCRIPTS, script)], { input: JSON.stringify(payload), encoding: 'utf8', env });

  const close = run('hook-pre-close.mjs', closing('bd close abc-1'));
  assert.equal(close.status, 2);
  assert.match(close.stderr, /UNADDRESSED style/);
  assert.equal(run('hook-pre-close.mjs', closing('git status')).status, 0);

  const edit = run('hook-post-edit.mjs', writing(root, 'docs/issues/t1-login.md', 'x'));
  assert.equal(edit.status, 2);
  assert.match(edit.stderr, /MISSING docs\/ghost\.md/);
});

test('the hooks.json template calls scripts that exist, through node and the plugin root', () => {
  const template = JSON.parse(readFileSync(join(PLUGIN_ROOT, 'templates', 'hooks.json'), 'utf8'));
  const commands = [template.hooks.PostToolUse[0], template.hooks.PreToolUse[0]].map((entry) => entry.hooks[0].command);
  assert.deepEqual(commands, [
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-post-edit.mjs"',
    'node "${CLAUDE_PLUGIN_ROOT}/scripts/hook-pre-close.mjs"',
  ]);
  for (const script of ['hook-post-edit.mjs', 'hook-pre-close.mjs']) assert.ok(existsSync(join(SCRIPTS, script)), script);
  assert.equal(template.hooks.PostToolUse[0].matcher, 'Write|Edit');
  // PowerShell is the primary shell tool on Windows; a matcher of Bash alone never fires for it.
  assert.equal(template.hooks.PreToolUse[0].matcher, 'Bash|PowerShell');
});

test('🚨 the bash checks are gone — the hooks are the only way a check runs', () => {
  for (const name of ['check-coverage.sh', 'check-citations.sh', 'check-negation.sh', 'bypass.sh']) {
    assert.equal(existsSync(join(SCRIPTS, name)), false, name);
  }
});
