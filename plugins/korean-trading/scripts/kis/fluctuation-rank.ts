#!/usr/bin/env bun
// --- KIS 등락률 순위 ---
// Usage: bun run scripts/kis/fluctuation-rank.ts [up|down] [kospi|kosdaq|all]
// Examples:
//   bun run scripts/kis/fluctuation-rank.ts up kospi
//   bun run scripts/kis/fluctuation-rank.ts down kosdaq

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface FluctuationRankItem {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  change: number;
  change_pct: number;
  volume: number;
  high: number;
  low: number;
}

function resolveMarketCode(market?: string): string {
  switch (market?.toLowerCase()) {
    case "kospi": return "0001";
    case "kosdaq": return "1001";
    case "all": return "0000";
    default: return "0000";
  }
}

async function main() {
  const direction = Bun.argv[2]?.toLowerCase() ?? "up";
  const market = Bun.argv[3];

  if (direction !== "up" && direction !== "down") {
    output(fail("INVALID_ARGS", "사용법: bun run fluctuation-rank.ts [up|down] [kospi|kosdaq|all]"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        hts_kor_isnm: string;
        mksc_shrn_iscd: string;
        data_rank: string;
        stck_prpr: string;
        prdy_vrss: string;
        prdy_ctrt: string;
        acml_vol: string;
        stck_hgpr: string;
        stck_lwpr: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/ranking/fluctuation",
      "FHPST01700000",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_COND_SCR_DIV_CODE: "20170",
        FID_INPUT_ISCD: resolveMarketCode(market),
        FID_RANK_SORT_CLS_CODE: direction === "up" ? "0" : "1",
        FID_INPUT_CNT_1: "0",
        FID_PRC_CLS_CODE: "0",
        FID_INPUT_PRICE_1: "",
        FID_INPUT_PRICE_2: "",
        FID_VOL_CNT: "",
        FID_TRGT_CLS_CODE: "111111111",
        FID_TRGT_EXLS_CLS_CODE: "0000000000",
        FID_DIV_CLS_CODE: "0",
        FID_RSFL_RATE1: "",
        FID_RSFL_RATE2: "",
      },
    );

    const items: FluctuationRankItem[] = (json.output ?? [])
      .filter((r) => r.mksc_shrn_iscd)
      .map((r) => ({
        rank: parseInt(r.data_rank),
        ticker: r.mksc_shrn_iscd,
        name: r.hts_kor_isnm,
        price: parseInt(r.stck_prpr),
        change: parseInt(r.prdy_vrss),
        change_pct: parseFloat(r.prdy_ctrt),
        volume: parseInt(r.acml_vol),
        high: parseInt(r.stck_hgpr),
        low: parseInt(r.stck_lwpr),
      }));

    output(success({ direction, market: market ?? "all", count: items.length, items }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
