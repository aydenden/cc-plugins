#!/usr/bin/env node
// --- KIS 일봉/분봉 OHLCV ---
// Usage: bun run scripts/kis/ohlcv.ts <ticker> [period] [start_date] [end_date]
// period: D(일봉), W(주봉), M(월봉) — 기본값 D
// Examples:
//   bun run scripts/kis/ohlcv.ts 005930
//   bun run scripts/kis/ohlcv.ts 005930 D 20240101 20241231

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface OhlcvRow {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run ohlcv.ts <종목코드> [D|W|M] [시작일] [종료일]"));
    return;
  }

  const period = (process.argv[3] ?? "D").toUpperCase();
  const now = new Date();
  const endDate = process.argv[5] ?? `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  const startDate = process.argv[4] ?? (() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3);
    return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
  })();

  try {
    const json = await kisGet<{
      output2?: Array<{
        stck_bsop_date: string;
        stck_oprc: string;
        stck_hgpr: string;
        stck_lwpr: string;
        stck_clpr: string;
        acml_vol: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      "FHKST03010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
        FID_INPUT_DATE_1: startDate,
        FID_INPUT_DATE_2: endDate,
        FID_PERIOD_DIV_CODE: period,
        FID_ORG_ADJ_PRC: "0",
      },
    );

    const rows: OhlcvRow[] = (json.output2 ?? [])
      .filter((r) => r.stck_bsop_date)
      .map((r) => ({
        date: `${r.stck_bsop_date.slice(0, 4)}-${r.stck_bsop_date.slice(4, 6)}-${r.stck_bsop_date.slice(6, 8)}`,
        open: parseInt(r.stck_oprc),
        high: parseInt(r.stck_hgpr),
        low: parseInt(r.stck_lwpr),
        close: parseInt(r.stck_clpr),
        volume: parseInt(r.acml_vol),
      }))
      .reverse();

    output(success({ ticker, period, count: rows.length, candles: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
