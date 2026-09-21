import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';

import { handoffDir, nextDocName, slugify } from '../lib/handoff-path.mjs';
import { handoffRoot, repoKeyOf, stateRoot } from '../lib/state-root.mjs';

test('인계 문서는 번호를 올려 쌓는다 — 덮어쓰면 인계 사슬이 끊긴다', () => {
  assert.equal(nextDocName([]), 'handoff-01.md');
  assert.equal(nextDocName(['handoff-01.md', 'handoff-02.md']), 'handoff-03.md');
  // 사이가 비어도 최대값 다음이다 — 빈 번호를 메우면 시간순과 정렬순이 어긋난다.
  assert.equal(nextDocName(['handoff-01.md', 'handoff-04.md']), 'handoff-05.md');
  assert.equal(nextDocName(['README.md', 'handoff.md', 'handoff-1.md']), 'handoff-01.md');
});

test('슬러그는 폴더 이름으로 쓸 수 있는 꼴로 깎인다', () => {
  assert.equal(slugify('세션 인계 / 스킬 이식'), '세션-인계-스킬-이식');
  assert.equal(slugify('  '), 'session');
  assert.equal(slugify(undefined), 'session');
});

test('🚨 상태 키는 worktree 마다 갈린다 — 머신에 하나면 무관한 repo 의 세션까지 같은 맵으로 판정한다', () => {
  const a = repoKeyOf('C:/dev/wt/proj-a/topic');
  const b = repoKeyOf('C:/dev/wt/proj-b/topic');
  assert.notEqual(a, b, '같은 이름 다른 루트가 한 키로 뭉쳤다');
  // 사람이 폴더만 보고 알아볼 수 있도록 basename 을 남긴다.
  assert.match(a, /^topic-[0-9a-f]{8}$/);
});

test('구분자와 대소문자가 달라도 같은 worktree 면 같은 키다 — 인계받은 세션이 선언을 물려받아야 한다', () => {
  assert.equal(repoKeyOf('C:\\dev\\wt\\proj\\topic\\'), repoKeyOf('c:/dev/wt/proj/topic'));
});

test('기본 위치는 홈 아래다 — 작업 저장소에 파일을 만들지 않는다', () => {
  assert.equal(stateRoot({}), path.join(os.homedir(), '.claude', 'long-run'));
  assert.equal(handoffRoot({}), path.join(os.homedir(), '.claude', 'handoff'));
});

test('환경변수가 기본값을 이긴다', () => {
  assert.equal(handoffRoot({ HANDOFF_ROOT: 'D:/handoff' }), 'D:/handoff');
  assert.equal(stateRoot({ LONG_RUN_STATE_ROOT: 'D:/state' }), 'D:/state');
});

test('인계 폴더는 <root>/<repoKey>/<slug> 다', () => {
  assert.equal(
    handoffDir({ root: 'D:/handoff', repoKey: 'topic-0badf00d', slug: '이식' }),
    path.join('D:/handoff', 'topic-0badf00d', '이식')
  );
});
