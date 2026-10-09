import test from 'node:test';
import assert from 'node:assert/strict';

import { DEFAULT_CONFIG, fromCcstatusline, normalizeConfig } from '../lib/config.mjs';

test('기본 설정은 다듬어도 문제가 없다', () => {
  const { config, problems } = normalizeConfig(DEFAULT_CONFIG);
  assert.deepEqual(problems, []);
  assert.deepEqual(config, JSON.parse(JSON.stringify(DEFAULT_CONFIG)));
});

test('객체가 아닌 설정은 기본 설정으로 그리고 이유를 남긴다', () => {
  const { config, problems } = normalizeConfig('nope');
  assert.equal(config, DEFAULT_CONFIG);
  assert.equal(problems.length, 1);
});

test('모르는 위젯·지원 안 하는 위젯·틀린 옵션은 버리고 나머지는 살린다', () => {
  const { config, problems } = normalizeConfig({
    lines: [{ items: [{ type: 'model', bold: 'yes' }, { type: 'no-such-widget' }, { type: 'jj-workspace' }, { nope: 1 }] }],
  });
  assert.deepEqual(config.lines[0].items, [{ type: 'model' }]);
  assert.equal(problems.length, 4);
});

test('enabled 는 false 일 때만 남는다', () => {
  const { config } = normalizeConfig({ lines: [{ enabled: false, items: [{ type: 'model', enabled: false }, { type: 'version', enabled: true }] }] });
  assert.equal(config.lines[0].enabled, false);
  assert.deepEqual(config.lines[0].items, [{ type: 'model', enabled: false }, { type: 'version' }]);
});

test('custom-command 는 id 와 argv 배열이 있어야 한다', () => {
  const bad = normalizeConfig({ lines: [{ items: [{ type: 'custom-command', command: 'date' }] }] });
  assert.deepEqual(bad.config.lines[0].items, []);
  const good = normalizeConfig({ lines: [{ items: [{ type: 'custom-command', id: 'd', command: ['date'] }] }] });
  assert.deepEqual(good.config.lines[0].items, [{ type: 'custom-command', id: 'd', command: ['date'] }]);
});

test('모르는 테마와 틀린 주기는 이유를 남기고 기본으로 돌아간다', () => {
  const { config, problems } = normalizeConfig({ theme: 'neon', refresh: { gitSeconds: 0, apiSeconds: 60 }, lines: [] });
  assert.equal(config.theme, null);
  assert.equal(config.refresh.gitSeconds, 5);
  assert.equal(config.refresh.apiSeconds, 60);
  assert.equal(problems.length, 2);
});

test('ccstatusline 설정을 옮긴다 — 테마가 있으면 항목 색은 두고 온다', () => {
  const { config, problems } = fromCcstatusline({
    version: 4,
    lines: [
      [
        { id: 'a', type: 'model', backgroundColor: 'bgMagenta', merge: true },
        { id: 'b', type: 'flex-separator' },
        { id: 'c', type: 'custom-text', customText: 'hi', rawValue: true },
      ],
      [],
    ],
    globalBold: true,
    minimalistMode: true,
    powerline: { enabled: true, separators: [''], theme: 'nord' },
  });
  assert.deepEqual(problems, []);
  assert.equal(config.theme, 'nord');
  assert.equal(config.bold, true);
  assert.equal(config.minimal, true);
  assert.equal(config.lines.length, 1);
  assert.deepEqual(config.lines[0].items, [{ type: 'model', merge: true }, { type: 'flex-separator' }, { type: 'custom-text', text: 'hi', raw: true }]);
});

test('ccstatusline 설정에 테마가 없으면 색 이름을 hex 로 옮긴다', () => {
  const { config } = fromCcstatusline({
    lines: [[{ type: 'model', color: 'cyan', backgroundColor: 'bgBrightGreen' }, { type: 'version', color: 'hex:88C0D0' }]],
    powerline: { enabled: false },
  });
  assert.equal(config.powerline.enabled, false);
  assert.deepEqual(config.lines[0].items, [{ type: 'model', color: '#00CDCD', bg: '#00FF00' }, { type: 'version', color: '#88C0D0' }]);
});

test('ccstatusline 의 셸 명령은 sh -c argv 로 옮긴다', () => {
  const { config } = fromCcstatusline({ lines: [[{ id: 'x1', type: 'custom-command', commandPath: 'date +%H' }]] });
  assert.deepEqual(config.lines[0].items, [{ type: 'custom-command', id: 'x1', command: ['sh', '-c', 'date +%H'] }]);
});
