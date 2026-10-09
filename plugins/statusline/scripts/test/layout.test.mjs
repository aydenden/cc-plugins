import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeConfig } from '../lib/config.mjs';
import { buildRows, neededSources } from '../lib/layout.mjs';
import { THEMES } from '../lib/themes.mjs';

const SEP = '';
const snap = {
  session: { model: 'claude-opus-5-5', version: '2.1.295', id: 'abc' },
  git: { branch: 'main', staged: 0, unstaged: 0, untracked: 0, conflicts: 0 },
};
const configOf = (extra) => normalizeConfig({ theme: null, minimal: true, ...extra }).config;
const texts = (row) => row.map((cell) => (cell.flex ? '<flex>' : cell.text));

test('켜진 항목이 요구하는 소스만 모은다', () => {
  const config = configOf({
    lines: [
      { items: [{ type: 'model' }, { type: 'git-branch', enabled: false }] },
      { enabled: false, items: [{ type: 'reset-timer' }] },
    ],
  });
  assert.deepEqual([...neededSources(config)], ['session']);
});

test('꺼진 줄·꺼진 항목·값 없는 위젯은 그리지 않는다', () => {
  const config = configOf({
    powerline: { enabled: false },
    lines: [
      { items: [{ type: 'model' }, { type: 'version', enabled: false }, { type: 'session-cost' }] },
      { enabled: false, items: [{ type: 'model' }] },
      { items: [{ type: 'session-cost' }] },
    ],
  });
  assert.deepEqual(buildRows(config, snap).map(texts), [['Opus 5.5']]);
});

test('일반 모드는 구간 사이에 구분자를 넣고 merge 는 공백으로 잇는다', () => {
  const config = configOf({
    powerline: { enabled: false },
    lines: [{ items: [{ type: 'model', merge: true }, { type: 'version' }, { type: 'git-branch' }] }],
  });
  assert.deepEqual(texts(buildRows(config, snap)[0]), ['Opus 5.5', ' ', '2.1.295', ' | ', 'main']);
});

test('일반 모드에서 수동 구분자가 있으면 자동 구분자는 넣지 않는다', () => {
  const config = configOf({
    powerline: { enabled: false },
    lines: [{ items: [{ type: 'model' }, { type: 'separator', text: ' / ' }, { type: 'version' }, { type: 'git-branch' }] }],
  });
  assert.deepEqual(texts(buildRows(config, snap)[0]), ['Opus 5.5', ' / ', '2.1.295', 'main']);
});

test('powerline 은 구간 사이와 끝에 앞 구간 배경색의 화살표를 그린다', () => {
  const config = configOf({ theme: 'nord', lines: [{ items: [{ type: 'model' }, { type: 'version' }] }] });
  const { fg, bg } = THEMES.nord;
  assert.deepEqual(buildRows(config, snap)[0], [
    { text: ' Opus 5.5 ', color: fg[0], bg: bg[0] },
    { text: SEP, color: bg[0], bg: bg[1] },
    { text: ' 2.1.295 ', color: fg[1], bg: bg[1] },
    { text: SEP, color: bg[1] },
  ]);
});

test('powerline 에서 merge 로 묶인 구간은 화살표 없이 같은 색을 쓴다', () => {
  const config = configOf({ theme: 'nord', lines: [{ items: [{ type: 'model', merge: true }, { type: 'version' }, { type: 'git-branch' }] }] });
  const row = buildRows(config, snap)[0];
  assert.deepEqual(texts(row), [' Opus 5.5 ', ' 2.1.295 ', SEP, ' main ', SEP]);
  assert.equal(row[1].bg, THEMES.nord.bg[0]);
  assert.equal(row[3].bg, THEMES.nord.bg[1]);
});

test('flex 는 화살표 사슬을 끊고, 테마 색은 줄을 넘어 이어진다', () => {
  const config = configOf({
    theme: 'nord',
    lines: [{ items: [{ type: 'model' }, { type: 'flex-separator' }, { type: 'version' }] }, { items: [{ type: 'git-branch' }] }],
  });
  const rows = buildRows(config, snap);
  assert.deepEqual(texts(rows[0]), [' Opus 5.5 ', SEP, '<flex>', ' 2.1.295 ', SEP]);
  assert.equal(rows[0][1].bg, undefined);
  assert.equal(rows[1][0].bg, THEMES.nord.bg[2]);
});

test('숨은 위젯 뒤의 구간은 화살표가 한 번만 붙는다', () => {
  const config = configOf({ theme: 'nord', lines: [{ items: [{ type: 'model' }, { type: 'session-cost' }, { type: 'version' }] }] });
  assert.deepEqual(texts(buildRows(config, snap)[0]), [' Opus 5.5 ', SEP, ' 2.1.295 ', SEP]);
});

test('항목의 색은 테마를 이기고, 테마가 없는 powerline 은 기본색을 쓴다', () => {
  const themed = configOf({ theme: 'nord', lines: [{ items: [{ type: 'model', bg: '#111111', color: '#EEEEEE' }] }] });
  assert.deepEqual(buildRows(themed, snap)[0][0], { text: ' Opus 5.5 ', color: '#EEEEEE', bg: '#111111' });
  const bare = configOf({ lines: [{ items: [{ type: 'model' }] }] });
  assert.equal(typeof buildRows(bare, snap)[0][0].bg, 'string');
});

test('라벨은 minimal·raw 에서 빠지고, 항목에 적은 label 은 남는다', () => {
  const labeled = normalizeConfig({ theme: null, minimal: false, powerline: { enabled: false }, lines: [{ items: [{ type: 'model' }, { type: 'version', raw: true }] }] }).config;
  assert.deepEqual(texts(buildRows(labeled, snap)[0]), ['Model: Opus 5.5', ' | ', '2.1.295']);
  const custom = configOf({ powerline: { enabled: false }, lines: [{ items: [{ type: 'model', label: 'M ' }] }] });
  assert.deepEqual(texts(buildRows(custom, snap)[0]), ['M Opus 5.5']);
});

test('maxWidth 는 구간 글자를 자른다', () => {
  const config = configOf({ powerline: { enabled: false }, lines: [{ items: [{ type: 'claude-session-id', maxWidth: 3 }] }] });
  assert.deepEqual(texts(buildRows(config, { session: { id: 'abcdefgh' } })[0]), ['ab…']);
});
