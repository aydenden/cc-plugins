#!/usr/bin/env node
/**
 * 지금 PATH 의 bd 로 `bd-shape.test.mjs` 의 fixture 한 벌을 뜬다 — 새 bd 버전을 만나면 한 번 돌린다.
 *
 *   node capture.mjs <맵 epic> <의존이 있는 자식> <코멘트가 있는 issue>
 *
 * bd 가 있는 저장소에서 돌린다. 결과는 이 폴더 아래 `<bd 버전>/` 에 쓴다.
 *
 * 🚨 이 저장소는 공개고 bd 이슈는 이 기기에만 둔다(CLAUDE.md). 그래서 꼴만 남기고 글은 지운다 —
 * 자유 텍스트·사람 칸은 자리표시로 바꾸고, 목록은 몇 행만 남긴다.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { versionOf } from '../../../lib/bd-shape.mjs';

const FREE_TEXT = new Set(['title', 'description', 'notes', 'design', 'acceptance_criteria', 'close_reason', 'text', 'body', 'payload']);
const PERSON = new Set(['owner', 'assignee', 'created_by', 'author', 'actor', 'closed_by_session', 'sender']);
const MAX_ROWS = 6;

const scrub = (value, key) => {
  if (Array.isArray(value)) return value.map((v) => scrub(v, key));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrub(v, k)]));
  if (typeof value !== 'string') return value;
  if (FREE_TEXT.has(key)) return `<${key}>`;
  if (PERSON.has(key)) return '<person>';
  return value;
};

const [epic, withDeps, withComments] = process.argv.slice(2);
if (!epic || !withDeps || !withComments) {
  console.error('usage: node capture.mjs <맵 epic> <의존이 있는 자식> <코멘트가 있는 issue>');
  process.exit(1);
}

const bd = (...args) => execFileSync('bd', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const json = (...args) => JSON.parse(bd(...args, '--json'));
const version = versionOf(bd('version'));
if (!version) throw new Error('bd version 을 못 읽었다');

const listed = json('list', '--parent', epic, '--all', '--limit', '0');
const keep = [listed.find((r) => r.id === withDeps), ...listed.filter((r) => r.id !== withDeps)].filter(Boolean).slice(0, MAX_ROWS);

const out = join(dirname(fileURLToPath(import.meta.url)), version);
mkdirSync(out, { recursive: true });
const write = (name, value) => writeFileSync(join(out, `${name}.json`), `${JSON.stringify(scrub(value), null, 2)}\n`);

let schema = null;
try {
  schema = JSON.parse(bd('schema'));
} catch {
  console.error(`bd ${version} 에 schema 가 없다(1.3.0 미만) — schema.json 없이 뜬다`);
}
if (schema) {
  // 칸 이름·필수 목록만 남긴다 — 대조가 보는 것은 그것뿐이고, 전체는 수천 줄이다.
  const slim = Object.fromEntries(Object.entries(schema.types ?? {}).map(([type, s]) => [type, { required: s.required ?? [], properties: Object.fromEntries(Object.keys(s.properties ?? {}).map((k) => [k, {}])) }]));
  writeFileSync(join(out, 'schema.json'), `${JSON.stringify({ schema_version: schema.schema_version, types: slim }, null, 2)}\n`);
}
write('show', json('show', epic));
write('show-with-deps', json('show', withDeps));
write('list', keep);
write('ready', json('ready', '--parent', epic, '--limit', '0').slice(0, MAX_ROWS));
write('comments', json('comments', withComments).slice(0, 2));
console.log(out);
