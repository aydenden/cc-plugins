/**
 * 설정의 꼴과 기본값 — 줄(`lines`) 안에 항목(`items`)이 놓이고, 줄과 항목 각각 `enabled` 로 끄고 켠다.
 *
 * 설정 파일(`~/.claude/statusline/settings.json`)은 사람이 손으로도 고치므로 여기가 입력 경계다.
 * 틀린 곳은 던지지 않고 `problems` 에 모아 돌려준다 — 한 항목이 틀렸다고 상태줄 전체가 사라지면 안 된다.
 *
 * `node:` import 를 두지 않는다. hooks module 이 import 한다.
 */

import { ANSI_HEX, THEMES } from './themes.mjs';
import { UNSUPPORTED, isKnownType } from './widgets/index.mjs';

export const CONFIG_VERSION = 1;

/** 홈 기준 설정 파일 경로. */
export const CONFIG_RELATIVE_PATH = '.claude/statusline/settings.json';

/** 홈 기준 ccstatusline 설정 파일 경로 (`/sl import` 가 읽는다). */
export const CCSTATUSLINE_RELATIVE_PATH = '.config/ccstatusline/settings.json';

const DEFAULT_REFRESH = { gitSeconds: 5, apiSeconds: 180, ghSeconds: 120, statusSeconds: 300, clockSeconds: 30, customSeconds: 30 };

const ITEM_STRING_KEYS = ['id', 'color', 'bg', 'label', 'text', 'symbol', 'url', 'format'];
const ITEM_BOOLEAN_KEYS = ['bold', 'dim', 'raw', 'merge', 'showZero'];
const ITEM_NUMBER_KEYS = ['maxWidth', 'width', 'ttlMinutes'];

/** 설정 파일이 없을 때의 상태줄. */
export const DEFAULT_CONFIG = Object.freeze({
  version: CONFIG_VERSION,
  powerline: { enabled: true, separator: '' },
  theme: 'nord',
  separator: ' | ',
  padding: ' ',
  bold: false,
  minimal: true,
  refresh: DEFAULT_REFRESH,
  lines: [
    {
      enabled: true,
      items: [
        { type: 'model', merge: true },
        { type: 'thinking-effort' },
        { type: 'git-root-dir' },
        { type: 'git-branch', merge: true },
        { type: 'git-changes' },
        { type: 'flex-separator' },
        { type: 'context-bar' },
        { type: 'session-usage', merge: true },
        { type: 'reset-timer' },
        { type: 'weekly-usage' },
      ],
    },
  ],
});

/**
 * 읽은 JSON 을 쓸 수 있는 설정으로 다듬는다. 모르는 타입·틀린 값은 버리고 그 이유를 `problems` 에 적는다.
 *
 * @param {unknown} raw
 * @returns {{config: typeof DEFAULT_CONFIG, problems: string[]}}
 */
export function normalizeConfig(raw) {
  const problems = [];
  if (!isRecord(raw)) return { config: DEFAULT_CONFIG, problems: ['설정이 객체가 아니다 — 기본 설정으로 그린다'] };

  const lines = Array.isArray(raw.lines) ? raw.lines : null;
  if (!lines) problems.push('`lines` 가 배열이 아니다 — 기본 줄로 그린다');

  const theme = raw.theme === undefined ? DEFAULT_CONFIG.theme : raw.theme;
  if (theme !== null && !Object.hasOwn(THEMES, theme)) {
    problems.push(`테마 \`${String(theme)}\` 를 모른다 (${Object.keys(THEMES).join(', ')}) — 테마 없이 그린다`);
  }

  return {
    config: {
      version: CONFIG_VERSION,
      powerline: {
        enabled: isRecord(raw.powerline) ? raw.powerline.enabled !== false : DEFAULT_CONFIG.powerline.enabled,
        separator:
          isRecord(raw.powerline) && typeof raw.powerline.separator === 'string'
            ? raw.powerline.separator
            : DEFAULT_CONFIG.powerline.separator,
      },
      theme: theme !== null && Object.hasOwn(THEMES, theme) ? theme : null,
      separator: typeof raw.separator === 'string' ? raw.separator : DEFAULT_CONFIG.separator,
      padding: typeof raw.padding === 'string' ? raw.padding : DEFAULT_CONFIG.padding,
      bold: raw.bold === true,
      minimal: raw.minimal === undefined ? DEFAULT_CONFIG.minimal : raw.minimal === true,
      refresh: normalizeRefresh(raw.refresh, problems),
      lines: lines ? lines.map((line, index) => normalizeLine(line, index, problems)) : DEFAULT_CONFIG.lines,
    },
    problems,
  };
}

function normalizeRefresh(raw, problems) {
  if (raw === undefined) return DEFAULT_REFRESH;
  if (!isRecord(raw)) {
    problems.push('`refresh` 가 객체가 아니다 — 기본 주기를 쓴다');
    return DEFAULT_REFRESH;
  }
  const refresh = { ...DEFAULT_REFRESH };
  for (const key of Object.keys(DEFAULT_REFRESH)) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] === 'number' && raw[key] >= 1) refresh[key] = raw[key];
    else problems.push(`\`refresh.${key}\` 는 1 이상의 숫자여야 한다 — 기본값 ${DEFAULT_REFRESH[key]} 을 쓴다`);
  }
  return refresh;
}

function normalizeLine(raw, index, problems) {
  const where = `${index + 1}번 줄`;
  // 줄을 항목 배열로만 적은 꼴도 받는다 (ccstatusline 과 같은 꼴).
  const line = Array.isArray(raw) ? { items: raw } : raw;
  if (!isRecord(line) || !Array.isArray(line.items)) {
    problems.push(`${where}: \`items\` 배열이 없다 — 빈 줄로 둔다`);
    return { enabled: false, items: [] };
  }
  const items = [];
  line.items.forEach((item, itemIndex) => {
    const normalized = normalizeItem(item, `${where} ${itemIndex + 1}번 항목`, problems);
    if (normalized) items.push(normalized);
  });
  return { enabled: line.enabled !== false, items };
}

function normalizeItem(raw, where, problems) {
  if (!isRecord(raw) || typeof raw.type !== 'string') {
    problems.push(`${where}: \`type\` 이 없다 — 버린다`);
    return null;
  }
  if (Object.hasOwn(UNSUPPORTED, raw.type)) {
    problems.push(`${where}: \`${raw.type}\` 는 지원하지 않는다 — ${UNSUPPORTED[raw.type]}`);
    return null;
  }
  if (!isKnownType(raw.type)) {
    problems.push(`${where}: 위젯 \`${raw.type}\` 를 모른다 — 버린다`);
    return null;
  }
  const item = { type: raw.type };
  if (raw.enabled === false) item.enabled = false;
  copyTyped(raw, item, ITEM_STRING_KEYS, 'string', where, problems);
  copyTyped(raw, item, ITEM_BOOLEAN_KEYS, 'boolean', where, problems);
  copyTyped(raw, item, ITEM_NUMBER_KEYS, 'number', where, problems);
  if (raw.command !== undefined) {
    if (Array.isArray(raw.command) && raw.command.length > 0 && raw.command.every((part) => typeof part === 'string')) {
      item.command = raw.command;
    } else {
      problems.push(`${where}: \`command\` 는 문자열 배열(argv)이어야 한다 — 무시한다`);
    }
  }
  if (item.type === 'custom-command' && !item.id) {
    problems.push(`${where}: custom-command 에는 \`id\` 가 있어야 출력을 찾는다 — 버린다`);
    return null;
  }
  return item;
}

function copyTyped(from, to, keys, type, where, problems) {
  for (const key of keys) {
    if (from[key] === undefined) continue;
    if (typeof from[key] === type) to[key] = from[key];
    else problems.push(`${where}: \`${key}\` 는 ${type} 이어야 한다 — 무시한다`);
  }
}

/**
 * ccstatusline 의 설정(v3·v4 꼴)을 이 플러그인의 설정으로 옮긴다. 옮기지 못한 것은 `problems` 에 적는다.
 *
 * @param {unknown} raw ccstatusline `settings.json` 의 내용
 * @returns {{config: typeof DEFAULT_CONFIG, problems: string[]}}
 */
export function fromCcstatusline(raw) {
  if (!isRecord(raw) || !Array.isArray(raw.lines)) {
    return { config: DEFAULT_CONFIG, problems: ['ccstatusline 설정에 `lines` 가 없다 — 기본 설정을 쓴다'] };
  }
  const powerline = isRecord(raw.powerline) ? raw.powerline : {};
  const themed = typeof powerline.theme === 'string' && Object.hasOwn(THEMES, powerline.theme);
  const notes = [];
  if (typeof powerline.theme === 'string' && !themed) {
    notes.push(`ccstatusline 테마 \`${powerline.theme}\` 는 없다 — 항목의 색만 옮긴다`);
  }

  const lines = raw.lines
    .filter((line) => Array.isArray(line) && line.length > 0)
    .map((line) => ({ enabled: true, items: line.map((item) => convertItem(item, themed)) }));

  const converted = {
    version: CONFIG_VERSION,
    powerline: {
      enabled: powerline.enabled === true,
      separator: Array.isArray(powerline.separators) && typeof powerline.separators[0] === 'string' ? powerline.separators[0] : '',
    },
    theme: themed ? powerline.theme : null,
    separator: typeof raw.defaultSeparator === 'string' ? raw.defaultSeparator : DEFAULT_CONFIG.separator,
    padding: typeof raw.defaultPadding === 'string' ? raw.defaultPadding : DEFAULT_CONFIG.padding,
    bold: raw.globalBold === true,
    minimal: raw.minimalistMode === true,
    lines,
  };
  const { config, problems } = normalizeConfig(converted);
  return { config, problems: [...notes, ...problems] };
}

function convertItem(raw, themed) {
  if (!isRecord(raw)) return raw;
  const item = { type: raw.type };
  // 테마가 색을 정하면 항목에 남은 색은 테마 이전의 흔적이다. 옮기면 테마를 덮어쓴다.
  if (!themed) {
    const color = convertColor(raw.color);
    const bg = convertColor(raw.backgroundColor);
    if (color) item.color = color;
    if (bg) item.bg = bg;
  }
  if (raw.bold === true) item.bold = true;
  if (raw.dim === true) item.dim = true;
  if (raw.rawValue === true) item.raw = true;
  if (raw.merge === true || raw.merge === 'no-padding') item.merge = true;
  if (typeof raw.maxWidth === 'number') item.maxWidth = raw.maxWidth;
  if (typeof raw.customText === 'string') item.text = raw.customText;
  if (typeof raw.customSymbol === 'string') item.symbol = raw.customSymbol;
  if (isRecord(raw.metadata) && typeof raw.metadata.label === 'string') item.label = raw.metadata.label;
  if (typeof raw.commandPath === 'string') {
    item.command = ['sh', '-c', raw.commandPath];
    item.id = typeof raw.id === 'string' ? raw.id : raw.commandPath;
  }
  return item;
}

/** ccstatusline 의 색 표기(`bgBrightGreen`, `hex:88C0D0`, `cyan`)를 hex 로. 못 옮기면 undefined. */
function convertColor(color) {
  if (typeof color !== 'string') return undefined;
  if (color.startsWith('hex:')) return `#${color.slice(4)}`;
  const name = color.startsWith('bg') ? color[2].toLowerCase() + color.slice(3) : color;
  return ANSI_HEX[name];
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
