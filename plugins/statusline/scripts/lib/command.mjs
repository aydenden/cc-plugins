/**
 * `/sl` 명령의 순수 로직 — 인자를 읽고, 설정을 고친 새 설정을 만들고, 현재 배치를 글로 보여 준다.
 *
 * 파일을 읽고 쓰는 일(init·import·reload·저장)은 hooks module 이 한다. 여기는 «무엇을 할지» 만 정한다.
 *
 * 주소는 1부터 센다: `2` 는 2번 줄, `2.3` 은 2번 줄의 3번 항목.
 */

import { THEMES } from './themes.mjs';
import { LAYOUT_TYPES, UNSUPPORTED, WIDGETS, isKnownType } from './widgets/index.mjs';

/** `/sl`. hooks module 의 `command.run` 매처에도 같은 글자가 리터럴로 적혀 있다 — 엔진이 매처를 소스에서 읽는다. */
export const COMMAND_NAME = 'sl';

export const USAGE = [
  '/sl                         현재 배치와 문제 보기',
  '/sl on|off <줄>[.<항목>]     줄이나 항목을 켜고 끈다',
  '/sl add <줄> <위젯> [위치]   줄에 위젯을 넣는다 (위치 생략 = 맨 끝)',
  '/sl rm <줄>.<항목>           항목을 뺀다',
  '/sl move <줄>.<항목> <줄>[.<위치>]   항목을 옮긴다',
  '/sl set <줄>.<항목> 키=값 …   항목 옵션 (color bg label text symbol url format bold dim raw merge showZero maxWidth width ttlMinutes), 값 없이 `키=` 는 지움',
  '/sl line add | line rm <줄>   줄을 더하고 뺀다',
  '/sl theme <이름>|off         powerline 테마',
  '/sl powerline on|off        powerline 화살표',
  '/sl minimal on|off          라벨 없이 값만',
  '/sl widgets                 쓸 수 있는 위젯',
  '/sl init | import [--force] | reload   설정 파일 만들기 · ccstatusline 설정 가져오기 · 다시 읽기',
].join('\n');

const BOOLEAN_OPTIONS = ['bold', 'dim', 'raw', 'merge', 'showZero'];
const NUMBER_OPTIONS = ['maxWidth', 'width', 'ttlMinutes'];
const STRING_OPTIONS = ['id', 'color', 'bg', 'label', 'text', 'symbol', 'url', 'format'];

/**
 * `/sl` 뒤의 인자를 동작으로 읽는다. 읽지 못하면 `{ action: 'error', message }`.
 *
 * @param {string} args
 * @returns {{action: string, [key: string]: unknown}}
 */
export function parseCommand(args) {
  const words = args.trim().split(/\s+/).filter(Boolean);
  const [verb, ...rest] = words;
  switch (verb) {
    case undefined:
    case 'list':
      return { action: 'list' };
    case 'help':
      return { action: 'help' };
    case 'widgets':
    case 'init':
    case 'reload':
      return { action: verb };
    case 'import':
      return { action: 'import', force: rest.includes('--force') };
    case 'on':
    case 'off': {
      const address = parseAddress(rest[0]);
      return address ? { action: 'toggle', enabled: verb === 'on', ...address } : fail(`\`/sl ${verb} <줄>[.<항목>]\``);
    }
    case 'add': {
      const line = positive(rest[0]);
      const position = rest[2] === undefined ? null : positive(rest[2]);
      if (!line || !rest[1] || position === undefined) return fail('`/sl add <줄> <위젯> [위치]`');
      return { action: 'add', line, type: rest[1], position };
    }
    case 'rm': {
      const address = parseAddress(rest[0]);
      return address?.item ? { action: 'remove', ...address } : fail('`/sl rm <줄>.<항목>`');
    }
    case 'move': {
      const from = parseAddress(rest[0]);
      const to = parseAddress(rest[1]);
      return from?.item && to ? { action: 'move', from, to } : fail('`/sl move <줄>.<항목> <줄>[.<위치>]`');
    }
    case 'set': {
      const address = parseAddress(rest[0]);
      const pairs = rest.slice(1).map((word) => {
        const index = word.indexOf('=');
        return index > 0 ? [word.slice(0, index), word.slice(index + 1)] : null;
      });
      if (!address?.item || pairs.length === 0 || pairs.includes(null)) return fail('`/sl set <줄>.<항목> 키=값 …`');
      return { action: 'set', ...address, pairs };
    }
    case 'line': {
      if (rest[0] === 'add') return { action: 'line-add' };
      const line = positive(rest[1]);
      return rest[0] === 'rm' && line ? { action: 'line-remove', line } : fail('`/sl line add` 또는 `/sl line rm <줄>`');
    }
    case 'theme':
      return rest[0] ? { action: 'theme', theme: rest[0] === 'off' ? null : rest[0] } : fail('`/sl theme <이름>|off`');
    case 'powerline':
    case 'minimal':
      return rest[0] === 'on' || rest[0] === 'off' ? { action: verb, enabled: rest[0] === 'on' } : fail(`\`/sl ${verb} on|off\``);
    default:
      return { action: 'error', message: `\`${verb}\` 는 모르는 동작이다.\n${USAGE}` };
  }
}

/**
 * 설정을 고치는 동작을 적용한 새 설정. 적용하지 못하면 `error` 에 이유가 실리고 설정은 그대로다.
 *
 * @param {object} config `normalizeConfig` 를 거친 설정
 * @param {ReturnType<typeof parseCommand>} command
 * @returns {{config: object, message?: string, error?: string}}
 */
export function applyEdit(config, command) {
  const next = structuredCloneJson(config);
  const lineAt = (number) => next.lines[number - 1];
  const itemAt = (address) => lineAt(address.line)?.items[address.item - 1];
  const missing = (address) => ({ config, error: `${formatAddress(address)} 은(는) 없다. \`/sl\` 로 번호를 확인한다.` });

  switch (command.action) {
    case 'toggle': {
      const target = command.item ? itemAt(command) : lineAt(command.line);
      if (!target) return missing(command);
      if (command.item && command.enabled) delete target.enabled;
      else target.enabled = command.enabled;
      return { config: next, message: `${formatAddress(command)} ${command.enabled ? '켬' : '끔'}` };
    }
    case 'add': {
      const line = lineAt(command.line);
      if (!line) return missing({ line: command.line });
      if (Object.hasOwn(UNSUPPORTED, command.type)) return { config, error: `\`${command.type}\` 는 지원하지 않는다 — ${UNSUPPORTED[command.type]}` };
      if (!isKnownType(command.type)) return { config, error: `위젯 \`${command.type}\` 를 모른다. \`/sl widgets\` 로 목록을 본다.` };
      const item = { type: command.type };
      if (command.type === 'custom-command') item.id = `cmd-${line.items.length + 1}`;
      const index = command.position === null ? line.items.length : Math.min(command.position - 1, line.items.length);
      line.items.splice(index, 0, item);
      return { config: next, message: `${command.line}.${index + 1} 에 \`${command.type}\` 추가` };
    }
    case 'remove': {
      if (!itemAt(command)) return missing(command);
      const [removed] = lineAt(command.line).items.splice(command.item - 1, 1);
      return { config: next, message: `${formatAddress(command)} \`${removed.type}\` 뺌` };
    }
    case 'move': {
      if (!itemAt(command.from)) return missing(command.from);
      if (!lineAt(command.to.line)) return missing({ line: command.to.line });
      const [moved] = lineAt(command.from.line).items.splice(command.from.item - 1, 1);
      const target = lineAt(command.to.line).items;
      const index = command.to.item ? Math.min(command.to.item - 1, target.length) : target.length;
      target.splice(index, 0, moved);
      return { config: next, message: `\`${moved.type}\` 을(를) ${command.to.line}.${index + 1} 로 옮김` };
    }
    case 'set': {
      const item = itemAt(command);
      if (!item) return missing(command);
      for (const [key, value] of command.pairs) {
        const problem = setOption(item, key, value);
        if (problem) return { config, error: problem };
      }
      return { config: next, message: `${formatAddress(command)} \`${item.type}\` 옵션 바꿈` };
    }
    case 'line-add':
      next.lines.push({ enabled: true, items: [] });
      return { config: next, message: `${next.lines.length}번 줄 추가` };
    case 'line-remove':
      if (!lineAt(command.line)) return missing({ line: command.line });
      next.lines.splice(command.line - 1, 1);
      return { config: next, message: `${command.line}번 줄 뺌` };
    case 'theme':
      if (command.theme !== null && !Object.hasOwn(THEMES, command.theme)) {
        return { config, error: `테마 \`${command.theme}\` 를 모른다 (${Object.keys(THEMES).join(', ')}, off)` };
      }
      next.theme = command.theme;
      return { config: next, message: `테마 ${command.theme ?? '없음'}` };
    case 'powerline':
      next.powerline.enabled = command.enabled;
      return { config: next, message: `powerline ${command.enabled ? '켬' : '끔'}` };
    case 'minimal':
      next.minimal = command.enabled;
      return { config: next, message: `minimal ${command.enabled ? '켬' : '끔'}` };
    default:
      return { config, error: `\`${command.action}\` 는 설정을 고치는 동작이 아니다.` };
  }
}

function setOption(item, key, value) {
  if (value === '') {
    delete item[key];
    return null;
  }
  if (BOOLEAN_OPTIONS.includes(key)) {
    if (value !== 'true' && value !== 'false') return `\`${key}\` 는 true 나 false 다.`;
    item[key] = value === 'true';
  } else if (NUMBER_OPTIONS.includes(key)) {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 1) return `\`${key}\` 는 1 이상의 숫자다.`;
    item[key] = number;
  } else if (STRING_OPTIONS.includes(key)) {
    // 밑줄을 공백으로 읽는다 — 명령 인자는 공백으로 갈라지므로 공백 든 값을 적을 길이 없다.
    item[key] = key === 'label' || key === 'text' ? value.replaceAll('_', ' ') : value;
  } else {
    return `\`${key}\` 는 모르는 옵션이다.`;
  }
  return null;
}

/**
 * 현재 배치를 번호와 함께 보여 준다. 설정의 문제와 소스 오류가 있으면 뒤에 붙인다.
 *
 * @param {object} config
 * @param {{path: string, exists: boolean, problems: string[], errors: Record<string, string>}} state
 * @returns {string}
 */
export function describeConfig(config, state) {
  const out = [
    `설정: ${state.path}${state.exists ? '' : ' (없음 — 기본 설정으로 그리는 중, `/sl init` 으로 만든다)'}`,
    `powerline ${config.powerline.enabled ? 'on' : 'off'} · 테마 ${config.theme ?? '없음'} · minimal ${config.minimal ? 'on' : 'off'}`,
    '',
  ];
  config.lines.forEach((line, lineIndex) => {
    out.push(`${lineIndex + 1}번 줄 ${line.enabled ? '' : '(꺼짐)'}`.trimEnd());
    line.items.forEach((item, itemIndex) => {
      const options = Object.entries(item)
        .filter(([key]) => key !== 'type' && key !== 'enabled')
        .map(([key, value]) => `${key}=${Array.isArray(value) ? JSON.stringify(value) : value}`)
        .join(' ');
      out.push(`  ${lineIndex + 1}.${itemIndex + 1}  ${item.enabled === false ? '○' : '●'} ${item.type}${options ? `  ${options}` : ''}`);
    });
    if (line.items.length === 0) out.push('  (빈 줄)');
  });
  if (state.problems.length > 0) out.push('', '설정의 문제:', ...state.problems.map((problem) => `  - ${problem}`));
  const errors = Object.entries(state.errors);
  if (errors.length > 0) out.push('', '값을 못 읽은 소스:', ...errors.map(([source, message]) => `  - ${source}: ${message}`));
  return out.join('\n');
}

/**
 * 쓸 수 있는 위젯을 분류별로.
 *
 * @returns {string}
 */
export function describeWidgets() {
  const byCategory = new Map();
  for (const [type, widget] of Object.entries(WIDGETS)) {
    if (!byCategory.has(widget.category)) byCategory.set(widget.category, []);
    byCategory.get(widget.category).push(type);
  }
  const out = [...byCategory].map(([category, types]) => `${category}: ${types.join(', ')}`);
  out.push(`layout: ${LAYOUT_TYPES.join(', ')}`);
  out.push(`지원 안 함: ${Object.keys(UNSUPPORTED).join(', ')}`);
  return out.join('\n');
}

function parseAddress(word) {
  const match = /^(\d+)(?:\.(\d+))?$/.exec(word ?? '');
  if (!match || Number(match[1]) < 1) return null;
  if (match[2] === undefined) return { line: Number(match[1]) };
  return Number(match[2]) < 1 ? null : { line: Number(match[1]), item: Number(match[2]) };
}

function formatAddress(address) {
  return address.item ? `${address.line}.${address.item}` : `${address.line}번 줄`;
}

/** 양의 정수면 그 수, 아니면 undefined. */
function positive(word) {
  return /^\d+$/.test(word ?? '') && Number(word) >= 1 ? Number(word) : undefined;
}

function fail(usage) {
  return { action: 'error', message: `쓰는 법: ${usage}` };
}

function structuredCloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
