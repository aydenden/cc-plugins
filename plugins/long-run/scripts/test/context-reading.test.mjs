import assert from 'node:assert/strict';
import test from 'node:test';

import { contextFileName, readingOf, resolveContext, transcriptCandidates } from '../lib/context-reading.mjs';

const usage = (tokens) => ({ input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: tokens - 2 });

test('🚨 세션이 잰 값이 있으면 그것이 이긴다 — 창 크기도 엔진의 것이다', () => {
  const reading = { tokens: 420_000, window: 1_000_000, at: '2026-11-22T00:00:00Z' };
  const ctx = resolveContext({ reading, usage: usage(266_000), model: 'claude-opus-5-5' });
  assert.deepEqual(ctx, { contextTokens: 420_000, contextLimit: 1_000_000, measured: true, source: 'session' });
});

test('잰 값이 없으면 트랜스크립트로 재되, 세션이 알려 준 창을 쓴다', () => {
  const reading = { tokens: null, window: 1_000_000, at: '2026-11-22T00:00:00Z' };
  const ctx = resolveContext({ reading, usage: usage(300_000), model: 'claude-opus-5-5' });
  assert.deepEqual(ctx, { contextTokens: 300_000, contextLimit: 1_000_000, measured: true, source: 'transcript' });
});

test('🚨 창을 모르는데 이미 200k 를 넘게 담았다면 창은 200k 가 아니다 — 133% 로 이른 인계를 시키지 않는다', () => {
  // 실측: [1m] 표시 없는 claude-opus-5-5 세션이 266,483 토큰을 담고 있었다.
  const ctx = resolveContext({ reading: null, usage: usage(266_483), model: 'claude-opus-5-5' });
  assert.equal(ctx.contextLimit, 1_000_000);
  assert.equal(ctx.measured, true);
});

test('창을 모르고 200k 안이면 모델 이름의 창을 쓴다', () => {
  assert.equal(resolveContext({ reading: null, usage: usage(120_000), model: 'claude-opus-5' }).contextLimit, 200_000);
  assert.equal(resolveContext({ reading: null, usage: usage(120_000), model: 'claude-opus-5[1m]' }).contextLimit, 1_000_000);
});

test('어느 쪽도 없으면 «못 쟀다» 고 말한다 — 0 을 여유로 읽히게 두지 않는다', () => {
  const ctx = resolveContext({ reading: null, usage: null, model: null });
  assert.equal(ctx.measured, false);
  assert.equal(ctx.source, 'none');
  assert.equal(resolveContext({ reading: { tokens: null, window: 1_000_000 }, usage: null, model: null }).contextLimit, 1_000_000);
});

test('readingOf 는 CLI 인자를 기록으로 바꾸고, 창이 없으면 남기지 않는다', () => {
  assert.deepEqual(readingOf('420000', '1000000', 'T'), { tokens: 420_000, window: 1_000_000, at: 'T' });
  // 압축 직후처럼 채움이 없을 때도 창과 «모름» 을 남긴다 — 지난 큰 값이 남아 이른 인계를 시키지 않게.
  assert.deepEqual(readingOf(undefined, '1000000', 'T'), { tokens: null, window: 1_000_000, at: 'T' });
  assert.equal(readingOf('420000', undefined, 'T'), null);
  assert.equal(readingOf('abc', '0', 'T'), null);
});

test('contextFileName 은 세션 id 를 파일 이름으로만 쓴다', () => {
  assert.equal(contextFileName('ad814eac-58da-4dbe-ae0b-54bd939cbab8'), 'ad814eac-58da-4dbe-ae0b-54bd939cbab8.json');
  assert.equal(contextFileName('../../etc/passwd'), null);
  assert.equal(contextFileName(''), null);
  assert.equal(contextFileName(undefined), null);
});

test('transcriptCandidates 는 프로젝트 폴더마다 <세션>.jsonl 을 본다', () => {
  assert.deepEqual(transcriptCandidates('/h/.claude', ['-a', '-b'], 'abc-1'), ['/h/.claude/projects/-a/abc-1.jsonl', '/h/.claude/projects/-b/abc-1.jsonl']);
  assert.deepEqual(transcriptCandidates('/h/.claude', ['-a'], '../x'), []);
});
