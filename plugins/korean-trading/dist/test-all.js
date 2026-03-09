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

// scripts/common/cache.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
var PLUGIN_ROOT = join(dirname(new URL(import.meta.url).pathname), "..", "..");
var CACHE_ROOT = process.env.KOREAN_TRADING_CACHE_DIR ?? join(PLUGIN_ROOT, ".cache");
function getCacheDir(...segments) {
  const dir = join(CACHE_ROOT, ...segments);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
function getCachePath(...segments) {
  const parts = [...segments];
  const file = parts.pop();
  const dir = getCacheDir(...parts);
  return join(dir, file);
}
function readCache(path) {
  if (!existsSync(path))
    return null;
  try {
    const raw = readFileSync(path, "utf-8");
    const entry = JSON.parse(raw);
    if (entry.expires_at && new Date(entry.expires_at) < new Date) {
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}
function writeCache(path, data, ttlMs) {
  const entry = {
    data,
    cached_at: new Date().toISOString()
  };
  if (ttlMs) {
    entry.expires_at = new Date(Date.now() + ttlMs).toISOString();
  }
  writeFileSync(path, JSON.stringify(entry, null, 2), "utf-8");
}
async function withLock(lockName, fn, staleSec = 60) {
  const lockDir = join(CACHE_ROOT, `${lockName}.lock`);
  const maxWait = staleSec * 1000;
  const start = Date.now();
  while (true) {
    try {
      mkdirSync(lockDir);
      break;
    } catch {
      if (Date.now() - start > maxWait) {
        try {
          const { rmdirSync } = await import("fs");
          rmdirSync(lockDir);
        } catch {}
        mkdirSync(lockDir);
        break;
      }
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      const { rmdirSync } = await import("fs");
      rmdirSync(lockDir);
    } catch {}
  }
}

// scripts/common/kis-auth.ts
var KIS_BASE = "https://openapi.koreainvestment.com:9443";
var TOKEN_CACHE_PATH = getCachePath("kis", "token.json");
var TOKEN_TTL_MS = 23 * 60 * 60 * 1000;
var RENEW_BEFORE_MS = 10 * 60 * 1000;
var memoryToken = null;
function isTokenValid(token) {
  const expiresAt = new Date(token.expires_at).getTime();
  return Date.now() < expiresAt - RENEW_BEFORE_MS;
}
async function issueToken(appKey, appSecret) {
  log("Issuing new KIS token");
  const resp = await fetchWithRetry(`${KIS_BASE}/oauth2/tokenP`, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: appKey,
      appsecret: appSecret
    })
  });
  if (!resp.ok) {
    throw new Error(`Token issue failed: HTTP ${resp.status}`);
  }
  const json = await resp.json();
  return {
    access_token: json.access_token,
    token_type: json.token_type,
    expires_at: new Date(Date.now() + TOKEN_TTL_MS).toISOString()
  };
}
async function getKisToken() {
  const appKey = requireEnv("KIS_APP_KEY");
  const appSecret = requireEnv("KIS_APP_SECRET");
  if (memoryToken && isTokenValid(memoryToken)) {
    log("Using memory-cached token");
    return memoryToken;
  }
  const cached = readCache(TOKEN_CACHE_PATH);
  if (cached && isTokenValid(cached.data)) {
    log("Using file-cached token");
    memoryToken = cached.data;
    return cached.data;
  }
  const token = await withLock("kis-token", async () => {
    const rechecked = readCache(TOKEN_CACHE_PATH);
    if (rechecked && isTokenValid(rechecked.data)) {
      return rechecked.data;
    }
    const newToken = await issueToken(appKey, appSecret);
    writeCache(TOKEN_CACHE_PATH, newToken, TOKEN_TTL_MS);
    return newToken;
  });
  memoryToken = token;
  return token;
}
function buildKisHeaders(token, trId) {
  const appKey = process.env.KIS_APP_KEY;
  const appSecret = process.env.KIS_APP_SECRET;
  return {
    authorization: `Bearer ${token.access_token}`,
    appkey: appKey,
    appsecret: appSecret,
    tr_id: trId,
    "Content-Type": "application/json; charset=utf-8"
  };
}
async function kisGet(path, trId, params) {
  const token = await getKisToken();
  const headers = buildKisHeaders(token, trId);
  const qs = new URLSearchParams(params).toString();
  const url = `${KIS_BASE}${path}?${qs}`;
  const resp = await fetchWithRetry(url, { headers });
  if (!resp.ok) {
    throw new Error(`KIS API error: HTTP ${resp.status}`);
  }
  const json = await resp.json();
  if (json.rt_cd !== "0") {
    if (json.msg_cd === "EGW00201") {
      throw new Error("KIS rate limit exceeded");
    }
    throw new Error(`KIS error: ${json.msg_cd} - ${json.msg1}`);
  }
  return json;
}

// scripts/test-all.ts
var results = [];
async function test(source, envVars, fn) {
  const missing = envVars.filter((v) => !process.env[v]);
  if (missing.length > 0) {
    results.push({ source, status: "skip", message: `환경변수 없음: ${missing.join(", ")}` });
    return;
  }
  const start = Date.now();
  try {
    await fn();
    results.push({ source, status: "pass", message: "OK", duration_ms: Date.now() - start });
  } catch (err) {
    results.push({ source, status: "fail", message: err.message, duration_ms: Date.now() - start });
  }
}
await test("FRED", ["FRED_API_KEY"], async () => {
  const resp = await fetch(`https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${process.env.FRED_API_KEY}&file_type=json&observation_start=2024-01-01&limit=1`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.observations)
    throw new Error("No observations");
});
await test("ECOS", ["ECOS_API_KEY"], async () => {
  const resp = await fetch(`https://ecos.bok.or.kr/api/StatisticSearch/${process.env.ECOS_API_KEY}/json/kr/1/1/722Y001/M/202401/202412/0101000`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.StatisticSearch?.row)
    throw new Error("No data");
});
await test("KRX", ["KRX_API_KEY"], async () => {
  const today = new Date;
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const resp = await fetch(`https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd?basDd=${dateStr}`, { headers: { AUTH_KEY: process.env.KRX_API_KEY } });
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
});
await test("KIS_TOKEN_AND_PRICE", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const json = await kisGet("/uapi/domestic-stock/v1/quotations/inquire-price", "FHKST01010100", { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "005930" });
  if (!json.output?.stck_prpr)
    throw new Error("No price data");
});
await test("KIS_VOLUME_RANK", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const json = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank", "FHPST01710000", {
    FID_COND_MRKT_DIV_CODE: "J",
    FID_COND_SCR_DIV_CODE: "20171",
    FID_INPUT_ISCD: "0001",
    FID_DIV_CLS_CODE: "0",
    FID_BLNG_CLS_CODE: "0",
    FID_TRGT_CLS_CODE: "111111111",
    FID_TRGT_EXLS_CLS_CODE: "0000000000",
    FID_INPUT_PRICE_1: "",
    FID_INPUT_PRICE_2: "",
    FID_VOL_CNT: "",
    FID_INPUT_DATE_1: ""
  });
  if (!json.output)
    throw new Error("No ranking data");
});
await test("KIS_OVERSEAS", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const json = await kisGet("/uapi/overseas-price/v1/quotations/price", "HHDFS00000300", { AUTH: "", EXCD: "NAS", SYMB: "AAPL" });
  if (!json.output?.last)
    throw new Error("No overseas price");
});
await test("DART", ["DART_API_KEY"], async () => {
  const resp = await fetch(`https://opendart.fss.or.kr/api/company.json?crtfc_key=${process.env.DART_API_KEY}&corp_code=00126380`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
});
await test("NAVER_NEWS", ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"], async () => {
  const resp = await fetch("https://openapi.naver.com/v1/search/news.json?query=삼성전자&display=1", {
    headers: {
      "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID,
      "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET
    }
  });
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
});
await test("KOREAEXIM", ["KOREAEXIM_API_KEY"], async () => {
  const resp = await fetch(`https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${process.env.KOREAEXIM_API_KEY}&data=AP01`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.length || json[0].result !== 1)
    throw new Error("No exchange rate data");
});
await test("DATA_GO_KR", ["DATA_GO_KR_API_KEY"], async () => {
  const serviceKey = encodeURIComponent(process.env.DATA_GO_KR_API_KEY);
  const resp = await fetch(`https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex?serviceKey=${serviceKey}&resultType=json&numOfRows=1&pageNo=1`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.response?.header?.resultCode !== "00")
    throw new Error("API error");
});
await test("ALPHA_VANTAGE", ["ALPHA_VANTAGE_API_KEY"], async () => {
  const resp = await fetch(`https://www.alphavantage.co/query?function=WTI&interval=monthly&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (!json.data)
    throw new Error("No commodity data");
});
console.log(JSON.stringify({
  ok: true,
  data: {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
    results
  },
  meta: { source: "test-all", fetched_at: new Date().toISOString() }
}, null, 2));
