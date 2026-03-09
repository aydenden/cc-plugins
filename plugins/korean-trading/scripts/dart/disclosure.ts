#!/usr/bin/env bun
// --- DART 공시 + 재무제표 ---
// Usage:
//   bun run scripts/dart/disclosure.ts <ticker> disclosures
//   bun run scripts/dart/disclosure.ts <ticker> financial [year] [quarter]
// quarter: 1Q, 2Q, 3Q, annual (기본: annual)

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";
import { tickerToCorpCode } from "./corp-codes.ts";

const DART_BASE = "https://opendart.fss.or.kr/api";

const DISCLOSURE_ENDPOINTS: Record<string, string> = {
  dividend: "alotMatter.json",
  treasury_acquire: "tesstkAcqsDspsSttus.json",
  capital_increase: "piicDecsn.json",
  free_capital: "fricDecsn.json",
  convertible_bond: "cbDecsn.json",
  bond_warrant: "bwDecsn.json",
  major_shareholder: "majorstock.json",
  executive_stock: "elestock.json",
};

const REPORT_CODES: Record<string, string> = {
  "1Q": "11013",
  "2Q": "11012",
  "3Q": "11014",
  annual: "11011",
};

async function dartGet(apiKey: string, endpoint: string, params: Record<string, string>): Promise<unknown> {
  const qs = new URLSearchParams({ crtfc_key: apiKey, ...params });
  const url = `${DART_BASE}/${endpoint}?${qs}`;

  const resp = await fetchWithRetry(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

  const json = await resp.json() as { status: string; message: string; list?: unknown[] };

  if (json.status === "013") return []; // 데이터 없음
  if (json.status && json.status !== "000") {
    throw new Error(`DART error: ${json.status} - ${json.message}`);
  }

  return json.list ?? json;
}

async function fetchDisclosures(apiKey: string, corpCode: string) {
  const results: Record<string, unknown> = {};
  const now = new Date();
  const endDate = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;

  for (const [name, endpoint] of Object.entries(DISCLOSURE_ENDPOINTS)) {
    try {
      log(`Fetching ${name}`);
      const params: Record<string, string> = { corp_code: corpCode };

      // 기간 조회가 필요한 엔드포인트
      if (["dividend", "treasury_acquire"].includes(name)) {
        params.bgn_de = "20200101";
        params.end_de = endDate;
      }

      results[name] = await dartGet(apiKey, endpoint, params);
    } catch (err) {
      log(`${name} failed: ${(err as Error).message}`);
      results[name] = { error: (err as Error).message };
    }
  }

  return results;
}

async function fetchFinancial(apiKey: string, corpCode: string, year: string, quarter: string) {
  const reprtCode = REPORT_CODES[quarter];
  if (!reprtCode) {
    throw new Error(`잘못된 분기: ${quarter}. 가능: 1Q, 2Q, 3Q, annual`);
  }

  return await dartGet(apiKey, "fnlttSinglAcnt.json", {
    corp_code: corpCode,
    bsns_year: year,
    reprt_code: reprtCode,
  });
}

// --- Main ---

async function main() {
  const ticker = Bun.argv[2];
  const command = Bun.argv[3];

  if (!ticker || !command) {
    output(fail("INVALID_ARGS", "사용법:\n  bun run disclosure.ts <종목코드> disclosures\n  bun run disclosure.ts <종목코드> financial [year] [quarter]"));
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
      const year = Bun.argv[4] ?? String(new Date().getFullYear() - 1);
      const quarter = Bun.argv[5] ?? "annual";
      const data = await fetchFinancial(apiKey, corp.corp_code, year, quarter);
      output(success({ ticker, corp_code: corp.corp_code, corp_name: corp.corp_name, year, quarter, financial: data }, "dart"));
    } else {
      output(fail("INVALID_ARGS", `알 수 없는 명령: ${command}. 가능: disclosures, financial`));
    }
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
