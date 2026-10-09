import test from 'node:test';
import assert from 'node:assert/strict';

import { LAYOUT_TYPES, UNSUPPORTED, WIDGETS, isKnownType } from '../lib/widgets/index.mjs';

const NOW = Date.parse('2026-10-09T02:00:00.000Z');
const show = (type, snap, item = {}) => {
  const rendered = WIDGETS[type].render(snap, { type, ...item });
  return rendered ? `${rendered.label}${rendered.value}` : null;
};

const full = {
  now: NOW,
  columns: 163,
  home: '/Users/u',
  session: { model: 'claude-opus-5-5', version: '2.1.295', id: 'abc', cwd: '/Users/u/dev/repo', effort: 'high' },
  repo: { root: '/Users/u/dev/repo' },
  usage: {
    startedAt: NOW - 65 * 60_000,
    context: { tokens: 179_440, window: 1_000_000, percent: 18 },
    rateLimits: [
      { kind: 'five_hour', percentUsed: 19, resetsAt: '2026-10-09T04:50:00.000Z' },
      { kind: 'seven_day', percentUsed: 56.5, resetsAt: '2026-10-12T06:00:00.000Z' },
    ],
    cost: { usd: 2.6091976 },
  },
  contextUsable: { maxTokens: 500_000 },
  settings: { effortLevel: 'medium', voice: { enabled: true } },
  configRows: { outputStyle: 'default', editor: 'vim', remoteControl: false },
  transcript: { customTitle: null, aiTitle: 'auto name', effort: 'low' },
  account: { email: 'me@example.com' },
  status: { indicator: 'none' },
  skills: { last: 'tdd', count: 3 },
  tokens: {
    input: 1200,
    output: 3400,
    cacheRead: 90_000,
    cacheWrite: 10_000,
    last: { input: 100, output: 50, cacheRead: 900, cacheWrite: 100 },
    lastResponseAt: NOW - 2 * 60_000,
    compactions: 2,
    turnInput: 20_000,
    turnOutput: 1000,
    turnMs: 10_000,
  },
  git: { branch: 'main', sha: '1234567890', upstream: 'origin/main', ahead: 1, behind: 0, staged: 2, unstaged: 0, untracked: 1, conflicts: 0 },
  gitDiff: { insertions: 12, deletions: 3 },
  gitRemotes: { origin: { host: 'github.com', owner: 'me', repo: 'fork' }, upstream: null },
  gitWorktree: { isWorktree: true, name: 'wt1' },
  gh: { pr: { number: 12, title: 'Fix', url: 'https://x/12', state: 'OPEN' }, checks: { failing: 1, pending: 0, passing: 5 } },
  jj: { revision: 'kxyz', bookmarks: ['main'], description: 'Fix', root: '/Users/u/dev/repo', insertions: 1, deletions: 0 },
  api: { perModel: { fable: { percent: 0, resetsAt: null } }, extra: { enabled: true, limit: 50, used: 12.5, utilization: 25, currency: 'USD' } },
  memory: { usedBytes: 12 * 1024 ** 3, totalBytes: 32 * 1024 ** 3 },
  custom: { c1: 'hello' },
};

test('모든 위젯은 빈 스냅숏에서 던지지 않고 숨는다', () => {
  for (const [type, widget] of Object.entries(WIDGETS)) {
    assert.equal(widget.render({}, { type }), null, type);
  }
});

test('값이 다 있는 스냅숏에서 대표 위젯의 글자', () => {
  const expected = {
    model: 'Model: Opus 5.5',
    'thinking-effort': 'Effort: high',
    'session-name': 'Session: auto name',
    'claude-status': 'Claude: ok',
    'vim-mode': 'Editor: vim',
    'voice-status': 'voice on',
    'sandbox-status': 'SB: OFF',
    'remote-control-status': 'RC: off',
    skills: 'Skill: tdd ×3',
    'session-clock': 'Session: 1hr 5m',
    'session-cost': 'Cost: $2.61',
    'git-branch': '⎇ main',
    'git-root-dir': 'repo',
    'git-sha': '1234567',
    'git-changes': '(+12,-3)',
    'git-status': '+?',
    'git-clean-status': '✗',
    'git-ahead-behind': '↑1↓0',
    'git-origin-owner-repo': 'me/fork',
    'git-staged-files': 'S:2',
    'worktree-name': 'wt1',
    'git-review': 'PR #12 Fix',
    'git-ci-status': '✗1 ✓5',
    'jj-changes': '(+1,-0)',
    'context-length': 'Ctx: 179.4k',
    'context-window': 'Win: 1M',
    'context-percentage-usable': 'Ctx(u): 35.9%',
    'context-bar': 'Ctx: [███░░░░░░░░░░░░░] 179k/1.0M (18%)',
    'session-usage': 'Session: 19%',
    'weekly-usage': 'Weekly: 56.5%',
    'reset-timer': 'Reset: 2hr 50m',
    'weekly-reset-timer': 'Weekly reset: 3d 4hr',
    'block-timer': 'Block: 2hr 10m',
    'fable-weekly-usage': 'Weekly Fable: 0%',
    'extra-usage-utilization': 'Extra: 25%',
    'extra-usage-remaining': 'Extra left: $37.50',
    'tokens-total': 'Total: 104.6k',
    'cache-hit-rate': 'Cache: 90%',
    'cache-read': 'Cache R: 900 (81.8%)',
    'cache-timer': 'Cache: 3m',
    'output-speed': 'Out: 100 t/s',
    'compaction-counter': '↻ 2',
    'current-working-dir': 'cwd: ~/dev/repo',
    'terminal-width': 'Width: 163',
    'free-memory': 'Mem: 12G/32G',
  };
  for (const [type, text] of Object.entries(expected)) assert.equal(show(type, full), text, type);
});

test('훅이 준 값이 설정·트랜스크립트의 값을 이긴다', () => {
  assert.equal(show('thinking-effort', { transcript: { effort: 'low' }, settings: { effortLevel: 'medium' } }), 'Effort: low');
  assert.equal(show('thinking-effort', { settings: { effortLevel: 'medium' } }), 'Effort: medium');
  assert.equal(show('session-name', { session: { name: 'renamed' }, transcript: { aiTitle: 'auto' } }), 'Session: renamed');
});

test('0 인 값은 숨고 showZero 면 보인다', () => {
  const clean = { git: { ...full.git, staged: 0, ahead: 0 }, gitDiff: { insertions: 0, deletions: 0 }, usage: { cost: { usd: 0 } } };
  for (const type of ['git-staged-files', 'git-changes', 'git-ahead-behind', 'session-cost']) {
    assert.equal(show(type, clean), null, type);
    assert.notEqual(show(type, clean, { showZero: true }), null, type);
  }
  assert.equal(show('output-style', full), null);
  assert.equal(show('output-style', full, { showZero: true }), 'Style: default');
});

test('저장소 밖이면 git 위젯은 숨는다', () => {
  for (const type of ['git-branch', 'git-status', 'git-clean-status', 'git-conflicts', 'git-changes', 'worktree-mode']) {
    assert.equal(show(type, { git: null, gitDiff: null, gitWorktree: null }), null, type);
  }
});

test('캐시 타이머는 TTL 이 지나면 COLD, ttlMinutes 로 늘린다', () => {
  const snap = { now: NOW, tokens: { lastResponseAt: NOW - 6 * 60_000 } };
  assert.equal(show('cache-timer', snap), 'Cache: COLD');
  assert.equal(show('cache-timer', snap, { ttlMinutes: 60 }), 'Cache: 54m');
});

test('컨텍스트 막대는 칸 수를 바꾸고, percent 형식이면 토큰 수를 뺀다', () => {
  assert.equal(show('context-bar', full, { width: 10, format: 'percent' }), 'Ctx: [██░░░░░░░░] 18%');
  assert.equal(show('context-bar', { usage: { context: { window: 200_000, percent: 0 } } }), 'Ctx: [░░░░░░░░░░░░░░░░] 0%');
  assert.equal(show('context-bar', { usage: { context: { tokens: 950, window: 200_000, percent: 0 } } }), 'Ctx: [░░░░░░░░░░░░░░░░] 950/200k (0%)');
});

test('추가 사용량이 꺼져 있으면 숨는다', () => {
  assert.equal(show('extra-usage-used', { api: { perModel: {}, extra: { enabled: false, used: 1, limit: 2, currency: 'USD' } } }), null);
  assert.equal(show('weekly-opus-usage', full), null);
});

test('커스텀 위젯은 항목에 적은 것을 그대로 쓴다', () => {
  assert.equal(show('custom-text', {}, { text: 'hi' }), 'hi');
  assert.equal(show('custom-symbol', {}, { symbol: '★' }), '★');
  assert.equal(show('custom-command', full, { id: 'c1' }), 'hello');
  assert.deepEqual(WIDGETS.link.render({}, { url: 'https://x', text: 'docs' }), { label: '', value: 'docs', url: 'https://x' });
});

test('레지스트리는 배치 타입과 지원 안 하는 타입을 위젯으로 두지 않는다', () => {
  for (const type of [...LAYOUT_TYPES, ...Object.keys(UNSUPPORTED)]) assert.equal(Object.hasOwn(WIDGETS, type), false, type);
  assert.equal(isKnownType('flex-separator'), true);
  assert.equal(isKnownType('jj-workspace'), false);
  for (const widget of Object.values(WIDGETS)) assert.ok(Array.isArray(widget.needs) && typeof widget.category === 'string');
});
