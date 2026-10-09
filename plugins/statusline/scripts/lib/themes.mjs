/**
 * powerline 테마 — 구간마다 돌려 쓰는 전경·배경 색 목록. ccstatusline 의 같은 이름 테마에서 truecolor 값을 옮겼다.
 *
 * 색은 `#RRGGBB` 로만 둔다. mod 의 `Text` 가 이름 색과 hex 를 받는 것은 실측했지만 `brightGreen` 같은
 * 이름을 터미널마다 같게 그린다는 보장이 없어, 가져온 설정의 이름 색도 `ANSI_HEX` 로 hex 로 바꾼다.
 */

/** @type {Record<string, {fg: string[], bg: string[]}>} */
export const THEMES = {
  nord: {
    fg: ['#2E3440', '#D8DEE9', '#FDF6E3', '#2E3440', '#2E3440'],
    bg: ['#88C0D0', '#4C566A', '#5E81AC', '#B48EAD', '#A3BE8C'],
  },
  'nord-aurora': {
    fg: ['#ECEFF4', '#2E3440', '#FDF6E3', '#2E3440', '#2E3440'],
    bg: ['#BF616A', '#EBCB8B', '#5E81AC', '#A3BE8C', '#B48EAD'],
  },
};

/** 테마도 항목 색도 없는 powerline 구간의 색. */
export const FALLBACK_COLORS = { fg: '#D8DEE9', bg: '#4C566A' };

/** ANSI 16색 이름의 hex (xterm 기본 팔레트). ccstatusline 설정의 이름 색을 옮길 때 쓴다. */
export const ANSI_HEX = {
  black: '#000000',
  red: '#CD0000',
  green: '#00CD00',
  yellow: '#CDCD00',
  blue: '#0000EE',
  magenta: '#CD00CD',
  cyan: '#00CDCD',
  white: '#E5E5E5',
  brightBlack: '#7F7F7F',
  brightRed: '#FF0000',
  brightGreen: '#00FF00',
  brightYellow: '#FFFF00',
  brightBlue: '#5C5CFF',
  brightMagenta: '#FF00FF',
  brightCyan: '#00FFFF',
  brightWhite: '#FFFFFF',
};
