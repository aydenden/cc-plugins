#!/usr/bin/env bun
// --- KIS 분봉 차트 ---
// Usage: bun run scripts/kis/minute-chart.ts <ticker> [from_time]
// 당일 데이터만 조회 가능, 장중(09:00~15:30) 유효
// Examples:
//   bun run scripts/kis/minute-chart.ts 005930
//   bun run scripts/kis/minute-chart.ts 005930 130000

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface MinuteCandle {
  time: string;
  close: number;
  open: number;
  high: number;
  low: number;
  volume: number;
  cumulative_volume: number;
}

async function main() {
  const ticker = Bun.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run minute-chart.ts <종목코드> [from_time]"));
    return;
  }

  const fromTime = Bun.argv[3] ?? "155000";

  try {
    const json = await kisGet<{
      output2?: Array<{
        stck_cntg_hour: string;
        stck_prpr: string;
        stck_oprc: string;
        stck_hgpr: string;
        stck_lwpr: string;
        cntg_vol: string;
        acml_vol: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/inquire-time-itemchartprice",
      "FHKST03010200",
      {
        FID_ETC_CLS_CODE: "",
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
        FID_INPUT_HOUR_1: fromTime,
        FID_PW_DATA_INCU_YN: "N",
      },
    );

    const candles: MinuteCandle[] = (json.output2 ?? [])
      .filter((r) => r.stck_cntg_hour)
      .map((r) => ({
        time: `${r.stck_cntg_hour.slice(0, 2)}:${r.stck_cntg_hour.slice(2, 4)}:${r.stck_cntg_hour.slice(4, 6)}`,
        close: parseInt(r.stck_prpr),
        open: parseInt(r.stck_oprc),
        high: parseInt(r.stck_hgpr),
        low: parseInt(r.stck_lwpr),
        volume: parseInt(r.cntg_vol),
        cumulative_volume: parseInt(r.acml_vol),
      }));

    output(success({ ticker, count: candles.length, candles }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
