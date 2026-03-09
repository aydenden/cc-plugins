#!/usr/bin/env node
import { createRequire } from "node:module";
var __require = /* @__PURE__ */ createRequire(import.meta.url);

// scripts/common/http.ts
var lastCallByHost = new Map;
var RATE_LIMITS = {
  "openapi.koreainvestment.com": 200,
  "data-dbg.krx.co.kr": 1000,
  "opendart.fss.or.kr": 1000,
  "ecos.bok.or.kr": 1000,
  "api.stlouisfed.org": 500,
  "oapi.koreaexim.go.kr": 1000,
  "apis.data.go.kr": 1000,
  "www.alphavantage.co": 12000
};
function getDelayForHost(url) {
  for (const [host, delay] of Object.entries(RATE_LIMITS)) {
    if (url.includes(host))
      return delay;
  }
  return 0;
}
async function rateLimit(url) {
  const delay = getDelayForHost(url);
  if (delay === 0)
    return;
  const host = new URL(url).host;
  const last = lastCallByHost.get(host) ?? 0;
  const elapsed = Date.now() - last;
  if (elapsed < delay) {
    await new Promise((r) => setTimeout(r, delay - elapsed));
  }
  lastCallByHost.set(host, Date.now());
}
async function fetchWithRetry(url, options = {}) {
  const { timeoutMs = 30000, maxRetries = 3, ...init } = options;
  let lastError = null;
  let delay = 500;
  for (let attempt = 0;attempt <= maxRetries; attempt++) {
    await rateLimit(url);
    const controller = new AbortController;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timer);
      if (resp.status === 429) {
        log(`Rate limited (429), retry ${attempt + 1}/${maxRetries}`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
        continue;
      }
      return resp;
    } catch (err) {
      clearTimeout(timer);
      lastError = err;
      if (attempt < maxRetries) {
        log(`Fetch error: ${lastError.message}, retry ${attempt + 1}/${maxRetries}`);
        await new Promise((r) => setTimeout(r, delay));
        delay *= 2;
      }
    }
  }
  throw lastError ?? new Error("Fetch failed after retries");
}
function log(msg) {
  console.error(`[korean-trading] ${msg}`);
}
function success(data, source) {
  return {
    ok: true,
    data,
    meta: { source, fetched_at: new Date().toISOString() }
  };
}
function fail(code, message) {
  return { ok: false, error: { code, message } };
}
function output(result) {
  process.stdout.write(JSON.stringify(result, null, 2) + `
`);
}
var envFileLoaded = false;
function loadEnvFile() {
  if (envFileLoaded)
    return;
  envFileLoaded = true;
  const { existsSync, readFileSync, readdirSync } = __require("fs");
  const searchRoots = ["/mnt", `${process.env.HOME}/mnt`];
  const skip = new Set([".claude", ".local-plugins", ".skills", "outputs", "uploads"]);
  for (const root of searchRoots) {
    if (!existsSync(root))
      continue;
    for (const name of readdirSync(root)) {
      if (skip.has(name))
        continue;
      const candidate = `${root}/${name}/trading-env.json`;
      if (!existsSync(candidate))
        continue;
      try {
        const env = JSON.parse(readFileSync(candidate, "utf-8"));
        for (const [k, v] of Object.entries(env)) {
          if (v && !process.env[k])
            process.env[k] = v;
        }
      } catch {}
      return;
    }
  }
}
function requireEnv(name) {
  let val = process.env[name];
  if (!val) {
    loadEnvFile();
    val = process.env[name];
  }
  if (!val) {
    output(fail("ENV_MISSING", `환경변수 ${name}이(가) 설정되지 않았습니다`));
    process.exit(0);
  }
  return val;
}

// scripts/fred/indicators.ts
var FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
var SERIES = {
  FEDFUNDS: "연방기금금리",
  T10Y2Y: "10년-2년 수익률곡선",
  VIXCLS: "VIX 변동성지수",
  DGS10: "미국 10년물 국채",
  BAMLH0A0HYM2: "하이일드 스프레드",
  DTWEXBGS: "무역가중 달러지수",
  CPIAUCSL: "소비자물가지수(CPI)",
  UNRATE: "실업률",
  DEXKOUS: "원/달러 환율"
};
async function fetchSeries(apiKey, seriesId, startDate) {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: startDate
  });
  const url = `${FRED_BASE}?${params}`;
  log(`Fetching ${seriesId}`);
  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const json = await resp.json();
  if (!json.observations) {
    return [];
  }
  return json.observations.map((obs) => ({
    date: obs.date,
    value: obs.value === "." ? null : parseFloat(obs.value)
  }));
}
async function main() {
  const apiKey = requireEnv("FRED_API_KEY");
  const arg = process.argv[2];
  if (!arg) {
    output(fail("INVALID_ARGS", `사용법: bun run indicators.ts <SERIES_ID|all> [start_date]
가능한 시리즈: ${Object.keys(SERIES).join(", ")}`));
    return;
  }
  const startDate = process.argv[3] ?? "2024-01-01";
  const isAll = arg.toLowerCase() === "all";
  const seriesIds = isAll ? Object.keys(SERIES) : [arg.toUpperCase()];
  if (!isAll && !SERIES[seriesIds[0]]) {
    output(fail("NOT_FOUND", `알 수 없는 시리즈: ${arg}. 가능한 시리즈: ${Object.keys(SERIES).join(", ")}`));
    return;
  }
  try {
    const results = {};
    for (const id of seriesIds) {
      const observations = await fetchSeries(apiKey, id, startDate);
      const latest = observations.filter((o) => o.value !== null).at(-1) ?? null;
      results[id] = { name: SERIES[id], observations, latest };
    }
    output(success(results, "fred"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
