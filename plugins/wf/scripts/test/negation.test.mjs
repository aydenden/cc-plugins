import assert from 'node:assert/strict';
import test from 'node:test';

import { negationReport, unprovenClaims } from '../lib/negation.mjs';

/** Narrowed to "I looked and it was not there"; the broad 없다·없음 fires on ordinary prose. */
const NEGATION = {
  claim: '0건|찾지 못|못 찾|미발견|검색되지 않|확인되지 않|(선례|공개 자료)[^.|]{0,12}없',
  proof: '검색|조회|쿼리|키워드|grep|rg |search|[0-9]+건을|[0-9]+건 중',
};

const claims = (text, written = text) => unprovenClaims({ text, written, negation: NEGATION }).map((claim) => claim.line);

test('an absence claim with no search nearby is flagged', () => {
  assert.deepEqual(claims('# 조사\n\n공식 문서를 찾지 못했다.'), [3]);
});

test('🚨 a claim with a trace of the search next to it is not flagged', () => {
  assert.deepEqual(claims('공식 문서를 찾지 못했다. `rg -n "refund" docs` 0건.'), []);
  assert.deepEqual(claims('키워드 "환불 정책" 으로 훑었다.\n\n공식 문서를 찾지 못했다.'), []);
});

test('a search more than six lines away does not back the claim', () => {
  const far = ['rg -n refund docs', ...Array(7).fill('본문'), '공식 문서를 찾지 못했다.'].join('\n');
  assert.deepEqual(claims(far), [9]);
  const near = ['rg -n refund docs', ...Array(5).fill('본문'), '공식 문서를 찾지 못했다.'].join('\n');
  assert.deepEqual(claims(near), []);
});

test('ordinary prose with 없다 is not a claim under the narrowed pattern', () => {
  assert.deepEqual(claims('이 화면에는 버튼이 없다.\n상태가 없음.'), []);
});

test('🚨 a claim on a line this edit did not write is not flagged', () => {
  const text = '공식 문서를 찾지 못했다.\n\n## 새 절\n\n새로 쓴 문장이다.';
  assert.deepEqual(claims(text, '## 새 절\n\n새로 쓴 문장이다.'), []);
});

test('a claim the edit wrote is flagged among older lines', () => {
  const text = '공식 문서를 찾지 못했다.\n\n## 새 절\n\n선례는 아직 없다.';
  assert.deepEqual(claims(text, '## 새 절\n\n선례는 아직 없다.'), [5]);
});

test('an edit that inserts the claim into an existing line is flagged', () => {
  assert.deepEqual(claims('환불 규정은 공식 문서에서 찾지 못했다고 본다.', '찾지 못했다'), [1]);
});

test('an edit that touches another part of a claiming line is not flagged', () => {
  assert.deepEqual(claims('환불 규정은 공식 문서에서 찾지 못했다고 본다.', '환불 규정'), []);
});

test('nothing written means nothing to flag', () => {
  assert.deepEqual(claims('공식 문서를 찾지 못했다.', ''), []);
});

test('CRLF documents and edits are read line by line', () => {
  assert.deepEqual(claims('# 조사\r\n\r\n공식 문서를 찾지 못했다.\r\n', '공식 문서를 찾지 못했다.\r\n'), [3]);
});

test('the report names file and line, truncates the text, and is empty when clean', () => {
  assert.deepEqual(negationReport({ docPath: 'a.md', claims: [] }), []);
  const lines = negationReport({ docPath: 'docs/a.md', claims: [{ line: 3, text: `찾지 못했다 ${'가'.repeat(200)}` }] });
  assert.match(lines[0], /^UNPROVEN docs\/a\.md:3 {2}찾지 못했다 가+$/);
  assert.ok(lines[0].length < 160);
  assert.match(lines[1], /1 absence claim/);
});
