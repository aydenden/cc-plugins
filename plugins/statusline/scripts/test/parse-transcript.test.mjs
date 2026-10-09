import test from 'node:test';
import assert from 'node:assert/strict';

import { addUsage, parseUsageApi, projectSlug, summarizeTranscript, usageOf } from '../lib/parse-transcript.mjs';

const usage = (input, output, read, write) => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
});
const assistant = (requestId, tokens, extra = {}) =>
  JSON.stringify({ type: 'assistant', requestId, message: { usage: tokens }, timestamp: '2026-10-09T01:00:00.000Z', effort: 'medium', ...extra });

test('usage 의 빠진 값은 0 이다', () => {
  assert.deepEqual(usageOf(undefined), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  assert.deepEqual(addUsage(usageOf(usage(1, 2, 3, 4)), usageOf(usage(10, 20, 30, 40))), { input: 11, output: 22, cacheRead: 33, cacheWrite: 44 });
});

test('한 응답의 블록 줄들은 요청 id 로 한 번만 센다', () => {
  const summary = summarizeTranscript(
    [assistant('r1', usage(10, 5, 100, 20)), assistant('r1', usage(10, 5, 100, 20)), assistant('r2', usage(1, 2, 3, 4))].join('\n'),
  );
  assert.deepEqual(summary.total, { input: 11, output: 7, cacheRead: 103, cacheWrite: 24 });
  assert.deepEqual(summary.last, { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 });
  assert.equal(summary.effort, 'medium');
  assert.equal(summary.lastResponseAt, Date.parse('2026-10-09T01:00:00.000Z'));
});

test('서브에이전트 줄과 깨진 줄은 합계에 넣지 않는다', () => {
  const summary = summarizeTranscript([assistant('r1', usage(10, 5, 0, 0)), assistant('s1', usage(999, 999, 0, 0), { isSidechain: true }), '{"type":"assis'].join('\n'));
  assert.deepEqual(summary.total, { input: 10, output: 5, cacheRead: 0, cacheWrite: 0 });
});

test('세션 이름은 마지막 것, 압축은 메인 대화의 경계만 센다', () => {
  const summary = summarizeTranscript(
    [
      JSON.stringify({ type: 'ai-title', aiTitle: 'auto name' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'first' }),
      JSON.stringify({ type: 'custom-title', customTitle: 'second' }),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary' }),
      JSON.stringify({ type: 'system', subtype: 'compact_boundary', isSidechain: true }),
      JSON.stringify({ type: 'system', subtype: 'other' }),
    ].join('\n'),
  );
  assert.equal(summary.customTitle, 'second');
  assert.equal(summary.aiTitle, 'auto name');
  assert.equal(summary.compactions, 1);
  assert.equal(summary.last, null);
});

test('트랜스크립트 폴더 이름은 영숫자 아닌 글자를 - 로 바꾼다', () => {
  assert.equal(projectSlug('/Users/nyh/dev/workSpace/cc-plugins'), '-Users-nyh-dev-workSpace-cc-plugins');
  assert.equal(projectSlug('/a/b.c_d'), '-a-b-c-d');
});

test('usage API 에서 모델별 주간과 추가 사용량을 읽는다', () => {
  const parsed = parseUsageApi({
    limits: [
      { kind: 'session', percent: 21 },
      { kind: 'weekly_scoped', percent: 0, resets_at: '2026-10-12T06:00:00+00:00', scope: { model: { display_name: 'Fable' } } },
      { kind: 'weekly_scoped', percent: 40, scope: { model: { display_name: 'Claude Sonnet' } } },
    ],
    seven_day_opus: { utilization: 12, resets_at: 'x' },
    seven_day_sonnet: { utilization: 99 },
    extra_usage: { is_enabled: true, monthly_limit: 5000, used_credits: 1250, utilization: 25, currency: 'USD', decimal_places: 2 },
  });
  assert.deepEqual(parsed.perModel, {
    fable: { percent: 0, resetsAt: '2026-10-12T06:00:00+00:00' },
    sonnet: { percent: 40, resetsAt: null },
    opus: { percent: 12, resetsAt: 'x' },
  });
  assert.deepEqual(parsed.extra, { enabled: true, limit: 50, used: 12.5, utilization: 25, currency: 'USD' });
});

test('usage API 응답이 비었거나 객체가 아니어도 빈 결과를 낸다', () => {
  assert.deepEqual(parseUsageApi(null), { perModel: {}, extra: null });
  assert.deepEqual(parseUsageApi({ seven_day_opus: null, extra_usage: { is_enabled: false } }).extra, {
    enabled: false,
    limit: null,
    used: null,
    utilization: null,
    currency: 'USD',
  });
});
