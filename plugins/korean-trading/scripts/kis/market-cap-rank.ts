#!/usr/bin/env node
// --- KIS 시가총액 순위 ---
// Usage: bun run scripts/kis/market-cap-rank.ts [kospi|kosdaq|all] [count]
// Examples:
//   bun run scripts/kis/market-cap-rank.ts kospi 10
//   bun run scripts/kis/market-cap-rank.ts all

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface MarketCapRankItem {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  volume: number;
  market_cap: number;
  listed_shares: number;
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
  const market = process.argv[2];
  const countArg = process.argv[3] ? parseInt(process.argv[3]) : undefined;

  try {
    const json = await kisGet<{
      output?: Array<{
        hts_kor_isnm: string;
        mksc_shrn_iscd: string;
        data_rank: string;
        stck_prpr: string;
        prdy_ctrt: string;
        acml_vol: string;
        hts_avls: string;
        lstn_stcn: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/ranking/market-cap",
      "FHPST01740000",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_COND_SCR_DIV_CODE: "20174",
        FID_INPUT_ISCD: resolveMarketCode(market),
        FID_DIV_CLS_CODE: "0",
        FID_INPUT_PRICE_1: "",
        FID_INPUT_PRICE_2: "",
        FID_VOL_CNT: "",
        FID_TRGT_CLS_CODE: "111111111",
        FID_TRGT_EXLS_CLS_CODE: "0000000000",
      },
    );

    let items: MarketCapRankItem[] = (json.output ?? [])
      .filter((r) => r.mksc_shrn_iscd)
      .map((r) => ({
        rank: parseInt(r.data_rank),
        ticker: r.mksc_shrn_iscd,
        name: r.hts_kor_isnm,
        price: parseInt(r.stck_prpr),
        change_pct: parseFloat(r.prdy_ctrt),
        volume: parseInt(r.acml_vol),
        market_cap: parseInt(r.hts_avls),
        listed_shares: parseInt(r.lstn_stcn),
      }));

    if (countArg && countArg > 0) {
      items = items.slice(0, countArg);
    }

    output(success({ market: market ?? "all", count: items.length, items }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
