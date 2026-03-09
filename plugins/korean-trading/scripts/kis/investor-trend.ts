#!/usr/bin/env bun
// --- KIS 투자자별 매매동향 ---
// Usage: bun run scripts/kis/investor-trend.ts <ticker>
// 외국인/기관/개인 순매수 동향

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  const ticker = Bun.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run investor-trend.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        stck_bsop_date: string;
        prsn_ntby_qty: string;
        frgn_ntby_qty: string;
        orgn_ntby_qty: string;
        prsn_ntby_tr_pbmn: string;
        frgn_ntby_tr_pbmn: string;
        orgn_ntby_tr_pbmn: string;
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
        individual: { qty: parseInt(r.prsn_ntby_qty), amount: parseInt(r.prsn_ntby_tr_pbmn) },
        foreign: { qty: parseInt(r.frgn_ntby_qty), amount: parseInt(r.frgn_ntby_tr_pbmn) },
        institution: { qty: parseInt(r.orgn_ntby_qty), amount: parseInt(r.orgn_ntby_tr_pbmn) },
      }));

    output(success({ ticker, count: rows.length, trends: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
