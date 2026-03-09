#!/usr/bin/env node
// --- 통합 검증 스크립트 ---
// Usage: bun run scripts/test-all.ts
// 모든 API 소스의 환경변수 확인 + 간단한 호출 테스트

import { log } from "./common/http.ts";

interface TestResult {
  source: string;
  status: "pass" | "fail" | "skip";
  message: string;
  duration_ms?: number;
}

const results: TestResult[] = [];

async function test(source: string, envVars: string[], fn: () => Promise<void>) {
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
    results.push({ source, status: "fail", message: (err as Error).message, duration_ms: Date.now() - start });
  }
}

// --- Tests ---

await test("FRED", ["FRED_API_KEY"], async () => {
  const resp = await fetch(
    `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${process.env.FRED_API_KEY}&file_type=json&observation_start=2024-01-01&limit=1`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { observations?: unknown[] };
  if (!json.observations) throw new Error("No observations");
});

await test("ECOS", ["ECOS_API_KEY"], async () => {
  const resp = await fetch(
    `https://ecos.bok.or.kr/api/StatisticSearch/${process.env.ECOS_API_KEY}/json/kr/1/1/722Y001/M/202401/202412/0101000`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { StatisticSearch?: { row?: unknown[] } };
  if (!json.StatisticSearch?.row) throw new Error("No data");
});

await test("KRX", ["KRX_API_KEY"], async () => {
  const today = new Date();
  const dateStr = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const resp = await fetch(
    `https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd?basDd=${dateStr}`,
    { headers: { AUTH_KEY: process.env.KRX_API_KEY! } },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
});

// KIS: 토큰 1회 발급 후 캐시 재사용 (1분당 1회 제한)
import { kisGet } from "./common/kis-auth.ts";

await test("KIS_TOKEN_AND_PRICE", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const json = await kisGet<{ output?: { stck_prpr?: string } }>(
    "/uapi/domestic-stock/v1/quotations/inquire-price",
    "FHKST01010100",
    { FID_COND_MRKT_DIV_CODE: "J", FID_INPUT_ISCD: "005930" },
  );
  if (!json.output?.stck_prpr) throw new Error("No price data");
});

await test("KIS_VOLUME_RANK", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const json = await kisGet<{ output?: unknown[] }>(
    "/uapi/domestic-stock/v1/quotations/volume-rank",
    "FHPST01710000",
    {
      FID_COND_MRKT_DIV_CODE: "J", FID_COND_SCR_DIV_CODE: "20171",
      FID_INPUT_ISCD: "0001", FID_DIV_CLS_CODE: "0", FID_BLNG_CLS_CODE: "0",
      FID_TRGT_CLS_CODE: "111111111", FID_TRGT_EXLS_CLS_CODE: "0000000000",
      FID_INPUT_PRICE_1: "", FID_INPUT_PRICE_2: "", FID_VOL_CNT: "", FID_INPUT_DATE_1: "",
    },
  );
  if (!json.output) throw new Error("No ranking data");
});

await test("KIS_OVERSEAS", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const json = await kisGet<{ output?: { last?: string } }>(
    "/uapi/overseas-price/v1/quotations/price",
    "HHDFS00000300",
    { AUTH: "", EXCD: "NAS", SYMB: "AAPL" },
  );
  if (!json.output?.last) throw new Error("No overseas price");
});

await test("DART", ["DART_API_KEY"], async () => {
  const resp = await fetch(
    `https://opendart.fss.or.kr/api/company.json?crtfc_key=${process.env.DART_API_KEY}&corp_code=00126380`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
});

await test("NAVER_NEWS", ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"], async () => {
  const resp = await fetch(
    "https://openapi.naver.com/v1/search/news.json?query=삼성전자&display=1",
    {
      headers: {
        "X-Naver-Client-Id": process.env.NAVER_CLIENT_ID!,
        "X-Naver-Client-Secret": process.env.NAVER_CLIENT_SECRET!,
      },
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
});

await test("KOREAEXIM", ["KOREAEXIM_API_KEY"], async () => {
  const resp = await fetch(
    `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${process.env.KOREAEXIM_API_KEY}&data=AP01`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as Array<{ result?: number }>;
  if (!json.length || json[0].result !== 1) throw new Error("No exchange rate data");
});

await test("DATA_GO_KR", ["DATA_GO_KR_API_KEY"], async () => {
  const serviceKey = encodeURIComponent(process.env.DATA_GO_KR_API_KEY!);
  const resp = await fetch(
    `https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService/getStockMarketIndex?serviceKey=${serviceKey}&resultType=json&numOfRows=1&pageNo=1`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { response?: { header?: { resultCode?: string } } };
  if (json.response?.header?.resultCode !== "00") throw new Error("API error");
});

await test("ALPHA_VANTAGE", ["ALPHA_VANTAGE_API_KEY"], async () => {
  const resp = await fetch(
    `https://www.alphavantage.co/query?function=WTI&interval=monthly&apikey=${process.env.ALPHA_VANTAGE_API_KEY}`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { name?: string; data?: unknown[] };
  if (!json.data) throw new Error("No commodity data");
});

// --- Output ---

console.log(JSON.stringify({
  ok: true,
  data: {
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
    skip: results.filter((r) => r.status === "skip").length,
    results,
  },
  meta: { source: "test-all", fetched_at: new Date().toISOString() },
}, null, 2));
