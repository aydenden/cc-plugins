import test from 'node:test';
import assert from 'node:assert/strict';

import { bar, basename, formatDuration, formatMoney, formatPercent, formatTokens, prettyModel, tildePath, truncate } from '../lib/format.mjs';

test('토큰 수는 단위가 바뀌는 경계에서 꼴이 바뀐다', () => {
  assert.equal(formatTokens(999), '999');
  assert.equal(formatTokens(1000), '1k');
  assert.equal(formatTokens(179_440), '179.4k');
  assert.equal(formatTokens(1_000_000), '1M');
});

test('기간은 큰 단위 둘만 쓰고 음수는 0 이다', () => {
  assert.equal(formatDuration(40_000), '40s');
  assert.equal(formatDuration(12 * 60_000), '12m');
  assert.equal(formatDuration(65 * 60_000), '1hr 5m');
  assert.equal(formatDuration(51 * 3_600_000), '2d 3hr');
  assert.equal(formatDuration(-5000), '0s');
});

test('퍼센트는 소수 한 자리까지, .0 은 뗀다', () => {
  assert.equal(formatPercent(18), '18%');
  assert.equal(formatPercent(23.5), '23.5%');
});

test('막대는 범위 밖 값을 끝에 붙인다', () => {
  assert.equal(bar(18), '██░░░░░░░░');
  assert.equal(bar(150, 4), '████');
  assert.equal(bar(-3, 4), '░░░░');
});

test('금액은 USD 가 아니면 통화 코드를 붙인다', () => {
  assert.equal(formatMoney(2.6091976), '$2.61');
  assert.equal(formatMoney(3, 'EUR'), '3.00 EUR');
});

test('모델 id 를 읽기 좋게 쓰고 모르는 꼴은 둔다', () => {
  assert.equal(prettyModel('claude-opus-5-5'), 'Opus 5.5');
  assert.equal(prettyModel('claude-sonnet-5-5[1m]'), 'Sonnet 5.5');
  assert.equal(prettyModel('claude-haiku-5'), 'Haiku 5');
  assert.equal(prettyModel('Default (recommended)'), 'Default');
  assert.equal(prettyModel('my-gateway-model'), 'my-gateway-model');
});

test('경로를 줄인다', () => {
  assert.equal(basename('/a/b/cc-plugins'), 'cc-plugins');
  assert.equal(tildePath('/Users/u/dev', '/Users/u'), '~/dev');
  assert.equal(tildePath('/Users/u', '/Users/u'), '~');
  assert.equal(tildePath('/Users/uu/dev', '/Users/u'), '/Users/uu/dev');
  assert.equal(tildePath('/x', undefined), '/x');
});

test('자르기는 한도가 없으면 그대로 둔다', () => {
  assert.equal(truncate('feature/long-branch', 8), 'feature…');
  assert.equal(truncate('main', 8), 'main');
  assert.equal(truncate('main', undefined), 'main');
});
