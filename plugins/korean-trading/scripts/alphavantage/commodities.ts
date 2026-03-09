#!/usr/bin/env node
// --- Alpha Vantage 원자재 가격 조회 ---
// Usage: bun run scripts/alphavantage/commodities.ts <WTI|BRENT|NATURAL_GAS|...> [daily|weekly|monthly]
// WARNING: Alpha Vantage 무료 API는 일 25건, 분당 5건으로 매우 제한적

import { fetchWithRetry, success, fail, output, requireEnv, log } from "../common/http.ts";

const VALID_COMMODITIES = [
  "WTI", "BRENT", "NATURAL_GAS", "COPPER", "ALUMINUM",
  "WHEAT", "CORN", "COTTON", "SUGAR", "COFFEE",
] as const;

type Commodity = typeof VALID_COMMODITIES[number];

const VALID_INTERVALS = ["daily", "weekly", "monthly"] as const;
type Interval = typeof VALID_INTERVALS[number];

interface AlphaVantageResponse {
  name: string;
  interval: string;
  unit: string;
  data: Array<{ date: string; value: string }>;
}

interface CommodityPrice {
  date: string;
  value: number;
}

async function main() {
  const apiKey = requireEnv("ALPHA_VANTAGE_API_KEY");
  const commodity = process.argv[2]?.toUpperCase() as Commodity | undefined;
  const interval = (process.argv[3] ?? "monthly") as Interval;

  if (!commodity || !VALID_COMMODITIES.includes(commodity)) {
    output(fail("INVALID_ARGS", `사용법: bun run commodities.ts <commodity> [interval]\n가능한 원자재: ${VALID_COMMODITIES.join(", ")}`));
    return;
  }

  if (!VALID_INTERVALS.includes(interval)) {
    output(fail("INVALID_ARGS", `유효하지 않은 간격: ${interval}. 가능: ${VALID_INTERVALS.join(", ")}`));
    return;
  }

  const params = new URLSearchParams({
    function: commodity,
    interval,
    apikey: apiKey,
  });

  const url = `https://www.alphavantage.co/query?${params}`;
  log(`Fetching ${commodity} prices (${interval})`);

  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = (await resp.json()) as AlphaVantageResponse;

    if (!json.data) {
      throw new Error("API 응답에 데이터가 없습니다. 일일 한도 초과일 수 있습니다.");
    }

    const prices: CommodityPrice[] = json.data
      .filter((d) => d.value !== ".")
      .map((d) => ({ date: d.date, value: parseFloat(d.value) }))
      .filter((d) => !isNaN(d.value))
      .slice(0, 30);

    output(success({
      commodity,
      name: json.name,
      unit: json.unit,
      interval: json.interval,
      count: prices.length,
      prices,
    }, "alphavantage"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
