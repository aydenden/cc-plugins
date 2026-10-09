import test from 'node:test';
import assert from 'node:assert/strict';

import { applyEdit, describeConfig, describeWidgets, parseCommand } from '../lib/command.mjs';
import { normalizeConfig } from '../lib/config.mjs';

const base = () =>
  normalizeConfig({
    theme: 'nord',
    lines: [{ items: [{ type: 'model' }, { type: 'version' }] }, { items: [{ type: 'git-branch' }] }],
  }).config;
const run = (config, args) => applyEdit(config, parseCommand(args));
const types = (config) => config.lines.map((line) => line.items.map((item) => item.type));

test('인자가 없으면 목록, 모르는 동작과 빠진 인자는 error', () => {
  assert.deepEqual(parseCommand(''), { action: 'list' });
  assert.equal(parseCommand('frobnicate').action, 'error');
  assert.equal(parseCommand('on').action, 'error');
  assert.equal(parseCommand('rm 2').action, 'error');
  assert.equal(parseCommand('add 0 model').action, 'error');
  assert.equal(parseCommand('add 1 model x').action, 'error');
  assert.deepEqual(parseCommand('import --force'), { action: 'import', force: true });
});

test('줄과 항목을 끄고 켠다 — 켜면 enabled 키가 사라진다', () => {
  const off = run(base(), 'off 1.2');
  assert.equal(off.config.lines[0].items[1].enabled, false);
  const on = run(off.config, 'on 1.2');
  assert.deepEqual(on.config.lines[0].items[1], { type: 'version' });
  assert.equal(run(base(), 'off 2').config.lines[1].enabled, false);
});

test('없는 주소는 설정을 건드리지 않고 이유를 준다', () => {
  const config = base();
  const result = run(config, 'off 9.1');
  assert.equal(result.config, config);
  assert.match(result.error, /9\.1/);
});

test('위젯을 끝이나 지정한 자리에 넣고, 모르는 위젯은 거절한다', () => {
  assert.deepEqual(types(run(base(), 'add 1 git-sha').config)[0], ['model', 'version', 'git-sha']);
  assert.deepEqual(types(run(base(), 'add 1 git-sha 1').config)[0], ['git-sha', 'model', 'version']);
  assert.match(run(base(), 'add 1 nope').error, /nope/);
  assert.match(run(base(), 'add 1 jj-workspace').error, /지원하지 않는다/);
  assert.equal(run(base(), 'add 1 custom-command').config.lines[0].items[2].id, 'cmd-3');
});

test('항목을 빼고 옮긴다', () => {
  assert.deepEqual(types(run(base(), 'rm 1.1').config), [['version'], ['git-branch']]);
  assert.deepEqual(types(run(base(), 'move 1.1 2').config), [['version'], ['git-branch', 'model']]);
  assert.deepEqual(types(run(base(), 'move 1.2 1.1').config), [['version', 'model'], ['git-branch']]);
});

test('옵션은 종류에 맞게 읽고, 빈 값은 지운다', () => {
  const set = run(base(), 'set 1.1 bold=true maxWidth=12 label=M_ bg=#112233');
  assert.deepEqual(set.config.lines[0].items[0], { type: 'model', bold: true, maxWidth: 12, label: 'M ', bg: '#112233' });
  assert.deepEqual(run(set.config, 'set 1.1 bold= label=').config.lines[0].items[0], { type: 'model', maxWidth: 12, bg: '#112233' });
  assert.match(run(base(), 'set 1.1 bold=yes').error, /true/);
  assert.match(run(base(), 'set 1.1 nope=1').error, /nope/);
});

test('틀린 옵션이 하나라도 있으면 앞의 옵션도 적용되지 않는다', () => {
  const config = base();
  assert.equal(run(config, 'set 1.1 bold=true nope=1').config, config);
});

test('줄을 더하고 빼고, 테마·powerline·minimal 을 바꾼다', () => {
  assert.equal(run(base(), 'line add').config.lines.length, 3);
  assert.deepEqual(types(run(base(), 'line rm 1').config), [['git-branch']]);
  assert.equal(run(base(), 'theme off').config.theme, null);
  assert.equal(run(base(), 'theme nord-aurora').config.theme, 'nord-aurora');
  assert.match(run(base(), 'theme neon').error, /neon/);
  assert.equal(run(base(), 'powerline off').config.powerline.enabled, false);
  assert.equal(run(base(), 'minimal off').config.minimal, false);
});

test('고친 설정은 다시 다듬어도 그대로다', () => {
  const edited = run(run(base(), 'add 2 context-bar 1').config, 'off 2.2').config;
  const { config, problems } = normalizeConfig(edited);
  assert.deepEqual(problems, []);
  assert.deepEqual(config, edited);
});

test('목록은 번호·꺼짐 표시·문제·소스 오류를 보여 준다', () => {
  const text = describeConfig(run(base(), 'off 1.2').config, { path: '/p', exists: false, problems: ['문제 하나'], errors: { git: 'boom' } });
  assert.match(text, /1\.1 {2}● model/);
  assert.match(text, /1\.2 {2}○ version/);
  assert.match(text, /문제 하나/);
  assert.match(text, /git: boom/);
  assert.match(text, /\/sl init/);
});

test('위젯 목록에 분류와 지원 안 하는 타입이 실린다', () => {
  const text = describeWidgets();
  assert.match(text, /^session: .*model/m);
  assert.match(text, /flex-separator/);
  assert.match(text, /jj-workspace/);
});
