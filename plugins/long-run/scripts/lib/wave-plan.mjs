/**
 * 웨이브 계획 — 티켓 목록을 하위 worktree 워커들의 worker-start 인자로 바꾼다. 파일·프로세스를 만지지
 * 않는다(`wave-start.mjs` 가 주입받은 I/O 로 실행한다).
 */

/** 티켓의 하위 worktree 이름. git 브랜치·폴더 이름이 되므로 영숫자와 `-` 만 남긴다. */
export const worktreeNameOf = (ticketId) => `wave-${String(ticketId).replace(/[^A-Za-z0-9-]+/g, '-')}`;

/**
 * 워커 worktree 가 갈라질 base 브랜치. 🚨 지정이 없으면 orca 는 저장소 기본 base(origin 기본 브랜치)에서
 * 가른다 — 로컬 base 가 앞서 있으면 워커가 낡은 코드에서 일하므로 base 의 지금 브랜치를 명시한다.
 *
 * @param {{flag?: string, head?: string}} input `head` 는 `git rev-parse --abbrev-ref HEAD` 출력
 */
export function baseBranchOf({ flag, head }) {
  if (flag) return String(flag);
  const branch = String(head ?? '').trim();
  if (!branch || branch === 'HEAD') {
    throw new Error('base 가 브랜치에 있지 않다(detached) — 워커가 갈라질 지점을 --base-branch <ref> 로 지정한다.');
  }
  return branch;
}

/**
 * 워커에게 보내는 과업 명세. 워커는 bd 를 못 읽으므로(하위 worktree 엔 맵 DB 설정이 없다) 티켓 본문·완료
 * 조건·노트를 여기 다 싣는다. 합치는 것은 코디네이터라서 워커는 자기 브랜치에 커밋만 한다.
 */
export function specOf({ ticket, baseBranch }) {
  const acceptance = ticket.acceptance_criteria?.trim() || '위 본문에 적힌 완료 조건.';
  const notes = ticket.notes?.trim();
  return [
    `[웨이브 워커] 티켓 ${ticket.id}: ${ticket.title ?? ''}`,
    '',
    '## 대상',
    `이 worktree 안의 파일(${baseBranch} 에서 갈라진 브랜치). 범위는 아래 본문이 정한다.`,
    '',
    '## 변경',
    ticket.description?.trim() || '(본문 없음)',
    '',
    '## 완료 조건',
    acceptance,
    ...(notes ? ['', '## 노트', notes] : []),
    '',
    '## 제약',
    '- bd 를 쓰지 않는다 — 이 worktree 에는 맵 DB 가 없다. 티켓은 이 명세가 전부다.',
    '- 이 worktree 밖의 파일과 다른 워커의 worktree 를 건드리지 않는다.',
    '- 결과는 이 worktree 의 브랜치에 저장소의 커밋 규약대로 커밋한다. push·merge·rebase 하지 않는다 — base 에 합치는 것은 코디네이터다.',
    '- 완료 조건으로 판정이 서지 않는 선택을 만나면 추측하지 말고 orchestration ask 로 묻는다.',
    '',
    '## 보고',
    'worker_done 본문에 커밋 해시, 바뀐 파일, 돌린 검증 명령과 그 결과 요지를 적는다. 완료 조건을 못 채웠으면 --outcome failed 로 보낸다.',
  ].join('\n');
}

/** 한 워커의 `orca orchestration worker-start` 인자(`--json` 은 어댑터가 붙인다). */
export function workerStartArgs({ name, spec, title, baseBranch, runId, agent, model }) {
  return [
    'orchestration', 'worker-start',
    '--spec', spec,
    '--task-title', title,
    '--worktree', 'new-child',
    '--name', name,
    '--base-branch', baseBranch,
    '--agent', agent,
    ...(model ? ['--model', String(model)] : []),
    ...(runId ? ['--run', runId] : []),
  ];
}

/**
 * base 의 `.git/info/exclude` 에 덧붙일 줄. orca 는 new-child worktree 를 base 디렉터리 안에 만들어,
 * 가리지 않으면 base 의 `git status` 에 `?? <이름>/` 로 잡히고 `git add -A` 가 워커 체크아웃을 쓸어 담는다.
 *
 * @returns {string} 덧붙일 텍스트. 이미 있으면 빈 문자열
 */
export function excludeAddition(existing, name) {
  const line = `/${name}/`;
  const text = String(existing ?? '');
  if (text.split(/\r?\n/).includes(line)) return '';
  return `${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`;
}

/**
 * 웨이브 계획. Run id 는 아직 없을 수 있다 — 실행이 Run 을 정한 뒤 인자에 붙인다.
 *
 * @param {{epic: string, tickets: object[], baseBranch: string, agent: string, model?: string, runId?: string}} input
 */
export function planWave({ epic, tickets, baseBranch, agent, model, runId }) {
  if (!tickets.length) throw new Error('웨이브에 넣을 티켓이 없다 — 승인받은 티켓 id 를 하나 이상 준다.');
  const ids = tickets.map((t) => t.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) throw new Error(`${dup} 가 중복됐다 — 한 티켓에 워커 둘을 띄우지 않는다.`);
  const closed = tickets.filter((t) => t.status === 'closed').map((t) => t.id);
  if (closed.length) throw new Error(`닫힌 티켓이 섞였다(${closed.join(', ')}) — 끝난 일을 워커에게 다시 시키지 않는다.`);
  return {
    objective: `${epic} 웨이브: ${ids.join(', ')}`,
    baseBranch,
    workers: tickets.map((ticket) => {
      const name = worktreeNameOf(ticket.id);
      const spec = specOf({ ticket, baseBranch });
      const title = `${ticket.id}: ${ticket.title ?? ''}`.trim();
      return { ticket: ticket.id, name, spec, args: workerStartArgs({ name, spec, title, baseBranch, runId, agent, model }) };
    }),
  };
}
