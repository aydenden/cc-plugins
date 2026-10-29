#!/usr/bin/env node
/**
 * 프론티어 가드 — 진입점. 실측(파일·프로세스·stdin)만 여기 있고 판정은 `lib/guard-core.mjs` 가 한다.
 *
 *   node frontier-guard.mjs claim <epic> [--no-ticket-limit|--ticket-limit]
 *                                                           이 세션이 그 맵을 민다고 선언(주인이 된다). `--no-ticket-limit`
 *                                                           은 닫은 티켓 수로 인계를 되밀지 않는다(코디네이터 맵) —
 *                                                           같은 맵을 다시 claim 하면 물려받고, `--ticket-limit` 으로만 다시 켠다
 *   node frontier-guard.mjs wave-begin <runId> <티켓>=<dispatch>...   워커에게 넘긴 티켓을 적는다(정산 전까지 기다리라고 되민다)
 *   node frontier-guard.mjs wave-settle <티켓>              정산한 티켓을 웨이브에서 뺀다(마지막이면 웨이브가 끝난다)
 *   node frontier-guard.mjs clear                           선언 해제(맵을 놓을 때. 인계할 때는 지우지 않는다)
 *   node frontier-guard.mjs epic                            이 worktree 에 선언된 맵 id 한 줄(없으면 빈 출력)
 *   node frontier-guard.mjs move <경로>                     선언을 다른 worktree 로 옮긴다(주인은 비운다)
 *   node frontier-guard.mjs status [--session <id>] [트랜스크립트]   지금 판정을 사람이 읽는 꼴로
 *   node frontier-guard.mjs --hook                          Stop hook 모드(stdin JSON)
 *
 * 마커는 **worktree 별로** 갈라 두고(`lib/state-root.mjs`), 그 안에서 판정되는 것은 **claim 한 주인
 * 세션 하나**다(`guard-core.mjs` 의 `ownership`). 플러그인은 아무 repo 에서나 열린 세션에 붙으므로
 * 머신에 파일 하나로 두면 무관한 저장소의 세션까지 이 맵으로 판정한다.
 *
 * 🚨 훅 모드는 **절대 실패로 죽지 않는다.** 가드가 터지면 막는 것이 아니라 조용히 통과시킨다 —
 * 세션을 못 끝내게 만드는 쪽이 훨씬 나쁜 고장이다.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { claimHashOf, claimTokenLine, newClaimToken, provesClaim } from './lib/claim.mjs';
import {
  beginWave,
  contextLimitOf,
  contextTokensOf,
  countClosedSince,
  countingSince,
  decide,
  HANDOFF_RATIO,
  handoffClosedOf,
  isDelegatedToMod,
  ownership,
  parseWaveArgs,
  pendingWave,
  readTranscriptTail,
  settleWave,
  ticketLimitOf,
  waveCarriedBy,
} from './lib/guard-core.mjs';
import { readMap } from './lib/read-map.mjs';
import { repoKeyOf, repoRootOf, stateRoot } from './lib/state-root.mjs';

const execFileAsync = promisify(execFile);

/** 그 위치가 속한 worktree 의 마커 경로. 훅은 세션의 `cwd` 로 부른다 — 이 프로세스의 cwd 가 아니다. */
const markerPathFor = (cwd) => join(stateRoot(), 'frontier-guard', `${repoKeyOf(repoRootOf(cwd))}.json`);

const readJson = (file) => {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
};

const readText = (file) => {
  try {
    return file ? readFileSync(file, 'utf8') : null;
  } catch {
    return null;
  }
};

const writeMarker = (path, body) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(body, null, 2)}\n`);
};

/**
 * bd 의 JSON 출력. 실패는 reject 하고, `readMap` 이 «모름» 으로 바꾼다. bd 는 그 worktree 에서 돌아야
 * 그 저장소의 DB 를 찾는다.
 *
 * 🚨 본문이 통째로 실려 오므로 기본 1MB 버퍼로는 맵이 자라면서 조용히 터진다 — 그 실패는 «모름» 으로
 * 떨어져 가드가 말없이 사라지는 꼴이 된다. 조회는 동시에 도므로 timeout 하나가 훅 예산(20초) 안에 든다.
 */
const bdRunner = (cwd) => async (args) => {
  const { stdout } = await execFileAsync('bd', [...args, '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: 10_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
};

const UNREAD_MAP = { frontier: null, epicOpen: true, epicTitle: null, claimed: null, children: null };

/**
 * Stop 이벤트인가.
 *
 * 🚨 이벤트 이름 필드를 믿지 않는다 — 없을 수도 있다. **도구 이벤트에만 `tool_name` 이 실린다**는
 * 것이 더 단단한 표지라, 그것이 있으면 Stop 이 아니다. 배선이 `PostToolUse` 로 잘못 들어갔을 때
 * 파일마다 판정이 터지는 것을 이 한 줄이 막는다(실측).
 */
const isStopEvent = (input) => {
  const name = input?.hook_event_name;
  if (typeof name === 'string') return name === 'Stop';
  return input?.tool_name === undefined;
};

/**
 * 트랜스크립트에서 점유를 잰다.
 *
 * 🚨 **못 쟀다는 것을 값이 아니라 `measured` 로 말한다.** 실패를 `{0, 200k}` 로만 돌려주면 판정이
 * 그것을 «0% — 여유» 로 읽는다(`guard-core.mjs` 머리말).
 */
function measure(transcriptPath) {
  try {
    const { usage, model } = readTranscriptTail(readFileSync(transcriptPath, 'utf8'));
    return { contextTokens: contextTokensOf(usage), contextLimit: contextLimitOf(model), measured: Boolean(usage) };
  } catch {
    return { contextTokens: 0, contextLimit: contextLimitOf(null), measured: false };
  }
}

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const [command, argument] = process.argv.slice(2);
const MARKER = markerPathFor(process.cwd());

if (command === 'claim') {
  if (!argument) {
    console.error('usage: frontier-guard.mjs claim <epic>');
    process.exit(1);
  }
  // 주인 칸을 비우고 새 토큰의 해시만 남긴다 — 앞 주인은 이 순간 풀리고, 토큰 줄이 이 세션의
  // 트랜스크립트에 남아 다음 Stop 에서 이 세션이 주인이 된다(`ownership`).
  const token = newClaimToken();
  const existing = readJson(MARKER);
  const ticketLimit = ticketLimitOf(existing, argument, process.argv.slice(4));
  writeMarker(MARKER, {
    epic: argument,
    worktree: repoRootOf(),
    claimedAt: new Date().toISOString(),
    claimHash: claimHashOf(token),
    ...(ticketLimit ? {} : { ticketLimit: false }),
    ...waveCarriedBy(existing, argument),
  });
  console.log(`[frontier-guard] ${argument} 를 미는 세션으로 선언했다. 맵이 닫힐 때까지 이 세션의 멈춤만 막는다 — 같은 worktree 의 다른 세션은 판정되지 않는다.`);
  if (!ticketLimit) console.log('[frontier-guard] 이 맵은 닫은 티켓 수로 인계를 되밀지 않는다 — 컨텍스트 축만 본다.');
  console.log(`[frontier-guard] 마커: ${MARKER}`);
  console.log(claimTokenLine(token));
} else if (command === 'epic') {
  // 인계가 새 세션에게 claim 을 시키려고 읽는다. 선언이 없으면 빈 출력이다.
  const marker = readJson(MARKER);
  if (marker?.epic) console.log(marker.epic);
} else if (command === 'move') {
  // 인계가 worktree 를 옮길 때 선언도 따라가야 한다 — 안 옮기면 새 세션이 가드 없이 출발하고 떠난
  // worktree 엔 아무도 안 미는 마커가 남는다.
  if (!argument) {
    console.error('usage: frontier-guard.mjs move <대상 worktree 경로>');
    process.exit(1);
  }
  const to = markerPathFor(argument);
  const marker = readJson(MARKER);
  if (!marker) {
    console.log('[frontier-guard] 이 worktree 에는 옮길 선언이 없다.');
  } else if (to === MARKER) {
    console.log('[frontier-guard] 같은 worktree 다 — 선언은 그대로 둔다. 새 세션이 claim 하면 주인이 된다.');
  } else {
    // 주인은 따라가지 않는다 — 옮긴 곳에서 새 세션이 claim 해야 주인이 선다(`ownership` 의 `claimHash: null`).
    const { session: _owner, ...rest } = marker;
    writeMarker(to, { ...rest, claimHash: null, worktree: repoRootOf(argument), movedAt: new Date().toISOString() });
    rmSync(MARKER);
    console.log(`[frontier-guard] ${marker.epic} 선언을 ${repoRootOf(argument)} 로 옮겼다. 그곳에서 claim 하는 세션이 주인이 된다.`);
  }
} else if (command === 'wave-begin') {
  const marker = readJson(MARKER);
  const wave = parseWaveArgs(process.argv.slice(3));
  if (!marker?.epic) {
    console.error('[frontier-guard] 이 worktree 에 선언된 맵이 없다 — 웨이브는 claim 한 맵 위에서만 연다.');
    process.exit(1);
  }
  if (wave.error) {
    console.error(`[frontier-guard] ${wave.error}`);
    process.exit(1);
  }
  if (pendingWave(marker).length) {
    console.error(`[frontier-guard] 웨이브 ${marker.wave.runId} 가 아직 돈다 — 정산(wave-settle)한 뒤에 새 웨이브를 연다.`);
    process.exit(1);
  }
  writeMarker(MARKER, beginWave(marker, { ...wave, startedAt: new Date().toISOString() }));
  console.log(`[frontier-guard] 웨이브 ${wave.runId} 를 열었다 — ${wave.tickets.map((t) => t.id).join(', ')}. 정산 전까지 가드는 워커의 보고를 기다리라고 되민다.`);
} else if (command === 'wave-settle') {
  const marker = readJson(MARKER);
  if (!argument || !pendingWave(marker).some((t) => t.id === argument)) {
    console.error(`[frontier-guard] ${argument ?? '(티켓 없음)'} 는 진행 중 웨이브에 없다 — wave-settle <티켓>`);
    process.exit(1);
  }
  const next = settleWave(marker, argument);
  writeMarker(MARKER, next);
  const left = pendingWave(next);
  console.log(
    left.length
      ? `[frontier-guard] ${argument} 를 정산했다. 남은 워커 ${left.length}건(${left.map((t) => t.id).join(', ')}).`
      : `[frontier-guard] ${argument} 를 정산했다. 웨이브가 끝났다 — 평소처럼 다음 티켓을 민다.`
  );
} else if (command === 'clear') {
  if (existsSync(MARKER)) rmSync(MARKER);
  console.log('[frontier-guard] 선언을 지웠다.');
} else if (command === 'status') {
  // 세션 id 와 트랜스크립트를 주면 훅과 **같은 판정**을 돌려준다 — 훅 모드는 stdin 을 먹어 손으로 못 돌린다.
  const rest = process.argv.slice(3);
  const at = rest.indexOf('--session');
  const sessionId = at >= 0 ? rest[at + 1] : undefined;
  const transcript = rest.find((_, i) => at < 0 || (i !== at && i !== at + 1));
  const marker = readJson(MARKER);
  const { children, ...read } = marker?.epic ? await readMap(marker.epic, bdRunner(process.cwd())) : UNREAD_MAP;
  // 잴 근거가 없으면 «안 쟀다» 다 — 0 을 여유로 읽히게 두지 않는다.
  const measured = transcript ? measure(transcript) : { contextTokens: 0, contextLimit: contextLimitOf(null), measured: false };
  // 세션 id 가 없으면 주인 자리에서 본 판정이다. 있으면 참·거짓, 아무도 주인이 아니면 null(주인 미정).
  let owner;
  if (sessionId) {
    const own = ownership(marker, sessionId, new Date().toISOString(), (hash) => provesClaim(readText(transcript), hash));
    owner = own.owner ? true : marker?.session?.id ? false : null;
  }
  const closedSinceSession = countClosedSince(children, countingSince(marker));
  const handoffClosed = handoffClosedOf(marker);
  const verdict = decide({
    marker,
    ...measured,
    ...read,
    owner: owner !== false && owner !== null,
    closedSinceSession,
    handoffClosed,
    stopHookActive: false,
  });
  const handoff = { closedTickets: handoffClosed, ratio: HANDOFF_RATIO };
  console.log(
    JSON.stringify({ markerPath: MARKER, worktree: repoRootOf(), marker, owner, ...read, ...measured, closedSinceSession, handoff, verdict }, null, 2)
  );
} else if (command === '--hook') {
  try {
    const input = JSON.parse((await readStdin()) || '{}');
    // 🚨 세션의 cwd 로 worktree 를 가린다 — 훅 프로세스의 cwd 가 그 세션의 worktree 라는 보장은 없다.
    const cwd = input.cwd || process.cwd();
    const markerPath = markerPathFor(cwd);
    const marker = readJson(markerPath);
    const { owner, since, changed } = ownership(marker, input.session_id, new Date().toISOString(), (hash) =>
      provesClaim(readText(input.transcript_path), hash)
    );
    // 주인 기록은 mod 위임보다 먼저다 — mod 는 이 훅이 끝난 뒤 status 로 주인을 읽는다.
    if (changed) writeMarker(markerPath, { ...marker, session: { id: input.session_id, since } });
    // mod 가 이 Stop 을 판정한다 — 여기서 또 판정하면 같은 멈춤을 두 번 되민다.
    if (isDelegatedToMod(input)) process.exit(0);
    // 주인이 아닌 세션은 bd 도 트랜스크립트 점유도 안 본다 — 같은 worktree 에서 연 다른 세션이다.
    if (!owner) process.exit(0);
    const { children, ...read } = await readMap(marker.epic, bdRunner(cwd));
    const verdict = decide({
      marker,
      ...measure(input.transcript_path),
      closedSinceSession: countClosedSince(children, since),
      handoffClosed: handoffClosedOf(marker),
      ...read,
      stopHookActive: input.stop_hook_active === true,
      isStopEvent: isStopEvent(input),
    });
    if (verdict.clear && existsSync(markerPath)) rmSync(markerPath);
    if (verdict.block) console.log(JSON.stringify({ decision: 'block', reason: verdict.reason }));
  } catch {
    // 가드가 터지면 통과시킨다 — 머리말.
  }
  process.exit(0);
} else {
  console.error('usage: node frontier-guard.mjs <claim <epic> [--no-ticket-limit|--ticket-limit]|wave-begin <runId> <티켓>=<dispatch>...|wave-settle <티켓>|clear|epic|move <경로>|status [--session <id>] [트랜스크립트]|--hook>');
  process.exit(1);
}
