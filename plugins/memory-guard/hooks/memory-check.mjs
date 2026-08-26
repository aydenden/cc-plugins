#!/usr/bin/env node
/**
 * SessionStart 훅(asyncRewake) — 이 세션의 프로젝트 메모리를 하루 1회 점검한다.
 *
 * 결정적 판정만 한다(무료, LLM 없이): 예산·하드캡, 깨진 링크, 고아 토픽, 노후.
 * 후보가 있으면 종료코드 2 로 메인 세션에 알리고, 의미 판단과 처리는 에이전트가
 * 한다. 아무것도 지우지 않는다.
 *
 * 차단이 아니라 알림인 이유: 링크·고아·섹션 판정은 인덱스 포맷을 추론해서 내리므로
 * 오판 가능성이 남는다. 오판한 알림은 무시하면 그만이지만 오판한 차단은 데드락이다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { auditIndex, auditTopic, isExcluded, renderCheck, INDEX_BASENAME } from '../src/core.mjs';
import {
  acquireDailyLock,
  collectSlugs,
  listTopicFiles,
  loadConfig,
  makeExists,
  readHookInput,
  resolveMemoryDir,
} from '../src/fs-adapter.mjs';

const input = await readHookInput();
if (!input) process.exit(0);

// 새 세션에서만. resume/clear/compact 는 이미 그 프로젝트를 보고 있던 세션이다.
if (input.source !== 'startup') process.exit(0);

const memoryDir = resolveMemoryDir({ transcriptPath: input.transcript_path, cwd: input.cwd });
if (!memoryDir) process.exit(0);
if (!acquireDailyLock(memoryDir)) process.exit(0);

const config = loadConfig(memoryDir);
const files = listTopicFiles(memoryDir);
const slugByFile = collectSlugs(memoryDir, files);
const slugs = new Set(slugByFile.values());
const exists = makeExists(memoryDir);

let indexText;
try {
  indexText = readFileSync(path.join(memoryDir, INDEX_BASENAME), 'utf8');
} catch {
  process.exit(0);
}

const findings = auditIndex(indexText, {
  files,
  slugs,
  config,
  exists,
  slugOf: (name) => slugByFile.get(name),
}).findings;

const now = Math.floor(Date.now() / 1000);
for (const name of files) {
  if (name === INDEX_BASENAME || isExcluded(name, config)) continue;
  try {
    findings.push(...auditTopic(name, readFileSync(path.join(memoryDir, name), 'utf8'), { files, slugs, config, now, exists }));
  } catch {
    /* 읽지 못한 파일은 건너뛴다 */
  }
}

if (findings.length === 0) process.exit(0);

// 긴 항목 지적을 100건 쏟으면 그게 곧 컨텍스트 오염이다 — 한 줄로 접는다.
const tooLong = findings.filter((f) => f.kind === 'entry-too-long');
const rest = findings.filter((f) => f.kind !== 'entry-too-long');
if (tooLong.length > 0) {
  rest.push({
    kind: 'entry-too-long',
    message: `${tooLong.length}개 항목이 상한 초과 (${tooLong.map((f) => `${f.line}행`).slice(0, 10).join(', ')}${
      tooLong.length > 10 ? ' …' : ''
    }) — 상세를 토픽 본문으로 내린다`,
  });
}

console.error(renderCheck(memoryDir, rest));
process.exit(2);
