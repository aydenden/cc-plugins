/**
 * core.mjs 테스트 — 파일시스템을 만지지 않는다. 인덱스 본문과 파일 목록을 문자열/배열로 준다.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CAPS,
  DEFAULTS,
  auditIndex,
  auditTopic,
  deriveLimits,
  extractLinks,
  frontmatterSlug,
  guardWrite,
  isExcluded,
  parseIndex,
  planWrite,
  resolveConfig,
  splitLines,
} from './core.mjs';

const cfg = (raw) => resolveConfig(raw);
const kinds = (r) => (r.findings ?? r).map((f) => f.kind).sort();

/** 링크로 토픽을 가리키는 평범한 인덱스. 특정 헤더 관례를 쓰지 않는다. */
const plainIndex = ['# Memory index', '- [auth](auth.md) — 로그인 흐름', '- [build](build.md) — 빌드 파이프라인'].join('\n');

const plainFiles = ['MEMORY.md', 'auth.md', 'build.md'];

// --- 한도 유도 ---

test('예산과 항목 상한은 하드캡에서 유도된다', () => {
  const limits = deriveLimits(cfg({}));
  assert.equal(limits.bytes, Math.round(CAPS.bytes * 0.9));
  assert.equal(limits.lines, Math.round(CAPS.lines * 0.9));
  assert.equal(limits.entryBytes, Math.round((limits.bytes / limits.lines) * DEFAULTS.entrySlack));
});

test('headroom 을 조이면 세 한도가 함께 내려간다', () => {
  const tight = deriveLimits(cfg({ headroom: 0.5 }));
  const loose = deriveLimits(cfg({ headroom: 0.9 }));
  assert.ok(tight.bytes < loose.bytes);
  assert.ok(tight.lines < loose.lines);
  assert.equal(tight.entryBytes, loose.entryBytes); // 비율이 같으므로 항목 상한은 유지된다
});

test('범위 밖 설정은 기본값으로 되돌린다', () => {
  assert.equal(cfg({ headroom: 5 }).headroom, 1);
  assert.equal(cfg({ headroom: 'x' }).headroom, DEFAULTS.headroom);
  assert.equal(cfg({ section: { min: 9, max: 2 } }).section, null);
  assert.equal(cfg(null).staleDays, DEFAULTS.staleDays);
});

// --- 파싱 ---

test('CRLF 와 파일 끝 개행이 줄 수를 흔들지 않는다', () => {
  assert.equal(splitLines('a\r\nb\r\n').length, 2);
  assert.equal(splitLines('a\nb').length, 2);
  assert.equal(parseIndex('- x\r\n- y\r\n').entries.length, 2);
});

test('헤더 포맷을 가정하지 않는다 — 링크가 있으면 토픽, 없으면 문구', () => {
  const parsed = parseIndex(['## [auth](auth.md)', '- a', '## 그냥 제목', '- b'].join('\n'));
  assert.deepEqual(
    parsed.sections.map((s) => s.topic),
    ['auth.md', '그냥 제목'],
  );
  assert.equal(parsed.sections[0].entries.length, 1);
});

test('링크 추출은 내부 md 링크와 wikilink 만 본다', () => {
  const links = extractLinks('[a](a.md) [b](https://x/b.md) [c](/abs/c.md) [[slug]] [[s|별칭]]');
  assert.deepEqual(links.md, ['a.md']);
  assert.deepEqual(links.wiki, ['slug', 's']);
});

test('프론트매터 slug 를 읽는다', () => {
  assert.equal(frontmatterSlug('---\nname: auth-flow\nx: 1\n---\n본문'), 'auth-flow');
  assert.equal(frontmatterSlug('본문만'), null);
});

// --- 인덱스 감사 ---

test('규칙을 지키는 인덱스는 조용하다', () => {
  const r = auditIndex(plainIndex, { files: plainFiles, config: cfg({}) });
  assert.equal(r.ok, true, JSON.stringify(r.findings));
});

test('하드캡 초과는 truncated 로 구분된다', () => {
  const fat = `- ${'가'.repeat(9000)}\n`;
  const r = auditIndex(fat, { files: ['MEMORY.md'], config: cfg({}) });
  assert.equal(r.truncated, true);
  assert.ok(kinds(r).includes('cap-bytes'));
});

test('예산 초과는 하드캡 미만에서 잡힌다', () => {
  const body = `- ${'a'.repeat(60)}\n`.repeat(380); // 약 23,180B / 380줄
  const r = auditIndex(body, { files: ['MEMORY.md'], config: cfg({}) });
  const k = kinds(r);
  assert.ok(k.includes('budget-bytes'));
  assert.ok(k.includes('cap-lines')); // 줄 수는 하드캡도 넘는다
  assert.equal(r.bytes < CAPS.bytes, true);
});

test('깨진 링크와 wikilink 를 잡고, slug 로 해석되는 것은 통과시킨다', () => {
  const text = '- [a](gone.md)\n- [[known-slug]]\n- [[nope]]';
  const r = auditIndex(text, { files: ['MEMORY.md'], slugs: ['known-slug'], config: cfg({}) });
  const k = kinds(r);
  assert.deepEqual(
    k.filter((x) => x.startsWith('broken')),
    ['broken-link', 'broken-wikilink'],
  );
});

test('아무도 가리키지 않는 토픽 파일은 고아다', () => {
  const r = auditIndex(plainIndex, { files: [...plainFiles, 'lonely.md'], config: cfg({}) });
  assert.deepEqual(
    r.findings.filter((f) => f.kind === 'orphan-topic').map((f) => f.target),
    ['lonely.md'],
  );
});

test('링크 없이 헤더에 파일명만 적는 인덱스도 고아로 오탐하지 않는다', () => {
  const text = ['# Memory index', '## auth.md — 로그인', '- a', '## build.md — 빌드', '- b'].join('\n');
  const r = auditIndex(text, { files: plainFiles, config: cfg({}) });
  assert.equal(r.ok, true, JSON.stringify(r.findings));
});

test('언급 판정은 부분 일치를 참조로 세지 않는다', () => {
  const r = auditIndex('## rtos-job.md — 잡', { files: ['rtos-job.md', 'job.md'], config: cfg({}) });
  assert.deepEqual(
    r.findings.filter((f) => f.kind === 'orphan-topic').map((f) => f.target),
    ['job.md'],
  );
});

test('슬러그로만 언급된 토픽은 고아가 아니다', () => {
  const r = auditIndex('- [[auth-flow]] 참고', {
    files: ['auth.md'],
    slugs: ['auth-flow'],
    slugOf: (n) => (n === 'auth.md' ? 'auth-flow' : undefined),
    config: cfg({}),
  });
  assert.equal(r.ok, true, JSON.stringify(r.findings));
});

test('제외 규칙 — 기본은 초안 관례, 설정으로 더 넣는다', () => {
  assert.equal(isExcluded('MEMORY.md', cfg({})), true);
  assert.equal(isExcluded('_draft.md', cfg({})), true);
  assert.equal(isExcluded('notes.draft.md', cfg({})), true);
  assert.equal(isExcluded('scratch.md', cfg({})), false);
  assert.equal(isExcluded('scratch.md', cfg({ exclude: ['scratch*'] })), true);

  const r = auditIndex(plainIndex, { files: [...plainFiles, 'scratch.md'], config: cfg({ exclude: ['scratch*'] }) });
  assert.equal(r.ok, true);
});

test('섹션 크기 검사는 설정이 있을 때만 켜진다', () => {
  const text = ['## [a](auth.md)', '- 1', '## [b](build.md)', '- 1', '- 2', '- 3', '- 4'].join('\n');
  const off = auditIndex(text, { files: plainFiles, config: cfg({}) });
  assert.equal(off.findings.some((f) => f.kind.startsWith('section-')), false);

  const on = auditIndex(text, { files: plainFiles, config: cfg({ section: { min: 2, max: 3 } }) });
  assert.deepEqual(kinds(on), ['section-too-big', 'section-too-small']);
});

test('같은 토픽을 두 섹션이 가리키면 중복이다', () => {
  const text = ['## [a](auth.md)', '- 1', '- 2', '## [a2](auth.md)', '- 3', '- 4'].join('\n');
  const r = auditIndex(text, { files: plainFiles, config: cfg({ section: { min: 1, max: 8 } }) });
  assert.ok(kinds(r).includes('duplicate-topic'));
});

test('build.md 가 인덱스에 없으면 고아로만 잡히고 링크는 멀쩡하다', () => {
  const r = auditIndex('- [auth](auth.md)', { files: plainFiles, config: cfg({}) });
  assert.deepEqual(kinds(r), ['orphan-topic']);
});

// --- 토픽 감사 ---

test('노후는 본문 최신 날짜 기준이다', () => {
  const now = Math.floor(Date.parse('2026-08-26T00:00:00Z') / 1000);
  const old = auditTopic('a.md', '2026-01-01 에 확인', { config: cfg({}), now, files: [] });
  assert.deepEqual(kinds(old), ['stale-date']);

  const fresh = auditTopic('a.md', '2026-01-01 에 확인했고 2026-08-01 에 갱신', { config: cfg({}), now, files: [] });
  assert.deepEqual(kinds(fresh), []);
});

test('토픽 파일의 깨진 링크도 잡는다', () => {
  const r = auditTopic('a.md', '자세히는 [b](b.md)', { config: cfg({}), files: ['a.md'], now: 0 });
  assert.deepEqual(kinds(r), ['broken-link']);
});

test('하위 디렉터리 링크는 exists 위임으로 해석된다', () => {
  const r = auditTopic('a.md', '[old](archive/a.md)', {
    config: cfg({}),
    files: ['a.md'],
    now: 0,
    exists: (rel) => rel === 'archive/a.md',
  });
  assert.deepEqual(kinds(r), []);
});

// --- write 가드 ---

const bigLine = `- ${'가'.repeat(200)}`; // 600B 남짓

test('Edit 의 결과 크기는 바이트 델타로 정확히 나온다', () => {
  const plan = planWrite({ tool: 'Edit', oldText: 'abc\ndef\n', old_string: 'def', new_string: 'defgh\nij' });
  assert.equal(plan.oldBytes, 8);
  assert.equal(plan.newBytes, 8 - 3 + 8);
  assert.equal(plan.oldLines, 2);
  assert.equal(plan.newLines, 3);
});

test('줄이는 write 는 절대 막지 않는다 — 정리 경로가 데드락되면 안 된다', () => {
  const huge = `${bigLine}\n`.repeat(50);
  const r = guardWrite({ tool: 'Write', oldText: huge, content: '- 짧게\n' }, { config: cfg({}) });
  assert.equal(r.blocked, false);
});

test('같은 크기로 갈아끼우는 write 는 통과한다 — 1-in-1-out 이 성립한다', () => {
  const text = '- 하나\n- 둘\n';
  const r = guardWrite({ tool: 'Edit', oldText: text, old_string: '- 둘', new_string: '- 셋' }, { config: cfg({}) });
  assert.equal(r.blocked, false);
});

test('한도를 넘겨 키우는 write 는 막는다', () => {
  const near = `- ${'a'.repeat(100)}\n`.repeat(220); // 22,440B — 예산(22,500B) 바로 아래
  const r = guardWrite({ tool: 'Edit', oldText: near, old_string: '', new_string: `- ${'b'.repeat(100)}\n` }, { config: cfg({}) });
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => x.includes('크기')));
});

test('추가되는 긴 항목은 한글에서도 구속한다 — 축이 바이트다', () => {
  const r = guardWrite({ tool: 'Edit', oldText: '- x\n', old_string: '', new_string: `${bigLine}\n` }, { config: cfg({}) });
  assert.equal(r.blocked, true);
  assert.ok(r.reasons.some((x) => x.includes('항목이')));
});

test('기존 인덱스의 긴 줄은 write 를 막지 않는다 — 추가분만 본다', () => {
  const r = guardWrite({ tool: 'Edit', oldText: `${bigLine}\n`, old_string: '', new_string: '- 짧은 줄\n' }, { config: cfg({}) });
  assert.equal(r.blocked, false);
});

test('requireTopicFirst 는 토픽 파일이 없는 인덱스 줄을 막는다', () => {
  const w = { tool: 'Edit', oldText: '- x\n', old_string: '', new_string: '- [new](new.md) — 요약\n' };
  const off = guardWrite(w, { config: cfg({}), files: ['MEMORY.md'] });
  assert.equal(off.blocked, false);

  const on = guardWrite(w, { config: cfg({ requireTopicFirst: true }), files: ['MEMORY.md'] });
  assert.equal(on.blocked, true);
  assert.ok(on.reasons.some((x) => x.includes('new.md')));

  const ready = guardWrite(w, { config: cfg({ requireTopicFirst: true }), files: ['MEMORY.md', 'new.md'] });
  assert.equal(ready.blocked, false);
});

test('인덱스가 아닌 도구는 판정 대상이 아니다', () => {
  assert.equal(guardWrite({ tool: 'Bash', oldText: '' }, { config: cfg({}) }).blocked, false);
});
