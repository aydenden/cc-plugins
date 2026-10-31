#!/usr/bin/env node
/**
 * 프론티어 가드 — 진입점. 실측(파일·프로세스·stdin)만 여기 있고 판정은 `lib/guard-core.mjs` 가 한다.
 *
 *   node frontier-guard.mjs claim <epic> [--no-ticket-limit|--ticket-limit]
 *                                                           이 세션이 그 맵을 민다고 선언(주인이 된다). `--no-ticket-limit`
 *                                                           은 닫은 티켓 수로 인계를 되밀지 않는다(코디네이터 맵) —
 *                                                           같은 맵을 다시 claim 하면 물려받고, `--ticket-limit` 으로만 다시 켠다
 *   node frontier-guard.mjs wave-begin <runId> <티켓>=<dispatch>[=<worktreeId>]...
 *                                                           워커에게 넘긴 티켓을 적는다(정산 전까지 기다리라고 되민다)
 *   node frontier-guard.mjs wave-settle <티켓>              정산한 티켓을 웨이브에서 뺀다(마지막이면 웨이브가 끝난다)
 *   node frontier-guard.mjs answer <질문> --quote <사람 원문> [--answer <뜻>]
 *                                                           사람의 답으로 질문을 닫는다. 원문은 그 질문 이후의 영수증에 있어야 한다
 *   node frontier-guard.mjs delegate --quote <사람 원문>     그 말을 근거로 이 맵을 위임한다(재claim 이 물려받는다)
 *   node frontier-guard.mjs delegate --off                  위임을 끈다
 *   node frontier-guard.mjs delegate-answer <질문> --choice <고른 것> --cite <헌장 원문> --why <이유>
 *                                                           헌장 목표를 근거로 대신 답하고 표시를 남긴다
 *   node frontier-guard.mjs delegation-report [맵]          위임 답변을 모아 보고서를 쓰고 경로를 낸다
 *   node frontier-guard.mjs hand-over                       인계를 보냈다고 적는다(보낸 세션을 더 밀지 않는다)
 *   node frontier-guard.mjs clear                           선언 해제(맵을 놓을 때. 인계할 때는 지우지 않는다)
 *   node frontier-guard.mjs epic                            이 worktree 에 선언된 맵 id 한 줄(없으면 빈 출력)
 *   node frontier-guard.mjs wave [--json]                   정산 안 된 웨이브의 Run id 한 줄, --json 이면 웨이브 전체(없으면 빈 출력)
 *   node frontier-guard.mjs move <경로>                     선언을 다른 worktree 로 옮긴다(주인은 비운다)
 *   node frontier-guard.mjs status [--session <id>] [트랜스크립트]   지금 판정을 사람이 읽는 꼴로
 *   node frontier-guard.mjs judge --session <id> [--transcript <경로>] [--active] [--cwd <경로>] [--tokens <n> --window <n>]
 *                                                           Stop 판정 한 번(마커 기록 포함). mod 가 부른다
 *   node frontier-guard.mjs --hook                          Stop hook 모드(stdin JSON)
 *   node frontier-guard.mjs --gate                          PreToolUse 모드 — 답을 기다리는 동안 진행을 거부한다
 *   node frontier-guard.mjs --receipt                       UserPromptSubmit 모드 — 사람의 말을 영수증으로 남긴다
 *   node frontier-guard.mjs --refresh                       PostToolUse 모드 — 맵을 움직인 명령 뒤 게이트 스냅샷을 고친다
 *
 * 마커는 **worktree 별로** 갈라 두고(`lib/state-root.mjs`), 그 안에서 판정되는 것은 **claim 한 주인
 * 세션 하나**다(`guard-core.mjs` 의 `ownership`). 플러그인은 아무 repo 에서나 열린 세션에 붙으므로
 * 머신에 파일 하나로 두면 무관한 저장소의 세션까지 이 맵으로 판정한다.
 *
 * 🚨 훅 모드는 **절대 실패로 죽지 않는다.** 가드가 터지면 막는 것이 아니라 조용히 통과시킨다 —
 * 세션을 못 끝내게 만드는 쪽이 훨씬 나쁜 고장이다.
 */
import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

import { claimHashOf, claimTokenLine, newClaimToken, provesClaim } from './lib/claim.mjs';
import {
  addReceipt,
  charterGoalOf,
  citesGoal,
  closeProblemOf,
  delegatedAnswerText,
  delegationEndText,
  delegationSpansOf,
  delegationStartText,
  isHumanPrompt,
  parseDelegatedAnswer,
  quoteProves,
  renderDelegationReport,
  spokeSince,
} from './lib/delegation.mjs';
import { closesEpic, denyCommand, denyWrite, needsGate } from './lib/gate.mjs';
import { movesMap } from './lib/mod-view.mjs';
import {
  beginWave,
  contextLimitOf,
  contextTokensOf,
  countClosedSince,
  countingSince,
  countToolUses,
  decide,
  DELEGATED_LABEL,
  delegationCarriedBy,
  HANDOFF_RATIO,
  handoffClosedOf,
  isDelegatedToMod,
  isWaiting,
  ownership,
  parseWaveArgs,
  pendingWave,
  pickOwned,
  QUESTION_LABEL,
  readTranscriptTail,
  settleWave,
  stalledSincePush,
  ticketLimitOf,
  waveCarriedBy,
} from './lib/guard-core.mjs';
import { BD_TIMEOUT_MS, readMap } from './lib/read-map.mjs';
import { repoKeyOf, repoRootOf, stateRoot } from './lib/state-root.mjs';

const execFileAsync = promisify(execFile);

/** 그 위치가 속한 worktree 의 마커 경로. 훅은 세션의 `cwd` 로 부른다 — 이 프로세스의 cwd 가 아니다. */
const markerPathFor = (cwd) => join(stateRoot(), 'frontier-guard', `${repoKeyOf(repoRootOf(cwd))}.json`);

/** 사람의 말을 남기는 곳. worktree 당 하나고 마커와 따로 둔다 — claim 전에 한 말도, 앞 세션에 한 답도 증거여야 한다. */
const receiptsPathFor = (cwd) => join(stateRoot(), 'frontier-guard', 'receipts', `${repoKeyOf(repoRootOf(cwd))}.json`);

/** 위임 보고서의 자리. worktree 가 사라져도 남고, 사람이 맵 id 로 찾을 수 있게 맵 id 를 이름으로 쓴다. */
const reportPathFor = (epic) => join(stateRoot(), 'delegation-reports', `${epic}.md`);

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
 * 떨어져 가드가 말없이 사라지는 꼴이 된다. 시한은 `BD_TIMEOUT_MS` 가 훅 예산에 맞춰 소유한다.
 */
const bdRunner = (cwd) => async (args) => {
  const { stdout } = await execFileAsync('bd', [...args, '--json'], {
    cwd,
    encoding: 'utf8',
    timeout: BD_TIMEOUT_MS,
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(stdout);
};

const UNREAD_MAP = { frontier: null, epicOpen: true, epicTitle: null, claimed: null, children: null, delegated: null };

/**
 * 이 세션이 주인인 마커를 찾는다(`pickOwned`). 처음 증명됐으면 주인을 적는다.
 * 🚨 맵의 일은 마커의 worktree 에서 읽는다 — 세션의 cwd 는 맵 DB 가 없는 웨이브 worktree 일 수 있다.
 */
function locateOwned(cwd, sessionId, transcriptPath) {
  const here = markerPathFor(cwd);
  const dir = dirname(here);
  const others = existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.json') && join(dir, name) !== here)
        .map((name) => ({ path: join(dir, name), marker: readJson(join(dir, name)) }))
    : [];
  let text;
  const proves = (hash) => provesClaim((text ??= readText(transcriptPath)), hash);
  const found = pickOwned([{ path: here, marker: readJson(here) }, ...others], sessionId, new Date().toISOString(), proves);
  if (!found?.changed) return found;
  const marker = { ...found.marker, session: { id: sessionId, since: found.since } };
  writeMarker(found.path, marker);
  return { ...found, marker };
}

const mapCwdOf = (marker, cwd) => (marker.worktree && existsSync(marker.worktree) ? marker.worktree : cwd);

/** 게이트가 bd 없이 읽는 스냅샷. 대기가 아니라고 적혀 있으면 쓰기를 곧장 통과시키고, 대기라고 적혀 있으면 bd 로 확인한 뒤에 거부한다. */
const gateSnapshotOf = (frontier) => ({ waiting: isWaiting(frontier), questions: frontier.questions });

/**
 * Stop 판정 한 번. 주인 기록·되민 기록·선언 해제까지 여기서 한다 — mod 와 node 훅이 같은 길을 탄다.
 *
 * @param {{session_id?: string, cwd?: string, transcript_path?: string, stop_hook_active?: boolean, hook_event_name?: string, tool_name?: string}} input
 * @param {{contextTokens: number, contextLimit: number, measured: boolean} | null} context 세션이 잰 값. 없으면 트랜스크립트로 잰다
 */
async function judgeStop(input, context) {
  const cwd = input.cwd || process.cwd();
  const found = locateOwned(cwd, input.session_id, input.transcript_path);
  if (!found) return { block: false };
  const { path, marker, since } = found;
  const { children, ...read } = await readMap(marker.epic, bdRunner(mapCwdOf(marker, cwd)));
  const toolUses = countToolUses(readText(input.transcript_path));
  const verdict = decide({
    marker,
    ...(context ?? measure(input.transcript_path)),
    closedSinceSession: countClosedSince(children, since),
    handoffClosed: handoffClosedOf(marker),
    ...read,
    stalled: stalledSincePush(input.stop_hook_active === true, marker.lastPushTools, toolUses),
    isStopEvent: isStopEvent(input),
  });
  if (verdict.clear) {
    if (existsSync(path)) rmSync(path);
    return verdict;
  }
  const { reportedWaiting, ...rest } = marker;
  // 대기가 풀리면 보고 기록을 지운다 — 같은 질문이 다시 대기가 되면 다시 보고해야 한다.
  const stillWaiting = !read.frontier || isWaiting(read.frontier);
  const reported = verdict.reported ?? (stillWaiting ? reportedWaiting : undefined);
  writeMarker(path, {
    ...rest,
    ...(read.frontier ? { gate: gateSnapshotOf(read.frontier) } : {}),
    ...(verdict.block && toolUses !== null ? { lastPushTools: toolUses } : {}),
    ...(reported ? { reportedWaiting: reported } : {}),
  });
  return verdict;
}

/** `--name 값` 인자. */
const flagOf = (args, name) => {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
};

/** bd 에 쓴다. 실패는 호출자에게 던진다 — 답이 안 닫혔는데 닫았다고 말하지 않는다. */
const bdWrite = (args) => execFileAsync('bd', args, { encoding: 'utf8', timeout: BD_TIMEOUT_MS, maxBuffer: 64 * 1024 * 1024 });

const showOf = async (id) => [await bdRunner(process.cwd())(['show', id])].flat()[0];

const refuse = (message) => {
  console.error(`[frontier-guard] ${message}`);
  process.exit(1);
};

/** 맵을 닫기 전 남은 일. 위임 답변이 없는 맵에는 아무것도 묻지 않는다. */
async function closeProblemFor(epic, command, run) {
  const rows = await run(['list', '--parent', epic, '--all', '--limit', '0', '--label', DELEGATED_LABEL]);
  const reportPath = reportPathFor(epic);
  return closeProblemOf({ ids: rows.map((r) => r.id), reportText: readText(reportPath), reportPath, command });
}

const printDenial = (reason) =>
  console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));

/** PreToolUse 판정. 판정 규칙은 `lib/gate.mjs` 가 소유한다. */
async function gate(input) {
  const cwd = input.cwd || process.cwd();
  const isShell = input.tool_name === 'Bash' || input.tool_name === 'PowerShell';
  const command = isShell ? String(input.tool_input?.command ?? '') : '';
  if (isShell && !needsGate(command)) return;
  const found = locateOwned(cwd, input.session_id, input.transcript_path);
  if (!found) return;
  const { marker } = found;
  const inWave = pendingWave(marker).length > 0;
  const write = { filePath: input.tool_input?.file_path ?? input.tool_input?.notebook_path, worktree: marker.worktree, inWave };
  // 도구 호출마다 bd 를 부르지 않는다 — 스냅샷이 대기라고 할 때만 거부 전에 다시 읽는다.
  if (!isShell) {
    if (!marker.gate?.waiting) return;
    if (!denyWrite({ ...write, frontier: { pushable: [], questions: [], blocked: ['스냅샷'] } })) return;
  }
  const mapCwd = mapCwdOf(marker, cwd);
  const run = bdRunner(mapCwd);
  const { frontier, children } = await readMap(marker.epic, run);
  if (!frontier) return;
  if (!isShell) {
    const why = denyWrite({ ...write, frontier });
    if (why) printDenial(why);
    return;
  }
  const receipts = readJson(receiptsPathFor(mapCwd));
  const createdAt = (id) => children?.find((c) => c.id === id)?.created_at ?? null;
  const why = denyCommand({
    command,
    frontier,
    inWave,
    hasReceiptSince: (id) => spokeSince(receipts, createdAt(id)).length > 0,
    closeProblem: closesEpic(command, marker.epic) ? await closeProblemFor(marker.epic, command, run) : null,
  });
  if (why) printDenial(why);
}

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
    ...delegationCarriedBy(existing, argument),
  });
  console.log(`[frontier-guard] ${argument} 를 미는 세션으로 선언했다. 맵이 닫힐 때까지 이 세션의 멈춤만 막는다 — 같은 worktree 의 다른 세션은 판정되지 않는다.`);
  if (!ticketLimit) console.log('[frontier-guard] 이 맵은 닫은 티켓 수로 인계를 되밀지 않는다 — 컨텍스트 축만 본다.');
  console.log(`[frontier-guard] 마커: ${MARKER}`);
  console.log(claimTokenLine(token));
} else if (command === 'epic') {
  // 인계가 새 세션에게 claim 을 시키려고 읽는다. 선언이 없으면 빈 출력이다.
  const marker = readJson(MARKER);
  if (marker?.epic) console.log(marker.epic);
} else if (command === 'wave') {
  // 인계가 새 세션에게 run-use 를 시키려고 읽는다(`--json` 이면 정산이 티켓 행까지). 정산할 워커가 없으면 빈 출력이다.
  const marker = readJson(MARKER);
  if (pendingWave(marker).length) console.log(argument === '--json' ? JSON.stringify(marker.wave) : marker.wave.runId);
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
} else if (command === 'answer') {
  const args = process.argv.slice(4);
  const quote = flagOf(args, '--quote');
  if (!argument || !quote) refuse('usage: answer <질문> --quote <사람이 친 원문> [--answer <뜻>]');
  const question = await showOf(argument);
  if (!question?.labels?.includes(QUESTION_LABEL)) refuse(`${argument} 는 질문 티켓(${QUESTION_LABEL} 라벨)이 아니다.`);
  if (!quoteProves(readJson(receiptsPathFor(process.cwd())), quote, question.created_at)) {
    refuse(`이 인용은 ${argument} 이후 사람이 친 말에 없다. 사람의 답을 받은 뒤 원문 그대로 인용한다. 부분 인용은 8자 이상이어야 한다 — 짧으면 그 프롬프트 전체를 인용한다.`);
  }
  const meaning = flagOf(args, '--answer');
  await bdWrite(['human', 'respond', argument, '-r', `사용자 원문: ${quote}${meaning ? `\n답: ${meaning}` : ''}`]);
  console.log(`[frontier-guard] ${argument} 를 사람의 답으로 닫았다. 답은 헌장의 「확정된 결정」에 근거까지 옮긴다.`);
} else if (command === 'delegate') {
  const args = process.argv.slice(3);
  const marker = readJson(MARKER);
  if (!marker?.epic) refuse('이 worktree 에 선언된 맵이 없다 — claim 한 맵 위에서만 위임한다.');
  if (args.includes('--off')) {
    const { delegation: _off, ...rest } = marker;
    writeMarker(MARKER, rest);
    await bdWrite(['comments', 'add', marker.epic, delegationEndText()]);
    console.log('[frontier-guard] 위임을 껐다. 이제 질문은 사람의 답을 기다린다.');
  } else {
    const quote = flagOf(args, '--quote');
    if (!quote) refuse('usage: delegate --quote <사람이 친 원문> | delegate --off');
    if (!quoteProves(readJson(receiptsPathFor(process.cwd())), quote, null)) {
      refuse('이 인용은 사람이 친 말에 없다 — 위임은 사람의 말로만 켠다. 부분 인용은 8자 이상이어야 한다.');
    }
    const goal = charterGoalOf((await showOf(marker.epic))?.description);
    if (!goal) refuse(`${marker.epic} 헌장에 Destination·완료 조건이 없다 — 위임이 따를 목표가 없다.`);
    writeMarker(MARKER, { ...marker, delegation: { since: new Date().toISOString(), quote, goalHash: claimHashOf(goal) } });
    await bdWrite(['comments', 'add', marker.epic, delegationStartText(quote)]);
    console.log('[frontier-guard] 위임을 켰다. 질문은 헌장의 Destination·완료 조건을 근거로 delegate-answer 로 답한다 — 근거를 못 대는 질문은 사람 몫으로 남는다. 답할 때마다 표시가 남고, 맵을 닫기 전 delegation-report 가 필요하다.');
  }
} else if (command === 'delegate-answer') {
  const args = process.argv.slice(4);
  const [choice, cite, why] = ['--choice', '--cite', '--why'].map((name) => flagOf(args, name));
  if (!argument || !choice || !cite || !why) refuse('usage: delegate-answer <질문> --choice <고른 것> --cite <헌장 원문> --why <이유>');
  const marker = readJson(MARKER);
  if (!marker?.delegation) refuse('이 맵은 위임 중이 아니다 — 사람의 답을 기다린다.');
  const question = await showOf(argument);
  if (!question?.labels?.includes(QUESTION_LABEL)) refuse(`${argument} 는 질문 티켓(${QUESTION_LABEL} 라벨)이 아니다.`);
  const goal = charterGoalOf((await showOf(marker.epic))?.description);
  if (claimHashOf(goal) !== marker.delegation.goalHash) {
    refuse('헌장의 Destination·완료 조건이 위임을 켠 뒤 바뀌었다 — 위임은 켤 때의 목표를 따른다. 사람에게 확인받아 위임을 다시 켠다.');
  }
  if (!citesGoal(goal, cite)) {
    refuse('--cite 가 헌장의 Destination·완료 조건 원문이 아니다(8자 이상 그대로 인용). 헌장으로 판정되지 않는 질문은 위임 대상이 아니다 — 사람 몫으로 남긴다.');
  }
  await bdWrite(['label', 'add', argument, DELEGATED_LABEL]);
  await bdWrite(['human', 'respond', argument, '-r', delegatedAnswerText({ choice, cite, why })]);
  console.log(`[frontier-guard] ${argument} 를 위임으로 답했다 — ${DELEGATED_LABEL} 표시를 남겼다. 맵을 닫기 전 delegation-report 에 실린다.`);
} else if (command === 'delegation-report') {
  const epic = argument ?? readJson(MARKER)?.epic;
  if (!epic) refuse('usage: delegation-report [맵] — 이 worktree 에 선언된 맵이 없다.');
  const run = bdRunner(process.cwd());
  const map = await showOf(epic);
  const rows = await run(['list', '--parent', epic, '--all', '--limit', '0']);
  const decisions = [];
  for (const q of rows.filter((r) => r.labels?.includes(DELEGATED_LABEL))) {
    const comments = await run(['comments', q.id]);
    const entry = comments.findLast((c) => parseDelegatedAnswer(c.text));
    const parsed = entry ? parseDelegatedAnswer(entry.text) : { choice: '(답 코멘트를 못 읽었다)', cite: '', why: '' };
    const dependents = rows
      .filter((r) => r.dependencies?.some((d) => d.type === 'blocks' && d.depends_on_id === q.id))
      .map((r) => ({ id: r.id, title: r.title, status: r.status, closeReason: r.close_reason }));
    decisions.push({ id: q.id, title: q.title, at: entry?.created_at ?? q.closed_at ?? '', ...parsed, dependents });
  }
  const reportPath = reportPathFor(epic);
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    renderDelegationReport({
      epic,
      title: map?.title ?? epic,
      goal: charterGoalOf(map?.description),
      generatedAt: new Date().toISOString(),
      spans: delegationSpansOf(await run(['comments', epic])),
      decisions,
    })
  );
  console.log(reportPath);
} else if (command === 'hand-over') {
  const marker = readJson(MARKER);
  if (marker?.epic) writeMarker(MARKER, { ...marker, handedOffAt: new Date().toISOString() });
} else if (command === 'judge') {
  const args = process.argv.slice(3);
  const tokens = Number(flagOf(args, '--tokens'));
  const window = Number(flagOf(args, '--window'));
  const context = tokens >= 0 && window > 0 ? { contextTokens: tokens, contextLimit: window, measured: true } : null;
  const verdict = await judgeStop(
    { session_id: flagOf(args, '--session'), cwd: flagOf(args, '--cwd'), transcript_path: flagOf(args, '--transcript'), stop_hook_active: args.includes('--active'), hook_event_name: 'Stop' },
    context
  );
  console.log(JSON.stringify(verdict));
} else if (command === 'clear') {
  if (existsSync(MARKER)) rmSync(MARKER);
  console.log('[frontier-guard] 선언을 지웠다.');
} else if (command === 'status') {
  // 세션 id 와 트랜스크립트를 주면 훅과 **같은 판정**을 돌려준다 — 훅 모드는 stdin 을 먹어 손으로 못 돌린다.
  const rest = process.argv.slice(3);
  const at = rest.indexOf('--session');
  const sessionId = at >= 0 ? rest[at + 1] : undefined;
  const transcript = rest.find((_, i) => at < 0 || (i !== at && i !== at + 1));
  // cwd 가 옮겨 간 세션도 자기 맵을 본다 — 없으면 지금 위치의 마커다.
  const moved = sessionId ? locateOwned(process.cwd(), sessionId, transcript) : null;
  const markerPath = moved?.path ?? MARKER;
  const marker = moved?.marker ?? readJson(MARKER);
  const { children, ...read } = marker?.epic ? await readMap(marker.epic, bdRunner(mapCwdOf(marker, process.cwd()))) : UNREAD_MAP;
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
    stalled: false,
  });
  const handoff = { closedTickets: handoffClosed, ratio: HANDOFF_RATIO };
  console.log(
    JSON.stringify({ markerPath, worktree: marker?.worktree ?? repoRootOf(), marker, owner, ...read, ...measured, closedSinceSession, handoff, verdict }, null, 2)
  );
} else if (command === '--hook') {
  try {
    const input = JSON.parse((await readStdin()) || '{}');
    // mod 가 이 Stop 을 판정했다 — 여기서 또 판정하면 같은 멈춤을 두 번 되민다.
    if (isDelegatedToMod(input)) process.exit(0);
    const verdict = await judgeStop(input, null);
    if (verdict.block) console.log(JSON.stringify({ decision: 'block', reason: verdict.reason }));
  } catch {
    // 가드가 터지면 통과시킨다 — 머리말.
  }
  process.exit(0);
} else if (command === '--gate') {
  try {
    await gate(JSON.parse((await readStdin()) || '{}'));
  } catch {
    // 게이트가 터지면 통과시킨다 — 머리말.
  }
  process.exit(0);
} else if (command === '--receipt') {
  try {
    const input = JSON.parse((await readStdin()) || '{}');
    const cwd = input.cwd || process.cwd();
    const found = locateOwned(cwd, input.session_id, input.transcript_path);
    if (isHumanPrompt(input.prompt)) {
      const path = receiptsPathFor(found ? mapCwdOf(found.marker, cwd) : cwd);
      writeMarker(path, addReceipt(readJson(path), new Date().toISOString(), input.prompt));
    }
    const questions = found?.marker.gate?.questions ?? [];
    if (questions.length) {
      const route = found.marker.delegation
        ? '위임 중이다 — 헌장으로 판정되는 질문은 `frontier-guard.mjs delegate-answer` 로 답한다.'
        : '이 말이 그 답이면 원문을 인용해 `frontier-guard.mjs answer <질문> --quote "<원문>"` 로 닫고, 답이 아니면 추측으로 닫지 않는다.';
      console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: `맵 ${found.marker.epic} 에 답을 기다리는 질문이 있다(${questions.join(', ')}). ${route}` } }));
    }
  } catch {
    // 영수증을 못 남겼다고 사람의 입력을 막지 않는다.
  }
  process.exit(0);
} else if (command === '--refresh') {
  try {
    const input = JSON.parse((await readStdin()) || '{}');
    if (movesMap(input.tool_input?.command)) {
      const cwd = input.cwd || process.cwd();
      const found = locateOwned(cwd, input.session_id, input.transcript_path);
      if (found) {
        const { frontier } = await readMap(found.marker.epic, bdRunner(mapCwdOf(found.marker, cwd)));
        if (frontier) writeMarker(found.path, { ...readJson(found.path), gate: gateSnapshotOf(frontier) });
      }
    }
  } catch {
    // 스냅샷을 못 고치면 다음 Stop 이 고친다.
  }
  process.exit(0);
} else {
  console.error('usage: node frontier-guard.mjs <claim <epic> [--no-ticket-limit|--ticket-limit]|wave-begin <runId> <티켓>=<dispatch>[=<worktreeId>]...|wave-settle <티켓>|answer <질문> --quote <원문>|delegate --quote <원문>|delegate --off|delegate-answer <질문> --choice <고른 것> --cite <헌장 원문> --why <이유>|delegation-report [맵]|hand-over|clear|epic|wave|move <경로>|status [--session <id>] [트랜스크립트]|judge|--hook|--gate|--receipt|--refresh>');
  process.exit(1);
}
