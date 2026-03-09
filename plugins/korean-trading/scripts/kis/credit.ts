#!/usr/bin/env node
// --- KIS 신용잔고 ---
// Usage: bun run scripts/kis/credit.ts <ticker>

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run credit.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        stck_bsop_date: string;
        stck_clpr: string;
        acml_vol: string;
        crdt_new_qty: string;
        crdt_repy_qty: string;
        crdt_remn_qty: string;
        crdt_rate: string;
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
        credit_new: parseInt(r.crdt_new_qty || "0"),
        credit_repay: parseInt(r.crdt_repy_qty || "0"),
        credit_balance: parseInt(r.crdt_remn_qty || "0"),
        credit_rate: parseFloat(r.crdt_rate || "0"),
      }))
      .reverse();

    output(success({ ticker, count: rows.length, credits: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
