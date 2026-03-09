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

// scripts/ecos/indicators.ts
var ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch";
var INDICATORS = {
  base_rate: { name: "기준금리", stat_code: "722Y001", item_code: "0101000", cycle: "M" },
  cpi: { name: "소비자물가지수", stat_code: "901Y009", item_code: "0", cycle: "M" },
  unemployment: { name: "실업률", stat_code: "901Y027", item_code: "3133*AA", cycle: "M" },
  bond_10y: { name: "국고채 10년", stat_code: "817Y002", item_code: "010210000", cycle: "D" },
  bond_2y: { name: "국고채 2년", stat_code: "817Y002", item_code: "010200000", cycle: "D" }
};
function defaultStart(cycle) {
  return cycle === "M" ? "202401" : "20240101";
}
function defaultEnd(cycle) {
  const now = new Date;
  if (cycle === "M") {
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}
async function fetchIndicator(apiKey, def, startPeriod) {
  const start = startPeriod ?? defaultStart(def.cycle);
  const end = defaultEnd(def.cycle);
  const url = `${ECOS_BASE}/${apiKey}/json/kr/1/1000/${def.stat_code}/${def.cycle}/${start}/${end}/${def.item_code}`;
  log(`Fetching ${def.name} (${def.stat_code})`);
  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const json = await resp.json();
  const rows = json.StatisticSearch?.row;
  if (!rows)
    return [];
  return rows.map((r) => ({
    period: r.TIME,
    value: r.DATA_VALUE === "" ? null : parseFloat(r.DATA_VALUE)
  }));
}
async function main() {
  const apiKey = requireEnv("ECOS_API_KEY");
  const arg = process.argv[2];
  if (!arg) {
    output(fail("INVALID_ARGS", `사용법: bun run indicators.ts <INDICATOR|all> [start_period]
가능한 지표: ${Object.keys(INDICATORS).join(", ")}`));
    return;
  }
  const startPeriod = process.argv[3];
  const isAll = arg.toLowerCase() === "all";
  const keys = isAll ? Object.keys(INDICATORS) : [arg.toLowerCase()];
  if (!isAll && !INDICATORS[keys[0]]) {
    output(fail("NOT_FOUND", `알 수 없는 지표: ${arg}. 가능한 지표: ${Object.keys(INDICATORS).join(", ")}`));
    return;
  }
  try {
    const results = {};
    for (const key of keys) {
      const def = INDICATORS[key];
      const observations = await fetchIndicator(apiKey, def, startPeriod);
      const latest = observations.filter((o) => o.value !== null).at(-1) ?? null;
      results[key] = { name: def.name, observations, latest };
    }
    output(success(results, "ecos"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
