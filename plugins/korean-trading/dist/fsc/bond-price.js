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

// scripts/fsc/bond-price.ts
var BASE_URL = "https://apis.data.go.kr/1160100/service/GetBondSecuritiesInfoService/getBondPriceInfo";
function todayYYYYMMDD() {
  const d = new Date;
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function subtractDays(dateStr, days) {
  const d = new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function normalizeItems(items) {
  return Array.isArray(items) ? items : [items];
}
async function fetchBonds(serviceKey, date, market) {
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: "50",
    pageNo: "1",
    basDt: date,
    mrktCtg: market
  });
  const url = `${BASE_URL}?${params}`;
  log(`Fetching bond prices for ${date}, market=${market}`);
  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }
  const json = await resp.json();
  if (json.response.header.resultCode !== "00") {
    throw new Error(`API 오류: ${json.response.header.resultMsg}`);
  }
  const totalCount = json.response.body.totalCount;
  if (totalCount === 0 || !json.response.body.items?.item) {
    return null;
  }
  return { items: normalizeItems(json.response.body.items.item), totalCount };
}
async function main() {
  const serviceKey = requireEnv("DATA_GO_KR_API_KEY");
  const inputDate = process.argv[2];
  const market = process.argv[3] ?? "KTS";
  try {
    let date = inputDate ?? todayYYYYMMDD();
    let result = null;
    for (let attempt = 0;attempt < 4; attempt++) {
      result = await fetchBonds(serviceKey, date, market);
      if (result)
        break;
      log(`${date}에 데이터 없음, 이전 날짜로 재시도`);
      date = subtractDays(date, 1);
    }
    if (!result) {
      output(fail("NO_DATA", `최근 4일 내 ${market} 채권 데이터가 없습니다`));
      return;
    }
    const bonds = result.items.map((item) => ({
      date: item.basDt,
      name: item.itmsNm,
      code: item.srtnCd,
      market: item.mrktCtg,
      close_price: parseFloat(item.clprPrc ?? "0"),
      close_yield: parseFloat(item.clprBnfRt ?? "0"),
      volume: parseInt(item.trqu ?? "0", 10),
      trade_amount: parseFloat(item.trPrc ?? "0"),
      maturity: parseFloat(item.xpYrCnt ?? "0")
    }));
    output(success({ date, market, count: bonds.length, bonds }, "fsc"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
