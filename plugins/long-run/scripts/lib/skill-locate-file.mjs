/**
 * skill-locate 의 파일 어댑터 — 설치 기록과 플러그인 매니페스트를 읽어, 실제로 있는 첫 후보를 낸다.
 *
 * 원본은 저장소의 `shared/scripts/` 다. 플러그인 안의 이 파일은 사본이므로 고치지 않는다 —
 * `node shared/sync.mjs` 가 다시 쓰고, 테스트가 원본과 같은지 본다.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { candidates, invokeName, isGated } from './skill-locate.mjs';

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** 그 플러그인의 skills/ 바로 아래 폴더 이름. 폴더가 없으면 빈 목록. */
function skillFolders(installPath) {
  try {
    return fs.readdirSync(path.join(installPath, 'skills'), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/** 매니페스트가 `skills` 로 등록한 스킬 폴더의 절대경로. 등록 목록이 없으면 null — 그때는 폴더를 훑는다. */
function registeredSkillDirs(installPath) {
  const manifest = readJson(path.join(installPath, '.claude-plugin', 'plugin.json'));
  const listed = manifest?.skills;
  if (!Array.isArray(listed)) return null;
  return listed.filter((entry) => typeof entry === 'string').map((entry) => path.resolve(installPath, entry));
}

/**
 * installed_plugins.json 의 설치 기록. 없거나 깨졌으면 빈 목록 — 플러그인 자리만 건너뛴다.
 * @param {string} home 홈 디렉터리
 * @returns {Array<{key: string, installPath: string, categories: string[], skillDirs: string[] | null}>}
 */
export function readPlugins(home) {
  const data = readJson(path.join(home, '.claude', 'plugins', 'installed_plugins.json'));
  if (!data) return [];
  return Object.entries(data.plugins ?? data).flatMap(([key, records]) =>
    [].concat(records)
      .filter((r) => r?.installPath)
      .map((r) => ({
        key,
        installPath: r.installPath,
        categories: skillFolders(r.installPath),
        skillDirs: registeredSkillDirs(r.installPath),
      })),
  );
}

/**
 * 스크립트를 실은 플러그인의 이름 — scripts/ 의 부모가 플러그인 루트다. 못 읽으면 빈 문자열.
 * @param {string} scriptFile 그 플러그인의 scripts/ 바로 아래에 있는 파일의 절대경로
 */
export function ownPluginName(scriptFile) {
  const root = path.dirname(path.dirname(scriptFile));
  return readJson(path.join(root, '.claude-plugin', 'plugin.json'))?.name ?? '';
}

/**
 * 이 기기에서 그 스킬을 찾는다.
 * @param {string} name 스킬 이름 또는 `plugin:skill`
 * @param {{cwd?: string, home?: string, self?: string}} [where] self 는 묻는 쪽 플러그인의 이름
 * @returns {{origin: string, path: string, gated: boolean, invoke: string} | null}
 *   invoke 는 Skill 도구와 슬래시 명령에 쓰는 이름
 */
export function locate(name, { cwd = process.cwd(), home = os.homedir(), self = '' } = {}) {
  const env = { cwd, home, self, plugins: readPlugins(home) };
  const found = candidates(name, env).find((c) => fs.existsSync(c.path));
  if (!found) return null;
  return { ...found, gated: isGated(fs.readFileSync(found.path, 'utf8')), invoke: invokeName(name, found.origin) };
}
