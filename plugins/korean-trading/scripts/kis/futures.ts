#!/usr/bin/env node
// --- KIS 선물/옵션 P/C Ratio ---
// Usage: bun run scripts/kis/futures.ts

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  try {
    // KOSPI200 선물 지수
    const futuresJson = await kisGet<{
      output?: {
        bstp_nmix_prpr: string;
        bstp_nmix_prdy_vrss: string;
        bstp_nmix_prdy_ctrt: string;
        acml_vol: string;
      };
    }>(
      "/uapi/domestic-stock/v1/quotations/inquire-index-price",
      "FHPUP02100000",
      {
        FID_COND_MRKT_DIV_CODE: "U",
        FID_INPUT_ISCD: "2001",
      },
    );

    const f = futuresJson.output;

    const result = {
      kospi200: f ? {
        price: parseFloat(f.bstp_nmix_prpr),
        change: parseFloat(f.bstp_nmix_prdy_vrss),
        change_pct: parseFloat(f.bstp_nmix_prdy_ctrt),
        volume: parseInt(f.acml_vol),
      } : null,
    };

    output(success(result, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
