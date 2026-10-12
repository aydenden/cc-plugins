import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { probe } from '../design/deps-file.mjs';
import { installedPlugins, report } from '../design/deps.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'check-deps.mjs');
const PD = 'plugin-dev@claude-plugins-official';
const BD = 'beads@beads-marketplace';
const LR = 'long-run@aydenden-plugins';

const record = (...keys) => JSON.stringify({ version: 2, plugins: Object.fromEntries(keys.map((key) => [key, [{ scope: 'user' }]])) });

/** A probe where everything is installed except what `missing` names. */
const having = ({ commands = [], skills = [], plugins = [] } = {}) => ({
  command: (name) => !commands.includes(name),
  skill: (name) => !skills.includes(name),
  plugin: (name) => !plugins.includes(name),
});

// --- installedPlugins ---

test('only the plugin name counts; the marketplace name is the installer\'s choice', () => {
  assert.deepEqual([...installedPlugins(record('plugin-dev@a', 'beads@b', 'long-run@c'))].sort(), ['beads', 'long-run', 'plugin-dev']);
});

test('🚨 a plugin whose name merely ends in long-run is a different plugin', () => {
  assert.equal(installedPlugins(record(PD, BD, 'not-long-run@aydenden-plugins')).has('long-run'), false);
});

test('no install record means nothing is installed', () => {
  assert.equal(installedPlugins(null).size, 0);
  assert.equal(installedPlugins('{"version":2}').size, 0);
});

// --- report ---

test('everything present passes with no missing required item', () => {
  const { lines, missingRequired } = report(having());
  assert.equal(missingRequired, 0);
  assert.ok(lines.includes('  ✓ long-run (여러 세션 실행·세션 이관)'));
  assert.ok(lines.includes('  ✓ node (생성물의 검사 hook 런타임)'));
  assert.match(lines.at(-1), /^필수 항목 충족/);
});

test('🚨 each missing required tool or plugin is counted and carries its install line', () => {
  for (const [missing, label] of [
    [{ commands: ['node'] }, '  ✗ node — 필수'],
    [{ commands: ['bd'] }, '  ✗ bd (beads) — 필수'],
    [{ plugins: ['plugin-dev'] }, '  ✗ plugin-dev — 필수'],
    [{ plugins: ['beads'] }, '  ✗ beads 플러그인 — 필수'],
    [{ plugins: ['long-run'] }, '  ✗ long-run — 필수'],
  ]) {
    const { lines, missingRequired } = report(having(missing));
    assert.equal(missingRequired, 1, label);
    assert.match(lines[lines.indexOf(label) + 1], /^ {6}설치: /, label);
  }
  const all = report(having({ plugins: ['plugin-dev', 'beads', 'long-run'] }));
  assert.equal(all.lines.at(-1), '필수 항목 3개가 없다. 설계를 진행하면 생성된 워크플로우가 실행되지 않는다.');
});

test('a missing optional tool or skill is reported but not counted', () => {
  const { lines, missingRequired } = report(having({ commands: ['orca'], skills: ['implement', 'find-skills'] }));
  assert.equal(missingRequired, 0);
  assert.ok(lines.includes('  · orca — 없음 (해당 단계를 넣을 수 없다)'));
  assert.ok(lines.includes('  · implement — 없음 → npx skills add mattpocock/skills@implement'));
  assert.ok(lines.includes('  · find-skills — 없음 → npx skills add vercel-labs/skills@find-skills'));
});

// --- probe and the script ---

/** A throwaway home with the given install record, skills and a PATH folder holding `commands`. */
function machine(t, { keys = [PD, BD, LR], skills = [], commands = [] } = {}) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wf-deps-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  // The marketplace directories are always there: adding a marketplace is not installing a plugin.
  mkdirSync(join(root, '.claude/plugins/marketplaces/claude-plugins-official'), { recursive: true });
  writeFileSync(join(root, '.claude/plugins/installed_plugins.json'), record(...keys));
  skills.forEach((name) => mkdirSync(join(root, '.claude/skills', name), { recursive: true }));
  mkdirSync(join(root, 'bin'));
  commands.forEach((name) => {
    writeFileSync(join(root, 'bin', name), '');
    chmodSync(join(root, 'bin', name), 0o755);
  });
  return { home: root, env: { PATH: join(root, 'bin') } };
}

test('the probe reads PATH, the skill folders and the install record', (t) => {
  const found = probe({ ...machine(t, { skills: ['tdd'], commands: ['bd'] }), platform: 'linux' });
  assert.deepEqual([found.command('bd'), found.command('git')], [true, false]);
  assert.deepEqual([found.skill('tdd'), found.skill('implement')], [true, false]);
  assert.deepEqual([found.plugin('long-run'), found.plugin('wf')], [true, false]);
});

test('a file on PATH that cannot be executed is not a command', { skip: process.platform === 'win32' }, (t) => {
  const where = machine(t, { commands: ['bd'] });
  chmodSync(join(where.env.PATH, 'bd'), 0o644);
  assert.equal(probe({ ...where, platform: 'linux' }).command('bd'), false);
});

test('on Windows a command is found by one of PATHEXT', (t) => {
  const where = machine(t, { commands: ['bd.CMD'] });
  assert.equal(probe({ home: where.home, env: { ...where.env, PATHEXT: '.EXE;.CMD' }, platform: 'win32' }).command('bd'), true);
  assert.equal(probe({ ...where, platform: 'linux' }).command('bd'), false);
});

test('🚨 the script exits 1 when a required dependency is missing and 0 when none is', { skip: process.platform === 'win32' }, (t) => {
  const run = (where) => spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8', env: { HOME: where.home, PATH: where.env.PATH } });
  const complete = run(machine(t, { commands: ['bd', 'git', 'node'] }));
  assert.equal(complete.status, 0, complete.stdout + complete.stderr);
  assert.match(complete.stdout, /✓ node/);
  const noNode = run(machine(t, { commands: ['bd', 'git'] }));
  assert.equal(noNode.status, 1);
  assert.match(noNode.stdout, /✗ node — 필수/);
  const marketOnly = run(machine(t, { keys: [], commands: ['bd', 'git', 'node'] }));
  assert.equal(marketOnly.status, 1);
  assert.match(marketOnly.stdout, /필수 항목 3개가 없다/);
});
