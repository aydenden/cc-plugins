/**
 * memory-guard 순수 로직 — CC auto memory 인덱스(`MEMORY.md`)와 토픽 파일을 감사한다.
 *
 * 이 파일이 상수·판정의 유일한 정본이다. CC 훅(`hooks/*.mjs`)과 OpenCode 진입점
 * (`src/index.ts`)이 같은 코어를 import 하므로 한도가 갈라질 수 없다.
 *
 * 설계 원칙은 "불변과 관례를 가른다" 다.
 * - 불변: 하드캡(claude 실행파일에 박힌 상수), 인덱스만 매 세션 로드된다는 비용 구조,
 *   깨진 링크·고아 토픽·노후. 프로젝트 포맷과 무관하게 참이다 → 코드에 둔다.
 *   그래서 구조 판정은 헤더 포맷이 아니라 **링크와 문자열 언급**으로 한다. `## x.md — desc`
 *   같은 특정 인덱스 관례를 가정하면 그 관례를 안 쓰는 프로젝트에서 전부 오탐이 된다.
 * - 관례: 섹션 크기, 토픽 선행 작성 강제. 프로젝트가 `.memory-guard.json` 으로
 *   선언할 때만 켠다 → 데이터로 둔다.
 *
 * 한도는 절대 상수가 아니라 하드캡에서 유도한다. 캡만이 사실이고 예산은 그로부터
 * 나온 여유분이다.
 */

/** claude 실행파일에 박힌 하드캡. 넘으면 인덱스가 잘려서 로드된다. */
export const CAPS = { bytes: 25000, lines: 200 };

export const DEFAULTS = {
  /** 하드캡 대비 예산 비율. 남는 10% 가 "세션 도중 몇 줄 더 써도 캡에 안 닿는" 여유다. */
  headroom: 0.9,
  /** 항목 상한 = 평균 허용 줄 × 이 배수. 평균보다 길어도 되지만 몇 배까지냐를 정한다. */
  entrySlack: 1.4,
  staleDays: 90,
  /** `{min,max}` 를 주면 섹션 크기 검사가 켜진다. 프로젝트 관례라 기본은 꺼짐. */
  section: null,
  /** 인덱스 줄이 가리키는 토픽 파일이 아직 없으면 write 를 막는다. 기본 꺼짐. */
  requireTopicFirst: false,
  /** 기본 제외에 더해지는 glob. 인덱스에 안 올린 초안을 고아로 잡지 않기 위한 통로. */
  exclude: [],
};

/**
 * 항상 제외되는 파일. 인덱스 자신, 사람이 읽는 안내문, 초안 관례(`_`·`.` 접두, `.draft.md`).
 * 하위 디렉터리(`archive/` 등)는 애초에 스캔하지 않으므로 여기 없다.
 */
export const BUILTIN_EXCLUDE = ['MEMORY.md', 'README.md', '_*', '.*', '*.draft.md'];

export const INDEX_BASENAME = 'MEMORY.md';
export const CONFIG_BASENAME = '.memory-guard.json';

const bytesOf = (s) => Buffer.byteLength(s ?? '', 'utf8');

// --- 설정 ---

const clamp = (v, lo, hi, fallback) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;

/**
 * 사용자 설정을 기본값과 합친다. 범위를 벗어난 값은 조용히 되돌린다 —
 * 설정 오타 하나로 가드가 전부 꺼지거나 모든 write 가 막히면 안 된다.
 *
 * @param {object} raw `.memory-guard.json` 내용
 * @returns {typeof DEFAULTS}
 */
export function resolveConfig(raw = {}) {
  const src = raw && typeof raw === 'object' ? raw : {};
  const section =
    src.section && typeof src.section === 'object'
      ? {
          min: clamp(src.section.min, 1, 100, 3),
          max: clamp(src.section.max, 1, 100, 8),
        }
      : null;
  return {
    headroom: clamp(src.headroom, 0.3, 1, DEFAULTS.headroom),
    entrySlack: clamp(src.entrySlack, 1, 10, DEFAULTS.entrySlack),
    staleDays: clamp(src.staleDays, 1, 3650, DEFAULTS.staleDays),
    section: section && section.min <= section.max ? section : null,
    requireTopicFirst: src.requireTopicFirst === true,
    exclude: Array.isArray(src.exclude) ? src.exclude.filter((p) => typeof p === 'string') : [],
  };
}

/**
 * 예산과 항목 상한을 하드캡에서 유도한다.
 *
 * 항목 상한이 "평균 허용 줄 × slack" 인 이유: 절대 문자 수로 두면 축이 어긋난다.
 * 250자 상한은 한글에서 최대 750B 로, 줄당 평균 허용치의 6배인데도 통과했다 —
 * 크기 캡이 항상 먼저 걸려 한 번도 구속하지 않는 죽은 규칙이었다.
 */
export function deriveLimits(config = DEFAULTS) {
  const bytes = Math.round(CAPS.bytes * config.headroom);
  const lines = Math.round(CAPS.lines * config.headroom);
  return { bytes, lines, entryBytes: Math.round((bytes / lines) * config.entrySlack) };
}

// --- 제외 규칙 ---

function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

/** 파일명이 기본 제외 또는 설정 제외에 걸리는가. */
export function isExcluded(name, config = DEFAULTS) {
  return [...BUILTIN_EXCLUDE, ...(config.exclude ?? [])].some((p) => globToRegExp(p).test(name));
}

// --- 파싱 ---

/** 파일 끝 개행이 줄을 하나 더 만들지 않게, CRLF 가 판정을 흔들지 않게 정규화한다. */
export function splitLines(text) {
  const lines = String(text ?? '')
    .split('\n')
    .map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

const ENTRY = /^\s*[-*]\s+/;
const HEADING = /^(#{2,6})\s+(.*)$/;
const MD_LINK = /\]\(\s*([^)\s#]+\.md)(?:#[^)]*)?\s*\)/g;
const WIKI_LINK = /\[\[([^\]|]+?)(?:\|[^\]]*)?\]\]/g;

/** 본문에서 내부 md 링크와 wikilink 를 뽑는다. 외부·절대 경로는 우리 소관이 아니다. */
export function extractLinks(text) {
  const md = [];
  const wiki = [];
  for (const m of String(text ?? '').matchAll(MD_LINK)) {
    const target = m[1];
    if (/^(https?:|\/)/.test(target)) continue;
    md.push(target);
  }
  for (const m of String(text ?? '').matchAll(WIKI_LINK)) wiki.push(m[1].trim());
  return { md, wiki };
}

/**
 * 인덱스를 항목·섹션·링크로 나눈다.
 *
 * 섹션의 토픽 식별자는 헤더 안의 md 링크를 먼저 쓰고, 없으면 헤더 문구를 쓴다.
 * 특정 헤더 포맷을 요구하지 않으므로 어느 인덱스에도 붙는다.
 */
export function parseIndex(text) {
  const lines = splitLines(text);
  const sections = [];
  const entries = [];

  lines.forEach((raw, i) => {
    const line = i + 1;
    const heading = HEADING.exec(raw);
    if (heading) {
      const title = heading[2].trim();
      const inHeader = extractLinks(title);
      sections.push({
        topic: inHeader.md[0] ?? inHeader.wiki[0] ?? title,
        title,
        line,
        entries: [],
      });
      return;
    }
    if (!ENTRY.test(raw)) return;
    const entry = { text: raw, bytes: bytesOf(raw), line };
    entries.push(entry);
    if (sections.length > 0) sections[sections.length - 1].entries.push(entry);
  });

  const avgEntryBytes = entries.length
    ? Math.round(entries.reduce((a, e) => a + e.bytes, 0) / entries.length)
    : 0;

  return {
    bytes: bytesOf(text),
    lines: lines.length,
    entries,
    sections,
    avgEntryBytes,
    links: extractLinks(text),
  };
}

// --- 링크 해석 ---

/**
 * 링크가 실제 대상에 닿는가.
 *
 * @param {string} target md 링크의 경로 또는 wikilink 이름
 * @param {{files?:Set<string>|string[], slugs?:Set<string>|string[], exists?:(rel:string)=>boolean}} ctx
 */
export function linkResolves(target, ctx = {}) {
  const files = ctx.files instanceof Set ? ctx.files : new Set(ctx.files ?? []);
  const slugs = ctx.slugs instanceof Set ? ctx.slugs : new Set(ctx.slugs ?? []);
  if (files.has(target) || files.has(`${target}.md`)) return true;
  if (slugs.has(target)) return true;
  // 하위 디렉터리(archive/ 등)로 내려간 링크는 파일 목록에 없다 — 존재 확인만 위임한다.
  if (typeof ctx.exists === 'function' && ctx.exists(target)) return true;
  return false;
}

/**
 * 이름이 본문에 하나의 토큰으로 등장하는가. `rtos-job.md` 가 있다고 `job.md` 가
 * 언급된 것으로 세지 않도록 앞뒤를 이름 문자로 막는다.
 */
export function mentions(text, name) {
  if (!name) return false;
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\w./-])${esc}([^\\w-]|$)`).test(String(text ?? ''));
}

// --- 감사 ---

const finding = (kind, message, extra = {}) => ({ kind, message, ...extra });

/**
 * 인덱스를 감사한다. 크기·항목 길이는 불변 규칙, 섹션 크기는 설정이 있을 때만.
 *
 * @param {string} text 인덱스 본문
 * @param {{files?:string[], slugs?:string[], config?:object, exists?:Function}} opts
 *        `files` 는 메모리 디렉터리 최상위의 `.md` 파일명 목록(인덱스 포함 가능),
 *        `slugOf` 는 파일명 → 프론트매터 slug 조회다
 */
export function auditIndex(text, opts = {}) {
  const config = opts.config ?? DEFAULTS;
  const limits = deriveLimits(config);
  const parsed = parseIndex(text);
  const files = new Set(opts.files ?? []);
  const ctx = { files, slugs: new Set(opts.slugs ?? []), exists: opts.exists };
  const findings = [];

  if (parsed.bytes > CAPS.bytes) {
    findings.push(finding('cap-bytes', `${parsed.bytes}B — 하드캡 ${CAPS.bytes}B 초과. 인덱스가 잘려서 로드된다`));
  } else if (parsed.bytes > limits.bytes) {
    findings.push(finding('budget-bytes', `${parsed.bytes}B — 예산 ${limits.bytes}B 초과 (하드캡 ${CAPS.bytes}B)`));
  }

  if (parsed.lines > CAPS.lines) {
    findings.push(finding('cap-lines', `${parsed.lines}줄 — 하드캡 ${CAPS.lines}줄 초과. 인덱스가 잘려서 로드된다`));
  } else if (parsed.lines > limits.lines) {
    findings.push(finding('budget-lines', `${parsed.lines}줄 — 예산 ${limits.lines}줄 초과 (하드캡 ${CAPS.lines}줄)`));
  }

  for (const entry of parsed.entries) {
    if (entry.bytes > limits.entryBytes) {
      findings.push(
        finding('entry-too-long', `${entry.line}행 ${entry.bytes}B — 상한 ${limits.entryBytes}B. 상세를 토픽 본문으로 내린다`, {
          line: entry.line,
          bytes: entry.bytes,
        }),
      );
    }
  }

  // 인덱스가 가리키는데 없는 대상. 헤더 포맷과 무관하게 링크만 본다.
  for (const target of parsed.links.md) {
    if (!linkResolves(target, ctx)) {
      findings.push(finding('broken-link', `${INDEX_BASENAME} -> ${target} — 대상 파일이 없다`, { target }));
    }
  }
  for (const name of parsed.links.wiki) {
    if (!linkResolves(name, ctx)) {
      findings.push(finding('broken-wikilink', `${INDEX_BASENAME} -> [[${name}]] — 대상 파일이 없다`, { target: name }));
    }
  }

  // 반대 방향: 아무도 안 가리키는 토픽 파일. 세션이 영영 읽지 않는 지식이 된다.
  //
  // 링크만 세지 않는다 — 인덱스가 토픽을 md 링크로 거는 대신 헤더에 파일명을 평문으로
  // 적는 관례가 흔하고, 링크만 보면 그런 인덱스에서 전 토픽이 고아로 오탐된다. 찾으려는
  // 것은 "어디에도 안 적힌 파일" 이므로 문자열 언급이면 참조로 충분하다.
  for (const file of files) {
    if (isExcluded(file, config)) continue;
    if (mentions(text, file)) continue;
    const slug = opts.slugOf?.(file);
    if (slug && mentions(text, slug)) continue;
    findings.push(finding('orphan-topic', `${file} — 인덱스가 가리키지 않는 토픽 파일이다`, { target: file }));
  }

  if (config.section) {
    const seen = new Set();
    for (const section of parsed.sections) {
      if (seen.has(section.topic)) {
        findings.push(finding('duplicate-topic', `${section.topic} — 두 섹션이 같은 토픽을 가리킨다`, { line: section.line }));
      }
      seen.add(section.topic);
      const n = section.entries.length;
      if (n < config.section.min) {
        findings.push(
          finding('section-too-small', `${section.topic} ${n}줄 — ${config.section.min}줄 미만은 인접 토픽에 흡수한다`, {
            line: section.line,
          }),
        );
      } else if (n > config.section.max) {
        findings.push(
          finding('section-too-big', `${section.topic} ${n}줄 — ${config.section.max}줄 초과. 토픽을 분해한다`, {
            line: section.line,
          }),
        );
      }
    }
  }

  return {
    ok: findings.length === 0,
    truncated: parsed.bytes > CAPS.bytes || parsed.lines > CAPS.lines,
    bytes: parsed.bytes,
    lines: parsed.lines,
    avgEntryBytes: parsed.avgEntryBytes,
    limits,
    findings,
  };
}

const DATE = /\d{4}-\d{2}-\d{2}/g;

/**
 * 토픽 파일 하나를 감사한다 — 깨진 링크와 본문 최신 날짜 기준 노후.
 *
 * @param {string} name 파일명
 * @param {string} text 본문
 * @param {{files?:string[], slugs?:string[], config?:object, now?:number, exists?:Function}} opts
 *        `now` 는 epoch 초.
 */
export function auditTopic(name, text, opts = {}) {
  const config = opts.config ?? DEFAULTS;
  const ctx = { files: new Set(opts.files ?? []), slugs: new Set(opts.slugs ?? []), exists: opts.exists };
  const findings = [];
  const links = extractLinks(text);

  for (const target of links.md) {
    if (!linkResolves(target, ctx)) {
      findings.push(finding('broken-link', `${name} -> ${target} — 대상 파일이 없다`, { file: name, target }));
    }
  }
  for (const wiki of links.wiki) {
    if (!linkResolves(wiki, ctx)) {
      findings.push(finding('broken-wikilink', `${name} -> [[${wiki}]] — 대상 파일이 없다`, { file: name, target: wiki }));
    }
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const dates = String(text ?? '').match(DATE);
  if (dates && dates.length > 0) {
    const latest = dates.slice().sort().pop();
    const epoch = Math.floor(Date.parse(`${latest}T00:00:00Z`) / 1000);
    if (Number.isFinite(epoch)) {
      const days = Math.floor((now - epoch) / 86400);
      if (days > config.staleDays) {
        findings.push(finding('stale-date', `${name} — 본문 최신 날짜 ${latest}, ${days}일 경과`, { file: name }));
      }
    }
  }

  return findings;
}

/** 프론트매터 `name:` slug. wikilink 가 파일명이 아니라 이 값을 가리키는 관례가 있다. */
export function frontmatterSlug(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(String(text ?? ''));
  if (!fm) return null;
  const m = /^name:[ \t]*(\S.*?)[ \t]*$/m.exec(fm[1]);
  return m ? m[1].replace(/^["']|["']$/g, '') : null;
}

// --- write 가드 ---

/**
 * write 후의 인덱스 크기를 계산한다. Edit 은 바이트 델타로 정확히 구한다
 * (실제 치환을 재현할 필요가 없다): new = old - len(old_string) + len(new_string).
 *
 * @param {{tool:string, oldText?:string, content?:string, old_string?:string, new_string?:string}} w
 */
export function planWrite(w) {
  const oldText = w.oldText ?? '';
  const oldBytes = bytesOf(oldText);
  const oldLines = oldText === '' ? 0 : splitLines(oldText).length;

  if (w.tool === 'Write') {
    const content = w.content ?? '';
    return {
      oldBytes,
      oldLines,
      newBytes: bytesOf(content),
      newLines: content === '' ? 0 : splitLines(content).length,
      added: content,
    };
  }
  if (w.tool === 'Edit') {
    const oldStr = w.old_string ?? '';
    const newStr = w.new_string ?? '';
    const lineDelta = (s) => (s === '' ? 0 : s.split('\n').length - 1);
    return {
      oldBytes,
      oldLines,
      newBytes: oldBytes - bytesOf(oldStr) + bytesOf(newStr),
      newLines: oldLines - lineDelta(oldStr) + lineDelta(newStr),
      added: newStr,
    };
  }
  return null;
}

/**
 * write 를 막을지 판정한다.
 *
 * 인덱스를 **키우는 write 만** 막는다. 줄이는(정리) write 는 항상 통과하므로 막혔다가
 * 푸는 루프가 데드락 없이 돈다. 예산에 닿은 뒤에도 같은 크기로 갈아끼우는 write 는
 * 통과하므로 1-in-1-out(하나 빼야 하나 넣는다)이 별도 규칙 없이 성립한다.
 *
 * 차단은 하드캡에 직결된 것만 한다. 링크·고아·섹션은 포맷을 추론해 판정하므로
 * 오판이 곧 데드락이 된다 — 그쪽은 알림으로만 낸다.
 */
export function guardWrite(w, opts = {}) {
  const config = opts.config ?? DEFAULTS;
  const limits = deriveLimits(config);
  const plan = planWrite(w);
  if (!plan) return { blocked: false };
  if (plan.newBytes <= plan.oldBytes) return { blocked: false, plan, limits };

  const addedEntries = splitLines(plan.added)
    .filter((l) => ENTRY.test(l))
    .map((l) => ({ text: l, bytes: bytesOf(l) }));
  const longest = addedEntries.reduce((a, e) => (e.bytes > a ? e.bytes : a), 0);

  const reasons = [];
  if (plan.newBytes > limits.bytes) reasons.push(`크기 ${plan.newBytes}B > ${limits.bytes}B`);
  if (plan.newLines > limits.lines) reasons.push(`줄 수 ${plan.newLines} > ${limits.lines}`);
  if (longest > limits.entryBytes) {
    reasons.push(`추가되는 항목이 ${longest}B > ${limits.entryBytes}B — 상세는 토픽 본문으로`);
  }

  if (config.requireTopicFirst) {
    const ctx = { files: new Set(opts.files ?? []), slugs: new Set(opts.slugs ?? []), exists: opts.exists };
    const missing = [];
    for (const entry of addedEntries) {
      const links = extractLinks(entry.text);
      for (const target of [...links.md, ...links.wiki]) {
        if (!linkResolves(target, ctx)) missing.push(target);
      }
    }
    if (missing.length > 0) {
      reasons.push(`토픽 파일이 아직 없다: ${[...new Set(missing)].join(', ')} — 본문을 먼저 쓴다`);
    }
  }

  return { blocked: reasons.length > 0, reasons, plan, limits, longestAdded: longest };
}

/** 차단 메시지. 사람이 아니라 에이전트가 읽고 바로 고치도록 진단을 함께 낸다. */
export function renderBlock(file, result, indexText = '') {
  const { plan, limits, reasons } = result;
  const parsed = parseIndex(indexText);
  const out = [
    `BLOCKED: ${file} 로의 write 가 메모리 인덱스를 한도 밖으로 키운다 (${reasons.join('; ')}).`,
    `  현재: ${plan.oldBytes}B / ${plan.oldLines}줄  ->  write 후: ${plan.newBytes}B / ${plan.newLines}줄`,
    `  예산: ${limits.bytes}B / ${limits.lines}줄 / 항목당 ${limits.entryBytes}B (하드캡 ${CAPS.bytes}B / ${CAPS.lines}줄)`,
  ];
  if (parsed.avgEntryBytes > 0) {
    out.push(
      `  이 인덱스의 항목 평균은 ${parsed.avgEntryBytes}B — ${limits.lines}줄이면 약 ${
        parsed.avgEntryBytes * limits.lines
      }B 다`,
    );
  }
  out.push('고치는 법: 상세(커밋 해시·수치·경로)를 토픽 .md 본문으로 내리고 인덱스에는 한 줄 요약 + 링크만 둔다.');
  out.push('           줄이는 write 는 절대 막히지 않는다. 예산에 닿았으면 하나를 빼고 하나를 넣는다.');
  const top = parsed.entries
    .slice()
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, 5);
  if (top.length > 0) {
    out.push('먼저 옮길 후보 (현재 인덱스에서 가장 긴 항목):');
    for (const e of top) out.push(`    ${e.line}행: ${e.bytes}B`);
  }
  return out.join('\n');
}

/** SessionStart 점검 결과 메시지. 자동 삭제하지 않는다 — 의미 판단은 에이전트가 한다. */
export function renderCheck(memoryDir, findings) {
  const out = [`[memory-guard] 메모리 점검에서 손봐야 할 항목을 찾았다 (${memoryDir}):`];
  for (const f of findings) out.push(`  [${f.kind}] ${f.message}`);
  out.push('처리 (자동 삭제 금지):');
  out.push('  - budget/cap-*          : 상세를 토픽 본문으로 내리고 인덱스 줄을 줄인다');
  out.push('  - broken-link/wikilink  : 링크를 고치거나 죽은 참조를 지운다');
  out.push('  - orphan-topic          : 인덱스에 한 줄로 올리거나 archive/ 로 내린다');
  out.push('  - stale-date            : 근거를 확인하고 유지 / 갱신 / archive');
  out.push('  archive/ 로 옮기거나 표시한 뒤 사용자에게 확인한다. 코드·출처 주장은 직접 검증한다.');
  return out.join('\n');
}
