import assert from 'node:assert/strict';
import test from 'node:test';

import { declaredWorktreePath, worktreeMismatch } from '../lib/doc-meta.mjs';

test('문서 머리의 worktree 줄을 읽는다 — 백틱과 뒤따르는 괄호를 벗긴다', () => {
  const doc = [
    '# 인계 21 — 어쩌고',
    '',
    '- **일시**: 2026-09-18 09:40',
    '- **worktree**: `C:\\dev\\wt\\proj\\topic-a` (브랜치 `feature/topic-a`, HEAD `e036e30183`)',
    '- **bd 정본**: `map-abcd`',
  ].join('\n');
  assert.equal(declaredWorktreePath(doc), 'C:\\dev\\wt\\proj\\topic-a');
});

test('백틱 없는 규약 형태도 읽는다', () => {
  const doc = '- **worktree**: C:/dev/wt/proj/topic-a (브랜치 `feature/x`)';
  assert.equal(declaredWorktreePath(doc), 'C:/dev/wt/proj/topic-a');
});

test('POSIX 절대경로도 읽는다 — Windows 전용이 아니다', () => {
  assert.equal(declaredWorktreePath('- **worktree**: /home/me/wt/topic-a (브랜치 `x`)'), '/home/me/wt/topic-a');
});

test('worktree 줄이 없으면 null — 대조할 근거가 없다는 뜻이지 불일치가 아니다', () => {
  assert.equal(declaredWorktreePath('# 인계\n\n- **일시**: 2026-09-18'), null);
});

test('구분자와 대소문자가 달라도 같은 경로면 통과한다', () => {
  assert.equal(worktreeMismatch({ declared: 'C:\\dev\\wt\\proj\\Topic-A', resolved: 'C:/dev/wt/proj/topic-a/' }), null);
});

test('선언이 없으면 통과한다', () => {
  assert.equal(worktreeMismatch({ declared: null, resolved: 'C:/dev/tools' }), null);
});

test('🚨 다른 worktree 면 사유를 문자열로 낸다 — 엉뚱한 탭이 뜨는 실패의 유일한 검출점이다', () => {
  const why = worktreeMismatch({ declared: 'C:\\dev\\wt\\proj\\topic-a', resolved: 'C:/dev/tools' });
  assert.ok(why, '불일치를 잡지 못했다');
  assert.match(why, /topic-a/);
  assert.match(why, /tools/);
  assert.match(why, /--worktree/);
});

test('하위 경로는 같은 worktree 가 아니다 — 상위만 담아도 통과시키면 가드가 무의미해진다', () => {
  assert.ok(worktreeMismatch({ declared: 'C:/dev/wt/proj/topic-a', resolved: 'C:/dev/wt/proj' }));
});
