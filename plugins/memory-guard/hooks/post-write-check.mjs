#!/usr/bin/env node
/**
 * PostToolUse 훅 — 메모리 디렉터리에 쓴 직후 인덱스를 감사해 경고한다. 막지 않는다.
 *
 * 경고는 exit 0 + `additionalContext` 로 모델에게만 간다. 메모리 밖 쓰기, 파싱·읽기
 * 실패, 지적 없음은 모두 출력 없이 통과한다 — 무관한 세션의 컨텍스트를 더럽히지 않는다.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { INDEX_BASENAME, auditIndex, renderPostWrite } from '../src/core.mjs';
import {
  collectSlugs,
  listTopicFiles,
  loadConfig,
  makeExists,
  memoryDirForFile,
  readHookInput,
} from '../src/fs-adapter.mjs';

const input = await readHookInput();
if (!input) process.exit(0);

const memoryDir = memoryDirForFile(input.tool_input?.file_path);
if (!memoryDir) process.exit(0);

let indexText;
try {
  indexText = readFileSync(path.join(memoryDir, INDEX_BASENAME), 'utf8');
} catch {
  process.exit(0);
}

const config = loadConfig(memoryDir);
const files = listTopicFiles(memoryDir);
const slugByFile = collectSlugs(memoryDir, files);
const report = auditIndex(indexText, {
  files,
  slugs: new Set(slugByFile.values()),
  config,
  exists: makeExists(memoryDir),
  slugOf: (name) => slugByFile.get(name),
});

const notice = renderPostWrite(report);
if (notice) {
  process.stdout.write(
    `${JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: notice } })}\n`,
  );
}
process.exit(0);
