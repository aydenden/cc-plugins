#!/usr/bin/env node
// --- 금융위원회 재무제표 조회 ---
// Usage: bun run scripts/fsc/financial-statements.ts <crno> [year] [summary|bs|income]
// crno: 법인등록번호
// year: 사업연도 (기본: 전년도)
// type: summary(요약재무), bs(재무상태표), income(손익계산서)

import { fetchWithRetry, success, fail, output, requireEnv, log } from "../common/http.ts";

const BASE_URL = "https://apis.data.go.kr/1160100/service/GetFinaStatInfoService_V2";

const ENDPOINTS: Record<string, string> = {
  summary: "/getSummFinaStat_V2",
  bs: "/getBs_V2",
  income: "/getIncoStat_V2",
};

interface DataGoKrResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      totalCount: number;
      items: { item: Record<string, string>[] | Record<string, string> };
    };
  };
}

function normalizeItems(items: Record<string, string>[] | Record<string, string>): Record<string, string>[] {
  return Array.isArray(items) ? items : [items];
}

function mapSummary(item: Record<string, string>) {
  return {
    bizYear: item.bizYear,
    revenue: parseFloat(item.enpSaleAmt ?? "0"),
    operating_profit: parseFloat(item.enpBzopPft ?? "0"),
    net_income: parseFloat(item.iclsPalClcAmt ?? "0"),
    total_assets: parseFloat(item.enpTastAmt ?? "0"),
    total_liabilities: parseFloat(item.enpTdbtAmt ?? "0"),
    capital: parseFloat(item.enpCptlAmt ?? "0"),
  };
}

function mapBsOrIncome(item: Record<string, string>) {
  return {
    account_name: item.acitNm,
    current_amount: parseFloat((item.thstrm_amount ?? "0").replace(/,/g, "")),
    previous_amount: parseFloat((item.frmtrm_amount ?? "0").replace(/,/g, "")),
  };
}

async function main() {
  const serviceKey = requireEnv("DATA_GO_KR_API_KEY");
  const crno = process.argv[2];

  if (!crno) {
    output(fail("INVALID_ARGS", "사용법: bun run financial-statements.ts <crno> [year] [summary|bs|income]"));
    return;
  }

  const year = process.argv[3] ?? String(new Date().getFullYear() - 1);
  const type = (process.argv[4] ?? "summary") as keyof typeof ENDPOINTS;

  if (!ENDPOINTS[type]) {
    output(fail("INVALID_ARGS", `유효하지 않은 유형: ${type}. 가능: summary, bs, income`));
    return;
  }

  const endpoint = ENDPOINTS[type];
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: "100",
    pageNo: "1",
    crno,
    bizYear: year,
  });

  const url = `${BASE_URL}${endpoint}?${params}`;
  log(`Fetching ${type} financial statements for CRNO=${crno}, year=${year}`);

  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = (await resp.json()) as DataGoKrResponse;

    if (json.response.header.resultCode !== "00") {
      throw new Error(`API 오류: ${json.response.header.resultMsg}`);
    }

    const rawItems = json.response.body.items?.item;
    if (!rawItems) {
      output(success({ crno, year, type, items: [] }, "fsc"));
      return;
    }

    const normalized = normalizeItems(rawItems);
    const items = type === "summary"
      ? normalized.map(mapSummary)
      : normalized.map(mapBsOrIncome);

    output(success({ crno, year, type, items }, "fsc"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
