#!/usr/bin/env node
// --- KIS 해외주식 일봉/주봉/월봉 ---
// Usage: bun run scripts/kis/overseas-daily.ts <exchange> <ticker> [D|W|M]
// Exchange codes: NAS(나스닥), NYS(뉴욕), AMS(아멕스), HKS(홍콩), TSE(도쿄)
// Examples:
//   bun run scripts/kis/overseas-daily.ts NAS AAPL
//   bun run scripts/kis/overseas-daily.ts NYS MSFT W

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface OverseasCandle {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number;
  change_pct: number;
}

function resolveGubn(period?: string): string {
  switch (period?.toUpperCase()) {
    case "W": return "1";
    case "M": return "2";
    case "D": return "0";
    default: return "0";
  }
}

async function main() {
  const exchange = process.argv[2]?.toUpperCase();
  const ticker = process.argv[3]?.toUpperCase();
  const period = process.argv[4]?.toUpperCase() ?? "D";

  if (!exchange || !ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run overseas-daily.ts <거래소코드> <종목코드> [D|W|M]\n거래소: NAS, NYS, AMS, HKS, TSE"));
    return;
  }

  try {
    const json = await kisGet<{
      output2?: Array<{
        xymd: string;
        clos: string;
        open: string;
        high: string;
        low: string;
        tvol: string;
        diff: string;
        rate: string;
      }>;
    }>(
      "/uapi/overseas-price/v1/quotations/dailyprice",
      "HHDFS76240000",
      {
        AUTH: "",
        EXCD: exchange,
        SYMB: ticker,
        GUBN: resolveGubn(period),
        BYMD: "",
        MODP: "1",
      },
    );

    const candles: OverseasCandle[] = (json.output2 ?? [])
      .filter((r) => r.xymd)
      .map((r) => ({
        date: `${r.xymd.slice(0, 4)}-${r.xymd.slice(4, 6)}-${r.xymd.slice(6, 8)}`,
        open: parseFloat(r.open),
        high: parseFloat(r.high),
        low: parseFloat(r.low),
        close: parseFloat(r.clos),
        volume: parseInt(r.tvol),
        change: parseFloat(r.diff),
        change_pct: parseFloat(r.rate),
      }));

    output(success({ exchange, ticker, period, count: candles.length, candles }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
