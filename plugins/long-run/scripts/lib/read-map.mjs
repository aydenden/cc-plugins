/**
 * 맵 하나를 읽는 데 드는 bd 조회 전부. bd 를 부르는 일은 주입받은 `run` 이 하고 여기는 무엇을 언제
 * 부르고 어떻게 가르는지만 안다 — 동시성을 bd 없이 잴 수 있게.
 */
import { classifyFrontier, DELEGATED_LABEL } from './guard-core.mjs';

/**
 * bd 조회 하나의 시한. 셋이 동시에 뜨므로 한 판의 시간은 가장 느린 하나이고, 이 시한 하나가 Stop 훅
 * 예산(`hooks.json` 의 20초)에서 시작·판정 몫 3초를 뺀 자리를 다 쓴다. 🚨 embedded dolt 의 bd 는 동시
 * 조회끼리 서로를 늦춰 한 판이 13초까지 간다 — 예산의 절반으로 자르면 목록 조회가 늘 죽어 가드가 말없이
 * «모름» 이 된다.
 */
export const BD_TIMEOUT_MS = 17_000;

/** 읽지 못한 맵. 🚨 빈 프론티어가 아니라 «모름» 이고, 맵은 열린 것으로 둔다 — 닫혔다고 읽으면 선언이 지워진다. */
const UNREAD = { frontier: null, epicOpen: true, epicTitle: null, claimed: null, delegated: null };

/**
 * 맵의 모든 직계 자식(`bd list --all`)에서 열린 것만 — bd list 의 기본 필터와 같은 범위다. 상태별로 bd 를
 * 따로 부르지 않으려고 한 번 받아 가른다.
 *
 * @param {{status?: string}[] | null} rows
 * @returns {{status?: string}[] | null} bd 가 답을 못 했으면 `null`(모름)
 */
export function openChildrenOf(rows) {
  return Array.isArray(rows) ? rows.filter((row) => row?.status !== 'closed') : null;
}

/**
 * 맵의 프론티어·열림·제목·잡힌 자식, 그리고 닫은 수를 셀 자식 행 전부.
 *
 * 셋을 동시에 부른다 — Stop 훅 예산(20초) 안에서 차례로 부르면 느린 bd 하나가 나머지를 시한 밖으로
 * 민다. 맵이 있는지는 `bd show` 가 가른다 — `bd list --parent` 는 없는 맵에도 빈 배열을 낸다.
 * 🚨 `--limit 0` 이 없으면 bd 가 50건에서 자른다 — 잘린 목록은 틀린 프론티어이고 틀린 닫은 수다.
 *
 * @param {string} epic 맵 id
 * @param {(args: string[]) => Promise<unknown>} run bd 인자를 받아 JSON 을 돌려준다. 실패는 reject
 * @returns {Promise<{frontier: ReturnType<typeof classifyFrontier> | null, epicOpen: boolean, epicTitle: string | null, claimed: {id: string, title: string | null}[] | null, children: object[] | null}>}
 *   조회 하나라도 실패하면 `frontier` 는 «모름»(null)이다. `children` 은 목록 조회가 됐으면 남는다
 */
export async function readMap(epic, run) {
  const unknown = () => null;
  const [shown, ready, listed] = await Promise.all([
    run(['show', epic]).catch(unknown),
    run(['ready', '--parent', epic, '--limit', '0']).catch(unknown),
    run(['list', '--parent', epic, '--all', '--limit', '0']).catch(unknown),
  ]);
  const children = Array.isArray(listed) ? listed : null;
  const map = [shown ?? []].flat()[0];
  if (!map?.status || !children || !Array.isArray(ready)) return { ...UNREAD, children };
  const open = openChildrenOf(children);
  return {
    frontier: classifyFrontier({ children: open, ready }),
    epicOpen: map.status !== 'closed',
    epicTitle: map.title ?? null,
    claimed: open.filter((c) => c.status === 'in_progress').map((c) => ({ id: c.id, title: c.title ?? null })),
    delegated: children.filter((c) => c.labels?.includes(DELEGATED_LABEL)).length,
    children,
  };
}
