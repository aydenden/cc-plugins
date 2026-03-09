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

// scripts/fsc/market-index.ts
var BASE_URL = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService";
var ENDPOINTS = {
  stock: "/getStockMarketIndex",
  bond: "/getBondMarketIndex",
  derivative: "/getDerivationProductMarketIndex"
};
function normalizeItems(items) {
  return Array.isArray(items) ? items : [items];
}
function mapStockIndex(item) {
  return {
    date: item.basDt,
    name: item.idxNm,
    close: parseFloat(item.clpr ?? "0"),
    change: parseFloat(item.vs ?? "0"),
    change_pct: parseFloat(item.fltRt ?? "0"),
    open: parseFloat(item.mkp ?? "0"),
    high: parseFloat(item.hipr ?? "0"),
    low: parseFloat(item.lopr ?? "0"),
    volume: parseInt(item.trqu ?? "0", 10),
    trade_amount: parseFloat(item.trPrc ?? "0"),
    market_cap: parseFloat(item.lstgMrktTotAmt ?? "0")
  };
}
function mapBondIndex(item) {
  return {
    ...mapStockIndex(item),
    total_return_index: parseFloat(item.totBnfIdxClpr ?? "0"),
    net_price_index: parseFloat(item.nPrcIdxClpr ?? "0"),
    duration: parseFloat(item.durt ?? "0"),
    convexity: parseFloat(item.cnvt ?? "0"),
    ytm: parseFloat(item.ytm ?? "0")
  };
}
async function main() {
  const serviceKey = requireEnv("DATA_GO_KR_API_KEY");
  const type = process.argv[2] ?? "stock";
  const date = process.argv[3] ?? "";
  const indexName = process.argv[4] ?? "";
  if (!ENDPOINTS[type]) {
    output(fail("INVALID_ARGS", `유효하지 않은 유형: ${type}. 가능: stock, bond, derivative`));
    return;
  }
  const endpoint = ENDPOINTS[type];
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: "50",
    pageNo: "1"
  });
  if (date)
    params.set("basDt", date);
  if (indexName && type === "stock")
    params.set("idxNm", indexName);
  const url = `${BASE_URL}${endpoint}?${params}`;
  log(`Fetching ${type} market index${date ? ` for ${date}` : ""}${indexName ? ` (${indexName})` : ""}`);
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
      output(success({ type, date, count: 0, indices: [] }, "fsc"));
      return;
    }
    const normalized = normalizeItems(rawItems);
    const indices = type === "bond" ? normalized.map(mapBondIndex) : normalized.map(mapStockIndex);
    const resultDate = date || (indices.length > 0 ? indices[0].date : "");
    output(success({ type, date: resultDate, count: indices.length, indices }, "fsc"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
