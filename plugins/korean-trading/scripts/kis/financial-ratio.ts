#!/usr/bin/env bun
// --- KIS 재무비율 (PER/PBR/ROE) ---
// Usage: bun run scripts/kis/financial-ratio.ts <ticker>

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

async function main() {
  const ticker = Bun.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run financial-ratio.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: Array<{
        stac_yymm: string;
        grs: string;
        bsps: string;
        per: string;
        pbr: string;
        eps: string;
        roe_val: string;
        roa_val: string;
        dps: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/finance/financial-ratio",
      "FHKST66430300",
      {
        FID_DIV_CLS_CODE: "0",
        fid_cond_mrkt_div_code: "J",
        fid_input_iscd: ticker,
      },
    );

    const rows = (json.output ?? []).map((r) => ({
      period: r.stac_yymm,
      growth_rate: parseFloat(r.grs || "0"),
      bps: parseFloat(r.bsps || "0"),
      per: parseFloat(r.per || "0"),
      pbr: parseFloat(r.pbr || "0"),
      eps: parseFloat(r.eps || "0"),
      roe: parseFloat(r.roe_val || "0"),
      roa: parseFloat(r.roa_val || "0"),
      dps: parseFloat(r.dps || "0"),
    }));

    output(success({ ticker, count: rows.length, ratios: rows }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
