/**
 * 위젯 레지스트리 — 위젯 타입 id 에서 «무엇이 필요하고 어떻게 그리는가» 로 가는 단일 표.
 *
 * 타입 id 는 ccstatusline 의 것을 그대로 쓴다. 그 설정을 가져올 때 이름을 옮길 필요가 없다.
 *
 * 스냅숏(`snap`)은 hooks module 이 모아 넘기는 값의 묶음이다. 안 모은 소스의 키는 없고(undefined),
 * 모았는데 해당 없음은 null 이다 (저장소 밖의 `git`).
 *
 * - `now`, `columns`, `home` — 그리는 시점의 시각(ms)·터미널 폭·홈 경로
 * - `session` — model, version, id, cwd, name, effort
 * - `repo` — root, remote (`$.session.repo()`)
 * - `usage` — startedAt, context{tokens,window,percent}, rateLimits[{kind,percentUsed,resetsAt}], cost{usd}
 * - `contextUsable` — maxTokens (압축 기준 창)
 * - `settings` — effortLevel, voice, sandbox / `configRows` — /config 행의 key → value
 * - `transcript` — customTitle, aiTitle, effort / `account` — email
 * - `tokens` — input, output, cacheRead, cacheWrite, last{...}, lastResponseAt, compactions, turnInput, turnOutput, turnMs
 * - `skills` — last, count
 * - `git` — branch, sha, upstream, ahead, behind, staged, unstaged, untracked, conflicts
 * - `gitDiff` — insertions, deletions / `gitRemotes` — origin, upstream / `gitWorktree` — isWorktree, name
 * - `gh` — pr{number,title,url,state}, checks{failing,pending,passing}
 * - `jj` — revision, bookmarks, description, root, insertions, deletions
 * - `api` — perModel{sonnet,opus,fable}, extra / `status` — indicator / `memory` — usedBytes, totalBytes
 * - `custom` — 항목 id → custom-command 출력
 *
 * @typedef {{label: string, value: string, url?: string}} Rendered
 * @typedef {{category: string, needs: string[], render: (snap: object, item: object) => Rendered | null}} Widget
 */

import { ENV_WIDGETS } from './env.mjs';
import { GIT_WIDGETS } from './git.mjs';
import { SESSION_WIDGETS } from './session.mjs';
import { USAGE_WIDGETS } from './usage.mjs';

/** @type {Record<string, Widget>} */
export const WIDGETS = { ...SESSION_WIDGETS, ...GIT_WIDGETS, ...USAGE_WIDGETS, ...ENV_WIDGETS };

/** 위젯이 아니라 배치 규칙인 항목 타입. */
export const LAYOUT_TYPES = ['separator', 'flex-separator'];

/**
 * ccstatusline 에는 있지만 mod 가 값을 얻을 곳이 없어 만들지 않은 타입과 그 이유.
 * 가져온 설정에 있으면 이 이유를 그대로 알린다.
 */
export const UNSUPPORTED = {
  'worktree-original-branch': 'worktree 를 어느 브랜치에서 만들었는지 mod 가 알 수 없다',
  'jj-workspace': '만든 기기에 jj 가 없어 명령을 검증하지 못해 넣지 않았다',
};

/**
 * 항목 타입이 설정에 쓸 수 있는 것인지.
 *
 * @param {string} type
 * @returns {boolean}
 */
export function isKnownType(type) {
  return Object.hasOwn(WIDGETS, type) || LAYOUT_TYPES.includes(type);
}
