/**
 * bd `--json` 출력을 이 플러그인의 내부 꼴 하나로 맞추고, 못 맞추면 그렇다고 말한다.
 *
 * 판정 로직(`guard-core`·`gate`·`delegation`)은 내부 꼴만 본다. bd 의 출력은 버전과 명령마다 다르다 —
 * 같은 1.3.4 에서도 `bd list` 의 의존은 `{depends_on_id, type}` 이고 `bd show` 의 의존은 대상 issue 를
 * 펼친 `{id, …, dependency_type}` 다(실측). 그 차이를 아는 곳은 여기 하나다.
 *
 * 🚨 **모르는 꼴을 추측으로 메우지 않는다.** 칸이 비면 판정은 오류 없이 «의존 없음» 으로 읽고, 모든 질문이
 * 범위 없음이 되어 맵 전체가 선다(bd 1.3.2 에서 겪었다). 그래서 읽어야 할 칸이 없으면 `gaps` 로 돌려주고,
 * 호출자가 그 조회를 «모름» 으로 떨어뜨린다.
 *
 * `bd schema`(1.3.0~)는 설치된 bd 의 직렬화 구조체에서 뽑은 JSON Schema 다. 칸의 이름만 있고 뜻은 없어
 * 바뀐 이름을 자동으로 잇지는 못한다 — 대신 이 bd 에 무슨 칸이 빠졌는지를 claim 시점에 이름으로 말한다.
 */

/** 이 플러그인이 bd 레코드에서 읽는 칸. `bd schema` 의 타입 이름 아래 있어야 한다. */
export const SCHEMA_FIELDS = {
  issue: ['id', 'title', 'status', 'labels', 'dependencies', 'created_at', 'closed_at', 'close_reason'],
  dependency: ['depends_on_id', 'type'],
};

const ISSUE_COMMANDS = new Set(['show', 'ready', 'list']);

const isText = (value) => typeof value === 'string';

/** issue 목록. 배열·`{issues: [...]}`·객체 하나를 배열로. 모르는 꼴이면 `null`. */
function issueRowsOf(json) {
  if (Array.isArray(json)) return json;
  if (Array.isArray(json?.issues)) return json.issues;
  if (json && typeof json === 'object' && isText(json.id)) return [json];
  return null;
}

/**
 * 의존 한 칸을 `{depends_on_id, type}` 로. `bd show` 는 대상 issue 를 펼쳐 `id` 가 대상이고 종류가
 * `dependency_type` 이다 — `dependency_type` 이 있을 때만 `id` 를 대상으로 읽는다.
 *
 * @param {object} dep
 * @returns {object}
 */
export function normalizeDependency(dep) {
  if (!dep || typeof dep !== 'object') return dep;
  const showForm = dep.dependency_type !== undefined;
  return {
    ...dep,
    depends_on_id: dep.depends_on_id ?? (showForm ? dep.id : undefined),
    type: dep.type ?? dep.dependency_type,
  };
}

function issueGaps(row) {
  const gaps = [];
  if (!isText(row?.id)) gaps.push('issue.id');
  if (!isText(row?.status)) gaps.push('issue.status');
  if (row?.labels !== undefined && row.labels !== null && !Array.isArray(row.labels)) gaps.push('issue.labels(배열이 아니다)');
  if (row?.dependencies !== undefined && row.dependencies !== null && !Array.isArray(row.dependencies)) gaps.push('issue.dependencies(배열이 아니다)');
  for (const dep of Array.isArray(row?.dependencies) ? row.dependencies : []) {
    if (!isText(dep?.depends_on_id)) gaps.push('dependency.depends_on_id');
    if (!isText(dep?.type)) gaps.push('dependency.type');
  }
  return gaps;
}

/**
 * bd 명령 하나의 `--json` 출력을 내부 꼴로.
 *
 * @param {string[]} args bd 인자(`--json` 제외). 첫 칸이 하위 명령이다
 * @param {unknown} json 파싱한 출력
 * @returns {{rows: unknown, gaps?: undefined} | {gaps: string[]}} 맞췄으면 `rows`, 못 맞췄으면 빠진 칸
 */
export function normalizeBdOutput(args, json) {
  const sub = args[0];
  if (sub === 'comments') {
    if (!Array.isArray(json)) return { gaps: ['comment 목록(배열이 아니다)'] };
    const rows = json.map((c) => ({ ...c, text: c?.text ?? c?.body }));
    const gaps = rows.flatMap((c) => [...(isText(c.text) ? [] : ['comment.text']), ...(isText(c.created_at) ? [] : ['comment.created_at'])]);
    return gaps.length ? { gaps: [...new Set(gaps)] } : { rows };
  }
  if (!ISSUE_COMMANDS.has(sub)) return { rows: json };
  const listed = issueRowsOf(json);
  if (!listed) return { gaps: ['issue 목록(배열이 아니다)'] };
  const rows = listed.map((row) => (Array.isArray(row?.dependencies) ? { ...row, dependencies: row.dependencies.map(normalizeDependency) } : row));
  const gaps = [...new Set(rows.flatMap(issueGaps))];
  return gaps.length ? { gaps } : { rows };
}

/** `bd version` 출력의 버전. 못 읽으면 `null`. */
export function versionOf(text) {
  return String(text ?? '').match(/\d+\.\d+\.\d+[^\s)]*/)?.[0] ?? null;
}

/**
 * 이 bd 의 schema 에 없는, 이 플러그인이 읽는 칸.
 *
 * @param {{types?: Record<string, {properties?: object}>} | null} schema `bd schema` 출력
 * @returns {string[] | null} schema 가 없으면(1.3.0 미만·실패) `null` — 통과가 아니라 «모름» 이다
 */
export function schemaGaps(schema, fields = SCHEMA_FIELDS) {
  const types = schema?.types;
  if (!types || typeof types !== 'object') return null;
  const gaps = [];
  for (const [type, names] of Object.entries(fields)) {
    const props = types[type]?.properties;
    if (!props) gaps.push(`${type}(타입이 없다)`);
    else for (const name of names) if (!(name in props)) gaps.push(`${type}.${name}`);
  }
  return gaps;
}

/** 빠진 칸을 사람이 고칠 수 있게 — 그 타입에 지금 있는 칸까지 함께 말한다. */
export function shapeMessage({ version, gaps, schema }) {
  const types = [...new Set(gaps.map((g) => g.split(/[.(]/)[0]))];
  const present = types
    .map((type) => {
      const props = schema?.types?.[type]?.properties;
      return props ? ` 이 bd 의 ${type} 칸: ${Object.keys(props).join(', ')}.` : '';
    })
    .join('');
  return (
    `bd ${version ?? '(버전 모름)'} 의 출력에 long-run 이 읽는 칸이 없다: ${gaps.join(', ')}.${present} ` +
    '이대로 밀면 가드가 의존·질문을 틀리게 읽는다 — long-run 의 scripts/lib/bd-shape.mjs 에 이 꼴의 대응을 더하거나 bd 를 바꾼다.'
  );
}
