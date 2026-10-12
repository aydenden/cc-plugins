#!/usr/bin/env node
/**
 * Sync the domain axis library kept under a custom ref on the plugin repository.
 *
 * The data lives at refs/wf/axes on the remote, outside refs/heads and refs/tags. Verified
 * against GitHub: the push is accepted, the ref is absent from `ls-remote --heads` and from the
 * web branch list, and a default clone or fetch does not bring it down. Only a caller that names
 * the refspec sees it, so plugin releases on main and axis data never meet.
 *
 * The local store is an ordinary repository with a working tree, so the files can be read and
 * edited by hand; only the remote side is hidden.
 *
 * The store lives outside the plugin directory on purpose: the install cache is
 * ~/.claude/plugins/cache/<owner>/<plugin>/<version>/, so anything kept inside the plugin is
 * orphaned on every version bump. Axes must survive updates.
 *
 * Usage: node axis-sync.mjs <command> [args]
 * Exit:  0 ok · 1 failure · 2 bad usage
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { isDomainFile, listLine, resolveDomain, retiredLines } from './design/axis-store.mjs';

const STORE = process.env.WF_AXIS_STORE || join(homedir(), '.cache', 'wf', 'axis-store');
const REMOTE = process.env.WF_AXIS_REMOTE || 'https://github.com/aydenden/cc-plugins.git';
const REF = process.env.WF_AXIS_REF || 'refs/wf/axes';
// Local branch name inside the store; the remote side is REF.
const BRANCH = 'axes';
const TEMPLATES = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'templates', 'axis-store');
const TRACKING = `refs/remotes/origin/${BRANCH}`;

const USAGE = `usage: axis-sync.mjs <command> [args]
  path                  print the local store path
  pull                  create or fast-forward the store from the remote ref
  list                  list the domains the store holds
  show <domain>         print one domain file as stored
  resolve <domain>      print the domain with \`extends\` merged in (child wins on id)
  ids <domain>          print resolved axis ids, one per line
  retired <domain>      print retired axis ids and why they were dropped
  push "<message>"      commit local store changes and publish them to the ref
  init                  seed the store and create the ref (first time only)
`;

/** A failure the caller can act on: reported as one line, exit 1. */
class Failure extends Error {}

const say = (line) => process.stdout.write(`${line}\n`);
const fail = (message) => {
  throw new Failure(message);
};

/** Runs git inside the store. git's own stderr is shown unless `quiet`. */
function git(args, { quiet = false } = {}) {
  const done = spawnSync('git', ['-C', STORE, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', quiet ? 'ignore' : 'inherit'] });
  if (done.error) fail(`could not run git: ${done.error.message}`);
  return { ok: done.status === 0, stdout: done.stdout };
}

const must = (args, message) => git(args).ok || fail(message);
const haveStore = () => existsSync(join(STORE, '.git'));
const requireStore = () => haveStore() || fail(`store not found at ${STORE} — run: axis-sync.mjs pull`);
const remoteHasRef = () => spawnSync('git', ['ls-remote', '--exit-code', REMOTE, REF], { stdio: 'ignore' }).status === 0;
const expectArgs = (args, count, usage) => args.length === count || fail(`usage: axis-sync.mjs ${usage}`);

/** Domain names in the store, sorted. */
function domainNames() {
  const folder = join(STORE, 'axes');
  if (!existsSync(folder)) return [];
  return readdirSync(folder).filter(isDomainFile).map((name) => basename(name, '.json')).sort();
}

function domainPath(name) {
  requireStore();
  const path = join(STORE, 'axes', `${name}.json`);
  if (!existsSync(path)) fail(`no such domain: ${name} (see: axis-sync.mjs list)`);
  return path;
}

const readDomain = (path) => JSON.parse(readFileSync(path, 'utf8'));

function resolved(name) {
  const child = readDomain(domainPath(name));
  const parents = (child.extends ?? []).map((parent) => {
    const path = join(STORE, 'axes', `${parent}.json`);
    if (!existsSync(path)) fail(`${name} extends '${parent}' which does not exist`);
    return readDomain(path);
  });
  return resolveDomain(child, parents);
}

const COMMANDS = {
  path(args) {
    expectArgs(args, 0, 'path');
    say(STORE);
  },

  pull(args) {
    expectArgs(args, 0, 'pull');
    if (!remoteHasRef()) fail(`${REF} does not exist on ${REMOTE} — run: axis-sync.mjs init`);
    if (!haveStore()) {
      mkdirSync(STORE, { recursive: true });
      must(['init', '--quiet'], 'init failed');
      must(['remote', 'add', 'origin', REMOTE], 'remote add failed');
    }
    must(['fetch', '--quiet', 'origin', `+${REF}:${TRACKING}`], 'fetch failed');
    if (git(['rev-parse', '--verify', '--quiet', BRANCH], { quiet: true }).ok) {
      if (git(['status', '--porcelain']).stdout.trim() !== '') {
        say('axis-sync: local changes present, not fast-forwarding. Publish them with: axis-sync.mjs push "<message>"');
        process.stdout.write(git(['status', '--short']).stdout);
        return 1;
      }
      if (!git(['merge', '--ff-only', TRACKING], { quiet: true }).ok) {
        fail(`local store and the remote ref diverged — resolve by hand in ${STORE}`);
      }
    } else {
      must(['checkout', '--quiet', '-b', BRANCH, TRACKING], 'checkout failed');
    }
    say(`axis-sync: store up to date at ${STORE} (${domainNames().length} domains)`);
  },

  list(args) {
    expectArgs(args, 0, 'list');
    requireStore();
    const names = domainNames();
    if (names.length === 0) return say('axis-sync: no domains yet');
    names.forEach((name) => say(listLine(name, readDomain(join(STORE, 'axes', `${name}.json`)).description)));
  },

  show(args) {
    expectArgs(args, 1, 'show <domain>');
    process.stdout.write(readFileSync(domainPath(args[0]), 'utf8'));
  },

  resolve(args) {
    expectArgs(args, 1, 'resolve <domain>');
    say(JSON.stringify(resolved(args[0]), null, 2));
  },

  ids(args) {
    expectArgs(args, 1, 'ids <domain>');
    resolved(args[0]).axes.forEach((axis) => say(axis.id));
  },

  // Read before adding an axis: an axis dropped once for a reason should not quietly return.
  retired(args) {
    expectArgs(args, 1, 'retired <domain>');
    retiredLines(resolved(args[0])).forEach(say);
  },

  push(args) {
    expectArgs(args, 1, 'push "<message>"');
    requireStore();
    if (git(['status', '--porcelain']).stdout.trim() !== '') {
      must(['add', '-A'], 'add failed');
      must(['commit', '--quiet', '-m', args[0]], 'commit failed');
    } else if (git(['rev-parse', 'HEAD']).stdout === git(['rev-parse', TRACKING], { quiet: true }).stdout) {
      return say('axis-sync: nothing to push');
    }
    if (!git(['push', '--quiet', 'origin', `HEAD:${REF}`]).ok) {
      process.stderr.write(`axis-sync: push rejected — the ref moved. Run: git -C "${STORE}" pull --rebase origin "${REF}"\n`);
      return 1;
    }
    git(['fetch', '--quiet', 'origin', `+${REF}:${TRACKING}`]);
    say(`axis-sync: published to ${REF}`);
  },

  // One-time bootstrap. Builds the store from the templates shipped with the plugin and leaves
  // publishing to the caller — this writes to the remote, so it is never implicit.
  init(args) {
    expectArgs(args, 0, 'init');
    if (haveStore()) fail(`store already exists at ${STORE} — run: axis-sync.mjs pull`);
    if (remoteHasRef()) fail(`${REF} already exists on ${REMOTE} — run: axis-sync.mjs pull`);
    if (!existsSync(TEMPLATES)) fail(`templates not found at ${TEMPLATES}`);
    mkdirSync(join(STORE, 'axes'), { recursive: true });
    must(['init', '--quiet', `--initial-branch=${BRANCH}`], 'init failed');
    must(['remote', 'add', 'origin', REMOTE], 'remote add failed');
    copyFileSync(join(TEMPLATES, 'README.md'), join(STORE, 'README.md'));
    copyFileSync(join(TEMPLATES, '_schema.json'), join(STORE, 'axes', '_schema.json'));
    readdirSync(TEMPLATES)
      .filter((name) => name.endsWith('.axes.json'))
      .forEach((name) => copyFileSync(join(TEMPLATES, name), join(STORE, 'axes', `${basename(name, '.axes.json')}.json`)));
    must(['add', '-A'], 'add failed');
    must(['commit', '--quiet', '-m', 'chore(axis): seed the domain axis store'], 'commit failed');
    say(`axis-sync: store seeded at ${STORE} (${domainNames().length} domains)`);
    say(`  publish it:  axis-sync.mjs push "<message>"  # or: git -C "${STORE}" push origin "HEAD:${REF}"`);
  },
};

function main([command, ...args]) {
  if (command === undefined) {
    process.stdout.write(USAGE);
    return 2;
  }
  if (['-h', '--help', 'help'].includes(command)) {
    process.stdout.write(USAGE);
    return 0;
  }
  if (!Object.hasOwn(COMMANDS, command)) fail(`unknown command: ${command}`);
  return COMMANDS[command](args) === 1 ? 1 : 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  process.stderr.write(`axis-sync: ${error.message}\n`);
  process.exitCode = 1;
}
