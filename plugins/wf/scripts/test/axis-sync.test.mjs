import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { isDomainFile, listLine, resolveDomain, retiredLines } from '../design/axis-store.mjs';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'axis-sync.mjs');

const axis = (id, ask) => ({ id, ask });

// --- resolveDomain ---

test('parent axes keep their position and the child replaces the same id in place', () => {
  const parent = { domain: 'frontend', axes: [axis('state', 'parent'), axis('style', 'parent')] };
  const child = { schema: 1, domain: 'frontend-vue', description: 'Vue', extends: ['frontend'], axes: [axis('style', 'child'), axis('slots', 'child')] };
  assert.deepEqual(resolveDomain(child, [parent]), {
    schema: 1,
    domain: 'frontend-vue',
    description: 'Vue',
    axes: [axis('state', 'parent'), axis('style', 'child'), axis('slots', 'child')],
    retired: [],
  });
});

test('🚨 an id that looks like a number does not jump the queue', () => {
  const resolved = resolveDomain({ domain: 'd', axes: [axis('zeta'), axis('10'), axis('2')] }, []);
  assert.deepEqual(resolved.axes.map((entry) => entry.id), ['zeta', '10', '2']);
});

test('retired entries merge the same way and print with their reason', () => {
  const parent = { domain: 'p', axes: [], retired: [{ id: 'seo', retired_by: 'parent reason' }] };
  const child = { domain: 'c', axes: [], retired: [{ id: 'seo', retired_by: 'child reason' }, { id: 'i18n', retired_by: '단일 언어' }] };
  assert.deepEqual(retiredLines(resolveDomain(child, [parent])), ['  seo — child reason', '  i18n — 단일 언어']);
});

test('a domain with no axes array is an error, not an empty domain', () => {
  assert.throws(() => resolveDomain({ domain: 'broken' }, []), /domain broken has no axes array/);
});

test('_schema.json is not a domain, and a list line pads the name', () => {
  assert.deepEqual(['frontend.json', '_schema.json', 'notes.md'].map(isDomainFile), [true, false, false]);
  assert.equal(listLine('frontend', '화면 작업'), '  frontend           화면 작업');
  assert.equal(listLine('bare', undefined), '  bare               ');
});

// --- the script against a local remote ---

/** A bare repository standing in for the remote, and a runner bound to one local store. */
function remote(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'wf-axis-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const bare = join(root, 'remote.git');
  assert.equal(spawnSync('git', ['init', '--quiet', '--bare', bare]).status, 0);
  const at = (store) => (...args) =>
    spawnSync(process.execPath, [SCRIPT, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        WF_AXIS_STORE: join(root, store),
        WF_AXIS_REMOTE: bare,
        WF_AXIS_REF: 'refs/wf/axes',
        GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.com', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.com',
        GIT_CONFIG_GLOBAL: join(root, 'no-gitconfig'), GIT_CONFIG_NOSYSTEM: '1',
      },
    });
  return { root, bare, at };
}

test('🚨 init seeds, push publishes to the ref, and a second store pulls the same domains', (t) => {
  const { root, bare, at } = remote(t);
  const first = at('first');

  const pullEarly = first('pull');
  assert.equal(pullEarly.status, 1);
  assert.match(pullEarly.stderr, /refs\/wf\/axes does not exist on .* — run: axis-sync\.mjs init/);

  const init = first('init');
  assert.equal(init.status, 0, init.stderr);
  assert.match(init.stdout, /store seeded at .*first \(2 domains\)/);
  // init never writes to the remote
  assert.equal(spawnSync('git', ['ls-remote', '--exit-code', bare, 'refs/wf/axes']).status, 2);

  const push = first('push', 'seed');
  assert.equal(push.status, 0, push.stderr);
  assert.match(push.stdout, /published to refs\/wf\/axes/);
  assert.equal(spawnSync('git', ['ls-remote', '--exit-code', '--heads', bare]).status, 2, 'the ref is not a branch');
  assert.match(first('push', 'again').stdout, /nothing to push/);

  const second = at('second');
  const pull = second('pull');
  assert.equal(pull.status, 0, pull.stderr);
  assert.match(pull.stdout, /store up to date at .*second \(2 domains\)/);
  assert.deepEqual(second('list').stdout.split('\n').filter(Boolean).map((line) => line.trim().split(/\s+/)[0]), ['backend-api', 'frontend']);
  assert.equal(second('show', 'frontend').stdout, readFileSync(join(root, 'second/axes/frontend.json'), 'utf8'));
  assert.deepEqual(second('ids', 'frontend').stdout.trim().split('\n'), JSON.parse(second('resolve', 'frontend').stdout).axes.map((entry) => entry.id));
});

test('a change in one store reaches another through push and pull, extends included', (t) => {
  const { root, at } = remote(t);
  const first = at('first');
  first('init');
  first('push', 'seed');
  const second = at('second');
  second('pull');

  const child = { schema: 1, domain: 'frontend-vue', description: 'Vue', extends: ['frontend'], axes: [axis('slots', '슬롯')], retired: [{ id: 'seo', retired_by: '내부 도구' }] };
  writeFileSync(join(root, 'first/axes/frontend-vue.json'), JSON.stringify(child));
  assert.equal(first('push', 'add frontend-vue').status, 0);

  assert.match(second('pull').stdout, /\(3 domains\)/);
  const ids = second('ids', 'frontend-vue').stdout.trim().split('\n');
  assert.equal(ids.at(-1), 'slots');
  assert.ok(ids.length > 1, 'parent axes come first');
  assert.equal(second('retired', 'frontend-vue').stdout, '  seo — 내부 도구\n');
});

test('🚨 pull does not fast-forward over local changes', (t) => {
  const { root, at } = remote(t);
  const first = at('first');
  first('init');
  first('push', 'seed');
  writeFileSync(join(root, 'first/axes/draft.json'), '{"domain":"draft","axes":[]}');
  const pull = first('pull');
  assert.equal(pull.status, 1);
  assert.match(pull.stdout, /local changes present, not fast-forwarding/);
  assert.match(pull.stdout, /draft\.json/);
});

test('failures name what is wrong, and bad usage exits 2', (t) => {
  const { root, at } = remote(t);
  const first = at('first');
  assert.match(first('list').stderr, /store not found at .* — run: axis-sync\.mjs pull/);
  first('init');
  assert.match(first('init').stderr, /store already exists/);
  assert.match(first('show', 'nope').stderr, /no such domain: nope/);
  assert.match(first('show').stderr, /usage: axis-sync\.mjs show <domain>/);
  writeFileSync(join(root, 'first/axes/orphan.json'), JSON.stringify({ domain: 'orphan', extends: ['gone'], axes: [] }));
  assert.match(first('resolve', 'orphan').stderr, /orphan extends 'gone' which does not exist/);
  for (const [args, status] of [[[], 2], [['help'], 0], [['bogus'], 1], [['path'], 0]]) {
    assert.equal(first(...args).status, status, args.join(' '));
  }
});
