/**
 * 설정과 스냅숏을 «그릴 칸의 줄» 로 바꾼다 — 끄기·숨김·merge·구분자·테마 색·powerline 화살표.
 *
 * 결과는 화면 요소가 아니라 평평한 칸 목록이다. hooks module 은 칸 하나를 요소 하나로 옮기기만 한다.
 *
 * @typedef {{text: string, color?: string, bg?: string, bold?: boolean, dim?: boolean, url?: string}} TextCell
 * @typedef {TextCell | {flex: true}} Cell
 */

import { truncate } from './format.mjs';
import { FALLBACK_COLORS, THEMES } from './themes.mjs';
import { WIDGETS } from './widgets/index.mjs';

/**
 * 켜진 항목들이 요구하는 소스의 이름. hooks module 은 여기 없는 소스를 모으지 않는다.
 *
 * @param {{lines: {enabled: boolean, items: {type: string, enabled?: boolean}[]}[]}} config
 * @returns {Set<string>}
 */
export function neededSources(config) {
  const needs = new Set();
  for (const item of activeItems(config)) {
    for (const need of WIDGETS[item.type]?.needs ?? []) needs.add(need);
  }
  return needs;
}

/**
 * 켜진 줄의 켜진 항목.
 *
 * @param {{lines: {enabled: boolean, items: object[]}[]}} config
 * @returns {object[]}
 */
export function activeItems(config) {
  return config.lines.filter((line) => line.enabled).flatMap((line) => line.items.filter((item) => item.enabled !== false));
}

/**
 * 그릴 줄들. 보일 칸이 하나도 없는 줄은 빠진다.
 *
 * @param {object} config `normalizeConfig` 를 거친 설정
 * @param {object} snap 스냅숏 (`widgets/index.mjs` 참고)
 * @returns {Cell[][]}
 */
export function buildRows(config, snap) {
  const theme = config.theme ? THEMES[config.theme] : null;
  const rows = [];
  // 테마 색은 줄이 바뀌어도 이어서 돈다.
  let groupIndex = -1;

  for (const line of config.lines) {
    if (!line.enabled) continue;
    const tokens = [];
    let previousMerged = false;
    for (const item of line.items) {
      if (item.enabled === false) continue;
      if (item.type === 'flex-separator') {
        tokens.push({ kind: 'flex' });
        previousMerged = false;
        continue;
      }
      if (item.type === 'separator') {
        tokens.push({ kind: 'separator', text: item.text });
        previousMerged = false;
        continue;
      }
      const rendered = WIDGETS[item.type]?.render(snap, item);
      if (!rendered) continue;
      if (!previousMerged) groupIndex += 1;
      tokens.push({ kind: 'segment', ...styleSegment(config, theme, groupIndex, item, rendered), joined: previousMerged });
      previousMerged = item.merge === true;
    }
    if (!tokens.some((token) => token.kind === 'segment')) continue;
    rows.push(config.powerline.enabled ? powerlineCells(config, tokens) : plainCells(config, tokens));
  }
  return rows;
}

function styleSegment(config, theme, groupIndex, item, rendered) {
  // 항목에 적은 label 은 minimal·raw 에서도 보인다 — 일부러 적은 것이다.
  const label = item.label ?? (item.raw || config.minimal ? '' : rendered.label);
  const text = truncate(`${label}${rendered.value}`, item.maxWidth);
  const themed = theme ? { color: theme.fg[groupIndex % theme.fg.length], bg: theme.bg[groupIndex % theme.bg.length] } : {};
  const segment = {
    text,
    color: item.color ?? themed.color,
    bg: item.bg ?? themed.bg,
    bold: item.bold ?? config.bold,
    dim: item.dim === true,
  };
  if (rendered.url) segment.url = rendered.url;
  return segment;
}

/** powerline: 구간마다 배경을 칠하고, 구간 사이·끝에 앞 구간의 배경색으로 화살표를 그린다. */
function powerlineCells(config, tokens) {
  const cells = [];
  let chainBg = null;
  const closeChain = () => {
    if (chainBg !== null) cells.push({ text: config.powerline.separator, color: chainBg });
    chainBg = null;
  };
  for (const token of tokens) {
    if (token.kind === 'flex') {
      closeChain();
      cells.push({ flex: true });
      continue;
    }
    // 수동 구분자는 powerline 에서 뜻이 없다.
    if (token.kind === 'separator') continue;
    const bg = token.bg ?? FALLBACK_COLORS.bg;
    const color = token.color ?? FALLBACK_COLORS.fg;
    if (chainBg !== null && !token.joined) cells.push({ text: config.powerline.separator, color: chainBg, bg });
    cells.push(textCell({ ...token, text: `${config.padding}${token.text}${config.padding}`, color, bg }));
    chainBg = bg;
  }
  closeChain();
  return cells;
}

/** 일반: 구간 사이에 구분자를 넣는다. 줄에 수동 구분자가 있으면 그것만 쓴다. */
function plainCells(config, tokens) {
  const manual = tokens.some((token) => token.kind === 'separator');
  const cells = [];
  let previousWasSegment = false;
  for (const token of tokens) {
    if (token.kind === 'flex') {
      cells.push({ flex: true });
      previousWasSegment = false;
      continue;
    }
    if (token.kind === 'separator') {
      cells.push({ text: token.text ?? config.separator, dim: true });
      previousWasSegment = false;
      continue;
    }
    if (previousWasSegment) cells.push(token.joined || manual ? { text: token.joined ? ' ' : '' } : { text: config.separator, dim: true });
    cells.push(textCell(token));
    previousWasSegment = true;
  }
  return cells.filter((cell) => cell.flex || cell.text !== '');
}

function textCell({ text, color, bg, bold, dim, url }) {
  const cell = { text };
  if (color) cell.color = color;
  if (bg) cell.bg = bg;
  if (bold) cell.bold = true;
  if (dim) cell.dim = true;
  if (url) cell.url = url;
  return cell;
}
