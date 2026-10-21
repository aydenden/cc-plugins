import assert from 'node:assert/strict';
import test from 'node:test';

import {
  declaredWorktreePath,
  handoffLogInPrinciples,
  lessonsInPrinciples,
  principleSectionViolation,
  worktreeMismatch,
} from '../lib/doc-meta.mjs';

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

// --- §0 사용자 원칙에 섞인 교훈 ---
//
// §0 은 인계마다 통째로 복사된다. 거기 들어간 교훈은 다시 나가지 않고 사슬을 따라 불어난다 — 실제
// 릴레이에서 인계 87 번 만에 §0 이 15K자가 됐고 그중 절반 넘게가 교훈·도구 함정이었다.

const principlesDoc = (principleLines, rest = []) =>
  [
    '# 인계 87 — 어쩌고',
    '',
    '- **worktree**: C:\\dev\\wt\\proj\\topic-a (브랜치 `main`)',
    '',
    '## 0. 사용자 원칙 — 최우선, 다음 인계에도 그대로 옮긴다',
    '',
    ...principleLines,
    '',
    '## 1. 지금 하는 일',
    '',
    ...rest,
  ].join('\n');

test('사용자 지시로 출처가 붙은 원칙은 교훈이 아니다', () => {
  const doc = principlesDoc([
    '1. **멈추지 않는다.** 크리티컬 이슈가 없는 한 `bd` 프론티어가 소거될 때까지 계속 간다.',
    '8. **설명은 짧게 쓴다**(사용자 지시',
    '38. **새 의존성은 묻고 들인다**(사용자 결정 2026-09-23).',
  ]);
  assert.deepEqual(lessonsInPrinciples(doc), []);
  assert.equal(principleSectionViolation(doc), null);
});

test('🚨 「인계 NN 이 한 줄 더한다」 꼴은 교훈이다 — 원칙이 아니라 작업 중 얻은 지식', () => {
  const doc = principlesDoc([
    '11. **테스트가 부족하면 그것부터 세운다**(사용자 지시 2026-09-16).',
    '✅ **인계 85 가 한 줄 더한다 — 재현이 한 번만 되면 두 번 더 돌려 본다.**',
  ]);
  const found = lessonsInPrinciples(doc);
  assert.equal(found.length, 1);
  assert.match(found[0].text, /인계 85 가 한 줄 더한다/);
  assert.equal(found[0].line, 8, '문서 기준 1-based 줄 번호여야 고칠 자리를 바로 찾는다');
});

test('🚨 실측을 근거로 든 도구 함정도 교훈이다', () => {
  const doc = principlesDoc([
    '🚨 **그 도구는 상대경로를 못 읽는다**(인계 83 실측) — 절대경로를 준다.',
    '   ✅ 실측(인계 71~86): `status` 의 값이 **전부 `null`** 이었다 —',
  ]);
  assert.equal(lessonsInPrinciples(doc).length, 2);
});

test('「원칙 N 의 단서」 머리도 교훈이다 — 원칙 밑에 매달린 해설이라', () => {
  const doc = principlesDoc(['🚨 **원칙 10·17 의 단서** — **성능 가설은 대개 틀린다.**']);
  assert.equal(lessonsInPrinciples(doc).length, 1);
});

test('인계 번호를 들어도 사용자 출처가 같은 줄에 있으면 원칙이다', () => {
  const doc = principlesDoc(['40. **문서는 한 쪽으로 묶는다**(사용자 결정 2026-09-23, 인계 83). 인계 83 에서 막혔다.']);
  assert.deepEqual(lessonsInPrinciples(doc), []);
});

test('§0 밖의 실측은 대상이 아니다 — §6 함정은 원래 교훈을 적는 자리다', () => {
  const doc = principlesDoc(
    ['1. **멈추지 않는다**(사용자 지시 2026-09-16).'],
    ['## 6. 함정', '', '- 캐시를 지워야 새 설정이 읽힌다(인계 87 실측)']
  );
  assert.deepEqual(lessonsInPrinciples(doc), []);
});

test('「실측」이라는 낱말만으로는 교훈이 아니다 — 근거로 인용할 때만 잡는다', () => {
  const doc = principlesDoc([
    '1. **결과는 두 갈래로만 나눈다**(사용자 지시 2026-09-22).',
    "   세 번째 '기타' 칸을 만들지 않는다. 단 실측이 아니라는 점은 각 항목에 명시한다.",
    '- **파일 이름으로 종류를 판정하지 않는다**(2026-09-22 실측으로 확정).',
  ]);
  const found = lessonsInPrinciples(doc);
  assert.equal(found.length, 1);
  assert.match(found[0].text, /파일 이름/);
});

test('0번 절이라도 원칙 절이 아니면 대상이 아니다', () => {
  const doc = ['# 인계 15', '', '## 0. 먼저 읽을 것', '', '- `notes.md` — 확인한 것이 여기 있다(인계 14 실측)'].join('\n');
  assert.deepEqual(lessonsInPrinciples(doc), []);
});

test('§0 이 없는 문서는 통과한다', () => {
  assert.equal(principleSectionViolation('# 인계 01\n\n## 1. 지금 하는 일\n\n- ✅ 인계 3 실측'), null);
});

// --- §0 을 인계 이력으로 쓴 꼴 ---
//
// 사용자 발언이라 교훈 검사는 통과하지만, 인계마다 소절이 하나씩 붙어 사슬을 따라 불어난다 — 실제
// 릴레이 인계 18 에서 소절 17개였다.

test('🚨 인계 번호별 소절은 이력이다 — 사용자 발언이어도 막는다', () => {
  const doc = principlesDoc([
    '### 인계 01~04 에서 이어지는 것',
    '',
    '- **팬아웃 금지**(사용자 지시 2026-09-21).',
    '### 인계 08·09(09-23)',
    '### 인계 17(09-23 밤, 인계 16 수신)',
  ]);
  const found = handoffLogInPrinciples(doc);
  assert.equal(found.length, 3);
  assert.equal(found[0].line, 7);
});

test('🚨 「새 지시 없음」 줄도 이력이다 — 실을 원칙이 없다는 말은 §0 에 둘 이유가 없다', () => {
  const doc = principlesDoc(['사용자의 새 지시 없음.', '- 새 지시 없음']);
  assert.equal(handoffLogInPrinciples(doc).length, 2);
});

test('주제로 묶은 소절과 출처 붙은 원칙은 이력이 아니다', () => {
  const doc = principlesDoc(['### 범위·브랜치', '- **브랜치는 하나로 간다**(사용자 지시 2026-09-21, 인계 01).']);
  assert.deepEqual(handoffLogInPrinciples(doc), []);
  assert.equal(principleSectionViolation(doc), null);
});

test('§0 밖의 인계 번호 소절은 대상이 아니다', () => {
  const doc = principlesDoc(['- **멈추지 않는다**(사용자 지시 2026-09-16).'], ['### 인계 17 에서 한 일']);
  assert.deepEqual(handoffLogInPrinciples(doc), []);
});

test('🚨 이력 꼴이면 send 사유가 서고, 주제로 다시 묶으라고 말한다', () => {
  const why = principleSectionViolation(principlesDoc(['### 인계 18(이번 세션)', '사용자의 새 지시 없음.']));
  assert.ok(why, '이력 꼴을 잡지 못했다');
  assert.match(why, /2/);
  assert.match(why, /주제/);
});

test('🚨 위반 사유는 줄 번호와 옮길 자리를 말한다 — 크기가 아니라 자리를 고치게 한다', () => {
  const lessons = Array.from({ length: 12 }, (_, i) => `✅ **인계 ${60 + i} 이 한 줄 더한다 — 교훈 ${i}.**`);
  const why = principleSectionViolation(principlesDoc(lessons));
  assert.ok(why, '위반을 잡지 못했다');
  assert.match(why, /12/, '전체 개수를 말해야 한다');
  assert.match(why, /7:/, '첫 줄 번호가 있어야 한다');
  assert.match(why, /references/, '옮길 자리를 말해야 한다');
  assert.match(why, /사용자 (지시|결정)/, '오탐일 때 출처를 붙이는 탈출구를 말해야 한다');
  assert.ok(!why.includes('교훈 11'), '목록은 앞 몇 줄로 끊어 사유가 또 하나의 긴 문서가 되지 않게 한다');
});
