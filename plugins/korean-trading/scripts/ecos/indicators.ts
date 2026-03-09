#!/usr/bin/env node
// --- ECOS (한국은행 경제통계) ---
// Usage: bun run scripts/ecos/indicators.ts <INDICATOR|all> [start_period]
// Examples:
//   bun run scripts/ecos/indicators.ts base_rate
//   bun run scripts/ecos/indicators.ts all
//   bun run scripts/ecos/indicators.ts bond_10y 20240101

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";

const ECOS_BASE = "https://ecos.bok.or.kr/api/StatisticSearch";

interface IndicatorDef {
  name: string;
  stat_code: string;
  item_code: string;
  cycle: "M" | "D";
}

const INDICATORS: Record<string, IndicatorDef> = {
  base_rate: { name: "기준금리", stat_code: "722Y001", item_code: "0101000", cycle: "M" },
  cpi: { name: "소비자물가지수", stat_code: "901Y009", item_code: "0", cycle: "M" },
  unemployment: { name: "실업률", stat_code: "901Y027", item_code: "3133*AA", cycle: "M" },
  bond_10y: { name: "국고채 10년", stat_code: "817Y002", item_code: "010210000", cycle: "D" },
  bond_2y: { name: "국고채 2년", stat_code: "817Y002", item_code: "010200000", cycle: "D" },
};

interface Observation {
  period: string;
  value: number | null;
}

function defaultStart(cycle: "M" | "D"): string {
  return cycle === "M" ? "202401" : "20240101";
}

function defaultEnd(cycle: "M" | "D"): string {
  const now = new Date();
  if (cycle === "M") {
    return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}`;
  }
  return `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
}

async function fetchIndicator(
  apiKey: string,
  def: IndicatorDef,
  startPeriod?: string,
): Promise<Observation[]> {
  const start = startPeriod ?? defaultStart(def.cycle);
  const end = defaultEnd(def.cycle);
  const url = `${ECOS_BASE}/${apiKey}/json/kr/1/1000/${def.stat_code}/${def.cycle}/${start}/${end}/${def.item_code}`;

  log(`Fetching ${def.name} (${def.stat_code})`);

  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = await resp.json() as { StatisticSearch?: { row?: Array<{ TIME: string; DATA_VALUE: string }> } };
  const rows = json.StatisticSearch?.row;
  if (!rows) return [];

  return rows.map((r) => ({
    period: r.TIME,
    value: r.DATA_VALUE === "" ? null : parseFloat(r.DATA_VALUE),
  }));
}

// --- Main ---

async function main() {
  const apiKey = requireEnv("ECOS_API_KEY");
  const arg = process.argv[2];

  if (!arg) {
    output(fail("INVALID_ARGS", `사용법: bun run indicators.ts <INDICATOR|all> [start_period]\n가능한 지표: ${Object.keys(INDICATORS).join(", ")}`));
    return;
  }

  const startPeriod = process.argv[3];
  const isAll = arg.toLowerCase() === "all";
  const keys = isAll ? Object.keys(INDICATORS) : [arg.toLowerCase()];

  if (!isAll && !INDICATORS[keys[0]]) {
    output(fail("NOT_FOUND", `알 수 없는 지표: ${arg}. 가능한 지표: ${Object.keys(INDICATORS).join(", ")}`));
    return;
  }

  try {
    const results: Record<string, { name: string; observations: Observation[]; latest: Observation | null }> = {};

    for (const key of keys) {
      const def = INDICATORS[key];
      const observations = await fetchIndicator(apiKey, def, startPeriod);
      const latest = observations.filter((o) => o.value !== null).at(-1) ?? null;
      results[key] = { name: def.name, observations, latest };
    }

    output(success(results, "ecos"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
