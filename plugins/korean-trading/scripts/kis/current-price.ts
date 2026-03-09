#!/usr/bin/env bun
// --- KIS 현재가 조회 ---
// Usage: bun run scripts/kis/current-price.ts <ticker>
// Examples:
//   bun run scripts/kis/current-price.ts 005930

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface CurrentPrice {
  ticker: string;
  name: string;
  sector: string;
  price: number;
  change_pct: number;
  market_cap: number;
  per: number;
  pbr: number;
  eps: number;
  bps: number;
  w52_high: number;
  w52_low: number;
  foreign_net_qty: number;
  volume: number;
  trade_amount: number;
  open: number;
  high: number;
  low: number;
}

async function main() {
  const ticker = Bun.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run current-price.ts <종목코드>"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: {
        stck_prpr: string;
        prdy_ctrt: string;
        hts_avls: string;
        per: string;
        pbr: string;
        eps: string;
        bps: string;
        w52_hgpr: string;
        w52_lwpr: string;
        frgn_ntby_qty: string;
        acml_vol: string;
        acml_tr_pbmn: string;
        stck_oprc: string;
        stck_hgpr: string;
        stck_lwpr: string;
        bstp_kor_isnm: string;
      };
    }>(
      "/uapi/domestic-stock/v1/quotations/inquire-price",
      "FHKST01010100",
      {
        FID_COND_MRKT_DIV_CODE: "J",
        FID_INPUT_ISCD: ticker,
      },
    );

    const r = json.output;
    if (!r) {
      output(fail("NO_DATA", "현재가 데이터가 없습니다"));
      return;
    }

    const item: CurrentPrice = {
      ticker,
      name: r.bstp_kor_isnm,
      sector: r.bstp_kor_isnm,
      price: parseInt(r.stck_prpr),
      change_pct: parseFloat(r.prdy_ctrt),
      market_cap: parseInt(r.hts_avls),
      per: parseFloat(r.per),
      pbr: parseFloat(r.pbr),
      eps: parseInt(r.eps),
      bps: parseInt(r.bps),
      w52_high: parseInt(r.w52_hgpr),
      w52_low: parseInt(r.w52_lwpr),
      foreign_net_qty: parseInt(r.frgn_ntby_qty),
      volume: parseInt(r.acml_vol),
      trade_amount: parseInt(r.acml_tr_pbmn),
      open: parseInt(r.stck_oprc),
      high: parseInt(r.stck_hgpr),
      low: parseInt(r.stck_lwpr),
    };

    output(success(item, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
