/**
 * 컨텍스트 점유를 어디서 읽을지 정하는 순수 로직.
 *
 * 세션이 재는 값(mod 의 `session.measure` — 엔진이 마지막 응답의 입력 토큰과 모델의 창을 준다)이 정답이다.
 * 그런데 그 값은 mod 안에만 있어, 모델이 직접 부르는 `frontier-guard.mjs status` 는 늘 «계측 불가» 를
 * 받았고, 세션은 그것을 보고 컨텍스트를 짐작해 인계했다(2026-11-19·22 실측). 그래서 mod 가 `status` 를
 * 부를 때 잰 값을 실어 보내고, CLI 가 세션별 파일로 남겨 어느 길로 불려도 같은 값을 읽게 한다.
 *
 * 순서: 세션이 잰 채움 → 트랜스크립트의 마지막 `usage` → «못 쟀다». 창은 세션이 준 것이 이긴다.
 * 파일 입출력은 `frontier-guard.mjs` 가 한다.
 */

import path from 'node:path';

import { contextLimitOf, contextTokensOf } from './guard-core.mjs';

/** 표준 창. 이보다 많이 담았다면 창이 더 크다는 뜻이다. */
const STANDARD_WINDOW = 200_000;
const LARGE_WINDOW = 1_000_000;

/** 세션 id 는 uuid 꼴이다. 경로로 쓰므로 그 밖의 글자는 받지 않는다. */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

/**
 * CLI 인자를 남길 기록으로. 창을 모르면 남기지 않는다.
 *
 * @returns {{tokens: number | null, window: number, at: string} | null}
 */
export function readingOf(tokens, window, at) {
  const w = Number(window);
  if (!(w > 0)) return null;
  const t = tokens === undefined ? NaN : Number(tokens);
  return { tokens: Number.isFinite(t) && t >= 0 ? t : null, window: w, at };
}

/**
 * 판정이 쓸 컨텍스트.
 *
 * 🚨 창을 세션에게서 못 받았는데 트랜스크립트가 표준 창보다 많이 담았다면 창은 표준이 아니다. 모델 이름의
 * `[1m]` 표시는 늘 실리지 않는다(실측: `claude-opus-5-5` 세션이 266k 를 담았다). 그것을 200k 로 재면
 * 133% 로 읽혀 한참 이른 인계를 시킨다.
 *
 * @param {{reading?: {tokens: number | null, window: number} | null, usage?: object | null, model?: string | null}} input
 * @returns {{contextTokens: number, contextLimit: number, measured: boolean, source: 'session' | 'transcript' | 'none'}}
 */
export function resolveContext({ reading, usage, model }) {
  if (typeof reading?.tokens === 'number') {
    return { contextTokens: reading.tokens, contextLimit: reading.window, measured: true, source: 'session' };
  }
  const named = contextLimitOf(model);
  if (usage) {
    const tokens = contextTokensOf(usage);
    const limit = reading?.window ?? (tokens > STANDARD_WINDOW ? Math.max(named, LARGE_WINDOW) : named);
    return { contextTokens: tokens, contextLimit: limit, measured: true, source: 'transcript' };
  }
  return { contextTokens: 0, contextLimit: reading?.window ?? named, measured: false, source: 'none' };
}

/** 세션의 기록 파일 이름. 세션 id 꼴이 아니면 `null` — 경로를 만들지 않는다. */
export function contextFileName(sessionId) {
  return typeof sessionId === 'string' && SESSION_ID.test(sessionId) ? `${sessionId}.json` : null;
}

/**
 * 세션 id 로 트랜스크립트를 찾을 후보. 모델이 `status` 를 인자 없이 불러도 자기 세션을 재게 한다.
 *
 * @param {string} configDir `~/.claude` (또는 `CLAUDE_CONFIG_DIR`)
 * @param {string[]} projectDirs `projects/` 아래 폴더 이름들
 * @param {string} sessionId
 * @returns {string[]}
 */
export function transcriptCandidates(configDir, projectDirs, sessionId) {
  const name = contextFileName(sessionId);
  if (!name) return [];
  return projectDirs.map((dir) => path.join(configDir, 'projects', dir, `${sessionId}.jsonl`));
}
