/**
 * 메모리 디렉터리에 대한 파일시스템 접근 — 순수 로직(`core.mjs`)이 쓰지 않는 I/O 를 모은다.
 * 두 CC 훅이 공유한다.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { homedir } from 'node:os';

import { CONFIG_BASENAME, INDEX_BASENAME, frontmatterSlug, resolveConfig } from './core.mjs';

/** `<memoryDir>/.memory-guard.json`. 없거나 깨졌으면 기본값 — 설정 오류로 가드가 죽지 않는다. */
export function loadConfig(memoryDir) {
  try {
    return resolveConfig(JSON.parse(readFileSync(path.join(memoryDir, CONFIG_BASENAME), 'utf8')));
  } catch {
    return resolveConfig({});
  }
}

/** 최상위 `.md` 파일명 목록. 하위 디렉터리(`archive/` 등)는 스캔 대상이 아니다. */
export function listTopicFiles(memoryDir) {
  try {
    return readdirSync(memoryDir, { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith('.md'))
      .map((e) => e.name);
  } catch {
    return [];
  }
}

/**
 * 파일명 → 프론트매터 `name:` slug 맵. wikilink 가 파일명 대신 이 값을 가리키는 관례를
 * 받고, 고아 판정에서 "슬러그로만 언급된 토픽" 을 살려 준다.
 */
export function collectSlugs(memoryDir, files) {
  const byFile = new Map();
  for (const name of files) {
    try {
      const slug = frontmatterSlug(readFileSync(path.join(memoryDir, name), 'utf8'));
      if (slug) byFile.set(name, slug);
    } catch {
      /* 읽기 실패한 파일은 slug 가 없는 것으로 본다 */
    }
  }
  return byFile;
}

/** 하위 디렉터리로 내려간 링크까지 확인하는 존재 검사기. */
export function makeExists(memoryDir) {
  return (rel) => {
    if (rel.includes('..')) return false;
    return existsSync(path.join(memoryDir, rel)) || existsSync(path.join(memoryDir, `${rel}.md`));
  };
}

/**
 * 이 파일 경로가 지켜야 할 메모리 인덱스인가. 맞으면 메모리 디렉터리를, 아니면 null.
 *
 * 기본 배치(`~/.claude/projects/<enc>/memory/MEMORY.md`)뿐 아니라 `autoMemoryDirectory`
 * 로 옮긴 경우도 받는다 — 그쪽은 디렉터리 이름이 `memory` 가 아닐 수 있으므로,
 * 설정 파일이 옆에 있으면 그것을 선언으로 인정한다.
 */
export function memoryDirForIndex(filePath) {
  if (!filePath || path.basename(filePath) !== INDEX_BASENAME) return null;
  const dir = path.dirname(filePath);
  if (path.basename(dir) === 'memory') return dir;
  if (existsSync(path.join(dir, CONFIG_BASENAME))) return dir;
  return null;
}

/** cwd 의 CC 설정에서 `autoMemoryDirectory` 를 읽는다. local 이 우선한다. */
function autoMemoryDirectory(cwd) {
  for (const name of ['settings.local.json', 'settings.json']) {
    try {
      const raw = JSON.parse(readFileSync(path.join(cwd, '.claude', name), 'utf8'));
      if (typeof raw.autoMemoryDirectory === 'string' && raw.autoMemoryDirectory) {
        return path.resolve(cwd, raw.autoMemoryDirectory);
      }
    } catch {
      /* 없거나 깨진 설정은 없는 것으로 본다 */
    }
  }
  return null;
}

/**
 * 이 세션이 쓰는 메모리 디렉터리를 찾는다.
 *
 * 1순위는 `transcript_path` 옆의 `memory/` — CC 가 결정한 경로를 그대로 쓰므로 추측이 없다.
 * 없으면 프로젝트가 `autoMemoryDirectory` 로 옮긴 경우이므로 cwd 설정을 본다.
 */
export function resolveMemoryDir({ transcriptPath, cwd } = {}) {
  if (transcriptPath) {
    const dir = path.join(path.dirname(transcriptPath), 'memory');
    if (existsSync(path.join(dir, INDEX_BASENAME))) return dir;
  }
  if (cwd) {
    const custom = autoMemoryDirectory(cwd);
    if (custom && existsSync(path.join(custom, INDEX_BASENAME))) return custom;
  }
  return null;
}

const dataDir = () =>
  process.env.CLAUDE_PLUGIN_DATA || path.join(process.env.CLAUDE_CONFIG_DIR || path.join(homedir(), '.claude'), 'memory-guard');

/**
 * 프로젝트·날짜당 한 번만 점검하도록 락을 잡는다. `mkdir` 는 원자적이라 같은 날 여러
 * 세션이 동시에 떠도 정확히 하나만 통과한다.
 *
 * @returns {boolean} 이 호출이 락을 잡았는가
 */
export function acquireDailyLock(memoryDir, today = new Date().toISOString().slice(0, 10)) {
  const dir = dataDir();
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    return false;
  }
  const key = memoryDir.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '');
  try {
    mkdirSync(path.join(dir, `done-${key}-${today}`));
  } catch {
    return false;
  }
  pruneLocks(dir);
  return true;
}

/** 7일 지난 락 디렉터리를 치운다. 실패해도 점검에는 영향이 없다. */
function pruneLocks(dir) {
  const cutoff = Date.now() - 7 * 86400 * 1000;
  try {
    for (const name of readdirSync(dir)) {
      if (!name.startsWith('done-')) continue;
      const full = path.join(dir, name);
      if (statSync(full).mtimeMs < cutoff) rmSync(full, { recursive: true, force: true });
    }
  } catch {
    /* best effort */
  }
}

/** 훅 stdin 의 JSON. 파싱 실패는 "볼 일 없음" 으로 처리한다(fail open). */
export async function readHookInput(stream = process.stdin) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  try {
    return JSON.parse(chunks.join(''));
  } catch {
    return null;
  }
}
