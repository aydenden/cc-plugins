import assert from 'node:assert/strict';
import test from 'node:test';

import { ancestors, candidates, invokeName, isGated, render } from '../scripts/lib/skill-locate.mjs';

const env = {
  cwd: '/home/u/work/repo/pkg',
  home: '/home/u',
  plugins: [
    { key: 'mattpocock-skills@mattpocock', installPath: '/home/u/.claude/plugins/cache/mattpocock/mattpocock-skills/1.0.0' },
    { key: 'pstack@cursor-plugins', installPath: '/home/u/.claude/plugins/cache/cursor-plugins/pstack/0.15.36' },
  ],
};

test('가까운 scope 가 먼저다 — 프로젝트, 개인, agents, 그 뒤에 플러그인 설치본', () => {
  const got = candidates('handoff', env).map((c) => c.origin);
  assert.deepEqual(got, [
    'project', 'project', 'project', 'project', 'project',
    'personal', 'agents',
    'plugin:mattpocock-skills@mattpocock', 'plugin:pstack@cursor-plugins',
  ]);
  assert.equal(candidates('handoff', env)[0].path, '/home/u/work/repo/pkg/.claude/skills/handoff/SKILL.md');
});

// 홈의 .claude/skills 를 project 로 세면 같은 파일이 두 origin 으로 나오고, 보고가 scope 를 틀리게 적는다.
test('홈 디렉터리는 project 후보가 아니다', () => {
  const paths = candidates('handoff', env).filter((c) => c.origin === 'project').map((c) => c.path);
  assert.ok(!paths.includes('/home/u/.claude/skills/handoff/SKILL.md'));
  assert.equal(candidates('handoff', env).find((c) => c.origin === 'personal').path, '/home/u/.claude/skills/handoff/SKILL.md');
});

test('plugin:skill 꼴은 그 플러그인의 설치본만 본다', () => {
  const got = candidates('pstack:correct', env);
  assert.deepEqual(got, [{
    origin: 'plugin:pstack@cursor-plugins',
    path: '/home/u/.claude/plugins/cache/cursor-plugins/pstack/0.15.36/skills/correct/SKILL.md',
  }]);
  assert.deepEqual(candidates('nope:correct', env), []);
});

test('설치 기록이 없어도 개인·프로젝트 자리는 찾는다', () => {
  const got = candidates('handoff', { cwd: '/w', home: '/home/u' }).map((c) => c.origin);
  assert.deepEqual(got, ['project', 'project', 'personal', 'agents']);
});

test('ancestors 는 cwd 에서 루트까지다', () => {
  assert.deepEqual(ancestors('/a/b/c'), ['/a/b/c', '/a/b', '/a', '/']);
});

test('모델 호출 차단은 frontmatter 에서만 읽는다', () => {
  assert.equal(isGated('---\nname: handoff\ndisable-model-invocation: true\n---\n본문'), true);
  assert.equal(isGated('---\nname: tdd\ndescription: x\n---\n본문'), false);
  assert.equal(isGated('---\nname: x\ndisable-model-invocation: false\n---\n'), false);
  // 본문에서 그 필드를 설명하는 스킬을 막힌 것으로 읽으면, 부를 수 있는 스킬을 파일로 읽게 된다.
  assert.equal(isGated('---\nname: x\n---\n\ndisable-model-invocation: true\n'), false);
  assert.equal(isGated('frontmatter 없음'), false);
  assert.equal(isGated('---\r\nname: x\r\ndisable-model-invocation: true\r\n---\r\n'), true);
});

test('플러그인 스킬의 호출 이름은 plugin:skill 이다', () => {
  assert.equal(invokeName('tdd', 'personal'), 'tdd');
  assert.equal(invokeName('tdd', 'plugin:mattpocock-skills@mattpocock'), 'mattpocock-skills:tdd');
  assert.equal(invokeName('pstack:correct', 'plugin:pstack@cursor-plugins'), 'pstack:correct');
});

// 🚨 막힌 스킬에 Skill 호출을 지시하면 하네스가 거부하고 «다른 수단으로 재현하지 말라»고 덧붙인다.
test('막힌 스킬은 Read 로, 열린 스킬은 Skill 도구로 쓰라고 적는다', () => {
  const gated = render('handoff', { origin: 'agents', path: '/p/SKILL.md', gated: true });
  assert.match(gated, /^FOUND skill=handoff\npath: \/p\/SKILL\.md\norigin: agents\nuse: Read/);
  assert.match(gated, /Skill 도구로 부르지 않는다/);

  const open = render('tdd', { origin: 'plugin:mattpocock-skills@mattpocock', path: '/q/SKILL.md', gated: false });
  assert.match(open, /\nuse: Skill — Skill 도구를 "mattpocock-skills:tdd" 로 호출한다$/);
});

test('없으면 MISSING 과 설치 방법을 낸다', () => {
  assert.equal(render('handoff', null, '/setup-matt-pocock-skills'), 'MISSING skill=handoff\ninstall: /setup-matt-pocock-skills');
  assert.match(render('handoff', null), /^MISSING skill=handoff\ninstall: \(설치 방법이/);
});

// mattpocock-skills 플러그인은 skills/engineering/tdd 처럼 분류 폴더 아래에 스킬을 둔다.
test('분류 폴더 아래의 플러그인 스킬도 후보다', () => {
  const plugins = [{ key: 'mattpocock-skills@mattpocock', installPath: '/c/m', categories: ['engineering', 'productivity'] }];
  const got = candidates('mattpocock-skills:handoff', { cwd: '/w', home: '/home/u', plugins }).map((c) => c.path);
  assert.deepEqual(got, [
    '/c/m/skills/handoff/SKILL.md',
    '/c/m/skills/engineering/handoff/SKILL.md',
    '/c/m/skills/productivity/handoff/SKILL.md',
  ]);
});

// 🚨 wf 가 맨이름 retro 를 물었을 때 자기 스킬 wf:retro 가 나오면, 범위 밖 일을 자기에게 되넘긴다.
test('묻는 쪽 플러그인의 스킬은 후보가 아니다', () => {
  const plugins = [
    { key: 'wf@aydenden-plugins', installPath: '/c/wf' },
    { key: 'other@mp', installPath: '/c/other' },
  ];
  const got = candidates('retro', { cwd: '/w', home: '/home/u', plugins, self: 'wf' }).filter((c) => c.origin.startsWith('plugin:'));
  assert.deepEqual(got, [{ origin: 'plugin:other@mp', path: '/c/other/skills/retro/SKILL.md' }]);
  // 이름을 짚어 물으면 자기 것도 답한다 — 그때는 실수가 아니라 요청이다.
  assert.equal(candidates('wf:retro', { cwd: '/w', home: '/home/u', plugins, self: 'wf' }).length, 1);
});

// mattpocock-skills 설치본에는 skills/in-progress/ 도 실려 오지만 매니페스트에 없어 그 이름으로 못 부른다.
test('매니페스트가 스킬을 등록했으면 등록된 것만 후보다', () => {
  const plugins = [{
    key: 'mattpocock-skills@mattpocock', installPath: '/c/m', categories: ['engineering', 'in-progress'],
    skillDirs: ['/c/m/skills/engineering/tdd', '/c/m/skills/productivity/handoff'],
  }];
  const where = { cwd: '/w', home: '/home/u', plugins };
  assert.deepEqual(candidates('mattpocock-skills:handoff', where), [
    { origin: 'plugin:mattpocock-skills@mattpocock', path: '/c/m/skills/productivity/handoff/SKILL.md' },
  ]);
  assert.deepEqual(candidates('mattpocock-skills:loop-me', where), []);
});
