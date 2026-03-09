#!/usr/bin/env node
// --- KIS 증권사 컨센서스 ---
// Usage: bun run scripts/kis/consensus.ts <ticker>

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run consensus.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        stck_bsop_date: string;
        invt_opnn: string;
        invt_opnn_cls_code: string;
        rgbf_invt_opnn: string;
        mbcr_name: string;
        stft_esdg: string;
        stck_prdy_clpr: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/invest-opinion",
      "FHKST663300C0",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
      },
    );

    const rows = (json.output ?? [])
      .filter((r) => r.stck_bsop_date)
      .map((r) => ({
        date: `${r.stck_bsop_date.slice(0, 4)}-${r.stck_bsop_date.slice(4, 6)}-${r.stck_bsop_date.slice(6, 8)}`,
        opinion: r.invt_opnn,
        opinion_code: r.invt_opnn_cls_code,
        prev_opinion: r.rgbf_invt_opnn,
        broker: r.mbcr_name,
        target_price: parseInt(r.stft_esdg || "0"),
        prev_close: parseInt(r.stck_prdy_clpr || "0"),
      }));

    output(success({ ticker, count: rows.length, opinions: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
