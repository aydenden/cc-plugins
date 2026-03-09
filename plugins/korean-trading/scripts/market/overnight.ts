#!/usr/bin/env node
// --- 글로벌 오버나이트 지수 ---
// Usage: bun run scripts/market/overnight.ts
// FRED에서 주요 글로벌 지표 일괄 조회 (전일 기준)

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

const OVERNIGHT_SERIES: Record<string, string> = {
  VIXCLS: "VIX 변동성지수",
  DTWEXBGS: "달러지수(무역가중)",
  DEXKOUS: "원/달러 환율",
  DGS10: "미 10년물 국채",
  DGS2: "미 2년물 국채",
  BAMLH0A0HYM2: "하이일드 스프레드",
};

interface LatestValue {
  name: string;
  date: string;
  value: number | null;
}

async function fetchLatest(apiKey: string, seriesId: string): Promise<{ date: string; value: number | null } | null> {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 14);
  const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-${String(startDate.getDate()).padStart(2, "0")}`;

  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: startStr,
    sort_order: "desc",
    limit: "1",
  });

  const resp = await fetchWithRetry(`${FRED_BASE}?${params}`);
  if (!resp.ok) return null;

  const json = await resp.json() as { observations?: Array<{ date: string; value: string }> };
  const obs = json.observations?.[0];
  if (!obs) return null;

  return {
    date: obs.date,
    value: obs.value === "." ? null : parseFloat(obs.value),
  };
}

async function main() {
  const apiKey = requireEnv("FRED_API_KEY");

  try {
    const results: Record<string, LatestValue> = {};

    for (const [id, name] of Object.entries(OVERNIGHT_SERIES)) {
      log(`Fetching ${id}`);
      const latest = await fetchLatest(apiKey, id);
      results[id] = {
        name,
        date: latest?.date ?? "N/A",
        value: latest?.value ?? null,
      };
    }

    output(success(results, "fred"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
