#!/usr/bin/env node
/**
 * PreToolUse 훅 — 메모리 인덱스(`MEMORY.md`)를 한도 밖으로 키우는 write 를 막는다.
 *
 * 판정은 `src/core.mjs` 가 한다. 여기는 훅 입력을 읽고 파일을 읽어 넘길 뿐이다.
 * 인덱스가 아닌 write, 파싱 실패, 읽기 실패는 모두 통과시킨다 — 가드의 사고로
 * 사용자의 편집이 막히는 쪽이 비대해진 인덱스보다 나쁘다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { guardWrite, renderBlock } from '../src/core.mjs';
import {
  collectSlugs,
  listTopicFiles,
  loadConfig,
  makeExists,
  memoryDirForIndex,
  readHookInput,
} from '../src/fs-adapter.mjs';

const input = await readHookInput();
if (!input) process.exit(0);

const tool = input.tool_name;
if (tool !== 'Write' && tool !== 'Edit') process.exit(0);

const filePath = input.tool_input?.file_path;
const memoryDir = memoryDirForIndex(filePath);
if (!memoryDir) process.exit(0);

let oldText = '';
try {
  oldText = readFileSync(filePath, 'utf8');
} catch {
  /* 새로 만드는 인덱스 — 빈 문자열 기준으로 판정한다 */
}

const config = loadConfig(memoryDir);
const files = listTopicFiles(memoryDir);
const slugs = config.requireTopicFirst ? collectSlugs(memoryDir, files) : new Map();
const result = guardWrite(
  {
    tool,
    oldText,
    content: input.tool_input?.content,
    old_string: input.tool_input?.old_string,
    new_string: input.tool_input?.new_string,
  },
  {
    config,
    files,
    slugs: new Set(slugs.values()),
    exists: makeExists(memoryDir),
  },
);

if (!result.blocked) process.exit(0);

console.error(renderBlock(path.basename(filePath), result, oldText));
process.exit(2);
