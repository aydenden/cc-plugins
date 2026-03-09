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

// scripts/alphavantage/commodities.ts
var VALID_COMMODITIES = [
  "WTI",
  "BRENT",
  "NATURAL_GAS",
  "COPPER",
  "ALUMINUM",
  "WHEAT",
  "CORN",
  "COTTON",
  "SUGAR",
  "COFFEE"
];
var VALID_INTERVALS = ["daily", "weekly", "monthly"];
async function main() {
  const apiKey = requireEnv("ALPHA_VANTAGE_API_KEY");
  const commodity = process.argv[2]?.toUpperCase();
  const interval = process.argv[3] ?? "monthly";
  if (!commodity || !VALID_COMMODITIES.includes(commodity)) {
    output(fail("INVALID_ARGS", `사용법: bun run commodities.ts <commodity> [interval]
가능한 원자재: ${VALID_COMMODITIES.join(", ")}`));
    return;
  }
  if (!VALID_INTERVALS.includes(interval)) {
    output(fail("INVALID_ARGS", `유효하지 않은 간격: ${interval}. 가능: ${VALID_INTERVALS.join(", ")}`));
    return;
  }
  const params = new URLSearchParams({
    function: commodity,
    interval,
    apikey: apiKey
  });
  const url = `https://www.alphavantage.co/query?${params}`;
  log(`Fetching ${commodity} prices (${interval})`);
  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const json = await resp.json();
    if (!json.data) {
      throw new Error("API 응답에 데이터가 없습니다. 일일 한도 초과일 수 있습니다.");
    }
    const prices = json.data.filter((d) => d.value !== ".").map((d) => ({ date: d.date, value: parseFloat(d.value) })).filter((d) => !isNaN(d.value)).slice(0, 30);
    output(success({
      commodity,
      name: json.name,
      unit: json.unit,
      interval: json.interval,
      count: prices.length,
      prices
    }, "alphavantage"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
