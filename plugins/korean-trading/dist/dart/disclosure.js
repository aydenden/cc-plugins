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

// scripts/dart/corp-codes.ts
import { writeFileSync as writeFileSync2 } from "fs";
import { execSync } from "child_process";
var CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml";
var CACHE_PATH = getCachePath("dart", "corp_codes.json");
var CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
async function downloadCorpCodes(apiKey) {
  log("Downloading DART corp codes (ZIP)...");
  const resp = await fetchWithRetry(`${CORP_CODE_URL}?crtfc_key=${apiKey}`, { timeoutMs: 60000 });
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }
  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const err = await resp.json();
    throw new Error(`DART error: ${err.status} - ${err.message}`);
  }
  const buffer = await resp.arrayBuffer();
  const blob = new Blob([buffer]);
  const tmpZip = getCachePath("dart", "corpCode.zip");
  writeFileSync2(tmpZip, Buffer.from(await blob.arrayBuffer()));
  const xml = execSync(`unzip -o -p ${tmpZip}`, { encoding: "utf-8" });
  if (!xml.includes("<list>")) {
    throw new Error("Invalid corpCode XML");
  }
  const map = {};
  const listRegex = /<list>([\s\S]*?)<\/list>/g;
  let match;
  while ((match = listRegex.exec(xml)) !== null) {
    const block = match[1];
    const corpCode = block.match(/<corp_code>(\d+)<\/corp_code>/)?.[1];
    const corpName = block.match(/<corp_name>([^<]+)<\/corp_name>/)?.[1];
    const stockCode = block.match(/<stock_code>(\d{6})<\/stock_code>/)?.[1];
    if (corpCode && stockCode && corpName) {
      map[stockCode] = { corp_code: corpCode, corp_name: corpName };
    }
  }
  log(`Parsed ${Object.keys(map).length} corp codes`);
  return map;
}
async function getCorpCodeMap(apiKey) {
  const cached = readCache(CACHE_PATH);
  if (cached) {
    log("Using cached corp codes");
    return cached.data;
  }
  const map = await downloadCorpCodes(apiKey);
  writeCache(CACHE_PATH, map, CACHE_TTL);
  return map;
}
async function tickerToCorpCode(ticker) {
  const apiKey = requireEnv("DART_API_KEY");
  const map = await getCorpCodeMap(apiKey);
  return map[ticker] ?? null;
}
async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run corp-codes.ts <종목코드(6자리)>"));
    return;
  }
  try {
    const apiKey = requireEnv("DART_API_KEY");
    const map = await getCorpCodeMap(apiKey);
    const info = map[ticker];
    if (!info) {
      output(fail("NOT_FOUND", `종목코드 ${ticker}에 대한 DART corp_code를 찾을 수 없습니다`));
      return;
    }
    output(success({ ticker, ...info }, "dart"));
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main();

// scripts/dart/disclosure.ts
var DART_BASE = "https://opendart.fss.or.kr/api";
var DISCLOSURE_ENDPOINTS = {
  dividend: "alotMatter.json",
  treasury_acquire: "tesstkAcqsDspsSttus.json",
  capital_increase: "piicDecsn.json",
  free_capital: "fricDecsn.json",
  convertible_bond: "cbDecsn.json",
  bond_warrant: "bwDecsn.json",
  major_shareholder: "majorstock.json",
  executive_stock: "elestock.json"
};
var REPORT_CODES = {
  "1Q": "11013",
  "2Q": "11012",
  "3Q": "11014",
  annual: "11011"
};
async function dartGet(apiKey, endpoint, params) {
  const qs = new URLSearchParams({ crtfc_key: apiKey, ...params });
  const url = `${DART_BASE}/${endpoint}?${qs}`;
  const resp = await fetchWithRetry(url);
  if (!resp.ok)
    throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json();
  if (json.status === "013")
    return [];
  if (json.status && json.status !== "000") {
    throw new Error(`DART error: ${json.status} - ${json.message}`);
  }
  return json.list ?? json;
}
async function fetchDisclosures(apiKey, corpCode) {
  const results = {};
  const now = new Date;
  const endDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  for (const [name, endpoint] of Object.entries(DISCLOSURE_ENDPOINTS)) {
    try {
      log(`Fetching ${name}`);
      const params = { corp_code: corpCode };
      if (["dividend", "treasury_acquire"].includes(name)) {
        params.bgn_de = "20200101";
        params.end_de = endDate;
      }
      results[name] = await dartGet(apiKey, endpoint, params);
    } catch (err) {
      log(`${name} failed: ${err.message}`);
      results[name] = { error: err.message };
    }
  }
  return results;
}
async function fetchFinancial(apiKey, corpCode, year, quarter) {
  const reprtCode = REPORT_CODES[quarter];
  if (!reprtCode) {
    throw new Error(`잘못된 분기: ${quarter}. 가능: 1Q, 2Q, 3Q, annual`);
  }
  return await dartGet(apiKey, "fnlttSinglAcnt.json", {
    corp_code: corpCode,
    bsns_year: year,
    reprt_code: reprtCode
  });
}
async function main2() {
  const ticker = process.argv[2];
  const command = process.argv[3];
  if (!ticker || !command) {
    output(fail("INVALID_ARGS", `사용법:
  bun run disclosure.ts <종목코드> disclosures
  bun run disclosure.ts <종목코드> financial [year] [quarter]`));
    return;
  }
  try {
    const apiKey = requireEnv("DART_API_KEY");
    const corp = await tickerToCorpCode(ticker);
    if (!corp) {
      output(fail("NOT_FOUND", `종목코드 ${ticker}에 대한 DART corp_code를 찾을 수 없습니다`));
      return;
    }
    log(`Resolved: ${ticker} → ${corp.corp_code} (${corp.corp_name})`);
    if (command === "disclosures") {
      const data = await fetchDisclosures(apiKey, corp.corp_code);
      output(success({ ticker, corp_code: corp.corp_code, corp_name: corp.corp_name, disclosures: data }, "dart"));
    } else if (command === "financial") {
      const year = process.argv[4] ?? String(new Date().getFullYear() - 1);
      const quarter = process.argv[5] ?? "annual";
      const data = await fetchFinancial(apiKey, corp.corp_code, year, quarter);
      output(success({ ticker, corp_code: corp.corp_code, corp_name: corp.corp_name, year, quarter, financial: data }, "dart"));
    } else {
      output(fail("INVALID_ARGS", `알 수 없는 명령: ${command}. 가능: disclosures, financial`));
    }
  } catch (err) {
    output(fail("API_ERROR", err.message));
  }
}
main2();
