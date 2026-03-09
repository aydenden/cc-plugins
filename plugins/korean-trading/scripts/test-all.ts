#!/usr/bin/env bun
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
  const missing = envVars.filter((v) => !Bun.env[v]);
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
    `https://api.stlouisfed.org/fred/series/observations?series_id=FEDFUNDS&api_key=${Bun.env.FRED_API_KEY}&file_type=json&observation_start=2024-01-01&limit=1`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { observations?: unknown[] };
  if (!json.observations) throw new Error("No observations");
});

await test("ECOS", ["ECOS_API_KEY"], async () => {
  const resp = await fetch(
    `https://ecos.bok.or.kr/api/StatisticSearch/${Bun.env.ECOS_API_KEY}/json/kr/1/1/722Y001/M/202401/202412/0101000`,
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
    { headers: { AUTH_KEY: Bun.env.KRX_API_KEY! } },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
});

await test("KIS", ["KIS_APP_KEY", "KIS_APP_SECRET"], async () => {
  const resp = await fetch("https://openapi.koreainvestment.com:9443/oauth2/tokenP", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      appkey: Bun.env.KIS_APP_KEY,
      appsecret: Bun.env.KIS_APP_SECRET,
    }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  const json = await resp.json() as { access_token?: string };
  if (!json.access_token) throw new Error("No token returned");
});

await test("DART", ["DART_API_KEY"], async () => {
  const resp = await fetch(
    `https://opendart.fss.or.kr/api/company.json?crtfc_key=${Bun.env.DART_API_KEY}&corp_code=00126380`,
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
});

await test("NAVER_NEWS", ["NAVER_CLIENT_ID", "NAVER_CLIENT_SECRET"], async () => {
  const resp = await fetch(
    "https://openapi.naver.com/v1/search/news.json?query=삼성전자&display=1",
    {
      headers: {
        "X-Naver-Client-Id": Bun.env.NAVER_CLIENT_ID!,
        "X-Naver-Client-Secret": Bun.env.NAVER_CLIENT_SECRET!,
      },
    },
  );
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
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
