import test from 'node:test';
import assert from 'node:assert/strict';

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { normalizeBdOutput, normalizeDependency, schemaGaps, shapeMessage, versionOf } from '../lib/bd-shape.mjs';

// --- 의존 한 칸 ---

test('list 꼴 의존은 그대로 둔다', () => {
  const dep = { issue_id: 'm.2', depends_on_id: 'm.1', type: 'blocks' };
  assert.deepEqual(normalizeDependency(dep), dep);
});

test('🚨 show 꼴 의존(대상 issue 를 펼치고 dependency_type)을 list 꼴로 맞춘다 — 안 맞추면 «의존 없음» 으로 읽혀 맵이 선다', () => {
  const dep = normalizeDependency({ id: 'm.1', title: '앞 티켓', status: 'open', issue_type: 'task', dependency_type: 'blocks' });
  assert.equal(dep.depends_on_id, 'm.1');
  assert.equal(dep.type, 'blocks');
});

// --- 명령 출력 ---

test('issue 출력은 배열·{issues}·객체 하나 어느 꼴이든 배열로 맞춘다', () => {
  const row = { id: 'm', status: 'open' };
  assert.deepEqual(normalizeBdOutput(['show', 'm'], [row]).rows, [row]);
  assert.deepEqual(normalizeBdOutput(['list'], { issues: [row] }).rows, [row]);
  assert.deepEqual(normalizeBdOutput(['show', 'm'], row).rows, [row]);
  assert.deepEqual(normalizeBdOutput(['ready'], []).rows, []);
});

test('🚨 읽어야 할 칸이 없으면 추측하지 않고 빠진 칸을 말한다', () => {
  assert.deepEqual(normalizeBdOutput(['list'], 'x').gaps, ['issue 목록(배열이 아니다)']);
  assert.deepEqual(normalizeBdOutput(['list'], [{ id: 'm.1' }]).gaps, ['issue.status']);
  assert.deepEqual(normalizeBdOutput(['list'], [{ id: 'm.1', status: 'open', labels: 'human' }]).gaps, ['issue.labels(배열이 아니다)']);
  assert.deepEqual(
    normalizeBdOutput(['list'], [{ id: 'm.2', status: 'open', dependencies: [{ issue_id: 'm.2', target: 'm.1', kind: 'blocks' }] }]).gaps,
    ['dependency.depends_on_id', 'dependency.type']
  );
});

test('labels·dependencies 가 없는 행은 «없음» 이다 — bd 는 빈 칸을 생략한다(1.3.4 실측)', () => {
  assert.deepEqual(normalizeBdOutput(['list'], [{ id: 'm.1', status: 'open' }]).gaps, undefined);
});

test('comments 는 text 를 읽고, body 꼴도 text 로 맞춘다', () => {
  const at = '2026-11-01T00:00:00Z';
  assert.equal(normalizeBdOutput(['comments', 'm'], [{ text: '가', created_at: at }]).rows[0].text, '가');
  assert.equal(normalizeBdOutput(['comments', 'm'], [{ body: '나', created_at: at }]).rows[0].text, '나');
  assert.deepEqual(normalizeBdOutput(['comments', 'm'], [{ created_at: at }]).gaps, ['comment.text']);
});

test('모양을 모르는 명령은 손대지 않는다', () => {
  assert.deepEqual(normalizeBdOutput(['stats'], { a: 1 }).rows, { a: 1 });
});

// --- bd schema 대조 ---

test('bd 버전 줄에서 버전을 뽑는다', () => {
  assert.equal(versionOf('bd version 1.3.4 (Homebrew)'), '1.3.4');
  assert.equal(versionOf('bd version 1.4.0-rc.4 (abc)'), '1.4.0-rc.4');
  assert.equal(versionOf(''), null);
});

test('bd schema 가 없으면(1.3.0 미만) 대조는 «모름» 이다 — 빈 목록(통과)이 아니다', () => {
  assert.equal(schemaGaps(null), null);
  assert.equal(schemaGaps({}), null);
});

test('🚨 이 bd 의 schema 에 읽는 칸이 없으면 그 칸을 이름으로 말한다', () => {
  const schema = { types: { issue: { properties: { id: {}, status: {} } }, dependency: { properties: { issue_id: {}, target_id: {} } } } };
  const gaps = schemaGaps(schema);
  assert.ok(gaps.includes('issue.labels'));
  assert.ok(gaps.includes('dependency.depends_on_id'));
  const message = shapeMessage({ version: '9.9.9', gaps, schema });
  assert.match(message, /bd 9\.9\.9/);
  assert.match(message, /dependency\.depends_on_id/);
  assert.match(message, /issue_id, target_id/);
  assert.match(message, /bd-shape\.mjs/);
});

// --- 버전별 실측 fixture ---

const FIXTURES = fileURLToPath(new URL('./fixtures/bd/', import.meta.url));
const versions = readdirSync(FIXTURES, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);

test('fixture 버전이 하나 이상 있다', () => {
  assert.ok(versions.length > 0);
});

for (const version of versions) {
  const read = (name) => JSON.parse(readFileSync(join(FIXTURES, version, `${name}.json`), 'utf8'));

  test(`bd ${version}: schema 에 읽는 칸이 다 있다`, () => {
    assert.deepEqual(schemaGaps(read('schema')), []);
  });

  test(`bd ${version}: 명령마다 출력이 내부 꼴로 맞춰진다`, () => {
    for (const [name, args] of [
      ['show', ['show']],
      ['show-with-deps', ['show']],
      ['list', ['list']],
      ['ready', ['ready']],
      ['comments', ['comments']],
    ]) {
      const shaped = normalizeBdOutput(args, read(name));
      assert.equal(shaped.gaps, undefined, `${name}: ${shaped.gaps}`);
    }
  });

  test(`bd ${version}: show 의 의존도 list 와 같은 대상 id·종류로 읽힌다`, () => {
    const [shown] = normalizeBdOutput(['show'], read('show-with-deps')).rows;
    const [listed] = normalizeBdOutput(['list'], read('list')).rows.filter((r) => r.id === shown.id);
    const pairs = (row) => (row.dependencies ?? []).map((d) => `${d.type}:${d.depends_on_id}`).sort();
    assert.ok(pairs(shown).length > 0);
    if (listed) assert.deepEqual(pairs(shown), pairs(listed));
  });
}
