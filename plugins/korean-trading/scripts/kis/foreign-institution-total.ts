#!/usr/bin/env node
// --- KIS 외국인/기관 종합 순위 ---
// Usage: bun run scripts/kis/foreign-institution-total.ts [foreign|institution] [buy|sell] [kospi|kosdaq|all]
// Examples:
//   bun run scripts/kis/foreign-institution-total.ts foreign buy kospi
//   bun run scripts/kis/foreign-institution-total.ts institution sell all

import { kisGet } from "../common/kis-auth.ts";
import { success, fail, output } from "../common/http.ts";

interface ForeignInstitutionItem {
  ticker: string;
  name: string;
  price: number;
  change_pct: number;
  foreign_net_qty: number;
  institution_net_qty: number;
  individual_net_qty: number;
}

function resolveMarketCode(market?: string): string {
  switch (market?.toLowerCase()) {
    case "kospi": return "0001";
    case "kosdaq": return "1001";
    case "all": return "0000";
    default: return "0000";
  }
}

async function main() {
  const entityArg = process.argv[2]?.toLowerCase() ?? "foreign";
  const directionArg = process.argv[3]?.toLowerCase() ?? "buy";
  const market = process.argv[4];

  if (entityArg !== "foreign" && entityArg !== "institution") {
    output(fail("INVALID_ARGS", "사용법: bun run foreign-institution-total.ts [foreign|institution] [buy|sell] [kospi|kosdaq|all]"));
    return;
  }

  if (directionArg !== "buy" && directionArg !== "sell") {
    output(fail("INVALID_ARGS", "사용법: bun run foreign-institution-total.ts [foreign|institution] [buy|sell] [kospi|kosdaq|all]"));
    return;
  }

  const etcClsCode = entityArg === "foreign" ? "1" : "2";
  const rankSortCode = directionArg === "buy" ? "0" : "1";

  try {
    const json = await kisGet<{
      output?: Array<{
        hts_kor_isnm: string;
        mksc_shrn_iscd: string;
        stck_prpr: string;
        prdy_ctrt: string;
        frgn_ntby_qty: string;
        orgn_ntby_qty: string;
        prsn_ntby_qty: string;
      }>;
    }>(
      "/uapi/domestic-stock/v1/quotations/foreign-institution-total",
      "FHPTJ04400000",
      {
        FID_COND_MRKT_DIV_CODE: "V",
        FID_COND_SCR_DIV_CODE: "16449",
        FID_INPUT_ISCD: resolveMarketCode(market),
        FID_DIV_CLS_CODE: "0",
        FID_RANK_SORT_CLS_CODE: rankSortCode,
        FID_ETC_CLS_CODE: etcClsCode,
      },
    );

    const items: ForeignInstitutionItem[] = (json.output ?? [])
      .filter((r) => r.mksc_shrn_iscd)
      .map((r) => ({
        ticker: r.mksc_shrn_iscd,
        name: r.hts_kor_isnm,
        price: parseInt(r.stck_prpr),
        change_pct: parseFloat(r.prdy_ctrt),
        foreign_net_qty: parseInt(r.frgn_ntby_qty),
        institution_net_qty: parseInt(r.orgn_ntby_qty),
        individual_net_qty: parseInt(r.prsn_ntby_qty),
      }));

    output(success({ entity: entityArg, direction: directionArg, market: market ?? "all", count: items.length, items }, "kis"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
