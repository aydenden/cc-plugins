#!/usr/bin/env node
/**
 * 남의 스킬이 이 기기 어디에 설치돼 있는지 찾아, 스킬 본문에 주입할 블록을 출력한다.
 *
 * 스킬 본문의 `` !`node …/resolve-skill.mjs <이름>` `` 자리에서 돈다 — 스킬이 로드될 때 한 번이고,
 * 그 스킬을 쓰지 않는 세션에는 비용이 없다.
 *
 * 사용법:
 *   node resolve-skill.mjs <스킬이름 | plugin:스킬이름> [--install "<없을 때 알릴 설치 방법>"]
 *
 * 종료코드: 항상 0. 못 찾은 것은 보고할 사실이지 부른 스킬의 실패가 아니다 — 0 이 아니면 주입이
 * 깨져 본문이 통째로 못 쓰게 된다. 설치 기록을 못 읽어도 개인·프로젝트 자리는 계속 찾는다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { candidates, isGated, render } from './lib/skill-locate.mjs';

/** installed_plugins.json 의 설치 기록. 없거나 깨졌으면 빈 목록 — 플러그인 자리만 건너뛴다. */
function readPlugins(home) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'plugins', 'installed_plugins.json'), 'utf8'));
    return Object.entries(data.plugins ?? data).flatMap(([key, records]) =>
      [].concat(records).filter((r) => r?.installPath).map((r) => ({ key, installPath: r.installPath })),
    );
  } catch {
    return [];
  }
}

const argv = process.argv.slice(2);
const name = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const hintAt = argv.indexOf('--install');
const hint = hintAt >= 0 ? argv[hintAt + 1] : '';

if (!name) {
  process.stdout.write(`${render('(이름 없음)', null, 'resolve-skill.mjs 에 스킬 이름을 넘긴다')}\n`);
} else {
  const home = os.homedir();
  const env = { cwd: process.cwd(), home, plugins: readPlugins(home) };
  const found = candidates(name, env).find((c) => fs.existsSync(c.path));
  const hit = found ? { ...found, gated: isGated(fs.readFileSync(found.path, 'utf8')) } : null;
  process.stdout.write(`${render(name, hit, hint)}\n`);
}
