#!/usr/bin/env node
// --- DART 종목코드 → corp_code 매핑 ---
// Usage: bun run scripts/dart/corp-codes.ts <ticker>
// ZIP 다운로드 후 캐시, ticker(6자리) → corp_code(8자리) 변환

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";
import { getCachePath, readCache, writeCache } from "../common/cache.ts";
import { existsSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";

const CORP_CODE_URL = "https://opendart.fss.or.kr/api/corpCode.xml";
const CACHE_PATH = getCachePath("dart", "corp_codes.json");
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7일

type CorpCodeMap = Record<string, { corp_code: string; corp_name: string }>;

async function downloadCorpCodes(apiKey: string): Promise<CorpCodeMap> {
  log("Downloading DART corp codes (ZIP)...");
  const resp = await fetchWithRetry(`${CORP_CODE_URL}?crtfc_key=${apiKey}`, { timeoutMs: 60_000 });

  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}`);
  }

  const contentType = resp.headers.get("content-type") ?? "";
  if (contentType.includes("json")) {
    const err = await resp.json() as { status: string; message: string };
    throw new Error(`DART error: ${err.status} - ${err.message}`);
  }

  // ZIP 처리 — Bun의 Decompress API 사용
  const buffer = await resp.arrayBuffer();
  const blob = new Blob([buffer]);

  // ZIP에서 XML 추출 (단일 파일)
  // 임시 저장 후 unzip
  const tmpZip = getCachePath("dart", "corpCode.zip");
  writeFileSync(tmpZip, Buffer.from(await blob.arrayBuffer()));
  const xml = execSync(`unzip -o -p ${tmpZip}`, { encoding: "utf-8" });

  if (!xml.includes("<list>")) {
    throw new Error("Invalid corpCode XML");
  }

  // XML 파싱 (정규식 — 외부 의존성 없이)
  const map: CorpCodeMap = {};
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

async function getCorpCodeMap(apiKey: string): Promise<CorpCodeMap> {
  const cached = readCache<CorpCodeMap>(CACHE_PATH);
  if (cached) {
    log("Using cached corp codes");
    return cached.data;
  }

  const map = await downloadCorpCodes(apiKey);
  writeCache(CACHE_PATH, map, CACHE_TTL);
  return map;
}

export async function tickerToCorpCode(ticker: string): Promise<{ corp_code: string; corp_name: string } | null> {
  const apiKey = requireEnv("DART_API_KEY");
  const map = await getCorpCodeMap(apiKey);
  return map[ticker] ?? null;
}

// --- Main (직접 실행 시) ---

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
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
