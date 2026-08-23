#!/usr/bin/env node
/**
 * llm-wiki setup-channels — optional research channels: diagnose and install.
 *
 * Dependency-free Node ESM, single file. Runs on macOS / Linux / Windows 11 with
 * nothing but `node` on PATH; uses only node: builtins.
 *
 * The mandatory research layer (WebSearch / WebFetch, the key-free paper APIs and
 * the single-tweet endpoint) needs none of this — a machine that never runs this
 * command still completes research. This only raises the ceiling on machines the
 * user chooses to equip, which is why it is an opt-in command and not an install
 * hook (plugin hooks install npm/bun deps with --ignore-scripts and cannot do it
 * anyway).
 *
 * Usage:
 *   node setup-channels.mjs check   [--channel id,...] [--json]   diagnose
 *   node setup-channels.mjs plan    [--channel id,...]            print install commands
 *   node setup-channels.mjs install [--channel id,...] [--yes]    run them
 *   node setup-channels.mjs channels                              list channel ids
 *
 * Two boundaries this script does not cross:
 *   1. **Authentication.** A script can install a binary; it cannot log a human
 *      into Reddit or extract browser cookies. Auth steps are printed, never run.
 *   2. **Trusting `command -v`.** A binary on PATH is not a working channel —
 *      agent-reach's doctor reported `twitter search` as fully available while the
 *      real call returned HTTP 404 (2026-08-16). Every channel is probed with an
 *      actual command, and known-broken subcommands are carried in the registry.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

// --- Constants ---

const PROBE_TIMEOUT_MS = 20000;

const HELP = `llm-wiki setup-channels — optional research channels

  node setup-channels.mjs check   [--channel id,...] [--json]   probe each channel for real
  node setup-channels.mjs plan    [--channel id,...]            print install commands only
  node setup-channels.mjs install [--channel id,...] [--yes]    run them (--yes required)
  node setup-channels.mjs channels                              list channel ids

Authentication is never automated — the commands are printed for you to run.
Exit codes: 0 ok · 2 usage error. \`check\` always exits 0: a missing optional
channel is degradation, not failure.
`;

/**
 * Package managers, in the order a platform prefers them. `pipx` is listed for
 * every platform because the two Python CLIs have no other install path.
 */
const MANAGERS = {
  darwin: ['brew', 'uv', 'pipx', 'npm'],
  linux: ['apt', 'dnf', 'pacman', 'uv', 'pipx', 'npm'],
  win32: ['winget', 'scoop', 'uv', 'pipx', 'npm'],
};

/**
 * Channel registry. `probe` is an actual invocation, never a PATH lookup:
 *   version   — exit 0 means the binary works; no account involved
 *   auth-exit — exit 0 means authenticated (the tool has no machine-readable output)
 *   auth-yaml — parse `authenticated: true` out of the tool's own status output
 * `broken` records subcommands that are known dead upstream even when auth is fine.
 */
const CHANNELS = [
  {
    id: 'yt-dlp',
    bin: 'yt-dlp',
    label: 'YouTube 자막',
    install: {
      brew: ['brew', 'install', 'yt-dlp'],
      apt: ['sudo', 'apt', 'install', '-y', 'yt-dlp'],
      dnf: ['sudo', 'dnf', 'install', '-y', 'yt-dlp'],
      pacman: ['sudo', 'pacman', '-S', '--noconfirm', 'yt-dlp'],
      winget: ['winget', 'install', '--id', 'yt-dlp.yt-dlp', '-e'],
      scoop: ['scoop', 'install', 'yt-dlp'],
      pipx: ['pipx', 'install', 'yt-dlp'],
    },
    probe: { cmd: ['yt-dlp', '--version'], kind: 'version' },
    auth: null,
  },
  {
    id: 'gh',
    bin: 'gh',
    label: 'GitHub — 코드·저장소 사실',
    install: {
      brew: ['brew', 'install', 'gh'],
      apt: ['sudo', 'apt', 'install', '-y', 'gh'],
      dnf: ['sudo', 'dnf', 'install', '-y', 'gh'],
      pacman: ['sudo', 'pacman', '-S', '--noconfirm', 'github-cli'],
      winget: ['winget', 'install', '--id', 'GitHub.cli', '-e'],
      scoop: ['scoop', 'install', 'gh'],
    },
    probe: { cmd: ['gh', 'auth', 'status'], kind: 'auth-exit' },
    auth: 'gh auth login',
  },
  {
    id: 'rdt',
    bin: 'rdt',
    label: 'Reddit — 커뮤니티 여론',
    install: { pipx: ['pipx', 'install', 'rdt-cli'] },
    probe: { cmd: ['rdt', 'status'], kind: 'auth-yaml' },
    auth: 'rdt login   # 브라우저 쿠키를 추출한다 — 기기마다 1회',
  },
  {
    id: 'twitter',
    bin: 'twitter',
    label: 'X — 큐레이션 계정 폴링',
    install: { pipx: ['pipx', 'install', 'twitter-cli'] },
    probe: { cmd: ['twitter', 'status'], kind: 'auth-yaml' },
    auth: 'twitter login   # 브라우저 쿠키를 추출한다 — 기기마다 1회',
    broken: ['search — 상시 HTTP 404 (2026-08-16 실측). user-posts / list / following 은 정상'],
  },
  {
    id: 'agent-browser',
    bin: 'agent-browser',
    label: '브라우저 우회 — JS 렌더링·단순 봇필터 페이지',
    install: {
      brew: ['brew', 'install', 'agent-browser'],
      npm: ['npm', 'install', '-g', 'agent-browser'],
    },
    // The binary alone renders nothing — Playwright's Chromium is a separate download.
    postInstall: [['agent-browser', 'install']],
    probe: { cmd: ['agent-browser', '--version'], kind: 'version' },
    auth: null,
    broken: ['상류가 아예 거부하는 사이트는 실브라우저로도 403이다 (g2.com, 2026-08-23 실측 — 3계단 scrapling도 동일). 그 URL은 축퇴로 기록한다'],
  },
  {
    id: 'scrapling',
    bin: 'scrapling',
    label: '브라우저 우회 — Cloudflare 챌린지 페이지',
    install: {
      // `[shell]` is the extra that carries markdownify; `[fetchers]` alone makes
      // `.md` output crash with ModuleNotFoundError (2026-08-23 실측).
      uv: ['uv', 'tool', 'install', 'scrapling[shell]'],
      pipx: ['pipx', 'install', 'scrapling[shell]'],
    },
    postInstall: [['scrapling', 'install']],
    probe: { cmd: ['scrapling', '--version'], kind: 'version' },
    auth: null,
  },
];

// --- Probing ---

function run(cmd, { capture = true } = {}) {
  const result = spawnSync(cmd[0], cmd.slice(1), {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
    shell: false,
  });
  return {
    // ENOENT (binary absent) and a non-zero exit are different facts, so keep both.
    spawned: !result.error || result.error.code !== 'ENOENT',
    code: result.status,
    out: `${result.stdout || ''}${result.stderr || ''}`,
    timedOut: result.error?.code === 'ETIMEDOUT' || result.signal === 'SIGTERM',
  };
}

/** `authenticated: true` in the tool's own status output. */
function parseAuthYaml(output) {
  if (/authenticated:\s*true/i.test(output)) return true;
  if (/authenticated:\s*false/i.test(output)) return false;
  return null;
}

/**
 * Classify one channel: `ok` / `auth` (installed, not logged in) / `missing`
 * (binary absent) / `broken` (binary there, probe failed for another reason).
 */
function classify(channel, probe) {
  if (!probe.spawned) return { status: 'missing', detail: 'binary not on PATH' };
  if (probe.timedOut) return { status: 'broken', detail: `probe timed out after ${PROBE_TIMEOUT_MS}ms` };
  if (channel.probe.kind === 'auth-yaml') {
    const authed = parseAuthYaml(probe.out);
    if (authed === true) return { status: 'ok', detail: 'authenticated' };
    if (authed === false) return { status: 'auth', detail: 'installed, not authenticated' };
    return { status: 'broken', detail: `unrecognised status output (exit ${probe.code})` };
  }
  if (probe.code === 0) return { status: 'ok', detail: channel.auth ? 'authenticated' : 'available' };
  return channel.auth
    ? { status: 'auth', detail: `installed, probe exited ${probe.code}` }
    : { status: 'broken', detail: `probe exited ${probe.code}` };
}

function checkChannel(channel) {
  const result = classify(channel, run(channel.probe.cmd));
  return {
    id: channel.id,
    label: channel.label,
    status: result.status,
    detail: result.detail,
    auth: channel.auth,
    broken: channel.broken || [],
    install: installCommand(channel, detectManagers()),
  };
}

// --- Install planning ---

/** Managers actually present, in this platform's preference order. */
function detectManagers(platform = process.platform, probe = (bin) => run([bin, '--version']).spawned) {
  const candidates = MANAGERS[platform] || MANAGERS.linux;
  return candidates.filter((manager) => probe(manager));
}

/** First install command whose manager is present; null when nothing can install it. */
function installCommand(channel, managers) {
  for (const manager of managers) {
    if (channel.install[manager]) return { manager, cmd: channel.install[manager] };
  }
  return null;
}

function formatCmd(cmd) {
  return cmd.join(' ');
}

// --- CLI ---

function parseArgs(argv) {
  const opts = { command: null, channels: null, json: false, yes: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('-')) {
      if (!opts.command) opts.command = arg;
      else fail(`unexpected argument: ${arg}`);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg : arg.slice(0, eq);
    const inlineValue = eq === -1 ? null : arg.slice(eq + 1);
    const next = () => (inlineValue !== null ? inlineValue : argv[++i]);
    switch (key) {
      case '--channel': opts.channels = next().split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--json': opts.json = true; break;
      case '--yes': opts.yes = true; break;
      case '-h': case '--help': opts.help = true; break;
      default: fail(`unknown argument: ${arg}`);
    }
  }
  if (opts.channels) {
    const unknown = opts.channels.filter((id) => !CHANNELS.some((c) => c.id === id));
    if (unknown.length) fail(`unknown channel: ${unknown.join(', ')}\nknown channels: ${CHANNELS.map((c) => c.id).join(', ')}`);
  }
  return opts;
}

function fail(message) {
  process.stderr.write(`[llm-wiki setup-channels] ${message}\n`);
  process.exit(2);
}

function selected(opts) {
  return CHANNELS.filter((channel) => !opts.channels || opts.channels.includes(channel.id));
}

function runCheck(opts) {
  const results = selected(opts).map(checkChannel);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify({ platform: process.platform, managers: detectManagers(), channels: results }, null, 2)}\n`);
    return 0;
  }
  const count = (status) => results.filter((r) => r.status === status).length;
  const out = [`CHANNELS ok=${count('ok')} auth=${count('auth')} missing=${count('missing')} broken=${count('broken')}`];
  for (const result of results) {
    out.push(`${result.id} ${result.status} — ${result.detail}`);
    if (result.status === 'missing' && result.install) out.push(`  설치: ${formatCmd(result.install.cmd)}`);
    if (result.status === 'missing' && !result.install) out.push('  설치: 이 기기에 쓸 패키지 매니저가 없다');
    if (result.status === 'auth' && result.auth) out.push(`  인증: ${result.auth}`);
    for (const note of result.broken) out.push(`  주의: ${note}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
  return 0;
}

/** The plan is the same text whether or not it will be executed — no hidden steps. */
function printPlan(channels, managers) {
  const out = [`PLAN platform=${process.platform} managers=${managers.join(',') || 'none'}`];
  const auth = [];
  for (const channel of channels) {
    const present = run([channel.bin, '--version']).spawned;
    if (present) {
      out.push(`${channel.id} — 이미 설치됨, 건너뜀`);
    } else {
      const install = installCommand(channel, managers);
      out.push(install ? `${channel.id} — ${formatCmd(install.cmd)}` : `${channel.id} — 설치 불가: 쓸 패키지 매니저가 없다`);
    }
    if (!present) {
      for (const step of channel.postInstall || []) out.push(`${channel.id} — ${formatCmd(step)}   # 브라우저 바이너리 내려받기`);
    }
    if (channel.auth) auth.push(`${channel.id}: ${channel.auth}`);
  }
  if (auth.length) {
    out.push('', '인증은 자동화하지 않는다 — 아래는 사람이 직접 실행한다:');
    for (const line of auth) out.push(`  ${line}`);
  }
  process.stdout.write(`${out.join('\n')}\n`);
}

function runInstall(opts) {
  const managers = detectManagers();
  const channels = selected(opts);
  printPlan(channels, managers);
  if (!opts.yes) {
    process.stdout.write('\n실행하려면 --yes 를 붙여라. 이 실행은 아무것도 바꾸지 않았다.\n');
    return 0;
  }
  for (const channel of channels) {
    if (run([channel.bin, '--version']).spawned) continue;
    const install = installCommand(channel, managers);
    if (!install) continue;
    process.stdout.write(`\n$ ${formatCmd(install.cmd)}\n`);
    const result = run(install.cmd, { capture: false });
    if (result.code !== 0) {
      process.stdout.write(`${channel.id} 설치 실패 (exit ${result.code}) — 위 출력을 확인해라\n`);
      continue;
    }
    // A browser-bypass binary without its browser is `missing` in every way that matters,
    // so the download is part of installing the channel, not a follow-up the user must guess.
    for (const step of channel.postInstall || []) {
      process.stdout.write(`\n$ ${formatCmd(step)}\n`);
      const post = run(step, { capture: false });
      if (post.code !== 0) {
        process.stdout.write(`${channel.id} 후속 단계 실패 (exit ${post.code}) — 브라우저 없이는 이 채널이 동작하지 않는다\n`);
      }
    }
    process.stdout.write(`${channel.id} 설치 완료\n`);
  }
  return 0;
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help || !opts.command) {
    process.stdout.write(HELP);
    return 0;
  }
  switch (opts.command) {
    case 'check': return runCheck(opts);
    case 'plan': printPlan(selected(opts), detectManagers()); return 0;
    case 'install': return runInstall(opts);
    case 'channels':
      for (const channel of CHANNELS) process.stdout.write(`${channel.id}\t${channel.label}\t${channel.auth ? '인증 필요' : '인증 없음'}\n`);
      return 0;
    default:
      fail(`unknown command: ${opts.command}\nknown commands: check, plan, install, channels`);
      return 2;
  }
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main();

export { CHANNELS, MANAGERS, parseArgs, parseAuthYaml, classify, detectManagers, installCommand, formatCmd };
