#!/usr/bin/env node
/**
 * shared/ 의 원본을 그것을 쓰는 플러그인 안으로 복사한다.
 *
 * 플러그인은 설치될 때 자기 폴더만 캐시로 복사되므로 폴더 밖의 파일을 참조하면 깨진다. 공식 방법인
 * symlink 는 Windows 에서 git 이 텍스트 파일로 체크아웃할 수 있어 쓰지 않는다. 그래서 원본은 한 곳에
 * 두고 사본을 저장소에 함께 커밋하며, `shared/test/sync.test.mjs` 가 둘이 같은지 본다.
 *
 * 사용법:
 *   node shared/sync.mjs           # 사본을 다시 쓴다
 *   node shared/sync.mjs --check   # 쓰지 않고 다른 것만 보고한다
 *
 * 종료코드: 0 전부 같다(또는 다시 썼다) / 1 --check 에서 다른 사본이 있다
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** 원본(shared/ 기준 상대경로)과, 같은 상대경로로 사본을 받는 플러그인. 여기가 목록의 정본이다. */
export const MANIFEST = [
  { file: 'scripts/resolve-skill.mjs', plugins: ['long-run', 'wf'] },
  { file: 'scripts/lib/skill-locate.mjs', plugins: ['long-run', 'wf'] },
];

/**
 * 원본과 사본의 짝. 순수: 경로만 조립한다.
 * @param {string} repoRoot 저장소 루트
 * @param {typeof MANIFEST} manifest
 * @returns {Array<{source: string, copy: string}>}
 */
export function pairs(repoRoot, manifest = MANIFEST) {
  return manifest.flatMap(({ file, plugins }) =>
    plugins.map((plugin) => ({
      source: path.join(repoRoot, 'shared', file),
      copy: path.join(repoRoot, 'plugins', plugin, file),
    })),
  );
}

/**
 * 원본과 다른 사본. 없는 사본도 다른 것이다.
 * @param {Array<{source: string, copy: string}>} list
 * @param {(file: string) => string | null} read 파일 내용, 없으면 null
 * @returns {Array<{source: string, copy: string}>}
 */
export function stale(list, read) {
  return list.filter(({ source, copy }) => read(source) !== read(copy));
}

// --- I/O ---

function readOrNull(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  const differing = stale(pairs(repoRoot), readOrNull);
  if (process.argv.includes('--check')) {
    differing.forEach(({ copy }) => process.stdout.write(`STALE ${path.relative(repoRoot, copy)}\n`));
    process.exitCode = differing.length > 0 ? 1 : 0;
  } else {
    for (const { source, copy } of differing) {
      fs.mkdirSync(path.dirname(copy), { recursive: true });
      fs.copyFileSync(source, copy);
      process.stdout.write(`WROTE ${path.relative(repoRoot, copy)}\n`);
    }
  }
}
