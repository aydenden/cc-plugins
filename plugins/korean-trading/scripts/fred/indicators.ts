#!/usr/bin/env node
// --- FRED Economic Indicators ---
// Usage: bun run scripts/fred/indicators.ts <SERIES_ID|all> [start_date]
// Examples:
//   bun run scripts/fred/indicators.ts FEDFUNDS
//   bun run scripts/fred/indicators.ts all
//   bun run scripts/fred/indicators.ts T10Y2Y 2024-01-01

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";

const FRED_BASE = "https://api.stlouisfed.org/fred/series/observations";

const SERIES: Record<string, string> = {
  FEDFUNDS: "연방기금금리",
  T10Y2Y: "10년-2년 수익률곡선",
  VIXCLS: "VIX 변동성지수",
  DGS10: "미국 10년물 국채",
  BAMLH0A0HYM2: "하이일드 스프레드",
  DTWEXBGS: "무역가중 달러지수",
  CPIAUCSL: "소비자물가지수(CPI)",
  UNRATE: "실업률",
  DEXKOUS: "원/달러 환율",
};

interface Observation {
  date: string;
  value: number | null;
}

async function fetchSeries(
  apiKey: string,
  seriesId: string,
  startDate: string,
): Promise<Observation[]> {
  const params = new URLSearchParams({
    series_id: seriesId,
    api_key: apiKey,
    file_type: "json",
    observation_start: startDate,
  });

  const url = `${FRED_BASE}?${params}`;
  log(`Fetching ${seriesId}`);

  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = await resp.json() as { observations?: Array<{ date: string; value: string }> };
  if (!json.observations) {
    return [];
  }

  return json.observations.map((obs) => ({
    date: obs.date,
    value: obs.value === "." ? null : parseFloat(obs.value),
  }));
}

// --- Main ---

async function main() {
  const apiKey = requireEnv("FRED_API_KEY");
  const arg = process.argv[2];

  if (!arg) {
    output(fail("INVALID_ARGS", `사용법: bun run indicators.ts <SERIES_ID|all> [start_date]\n가능한 시리즈: ${Object.keys(SERIES).join(", ")}`));
    return;
  }

  const startDate = process.argv[3] ?? "2024-01-01";
  const isAll = arg.toLowerCase() === "all";
  const seriesIds = isAll ? Object.keys(SERIES) : [arg.toUpperCase()];

  if (!isAll && !SERIES[seriesIds[0]]) {
    output(fail("NOT_FOUND", `알 수 없는 시리즈: ${arg}. 가능한 시리즈: ${Object.keys(SERIES).join(", ")}`));
    return;
  }

  try {
    const results: Record<string, { name: string; observations: Observation[]; latest: Observation | null }> = {};

    for (const id of seriesIds) {
      const observations = await fetchSeries(apiKey, id, startDate);
      const latest = observations.filter((o) => o.value !== null).at(-1) ?? null;
      results[id] = { name: SERIES[id], observations, latest };
    }

    output(success(results, "fred"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
