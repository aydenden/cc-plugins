/**
 * 이 플러그인이 소유하지 않은 스킬이 어디 설치돼 있는지, 그리고 모델이 그것을 어떻게 써야 하는지.
 *
 * 남의 스킬을 복사해 오지 않기 위한 장치다 — 복사본은 원본이 나아져도 그대로 남는다. 대신 설치본을
 * 찾아 경로를 넘긴다. 찾는 순서는 Claude Code 가 같은 이름을 푸는 순서(가까운 scope 먼저)를 따르고,
 * 그 뒤에 플러그인 설치본을 본다.
 *
 * 여기는 판정만 한다. 파일은 `resolve-skill.mjs` 가 읽는다.
 *
 * 원본은 저장소의 `shared/scripts/` 다. 플러그인 안의 이 파일은 사본이므로 고치지 않는다 —
 * `node shared/sync.mjs` 가 다시 쓰고, 테스트가 원본과 같은지 본다.
 */

import path from 'node:path';

/**
 * cwd 에서 루트까지의 디렉터리. 프로젝트 스킬은 worktree 어느 깊이에서 불려도 찾아야 한다.
 * @param {string} cwd 절대경로
 * @returns {string[]} cwd 가 먼저, 루트가 마지막
 */
export function ancestors(cwd) {
  const out = [];
  let dir = path.resolve(cwd);
  for (;;) {
    out.push(dir);
    const up = path.dirname(dir);
    if (up === dir) return out;
    dir = up;
  }
}

/**
 * 스킬 이름이 놓일 수 있는 자리를 가까운 순서로 낸다.
 * @param {string} name 스킬 이름. `plugin:skill` 꼴이면 그 플러그인의 설치본만 본다
 * @param {{cwd: string, home: string, self?: string, from?: string,
 *   plugins: Array<{key: string, installPath: string, categories?: string[], skillDirs?: string[] | null}>}} env
 *   plugins 는 installed_plugins.json 의 기록(키는 `plugin@marketplace`)을 파일 순서대로.
 *   categories 는 그 플러그인의 `skills/` 바로 아래 폴더 이름 — 스킬을 분류 폴더에 넣는 플러그인이 있다.
 *   skillDirs 는 매니페스트가 등록한 스킬 폴더(절대경로). 있으면 그것만 후보다 — 설치본에 파일이 있어도
 *   등록하지 않은 스킬은 그 플러그인 이름으로 부를 수 없다.
 *   self 는 묻는 쪽 플러그인의 이름. 자기 스킬은 남의 스킬이 아니므로 후보에서 뺀다.
 *   from 은 그 스킬을 내는 플러그인의 이름. 맨이름으로 물어도 플러그인 후보는 그 플러그인으로 한정한다 —
 *   같은 이름의 스킬을 여러 플러그인이 낸다(tdd). 프로젝트·개인 자리는 from 과 무관하게 먼저 본다
 * @returns {Array<{origin: string, path: string}>} origin 은 project | personal | agents | plugin:<키>
 */
export function candidates(name, env) {
  const [pluginFilter, skill] = name.includes(':') ? name.split(':') : [null, name];
  const out = [];
  if (!pluginFilter) {
    for (const dir of ancestors(env.cwd)) {
      // 홈의 .claude/skills 는 personal 이다 — cwd 가 홈 아래라고 project 로 세지 않는다.
      if (dir === env.home) continue;
      out.push({ origin: 'project', path: path.join(dir, '.claude', 'skills', skill, 'SKILL.md') });
    }
    out.push({ origin: 'personal', path: path.join(env.home, '.claude', 'skills', skill, 'SKILL.md') });
    out.push({ origin: 'agents', path: path.join(env.home, '.agents', 'skills', skill, 'SKILL.md') });
  }
  for (const p of env.plugins ?? []) {
    const pluginName = p.key.split('@')[0];
    if (pluginFilter ? pluginFilter !== pluginName : pluginName === env.self) continue;
    if (!pluginFilter && env.from && env.from !== pluginName) continue;
    const origin = `plugin:${p.key}`;
    if (Array.isArray(p.skillDirs)) {
      for (const dir of p.skillDirs) {
        if (path.basename(dir) === skill) out.push({ origin, path: path.join(dir, 'SKILL.md') });
      }
      continue;
    }
    out.push({ origin, path: path.join(p.installPath, 'skills', skill, 'SKILL.md') });
    for (const category of p.categories ?? []) {
      if (category === skill) continue;
      out.push({ origin, path: path.join(p.installPath, 'skills', category, skill, 'SKILL.md') });
    }
  }
  return out;
}

/**
 * SKILL.md 가 모델 호출을 막아 두었는가. 막혀 있으면 Skill 도구 호출은 하네스가 거부한다.
 * @param {string} text SKILL.md 전문
 * @returns {boolean} frontmatter 에 `disable-model-invocation: true` 가 있으면 true
 */
export function isGated(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  return fm ? /^disable-model-invocation:\s*true\s*$/m.test(fm[1]) : false;
}

/**
 * 모델이 Skill 도구에 넘길 이름. 플러그인 스킬은 `plugin:skill` 로만 풀린다.
 * @param {string} name 요청한 이름
 * @param {string} origin candidates() 가 낸 origin
 * @returns {string} 호출 이름
 */
export function invokeName(name, origin) {
  const skill = name.split(':').pop();
  return origin.startsWith('plugin:') ? `${origin.slice('plugin:'.length).split('@')[0]}:${skill}` : skill;
}

/**
 * 스킬 본문에 주입할 블록. 첫 줄의 FOUND / MISSING 이 계약이다 — 본문의 지시가 그 낱말로 갈린다.
 * @param {string} name 요청한 이름
 * @param {{origin: string, path: string, gated: boolean} | null} hit 실제로 있는 첫 후보
 * @param {string} [installHint] 없을 때 사용자에게 알릴 설치 방법
 * @returns {string} 줄바꿈으로 끝나지 않는 블록
 */
export function render(name, hit, installHint) {
  if (!hit) {
    return [`MISSING skill=${name}`, `install: ${installHint || '(설치 방법이 주어지지 않았다)'}`].join('\n');
  }
  const how = hit.gated
    ? 'use: Read — 모델 호출이 막힌 스킬이다(disable-model-invocation). 위 path 를 Read 로 읽어 그 지시를 따른다. Skill 도구로 부르지 않는다'
    : `use: Skill — Skill 도구를 "${invokeName(name, hit.origin)}" 로 호출한다`;
  return [`FOUND skill=${name}`, `path: ${hit.path}`, `origin: ${hit.origin}`, how].join('\n');
}
