#!/usr/bin/env node
// --- KIS 프로그램매매 동향 ---
// Usage: bun run scripts/kis/program-trade.ts <ticker>

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run program-trade.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        stck_bsop_date: string;
        stck_clpr: string;
        acml_vol: string;
        prsn_ntby_qty: string;
        frgn_ntby_qty: string;
        orgn_ntby_qty: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/invest-opbysec",
      "FHKST663400C0",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
      },
    );

    const rows = (json.output ?? [])
      .filter((r) => r.stck_bsop_date)
      .map((r) => ({
        date: `${r.stck_bsop_date.slice(0, 4)}-${r.stck_bsop_date.slice(4, 6)}-${r.stck_bsop_date.slice(6, 8)}`,
        close: parseInt(r.stck_clpr || "0"),
        volume: parseInt(r.acml_vol || "0"),
        individual: parseInt(r.prsn_ntby_qty || "0"),
        foreign: parseInt(r.frgn_ntby_qty || "0"),
        institution: parseInt(r.orgn_ntby_qty || "0"),
      }));

    output(success({ ticker, count: rows.length, program_trades: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
