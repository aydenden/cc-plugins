/**
 * 토큰·사용량·컨텍스트 위젯.
 *
 * 5시간·주간 사용량과 컨텍스트는 엔진이 잰 값(`snap.usage`)이고, 모델별 주간·추가 사용량은 usage API
 * 응답(`snap.api`)이다. 토큰 합계와 캐시는 트랜스크립트로 채운 뒤 턴마다 더한 값(`snap.tokens`)이다.
 */

import { bar, formatDuration, formatMoney, formatPercent, formatTokens } from '../format.mjs';

const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const DEFAULT_CACHE_TTL_MINUTES = 5;
const DEFAULT_BAR_WIDTH = 16;

/** 막대 옆의 토큰 수 — ccstatusline 의 context-bar 와 같은 꼴 (`322k`, `1.0M`). */
const barTokens = (count) => (count >= 1_000_000 ? `${(count / 1_000_000).toFixed(1)}M` : count >= 1000 ? `${Math.round(count / 1000)}k` : String(count));

const limitOf = (snap, kind) => snap.usage?.rateLimits?.find((limit) => limit.kind === kind);

const percentOf = (label, kind) => (snap) => {
  const limit = limitOf(snap, kind);
  return limit ? { label, value: formatPercent(limit.percentUsed) } : null;
};

const resetOf = (label, kind) => (snap) => {
  const resetsAt = Date.parse(limitOf(snap, kind)?.resetsAt ?? '');
  if (Number.isNaN(resetsAt) || !snap.now) return null;
  return { label, value: formatDuration(resetsAt - snap.now) };
};

const tokenCount = (label, pick) => (snap, item) => {
  if (!snap.tokens) return null;
  const value = pick(snap.tokens);
  if (value === 0 && !item.showZero) return null;
  return { label, value: formatTokens(value) };
};

const speed = (label, pick) => (snap) => {
  const tokens = snap.tokens;
  if (!tokens || !tokens.turnMs) return null;
  return { label, value: `${Math.round(pick(tokens) / (tokens.turnMs / 1000))} t/s` };
};

const modelWeekly = (label, model) => (snap) => {
  const bucket = snap.api?.perModel?.[model];
  return bucket ? { label, value: formatPercent(bucket.percent) } : null;
};

const extra = (label, format) => (snap) => {
  const usage = snap.api?.extra;
  if (!usage?.enabled) return null;
  const value = format(usage);
  return value === null ? null : { label, value };
};

const cacheShare = (label, pick) => (snap) => {
  const last = snap.tokens?.last;
  if (!last) return null;
  const prompt = last.input + last.cacheRead + last.cacheWrite;
  const part = pick(last);
  if (prompt === 0 || part === 0) return null;
  return { label, value: `${formatTokens(part)} (${formatPercent((part / prompt) * 100)})` };
};

/** @type {Record<string, import('./index.mjs').Widget>} */
export const USAGE_WIDGETS = {
  'context-length': {
    category: 'usage',
    needs: ['usage'],
    render: (snap) => {
      const tokens = snap.usage?.context?.tokens;
      return typeof tokens === 'number' ? { label: 'Ctx: ', value: formatTokens(tokens) } : null;
    },
  },
  'context-window': {
    category: 'usage',
    needs: ['usage'],
    render: (snap) => {
      const window = snap.usage?.context?.window;
      return window ? { label: 'Win: ', value: formatTokens(window) } : null;
    },
  },
  'context-percentage': {
    category: 'usage',
    needs: ['usage'],
    render: (snap) => {
      const percent = snap.usage?.context?.percent;
      return typeof percent === 'number' ? { label: 'Ctx: ', value: formatPercent(percent) } : null;
    },
  },
  'context-percentage-usable': {
    category: 'usage',
    needs: ['usage', 'contextUsable'],
    render: (snap) => {
      const tokens = snap.usage?.context?.tokens;
      const usable = snap.contextUsable?.maxTokens;
      if (typeof tokens !== 'number' || !usable) return null;
      return { label: 'Ctx(u): ', value: formatPercent((tokens / usable) * 100) };
    },
  },
  'context-bar': {
    category: 'usage',
    needs: ['usage'],
    render: (snap, item) => {
      const percent = snap.usage?.context?.percent;
      if (typeof percent !== 'number') return null;
      const gauge = `[${bar(percent, item.width ?? DEFAULT_BAR_WIDTH)}]`;
      const { tokens, window } = snap.usage.context;
      if (item.format === 'percent' || typeof tokens !== 'number' || !window) {
        return { label: 'Ctx: ', value: `${gauge} ${formatPercent(percent)}` };
      }
      return { label: 'Ctx: ', value: `${gauge} ${barTokens(tokens)}/${barTokens(window)} (${formatPercent(percent)})` };
    },
  },
  'session-usage': { category: 'usage', needs: ['usage'], render: percentOf('Session: ', 'five_hour') },
  'weekly-usage': { category: 'usage', needs: ['usage'], render: percentOf('Weekly: ', 'seven_day') },
  'reset-timer': { category: 'usage', needs: ['usage', 'clock'], render: resetOf('Reset: ', 'five_hour') },
  'weekly-reset-timer': { category: 'usage', needs: ['usage', 'clock'], render: resetOf('Weekly reset: ', 'seven_day') },
  'block-timer': {
    category: 'usage',
    needs: ['usage', 'clock'],
    render: (snap) => {
      const resetsAt = Date.parse(limitOf(snap, 'five_hour')?.resetsAt ?? '');
      if (Number.isNaN(resetsAt) || !snap.now) return null;
      return { label: 'Block: ', value: formatDuration(snap.now - (resetsAt - FIVE_HOURS_MS)) };
    },
  },
  'weekly-sonnet-usage': { category: 'usage', needs: ['api'], render: modelWeekly('Weekly Sonnet: ', 'sonnet') },
  'weekly-opus-usage': { category: 'usage', needs: ['api'], render: modelWeekly('Weekly Opus: ', 'opus') },
  'fable-weekly-usage': { category: 'usage', needs: ['api'], render: modelWeekly('Weekly Fable: ', 'fable') },
  'extra-usage-utilization': {
    category: 'usage',
    needs: ['api'],
    render: extra('Extra: ', (u) => (typeof u.utilization === 'number' ? formatPercent(u.utilization) : null)),
  },
  'extra-usage-used': {
    category: 'usage',
    needs: ['api'],
    render: extra('Extra used: ', (u) => (typeof u.used === 'number' ? formatMoney(u.used, u.currency) : null)),
  },
  'extra-usage-remaining': {
    category: 'usage',
    needs: ['api'],
    render: extra('Extra left: ', (u) =>
      typeof u.used === 'number' && typeof u.limit === 'number' ? formatMoney(u.limit - u.used, u.currency) : null,
    ),
  },
  'tokens-input': { category: 'usage', needs: ['tokens'], render: tokenCount('In: ', (t) => t.input) },
  'tokens-output': { category: 'usage', needs: ['tokens'], render: tokenCount('Out: ', (t) => t.output) },
  'tokens-cached': { category: 'usage', needs: ['tokens'], render: tokenCount('Cached: ', (t) => t.cacheRead + t.cacheWrite) },
  'tokens-total': {
    category: 'usage',
    needs: ['tokens'],
    render: tokenCount('Total: ', (t) => t.input + t.output + t.cacheRead + t.cacheWrite),
  },
  'cache-hit-rate': {
    category: 'usage',
    needs: ['tokens'],
    render: (snap) => {
      const last = snap.tokens?.last;
      if (!last || last.cacheRead + last.cacheWrite === 0) return null;
      return { label: 'Cache: ', value: formatPercent((last.cacheRead / (last.cacheRead + last.cacheWrite)) * 100) };
    },
  },
  'cache-read': { category: 'usage', needs: ['tokens'], render: cacheShare('Cache R: ', (last) => last.cacheRead) },
  'cache-write': { category: 'usage', needs: ['tokens'], render: cacheShare('Cache W: ', (last) => last.cacheWrite) },
  // 캐시 TTL(5분/1시간)은 mod 에 노출되지 않는다. 항목의 `ttlMinutes` 로 정하고 기본은 5분이다.
  'cache-timer': {
    category: 'usage',
    needs: ['tokens', 'clock'],
    render: (snap, item) => {
      const at = snap.tokens?.lastResponseAt;
      if (!at || !snap.now) return null;
      const left = at + (item.ttlMinutes ?? DEFAULT_CACHE_TTL_MINUTES) * 60_000 - snap.now;
      return { label: 'Cache: ', value: left > 0 ? formatDuration(left) : 'COLD' };
    },
  },
  // 턴 길이에는 도구 실행 시간이 섞인다. 응답 속도가 아니라 턴 평균이다.
  'input-speed': { category: 'usage', needs: ['tokens'], render: speed('In: ', (t) => t.turnInput) },
  'output-speed': { category: 'usage', needs: ['tokens'], render: speed('Out: ', (t) => t.turnOutput) },
  'total-speed': { category: 'usage', needs: ['tokens'], render: speed('Speed: ', (t) => t.turnInput + t.turnOutput) },
  'compaction-counter': {
    category: 'usage',
    needs: ['tokens'],
    render: (snap, item) => {
      const compactions = snap.tokens?.compactions;
      if (typeof compactions !== 'number') return null;
      if (compactions === 0 && !item.showZero) return null;
      return { label: '↻ ', value: String(compactions) };
    },
  },
};
