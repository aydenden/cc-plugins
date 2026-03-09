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

// scripts/krx/vkospi.ts
var KRX_API = "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd";
var KRX_SAMPLE = "https://data-dbg.krx.co.kr/svc/sample/apis/idx/drvprod_dd_trd";
function formatDate(d) {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}
function prevBusinessDay(dateStr, daysBack) {
  const y = parseInt(dateStr.slice(0, 4));
  const m = parseInt(dateStr.slice(4, 6)) - 1;
  const d = parseInt(dateStr.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() - daysBack);
  return formatDate(date);
}
async function fetchVkospi(apiKey, basDd) {
  try {
    log(`Trying official API for ${basDd}`);
    const url = `${KRX_API}?basDd=${basDd}`;
    const resp = await fetchWithRetry(url, {
      headers: { AUTH_KEY: apiKey },
      maxRetries: 1
    });
    if (resp.ok) {
      const data = await parseVkospi(resp, basDd);
      if (data)
        return data;
    }
  } catch (err) {
    log(`Official API failed: ${err.message}`);
  }
  try {
    log(`Trying sample API for ${basDd}`);
    const url = `${KRX_SAMPLE}?basDd=${basDd}&AUTH_KEY=${apiKey}`;
    const resp = await fetchWithRetry(url, { maxRetries: 1 });
    if (resp.ok) {
      return await parseVkospi(resp, basDd);
    }
  } catch (err) {
    log(`Sample API failed: ${err.message}`);
  }
  return null;
}
async function parseVkospi(resp, basDd) {
  const json = await resp.json();
  const rows = json.OutBlock_1;
  if (!rows || rows.length === 0)
    return null;
  const vkospi = rows.find((r) => r.IDX_NM.includes("VKOSPI") || r.IDX_NM.includes("변동성"));
  if (!vkospi)
    return null;
  const close = parseFloat(vkospi.CLSPRC_IDX);
  if (isNaN(close))
    return null;
  return {
    date: `${basDd.slice(0, 4)}-${basDd.slice(4, 6)}-${basDd.slice(6, 8)}`,
    close,
    name: vkospi.IDX_NM
  };
}
async function main() {
  const apiKey = requireEnv("KRX_API_KEY");
  const argDate = process.argv[2];
  const baseDate = argDate ?? formatDate(new Date);
  for (let i = 0;i <= 2; i++) {
    const targetDate = i === 0 ? baseDate : prevBusinessDay(baseDate, i);
    const data = await fetchVkospi(apiKey, targetDate);
    if (data) {
      output(success(data, "krx"));
      return;
    }
    log(`No data for ${targetDate}, trying previous day`);
  }
  output(fail("NOT_FOUND", `VKOSPI 데이터 없음 (${baseDate} 기준 3일 역추적)`));
}
main();
