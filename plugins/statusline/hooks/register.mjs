/**
 * statusline mod — 프롬프트 아래 힌트 줄 밑에 상태줄을 그린다.
 *
 * 여기는 어댑터다. 값을 모으는 일(`$` 를 부르는 모든 것)과 이벤트 배선만 있고, 무엇을 어떻게 그릴지는
 * `scripts/lib/` 의 순수 함수가 정한다: 설정은 `config.mjs`, 배치는 `layout.mjs`, 위젯은 `widgets/`,
 * 명령 출력의 해석은 `parse-*.mjs`, `/sl` 은 `command.mjs`.
 *
 * `$` 를 받는 함수는 모두 이 파일의 최상위에 둔다 — 엔진이 hooks module 을 읽을 때 `$` 가 어디로
 * 가는지 이 파일 안에서 따라가며, 다른 파일로 넘기면 로드를 거부한다.
 *
 * 값을 모으다 실패한 소스는 상태줄을 막지 않는다. 그 칸만 비고, 이유는 `/sl` 목록에 보인다.
 *
 * @param {(event: string, ...rest: unknown[]) => unknown} on
 */

import { COMMAND_NAME, USAGE, applyEdit, describeConfig, describeWidgets, parseCommand } from '../scripts/lib/command.mjs';
import { CCSTATUSLINE_RELATIVE_PATH, CONFIG_RELATIVE_PATH, DEFAULT_CONFIG, fromCcstatusline, normalizeConfig } from '../scripts/lib/config.mjs';
import { activeItems, buildRows, neededSources } from '../scripts/lib/layout.mjs';
import { parseGitStatus, parseJjLog, parsePullRequest, parseRemotes, parseShortstat, parseVmStat, parseWorktree } from '../scripts/lib/parse-git.mjs';
import { addUsage, parseUsageApi, projectSlug, summarizeTranscript, usageOf } from '../scripts/lib/parse-transcript.mjs';

const USAGE_API_URL = 'https://api.anthropic.com/api/oauth/usage';
const STATUS_URL = 'https://status.claude.com/api/v2/status.json';
const CUSTOM_COMMAND_TIMEOUT_MS = 5000;
const JJ_TEMPLATE = 'change_id.shortest(8) ++ "\\n" ++ bookmarks.join(",") ++ "\\n" ++ description.first_line()';

// --- State ---

/** 모은 값. 꼴은 `scripts/lib/widgets/index.mjs` 가 적는다. */
const snap = {};
/** 소스 이름 → 마지막으로 값을 못 읽은 이유. */
const errors = {};
/** 소스 이름 → 마지막으로 모은 시각(ms). */
const collectedAt = {};

let home;
let configState = { config: DEFAULT_CONFIG, exists: false, problems: [], mtimeMs: null };
let needs = neededSources(DEFAULT_CONFIG);
let ticker = null;

// --- Config ---

async function homeDir($) {
  home ??= await $.env.get('HOME');
  snap.home = home;
  return home;
}

async function configPath($) {
  return `${await homeDir($)}/${CONFIG_RELATIVE_PATH}`;
}

async function configMtime($, path) {
  return (await $.fs.exists(path)) ? (await $.fs.stat(path)).mtimeMs : null;
}

async function loadConfig($) {
  const path = await configPath($);
  const mtimeMs = await configMtime($, path);
  if (mtimeMs === null) {
    configState = { config: DEFAULT_CONFIG, exists: false, problems: [], mtimeMs };
  } else {
    let raw;
    let broken = null;
    try {
      raw = JSON.parse(await $.fs.read(path));
    } catch (error) {
      broken = `설정 파일을 JSON 으로 읽지 못했다 (${error.message}) — 기본 설정으로 그린다`;
    }
    const { config, problems } = broken ? { config: DEFAULT_CONFIG, problems: [broken] } : normalizeConfig(raw);
    configState = { config, exists: true, problems, mtimeMs };
  }
  needs = neededSources(configState.config);
  restartTicker($);
}

async function reloadIfChanged($) {
  if ((await configMtime($, await configPath($))) === configState.mtimeMs) return false;
  await loadConfig($);
  return true;
}

async function saveConfig($, config) {
  const path = await configPath($);
  const made = await $.process.run(['mkdir', '-p', path.slice(0, path.lastIndexOf('/'))]);
  if (made.exitCode !== 0) throw new Error(`설정 폴더를 만들지 못했다: ${made.stderr.trim()}`);
  await $.fs.write(path, `${JSON.stringify(config, null, 2)}\n`);
  await loadConfig($);
}

function restartTicker($) {
  ticker?.cancel();
  ticker = needs.has('clock') ? $.clock.every(configState.config.refresh.clockSeconds * 1000, () => $.ui.invalidate('ui.render')) : null;
}

// --- Collecting ---

/** 소스 하나를 모은다. 실패는 그 소스의 칸만 비우고 이유를 남긴다. */
async function collect(source, body) {
  try {
    await body();
    delete errors[source];
  } catch (error) {
    errors[source] = String(error?.message ?? error);
  }
}

function isDue(source, seconds, now, force) {
  if (!force && collectedAt[source] !== undefined && now - collectedAt[source] < seconds * 1000) return false;
  collectedAt[source] = now;
  return true;
}

async function collectSession($) {
  const [model, version, id, cwd, repo] = await Promise.all([
    $.session.model(),
    $.session.version(),
    $.session.id(),
    $.session.cwd(),
    $.session.repo(),
  ]);
  snap.session = { ...snap.session, model, version: version.version, id, cwd };
  snap.repo = repo;
}

async function collectSettings($) {
  const settings = await $.settings.read();
  snap.settings = { effortLevel: settings.effortLevel, voice: settings.voice, sandbox: settings.sandbox };
}

async function collectConfigRows($) {
  snap.configRows = Object.fromEntries((await $.config.list()).map((row) => [row.key, row.value]));
}

async function collectContextUsable($) {
  const usage = await $.session.usage({ breakdown: 'summary' });
  snap.contextUsable = { maxTokens: usage.context.breakdown?.rawMaxTokens ?? null };
}

async function collectAccount($) {
  const account = JSON.parse(await $.fs.read(`${await homeDir($)}/.claude.json`)).oauthAccount;
  snap.account = { email: account?.emailAddress ?? null };
}

/** 트랜스크립트에서 세션 이름을 읽고, 처음 한 번은 재개 전까지의 토큰 합계를 되찾는다. */
async function collectTranscript($) {
  const [root, id] = await Promise.all([$.session.root(), $.session.id()]);
  const path = `${await homeDir($)}/.claude/projects/${projectSlug(root)}/${id}.jsonl`;
  // 첫 프롬프트 전에는 파일이 없다.
  const summary = summarizeTranscript((await $.fs.exists(path)) ? await $.fs.read(path) : '');
  snap.transcript = { customTitle: summary.customTitle, aiTitle: summary.aiTitle, effort: summary.effort };
  if (!snap.tokens) {
    snap.tokens = {
      ...summary.total,
      last: summary.last,
      lastResponseAt: summary.lastResponseAt,
      compactions: summary.compactions,
      turnInput: 0,
      turnOutput: 0,
      turnMs: 0,
    };
  }
}

async function runGit($, args) {
  const ran = await $.process.run(['git', ...args]);
  return ran.exitCode === 0 ? ran.stdout : null;
}

async function collectGit($) {
  const status = await runGit($, ['status', '--porcelain=v2', '--branch']);
  if (status === null) {
    // 저장소 밖이다.
    snap.git = null;
    snap.gitDiff = null;
    snap.gitRemotes = null;
    snap.gitWorktree = null;
    return;
  }
  snap.git = parseGitStatus(status);
  const [diff, remotes, worktree] = await Promise.all([
    needs.has('gitDiff') ? runGit($, ['diff', 'HEAD', '--shortstat']) : null,
    needs.has('gitRemotes') ? runGit($, ['remote', '-v']) : null,
    needs.has('gitWorktree') ? runGit($, ['rev-parse', '--path-format=absolute', '--git-dir', '--git-common-dir', '--show-toplevel']) : null,
  ]);
  // 첫 커밋 전에는 HEAD 가 없어 diff 가 실패한다. 그때는 변화 0 으로 둔다.
  snap.gitDiff = needs.has('gitDiff') ? parseShortstat(diff ?? '') : undefined;
  snap.gitRemotes = remotes === null ? undefined : parseRemotes(remotes);
  snap.gitWorktree = worktree === null ? undefined : parseWorktree(worktree);
}

async function collectGh($) {
  const ran = await $.process.run(['gh', 'pr', 'view', '--json', 'number,title,url,state,statusCheckRollup']);
  snap.gh = ran.exitCode === 0 ? parsePullRequest(ran.stdout) : null;
}

async function collectJj($) {
  const log = await $.process.run(['jj', 'log', '-r', '@', '--no-graph', '-T', JJ_TEMPLATE]);
  const parsed = log.exitCode === 0 ? parseJjLog(log.stdout) : null;
  if (!parsed) {
    snap.jj = null;
    return;
  }
  const [stat, root] = await Promise.all([$.process.run(['jj', 'diff', '--stat']), $.process.run(['jj', 'root'])]);
  snap.jj = { ...parsed, ...parseShortstat(stat.exitCode === 0 ? stat.stdout : ''), root: root.exitCode === 0 ? root.stdout.trim() : null };
}

async function collectApi($) {
  const authorization = await $.session.authorize();
  if (authorization === null) {
    // 자사 로그인이 아니다 (API 키, 게이트웨이, 3P). 이 값은 없는 것이다.
    snap.api = null;
    return;
  }
  const response = await $.http.fetch(USAGE_API_URL, { headers: { 'anthropic-beta': 'oauth-2025-04-20' }, auth: authorization.handle });
  if (!response.ok) throw new Error(`usage API ${response.status}`);
  snap.api = parseUsageApi(JSON.parse(response.text));
}

async function collectStatus($) {
  const response = await $.http.fetch(STATUS_URL);
  if (!response.ok) throw new Error(`status ${response.status}`);
  snap.status = { indicator: JSON.parse(response.text).status?.indicator ?? null };
}

async function collectMemory($) {
  const [vmStat, total] = await Promise.all([$.process.run(['vm_stat']), $.process.run(['sysctl', '-n', 'hw.memsize'])]);
  snap.memory = vmStat.exitCode === 0 && total.exitCode === 0 ? parseVmStat(vmStat.stdout, Number(total.stdout.trim())) : null;
}

async function collectCustom($) {
  const outputs = {};
  for (const item of activeItems(configState.config)) {
    if (item.type !== 'custom-command' || !item.command) continue;
    const ran = await $.process.run(item.command, { timeoutMs: CUSTOM_COMMAND_TIMEOUT_MS });
    outputs[item.id] = ran.exitCode === 0 ? ran.stdout.split('\n')[0].trim() : '';
  }
  snap.custom = outputs;
}

/** 켜진 위젯이 요구하는 소스를, 주기가 된 것만 모으고 다시 그리게 한다. */
async function refresh($, force) {
  const now = await $.clock.now();
  const every = configState.config.refresh;
  const jobs = [];
  const add = (source, seconds, body) => {
    if (needs.has(source) && isDue(source, seconds, now, force)) jobs.push(collect(source, body));
  };
  add('session', 0, () => collectSession($));
  add('usage', 0, async () => {
    snap.usage = await $.session.usage();
  });
  add('settings', 0, () => collectSettings($));
  add('configRows', 0, () => collectConfigRows($));
  add('contextUsable', every.apiSeconds, () => collectContextUsable($));
  add('account', every.statusSeconds, () => collectAccount($));
  add('transcript', every.clockSeconds, () => collectTranscript($));
  add('tokens', every.statusSeconds, () => collectTranscript($));
  add('git', every.gitSeconds, () => collectGit($));
  add('gh', every.ghSeconds, () => collectGh($));
  add('jj', every.gitSeconds, () => collectJj($));
  add('api', every.apiSeconds, () => collectApi($));
  add('status', every.statusSeconds, () => collectStatus($));
  add('memory', every.clockSeconds, () => collectMemory($));
  add('custom', every.customSeconds, () => collectCustom($));
  await Promise.all(jobs);
  $.ui.invalidate('ui.render');
}

/** 도구 호출 뒤에 부른다 — 작업 트리만 주기 안에서 다시 본다. */
async function refreshWorkingTree($) {
  const now = await $.clock.now();
  const seconds = configState.config.refresh.gitSeconds;
  const jobs = [];
  if (needs.has('git') && isDue('git', seconds, now, false)) jobs.push(collect('git', () => collectGit($)));
  if (needs.has('jj') && isDue('jj', seconds, now, false)) jobs.push(collect('jj', () => collectJj($)));
  if (jobs.length === 0) return;
  await Promise.all(jobs);
  $.ui.invalidate('ui.render');
}

/** 턴 하나의 토큰과 길이를 합계에 더한다. */
function addTurn(usage, durationMs, now) {
  const turn = usageOf(usage);
  const tokens = snap.tokens ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, compactions: 0, turnInput: 0, turnOutput: 0, turnMs: 0 };
  snap.tokens = {
    ...tokens,
    ...addUsage(tokens, turn),
    last: turn,
    lastResponseAt: now,
    turnInput: tokens.turnInput + turn.input + turn.cacheRead + turn.cacheWrite,
    turnOutput: tokens.turnOutput + turn.output,
    turnMs: tokens.turnMs + durationMs,
  };
}

/** 훅 입력에 실려 오는 노력 수준과 세션 이름. 없으면 그대로 둔다. */
function noteHookInput(e) {
  const effort = e.effort?.level;
  const name = e.session_title;
  if (!effort && !name) return;
  snap.session = { ...snap.session, ...(effort ? { effort } : {}), ...(name ? { name } : {}) };
}

// --- /sl ---

async function runCommand($, args) {
  const command = parseCommand(args);
  const path = await configPath($);
  const listing = () => describeConfig(configState.config, { path, exists: configState.exists, problems: configState.problems, errors });

  switch (command.action) {
    case 'error':
      return command.message;
    case 'help':
      return USAGE;
    case 'widgets':
      return describeWidgets();
    case 'list':
      return `${listing()}\n\n${USAGE}`;
    case 'reload':
      await loadConfig($);
      await refresh($, true);
      return `다시 읽었다.\n\n${listing()}`;
    case 'init':
      if (configState.exists) return `이미 있다: ${path}`;
      await saveConfig($, configState.config);
      await refresh($, true);
      return `만들었다: ${path}`;
    case 'import': {
      const source = `${await homeDir($)}/${CCSTATUSLINE_RELATIVE_PATH}`;
      if (!(await $.fs.exists(source))) return `ccstatusline 설정이 없다: ${source}`;
      if (configState.exists && !command.force) return `설정이 이미 있다: ${path}\n덮어쓰려면 \`/sl import --force\``;
      const { config, problems } = fromCcstatusline(JSON.parse(await $.fs.read(source)));
      await saveConfig($, config);
      await refresh($, true);
      return [`가져왔다: ${source} → ${path}`, ...problems.map((problem) => `  - ${problem}`), '', listing()].join('\n');
    }
    default: {
      const edited = applyEdit(configState.config, command);
      if (edited.error) return edited.error;
      await saveConfig($, edited.config);
      await refresh($, true);
      return `${edited.message}\n\n${listing()}`;
    }
  }
}

// --- Wiring ---

export function register(on) {
  on('session.start', async ($, e, next) => {
    await collect('config', () => loadConfig($));
    await collect('command', () => $.command.register({ name: COMMAND_NAME, description: '상태줄 배치를 보고 바꾼다', argumentHint: '[on|off|add|rm|move|set|…]' }));
    await refresh($, true);
    return next(e);
  });

  // 손으로 고친 설정은 다음 프롬프트에서 반영된다.
  on('turn.start', async ($, e, next) => {
    const changed = await reloadIfChanged($);
    await refresh($, changed);
    return next(e);
  });

  on('turn.complete', async ($, e, next) => {
    // 서브에이전트의 턴도 지나간다. 메인 대화만 센다.
    if (!e.agentId) {
      if (e.usage) addTurn(e.usage, e.durationMs, await $.clock.now());
      await refresh($, false);
    }
    return next(e);
  });

  on('session.measure', async ($, e, next) => {
    snap.usage = { ...snap.usage, context: e.context, rateLimits: e.rateLimits, cost: e.cost };
    await refresh($, false);
    return next(e);
  });

  on('session.compact', async ($, e, next) => {
    const result = await next(e);
    // precompute 는 아무것도 바꾸지 않는다.
    if (e.trigger !== 'precompute' && !e.agentId && !result?.skip && snap.tokens) {
      snap.tokens = { ...snap.tokens, compactions: snap.tokens.compactions + 1 };
      $.ui.invalidate('ui.render');
    }
    return result;
  });

  on('skill.prompt', ($, e, next) => {
    snap.skills = { last: e.skill, count: (snap.skills?.count ?? 0) + 1 };
    $.ui.invalidate('ui.render');
    return next(e);
  });

  on('classic.UserPromptSubmit', ($, e, next) => {
    noteHookInput(e);
    return next(e);
  });

  // 턴 도중에 바뀌는 git 상태를 따라간다. 주기 안에서는 git 을 다시 부르지 않는다.
  on('classic.PostToolUse', async ($, e, next) => {
    noteHookInput(e);
    await refreshWorkingTree($);
    return next(e);
  });

  on('command.run', { command: 'sl' }, async ($, e) => {
    try {
      return { text: await runCommand($, e.args) };
    } catch (error) {
      return { text: `/sl 실패: ${error.message}` };
    }
  });

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e);
    const rows = buildRows(configState.config, { ...snap, now: await $.clock.now(), columns: e.viewport?.columns });
    if (rows.length === 0) return hint;

    const { Box, Text } = $.ui.resolve(e);
    return h(
      Box,
      { flexDirection: 'column' },
      hint,
      ...rows.map((cells) =>
        h(
          Box,
          null,
          ...cells.map((cell) =>
            cell.flex
              ? h(Box, { flexGrow: 1 })
              : h(Text, { color: cell.color, backgroundColor: cell.bg, bold: cell.bold, dimColor: cell.dim }, cell.text),
          ),
        ),
      ),
    );
  });
}
