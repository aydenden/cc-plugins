import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPrompt, inheritedMap } from '../lib/handoff-prompt.mjs';

const doc = 'C:/handoff/topic-1234abcd/slug/handoff-03.md';
const guard = 'C:/plugins/long-run/scripts/frontier-guard.mjs';

test('인계 프롬프트는 한 줄이다 — 개행에서 TUI 가 제출해 버린다', () => {
  assert.doesNotMatch(buildPrompt({ doc, bdId: 'map-x', mapEpic: 'map-x', guard }), /\n/);
  assert.doesNotMatch(buildPrompt({ doc, mapEpic: 'map-x', guard, hold: true }), /\n/);
});

test('문서를 읽고 지정된 스킬을 실제로 부르라고 한다 — 문서는 절차서가 아니다', () => {
  const prompt = buildPrompt({ doc });
  assert.match(prompt, new RegExp(`Read 로 ${doc}`));
  assert.match(prompt, /스킬을 실제로 호출한다/);
  assert.match(prompt, /완료 통보/);
});

// 가드는 claim 한 주인 세션만 판정한다. 이 단계가 빠지면 새 세션은 가드 없이 출발한다 — 문서가 아니라
// 프롬프트에 박는 이유다.
test('🚨 맵을 미는 worktree 면 새 세션이 가장 먼저 claim 해 주인이 된다', () => {
  const prompt = buildPrompt({ doc, mapEpic: 'map-yged', guard });
  assert.match(prompt, new RegExp(`node "${guard}" claim map-yged`));
  // 문서를 읽기 전에 해야 한다 — 읽다가 멈추면 주인 없는 맵이 남는다.
  assert.ok(prompt.indexOf('claim map-yged') < prompt.indexOf(doc));
});

test('맵이 없으면 claim 을 시키지 않는다 — 티켓 bd id 를 맵으로 선언하면 안 된다', () => {
  const prompt = buildPrompt({ doc, bdId: 'map-ticket', guard });
  assert.doesNotMatch(prompt, /frontier-guard/);
  assert.match(prompt, /bd show map-ticket/);
});

test('🚨 넘기는 bd 가 worktree 의 맵 밖이면 그 맵을 claim 시키지 않는다 — 같은 worktree 의 남의 맵을 빼앗는다', () => {
  const prompt = buildPrompt({ doc, bdId: 'other-c68e', mapEpic: 'map-zrr2.23', guard });
  assert.doesNotMatch(prompt, /frontier-guard/);
  assert.doesNotMatch(prompt, /map-zrr2\.23/);
  assert.match(prompt, /bd show other-c68e/);
});

test('inheritedMap — bd 가 없거나 맵 자신·그 자손이면 맵을 잇고, 아니면 null', () => {
  assert.equal(inheritedMap({ mapEpic: 'map-yged' }), 'map-yged');
  assert.equal(inheritedMap({ bdId: 'map-yged', mapEpic: 'map-yged' }), 'map-yged');
  assert.equal(inheritedMap({ bdId: 'map-yged.12', mapEpic: 'map-yged' }), 'map-yged');
  // 접두사만 같은 다른 id 는 자손이 아니다.
  assert.equal(inheritedMap({ bdId: 'map-ygedx', mapEpic: 'map-yged' }), null);
  assert.equal(inheritedMap({ bdId: 'other-c68e', mapEpic: 'map-zrr2.23' }), null);
  assert.equal(inheritedMap({ bdId: 'other-c68e' }), null);
});

test('hold 면 지금 claim 하지 않고, 이어가라는 지시가 올 때 claim 하라고 남긴다', () => {
  const prompt = buildPrompt({ doc, mapEpic: 'map-yged', guard, hold: true });
  assert.match(prompt, /작업을 시작하지 않는다/);
  assert.match(prompt, /이어가라는 지시가 오면 .*claim map-yged/);
  assert.ok(prompt.indexOf(doc) < prompt.indexOf('claim map-yged'));
});
