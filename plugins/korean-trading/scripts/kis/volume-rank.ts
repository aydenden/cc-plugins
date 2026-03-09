#!/usr/bin/env bun
// --- KIS 거래량 순위 ---
// Usage: bun run scripts/kis/volume-rank.ts [kospi|kosdaq|all] [min_volume]
// Examples:
//   bun run scripts/kis/volume-rank.ts
//   bun run scripts/kis/volume-rank.ts kospi 100000

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface VolumeRankItem {
  rank: number;
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  volume: number;
  prev_volume: number;
  avg_volume: number;
  volume_increase_rate: number;
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
  const market = Bun.argv[2];
  const minVolume = Bun.argv[3] ?? "";

  try {
    const json = await kisGet<{
      output?: Array<{
        hts_kor_isnm: string;
        mksc_shrn_iscd: string;
        data_rank: string;
        stck_prpr: string;
        prdy_ctrt: string;
        acml_vol: string;
        prdy_vol: string;
        avrg_vol: string;
        vol_inrt: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/volume-rank",
      "FHPST01710000",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_COND_SCR_DIV_CODE: "20171",
        FID_INPUT_ISCD: resolveMarketCode(market),
        FID_DIV_CLS_CODE: "0",
        FID_BLNG_CLS_CODE: "0",
        FID_TRGT_CLS_CODE: "111111111",
        FID_TRGT_EXLS_CLS_CODE: "0000000000",
        FID_INPUT_PRICE_1: "",
        FID_INPUT_PRICE_2: "",
        FID_VOL_CNT: minVolume,
        FID_INPUT_DATE_1: "",
      },
    );

    const items: VolumeRankItem[] = (json.output ?? [])
      .filter((r) => r.mksc_shrn_iscd)
      .map((r) => ({
        rank: parseInt(r.data_rank),
        ticker: r.mksc_shrn_iscd,
        name: r.hts_kor_isnm,
        price: parseInt(r.stck_prpr),
        change_pct: parseFloat(r.prdy_ctrt),
        volume: parseInt(r.acml_vol),
        prev_volume: parseInt(r.prdy_vol),
        avg_volume: parseInt(r.avrg_vol),
        volume_increase_rate: parseFloat(r.vol_inrt),
      }));

    output(success({ market: market ?? "all", count: items.length, items }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
