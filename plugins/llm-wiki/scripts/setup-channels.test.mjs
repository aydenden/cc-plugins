/**
 * Regression tests for setup-channels.mjs — offline. Probe results are fabricated
 * and manager detection takes an injected probe, so nothing here shells out to a
 * package manager or a network-backed CLI.
 * Run with: node --test scripts/lint.test.mjs scripts/ingest-book.test.mjs scripts/research-channels.test.mjs scripts/setup-channels.test.mjs hooks/post-log.test.mjs
 *
 * Dependency-free: node:test / node:assert only.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  CHANNELS, MANAGERS, parseArgs, parseAuthYaml, classify, detectManagers, installCommand, formatCmd,
} from './setup-channels.mjs';

const SCRIPT = fileURLToPath(new URL('./setup-channels.mjs', import.meta.url));

const byId = (id) => CHANNELS.find((c) => c.id === id);
const probe = (over = {}) => ({ spawned: true, code: 0, out: '', timedOut: false, ...over });

// --- Registry ---

test('every channel is installable, probed for real, and self-describing', () => {
  assert.deepEqual(CHANNELS.map((c) => c.id), ['yt-dlp', 'gh', 'rdt', 'twitter', 'agent-browser', 'scrapling']);
  for (const channel of CHANNELS) {
    assert.ok(channel.label && channel.bin, `${channel.id} needs a label and a binary`);
    assert.ok(Object.keys(channel.install).length, `${channel.id} needs at least one install path`);
    // The whole point: availability is decided by running something, not by `command -v`.
    assert.ok(Array.isArray(channel.probe.cmd) && channel.probe.cmd.length > 1, `${channel.id} probe must be a real invocation`);
  }
});

test('the X channel carries its known-broken subcommand', () => {
  // agent-reach's doctor called this channel fully available while search 404'd.
  assert.match(byId('twitter').broken.join(' '), /search/);
  assert.equal(byId('yt-dlp').auth, null); // the one channel that needs no human step
});

test('browser-bypass channels download their browser as part of installing', () => {
  // A bypass binary without its browser renders nothing, so the download is not
  // a follow-up the user has to guess — it is part of the channel's install.
  for (const id of ['agent-browser', 'scrapling']) {
    assert.ok(byId(id).postInstall?.length, `${id} must carry its browser download step`);
  }
  // `[fetchers]` alone crashes on .md output (missing markdownify) — the extra matters.
  assert.match(formatCmd(byId('scrapling').install.uv), /scrapling\[shell\]/);
  assert.equal(byId('agent-browser').auth, null);
  // The ladder's ceiling is recorded where a reader will hit it.
  assert.match(byId('agent-browser').broken.join(' '), /403/);
});

test('every platform can install both browser-bypass channels', () => {
  for (const [platform, managers] of Object.entries(MANAGERS)) {
    for (const id of ['agent-browser', 'scrapling']) {
      assert.ok(installCommand(byId(id), managers), `${platform} cannot install ${id}`);
    }
  }
});

test('every platform has a manager list and pipx is always reachable', () => {
  for (const [platform, managers] of Object.entries(MANAGERS)) {
    assert.ok(managers.length, `${platform} needs managers`);
    assert.ok(managers.includes('pipx'), `${platform} must keep the Python CLIs installable`);
  }
});

// --- Probe classification ---

test('parseAuthYaml reads the tools own status output', () => {
  assert.equal(parseAuthYaml('ok: true\ndata:\n  authenticated: true\n'), true);
  assert.equal(parseAuthYaml('data:\n  authenticated: false\n'), false);
  assert.equal(parseAuthYaml('Traceback (most recent call last)'), null);
});

test('classify separates missing binary from unauthenticated from broken', () => {
  assert.equal(classify(byId('rdt'), probe({ spawned: false })).status, 'missing');
  assert.equal(classify(byId('rdt'), probe({ out: 'authenticated: true' })).status, 'ok');
  assert.equal(classify(byId('rdt'), probe({ out: 'authenticated: false' })).status, 'auth');
  // Installed but the status output made no sense — not the same as "not logged in".
  assert.equal(classify(byId('rdt'), probe({ out: 'boom', code: 1 })).status, 'broken');
});

test('classify handles exit-code probes and timeouts', () => {
  assert.equal(classify(byId('gh'), probe({ code: 0 })).status, 'ok');
  assert.equal(classify(byId('gh'), probe({ code: 1 })).status, 'auth');
  assert.equal(classify(byId('yt-dlp'), probe({ code: 0 })).status, 'ok');
  // No account exists for yt-dlp, so a failing probe can only mean broken.
  assert.equal(classify(byId('yt-dlp'), probe({ code: 2 })).status, 'broken');
  assert.equal(classify(byId('gh'), probe({ timedOut: true })).status, 'broken');
});

// --- Install planning ---

test('detectManagers keeps the platform preference order and drops absent ones', () => {
  assert.deepEqual(detectManagers('darwin', (m) => m === 'brew' || m === 'pipx'), ['brew', 'pipx']);
  assert.deepEqual(detectManagers('linux', (m) => m === 'pipx'), ['pipx']);
  assert.deepEqual(detectManagers('win32', (m) => m === 'scoop'), ['scoop']);
  assert.deepEqual(detectManagers('darwin', () => false), []);
  assert.deepEqual(detectManagers('sunos', (m) => m === 'apt'), ['apt']); // unknown platform falls back to linux
});

test('installCommand picks the first present manager that can install the channel', () => {
  assert.equal(formatCmd(installCommand(byId('yt-dlp'), ['brew', 'pipx']).cmd), 'brew install yt-dlp');
  assert.equal(installCommand(byId('yt-dlp'), ['pipx']).manager, 'pipx');
  // The Python CLIs have exactly one path — brew alone cannot install them.
  assert.equal(installCommand(byId('rdt'), ['brew']), null);
  assert.equal(formatCmd(installCommand(byId('rdt'), ['brew', 'pipx']).cmd), 'pipx install rdt-cli');
});

// --- CLI ---

test('parseArgs reads the command and both flag forms', () => {
  const opts = parseArgs(['install', '--channel=gh,rdt', '--yes']);
  assert.equal(opts.command, 'install');
  assert.deepEqual(opts.channels, ['gh', 'rdt']);
  assert.equal(opts.yes, true);
  assert.equal(parseArgs(['check', '--channel', 'gh', '--json']).json, true);
});

function runCli(args) {
  try {
    return { code: 0, out: execFileSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }) };
  } catch (err) {
    return { code: err.status, out: `${err.stdout || ''}${err.stderr || ''}` };
  }
}

test('CLI rejects unknown channels, commands and stray arguments', () => {
  assert.equal(runCli(['check', '--channel', 'discord']).code, 2);
  assert.equal(runCli(['bogus']).code, 2);
  assert.equal(runCli(['check', 'extra']).code, 2);
});

test('install without --yes changes nothing and says so', () => {
  const result = runCli(['install', '--channel', 'gh']);
  assert.equal(result.code, 0);
  assert.match(result.out, /--yes/);
  assert.match(result.out, /아무것도 바꾸지 않았다/);
});

test('plan prints the browser download step so nothing installs invisibly', () => {
  const out = runCli(['plan', '--channel', 'scrapling']).out;
  assert.match(out, /scrapling/);
});

test('CLI lists channels and help offline', () => {
  assert.match(runCli(['channels']).out, /^yt-dlp\t/m);
  assert.match(runCli(['--help']).out, /setup-channels\.mjs check/);
});
