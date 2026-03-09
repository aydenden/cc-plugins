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

// scripts/kis/volume-rank.ts
function resolveMarketCode(market) {
  switch (market?.toLowerCase()) {
    case "kospi":
      return "0001";
    case "kosdaq":
      return "1001";
    case "all":
      return "0000";
    default:
      return "0000";
  }
}
async function main() {
  const market = process.argv[2];
  const minVolume = process.argv[3] ?? "";
  try {
    const json = await kisGet("/uapi/domestic-stock/v1/quotations/volume-rank", "FHPST01710000", {
      FID_COND_MRKT_DIV_CODE: "J",
      FID_COND_SCR_DIV_CODE: "20171",
      FID_INPUT_ISCD: resolveMarketCode(market),
      FID_DIV_CLS_CODE: "0",
      FID_BLNG_CLS_CODE: "0",
      FID_TRGT_CLS_CODE: "111111111",
      FID_TRGT_EXLS_CLS_CODE: "0000000000",
      FID_INPUT_PRICE_1: "",
      FID_INPUT_PRICE_2: "",
      FID_VOL_CNT: minVolume,
      FID_INPUT_DATE_1: ""
    });
    const items = (json.output ?? []).filter((r) => r.mksc_shrn_iscd).map((r) => ({
      rank: parseInt(r.data_rank),
      ticker: r.mksc_shrn_iscd,
      name: r.hts_kor_isnm,
      price: parseInt(r.stck_prpr),
      change_pct: parseFloat(r.prdy_ctrt),
      volume: parseInt(r.acml_vol),
      prev_volume: parseInt(r.prdy_vol),
      avg_volume: parseInt(r.avrg_vol),
      volume_increase_rate: parseFloat(r.vol_inrt)
    }));
    output(success({ market: market ?? "all", count: items.length, items }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();
