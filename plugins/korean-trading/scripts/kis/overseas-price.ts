#!/usr/bin/env node
// --- KIS 해외주식 현재가 ---
// Usage: bun run scripts/kis/overseas-price.ts <exchange> <ticker>
// Exchange codes: NAS(나스닥), NYS(뉴욕), AMS(아멕스), HKS(홍콩), TSE(도쿄)
// Examples:
//   bun run scripts/kis/overseas-price.ts NAS AAPL
//   bun run scripts/kis/overseas-price.ts NYS MSFT

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface OverseasPrice {
  exchange: string;
  ticker: string;
  symbol: string;
  price: number;
  prev_close: number;
  change: number;
  change_pct: number;
  volume: number;
  trade_amount: number;
  orderable: string;
}

async function main() {
  const exchange = process.argv[2]?.toUpperCase();
  const ticker = process.argv[3]?.toUpperCase();

  if (!exchange || !ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run overseas-price.ts <거래소코드> <종목코드>\n거래소: NAS, NYS, AMS, HKS, TSE"));
    return;
  }

  try {
    const json = await kisGet<{
      output?: {
        rsym: string;
        last: string;
        base: string;
        diff: string;
        rate: string;
        tvol: string;
        tamt: string;
        ordy: string;
      };
    }>(
      "/uapi/overseas-price/v1/quotations/price",
      "HHDFS00000300",
      {
        AUTH: "",
        EXCD: exchange,
        SYMB: ticker,
      },
    );

    const r = json.output;
    if (!r) {
      output(fail("NO_DATA", "해외주식 가격 데이터가 없습니다"));
      return;
    }

    const item: OverseasPrice = {
      exchange,
      ticker,
      symbol: r.rsym,
      price: parseFloat(r.last),
      prev_close: parseFloat(r.base),
      change: parseFloat(r.diff),
      change_pct: parseFloat(r.rate),
      volume: parseInt(r.tvol),
      trade_amount: parseInt(r.tamt),
      orderable: r.ordy,
    };

    output(success(item, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
