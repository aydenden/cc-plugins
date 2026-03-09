#!/usr/bin/env node
// --- KIS KOSPI/KOSDAQ 지수 ---
// Usage: bun run scripts/kis/index-price.ts [index_code]
// index_code: 0001(KOSPI), 1001(KOSDAQ), 2001(KOSPI200) — 기본값 전체

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

const INDEX_CODES: Record<string, string> = {
  "0001": "KOSPI",
  "1001": "KOSDAQ",
  "2001": "KOSPI200",
};

async function fetchIndex(code: string) {
  const json = await kisGet<{
    output?: {
      bstp_nmix_prpr: string;
      bstp_nmix_prdy_vrss: string;
      bstp_nmix_prdy_ctrt: string;
      acml_vol: string;
      acml_tr_pbmn: string;
    };
  }>(
    "/uapi/domestic-stock/v1/quotations/inquire-index-price",
    "FHPUP02100000",
    {
      FID_COND_MRKT_DIV_CODE: "U",
      FID_INPUT_ISCD: code,
    },
  );

  const o = json.output;
  if (!o) return null;

  return {
    code,
    name: INDEX_CODES[code] ?? code,
    price: parseFloat(o.bstp_nmix_prpr),
    change: parseFloat(o.bstp_nmix_prdy_vrss),
    change_pct: parseFloat(o.bstp_nmix_prdy_ctrt),
    volume: parseInt(o.acml_vol),
    amount: parseInt(o.acml_tr_pbmn),
  };
}

async function main() {
  const argCode = process.argv[2];
  const codes = argCode ? [argCode] : Object.keys(INDEX_CODES);

  try {
    const results = [];
    for (const code of codes) {
      const data = await fetchIndex(code);
      if (data) results.push(data);
    }

    output(success({ indices: results }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
