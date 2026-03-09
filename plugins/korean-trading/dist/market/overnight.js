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

// scripts/market/overnight.ts
var FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";
var OVERNIGHT_SERIES = {
  VIXCLS: "VIX 변동성지수",
  DTWEXBGS: "달러지수(무역가중)",
  DEXKOUS: "원/달러 환율",
  DGS10: "미 10년물 국채",
  DGS2: "미 2년물 국채",
  BAMLH0A0HYM2: "하이일드 스프레드"
};
async function fetchLatest(apiKey, seriesId) {
  const startDate = new Date;
  startDate.setDate(startDate.getDate() - 14);
  const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: startStr,
    sort_order: "desc",
    limit: "1"
  });
  const resp = await fetchWithRetry(`${FRED_BASE}?${params}`);
  if (!resp.ok)
    return null;
  const json = await resp.json();
  const obs = json.observations?.[0];
  if (!obs)
    return null;
  return {
    date: obs.date,
    value: obs.value === "." ? null : parseFloat(obs.value)
  };
}
async function main() {
  const apiKey = requireEnv("FRED_API_KEY");
  try {
    const results = {};
    for (const [id, name] of Object.entries(OVERNIGHT_SERIES)) {
      log(`Fetching ${id}`);
      const latest = await fetchLatest(apiKey, id);
      results[id] = {
        name,
        date: latest?.date ?? "N/A",
        value: latest?.value ?? null
      };
    }
    output(success(results, "fred"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
