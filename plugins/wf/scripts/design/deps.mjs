/**
 * What wf depends on and how the report about it reads. Pure: what is installed comes in as a probe.
 *
 * Design-time only — not copied into generated plugins, which is why it is not under `lib/`.
 */

const REQUIRED_TOOLS = [
  { command: 'bd', present: 'bd (beads)', absent: 'bd (beads)', install: 'brew install beads' },
  { command: 'git', present: 'git', absent: 'git', install: 'brew install git' },
  // The hooks of every generated plugin are node scripts; without node no check runs.
  { command: 'node', present: 'node (생성물의 검사 hook 런타임)', absent: 'node', install: 'brew install node' },
];

const REQUIRED_PLUGINS = [
  { plugin: 'plugin-dev', present: 'plugin-dev (create-plugin 인계 대상)', absent: 'plugin-dev', install: '/plugin marketplace add anthropics/claude-plugins-official → plugin-dev 설치' },
  { plugin: 'beads', present: 'beads 플러그인 (SessionStart bd prime 훅)', absent: 'beads 플러그인', install: '/plugin marketplace add steveyegge/beads → beads 설치' },
  { plugin: 'long-run', present: 'long-run (여러 세션 실행·세션 이관)', absent: 'long-run', install: '/plugin install long-run@<wf 를 설치한 마켓플레이스>' },
];

const OPTIONAL_TOOLS = [
  { command: 'orca', present: 'orca (세션 스폰·워크트리)', absent: 'orca', install: 'brew install --cask stablyai/orca/orca' },
  { command: 'agent-browser', present: 'agent-browser (웹 검증)', absent: 'agent-browser', install: 'brew install agent-browser' },
  { command: 'npx', present: 'npx (스킬 레지스트리 조사)', absent: 'npx', install: 'brew install node' },
];

// Their skills are all model-gated; a seam skill reads them by path (stage-patterns.md, 경로 주입).
const OPTIONAL_PLUGINS = [
  { plugin: 'pstack', present: 'pstack (반복 실수의 강제 장치화·영향 범위·성능 수치 검증)', absent: 'pstack', install: 'claude plugin marketplace add cursor/plugins 후 claude plugin install pstack@cursor-plugins' },
];

const RESEARCH_SKILLS = [
  { skill: 'find-skills', repo: 'vercel-labs/skills' },
  { skill: 'agent-browser', repo: 'vercel-labs/agent-browser' },
];

// Installed as a plugin, so its skills answer to `mattpocock-skills:<name>`; a copy made with
// `npx skills add` answers to the bare name. The report prints whichever this machine has.
const DELEGATE_INSTALL = 'claude plugin marketplace add mattpocock/skills 후 claude plugin install mattpocock-skills@mattpocock';
const DELEGATE_SKILLS = [
  'grill-with-docs', 'to-spec', 'to-tickets', 'implement', 'tdd', 'code-review',
  'diagnosing-bugs', 'triage', 'handoff', 'prototype', 'wayfinder', 'domain-modeling', 'research',
];

/**
 * Names of the installed plugins, from the text of `installed_plugins.json`.
 * Its keys are `<plugin>@<marketplace>`. The marketplace name is the installer's choice, so only the
 * plugin name counts. A marketplace directory is not evidence: adding a marketplace installs nothing.
 *
 * @param {string|null} text file content, or null when the file does not exist
 * @returns {Set<string>}
 */
export function installedPlugins(text) {
  if (text === null) return new Set();
  const keys = Object.keys(JSON.parse(text).plugins ?? {});
  return new Set(keys.filter((key) => key.includes('@')).map((key) => key.slice(0, key.lastIndexOf('@'))));
}

/**
 * The dependency report.
 *
 * @param {{command: (name: string) => boolean, skill: (name: string) => boolean, plugin: (name: string) => boolean,
 *   skillName?: (name: string) => string | null}} probe `skillName` gives the name the skill is invoked by, when known
 * @returns {{lines: string[], missingRequired: number}} `missingRequired` above 0 means a generated workflow would not run
 */
export function report(probe) {
  const lines = [];
  let missingRequired = 0;
  const required = (found, item) => {
    if (found) return lines.push(`  ✓ ${item.present}`);
    missingRequired += 1;
    return lines.push(`  ✗ ${item.absent} — 필수`, `      설치: ${item.install}`);
  };
  const optional = (found, item) =>
    found ? lines.push(`  ✓ ${item.present}`) : lines.push(`  · ${item.absent} — 없음 (해당 단계를 넣을 수 없다)`, `      설치: ${item.install}`);
  const invokedAs = (name) => probe.skillName?.(name) ?? (probe.skill(name) ? name : null);
  const present = (name, as) => (as === name ? `  ✓ ${name}` : `  ✓ ${name} — 부르는 이름: ${as}`);
  const skill = (name, repo) => {
    const as = invokedAs(name);
    lines.push(as ? present(name, as) : `  · ${name} — 없음 → npx skills add ${repo}@${name}`);
  };

  lines.push('필수 도구');
  REQUIRED_TOOLS.forEach((item) => required(probe.command(item.command), item));
  lines.push('', '필수 플러그인');
  REQUIRED_PLUGINS.forEach((item) => required(probe.plugin(item.plugin), item));
  lines.push('', '조건부 도구 — 없으면 해당 단계를 설계에서 뺀다');
  OPTIONAL_TOOLS.forEach((item) => optional(probe.command(item.command), item));
  lines.push('', '조건부 플러그인 — 없으면 그 판단을 위임하는 단계를 설계에서 뺀다');
  OPTIONAL_PLUGINS.forEach((item) => optional(probe.plugin(item.plugin), item));
  lines.push('', '조사·조작 스킬 — 설계 4단계(스킬 조사)와 브라우저 검증이 여기 기댄다');
  RESEARCH_SKILLS.forEach((item) => skill(item.skill, item.repo));
  lines.push('', '위임 대상 스킬 — 없으면 그 판단을 대신할 스킬을 조사해야 한다');
  const delegates = DELEGATE_SKILLS.map((name) => [name, invokedAs(name)]);
  delegates.forEach(([name, as]) => lines.push(as ? present(name, as) : `  · ${name} — 없음`));
  if (delegates.some(([, as]) => !as)) lines.push(`      설치: ${DELEGATE_INSTALL}`);
  lines.push('      생성물에는 여기 찍힌 「부르는 이름」을 적는다 — 설치 형태에 따라 이름이 다르다.');
  lines.push(
    '',
    missingRequired > 0
      ? `필수 항목 ${missingRequired}개가 없다. 설계를 진행하면 생성된 워크플로우가 실행되지 않는다.`
      : '필수 항목 충족. 조건부 항목의 유무는 어떤 단계를 넣을 수 있는지를 바꾼다.',
  );
  return { lines, missingRequired };
}
