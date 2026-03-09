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

// scripts/fsc/financial-statements.ts
var BASE_URL = "https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2";
var ENDPOINTS = {
  summary: "/getSummFinaStat_V2",
  bs: "/getBs_V2",
  income: "/getIncoStat_V2"
};
function normalizeItems(items) {
  return Array.isArray(items) ? items : [items];
}
function mapSummary(item) {
  return {
    bizYear: item.bizYear,
    revenue: parseFloat(item.enpSaleAmt ?? "0"),
    operating_profit: parseFloat(item.enpBzopPft ?? "0"),
    net_income: parseFloat(item.iclsPalClcAmt ?? "0"),
    total_assets: parseFloat(item.enpTastAmt ?? "0"),
    total_liabilities: parseFloat(item.enpTdbtAmt ?? "0"),
    capital: parseFloat(item.enpCptlAmt ?? "0")
  };
}
function mapBsOrIncome(item) {
  return {
    account_name: item.acitNm,
    current_amount: parseFloat((item.thstrm_amount ?? "0").replace(/,/g, "")),
    previous_amount: parseFloat((item.frmtrm_amount ?? "0").replace(/,/g, ""))
  };
}
async function main() {
  const serviceKey = requireEnv("DATA_GO_KR_API_KEY");
  const crno = process.argv[2];
  if (!crno) {
    output(fail("INVALID_ARGS", "사용법: bun run financial-statements.ts <crno> [year] [summary|bs|income]"));
    return;
  }
  const year = process.argv[3] ?? String(new Date().getFullYear() - 1);
  const type = process.argv[4] ?? "summary";
  if (!ENDPOINTS[type]) {
    output(fail("INVALID_ARGS", `유효하지 않은 유형: ${type}. 가능: summary, bs, income`));
    return;
  }
  const endpoint = ENDPOINTS[type];
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: "100",
    pageNo: "1",
    crno,
    bizYear: year
  });
  const url = `${BASE_URL}${endpoint}?${params}`;
  log(`Fetching ${type} financial statements for CRNO=${crno}, year=${year}`);
  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }
    const json = await resp.json();
    if (json.response.header.resultCode !== "00") {
      throw new Error(`API 오류: ${json.response.header.resultMsg}`);
    }
    const rawItems = json.response.body.items?.item;
    if (!rawItems) {
      output(success({ crno, year, type, items: [] }, "fsc"));
      return;
    }
    const normalized = normalizeItems(rawItems);
    const items = type === "summary" ? normalized.map(mapSummary) : normalized.map(mapBsOrIncome);
    output(success({ crno, year, type, items }, "fsc"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
