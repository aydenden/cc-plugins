#!/usr/bin/env bun
// --- KIS 공매도 현황 ---
// Usage: bun run scripts/kis/short-sale.ts <ticker>

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  const ticker = Bun.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run short-sale.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        stck_bsop_date: string;
        stck_clpr: string;
        acml_vol: string;
        ssts_cntg_qty: string;
        ssts_cntg_amt: string;
        stck_ssts_ratio: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice",
      "FHKST03010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
        FID_INPUT_DATE_1: (() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; })(),
        FID_INPUT_DATE_2: (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`; })(),
        FID_PERIOD_DIV_CODE: "D",
        FID_ORG_ADJ_PRC: "0",
      },
    );

    const rows = (json.output ?? [])
      .filter((r) => r.stck_bsop_date)
      .map((r) => ({
        date: `${r.stck_bsop_date.slice(0, 4)}-${r.stck_bsop_date.slice(4, 6)}-${r.stck_bsop_date.slice(6, 8)}`,
        close: parseInt(r.stck_clpr),
        volume: parseInt(r.acml_vol),
        short_qty: parseInt(r.ssts_cntg_qty || "0"),
        short_amount: parseInt(r.ssts_cntg_amt || "0"),
        short_ratio: parseFloat(r.stck_ssts_ratio || "0"),
      }))
      .reverse();

    output(success({ ticker, count: rows.length, short_sales: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
