#!/usr/bin/env node
/**
 * 남의 스킬이 이 기기 어디에 설치돼 있는지 찾아, 스킬 본문에 주입할 블록을 출력한다.
 *
 * 스킬 본문의 `` !`node …/resolve-skill.mjs <이름>` `` 자리에서 돈다 — 스킬이 로드될 때 한 번이고,
 * 그 스킬을 쓰지 않는 세션에는 비용이 없다.
 *
 * 사용법:
 *   node resolve-skill.mjs <스킬이름 | plugin:스킬이름> [--from <플러그인>] [--install "<없을 때 알릴 설치 방법>"]
 *
 * --from 은 그 스킬을 내는 플러그인이다. 맨이름은 복사본(프로젝트·개인)을 먼저 찾고, 플러그인 설치본은
 * 그 플러그인 것만 본다 — 같은 이름의 스킬을 여러 플러그인이 낼 때 엉뚱한 것을 집지 않는다.
 *
 * 종료코드: 항상 0. 못 찾은 것은 보고할 사실이지 부른 스킬의 실패가 아니다 — 0 이 아니면 주입이
 * 깨져 본문이 통째로 못 쓰게 된다. 설치 기록을 못 읽어도 개인·프로젝트 자리는 계속 찾는다.
 *
 * 원본은 저장소의 `shared/scripts/` 다. 플러그인 안의 이 파일은 사본이므로 고치지 않는다 —
 * `node shared/sync.mjs` 가 다시 쓰고, 테스트가 원본과 같은지 본다.
 */

import { fileURLToPath } from 'node:url';

import { locate, ownPluginName } from './lib/skill-locate-file.mjs';
import { render } from './lib/skill-locate.mjs';

const argv = process.argv.slice(2);
const name = argv[0] && !argv[0].startsWith('--') ? argv[0] : '';
const hintAt = argv.indexOf('--install');
const hint = hintAt >= 0 ? argv[hintAt + 1] : '';
const fromAt = argv.indexOf('--from');
const from = fromAt >= 0 ? argv[fromAt + 1] : '';

if (!name) {
  process.stdout.write(`${render('(이름 없음)', null, 'resolve-skill.mjs 에 스킬 이름을 넘긴다')}\n`);
} else {
  const hit = locate(name, { from, self: ownPluginName(fileURLToPath(import.meta.url)) });
  process.stdout.write(`${render(name, hit, hint)}\n`);
}
