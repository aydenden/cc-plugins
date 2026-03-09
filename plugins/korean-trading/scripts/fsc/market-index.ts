#!/usr/bin/env bun
// --- 금융위원회 시장지수 조회 ---
// Usage: bun run scripts/fsc/market-index.ts [stock|bond|derivative] [date] [index_name]
// type: 기본 stock
// date: YYYYMMDD 형식, 생략 시 최신
// index_name: 지수명 필터 (선택)

import { fetchWithRetry, success, fail, output, requireEnv, log } from "../common/http.ts";

const BASE_URL = "https://apis.data.go.kr/1160100/service/GetMarketIndexInfoService";

const ENDPOINTS: Record<string, string> = {
  stock: "/getStockMarketIndex",
  bond: "/getBondMarketIndex",
  derivative: "/getDerivationProductMarketIndex",
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

function mapStockIndex(item: Record<string, string>) {
  return {
    date: item.basDt,
    name: item.idxNm,
    close: parseFloat(item.clpr ?? "0"),
    change: parseFloat(item.vs ?? "0"),
    change_pct: parseFloat(item.fltRt ?? "0"),
    open: parseFloat(item.mkp ?? "0"),
    high: parseFloat(item.hipr ?? "0"),
    low: parseFloat(item.lopr ?? "0"),
    volume: parseInt(item.trqu ?? "0", 10),
    trade_amount: parseFloat(item.trPrc ?? "0"),
    market_cap: parseFloat(item.lstgMrktTotAmt ?? "0"),
  };
}

function mapBondIndex(item: Record<string, string>) {
  return {
    ...mapStockIndex(item),
    total_return_index: parseFloat(item.totBnfIdxClpr ?? "0"),
    net_price_index: parseFloat(item.nPrcIdxClpr ?? "0"),
    duration: parseFloat(item.durt ?? "0"),
    convexity: parseFloat(item.cnvt ?? "0"),
    ytm: parseFloat(item.ytm ?? "0"),
  };
}

async function main() {
  const serviceKey = requireEnv("DATA_GO_KR_API_KEY");
  const type = Bun.argv[2] ?? "stock";
  const date = Bun.argv[3] ?? "";
  const indexName = Bun.argv[4] ?? "";

  if (!ENDPOINTS[type]) {
    output(fail("INVALID_ARGS", `유효하지 않은 유형: ${type}. 가능: stock, bond, derivative`));
    return;
  }

  const endpoint = ENDPOINTS[type];
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: "50",
    pageNo: "1",
  });

  if (date) params.set("basDt", date);
  if (indexName && type === "stock") params.set("idxNm", indexName);

  const url = `${BASE_URL}${endpoint}?${params}`;
  log(`Fetching ${type} market index${date ? ` for ${date}` : ""}${indexName ? ` (${indexName})` : ""}`);

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
      output(success({ type, date, count: 0, indices: [] }, "fsc"));
      return;
    }

    const normalized = normalizeItems(rawItems);
    const indices = type === "bond"
      ? normalized.map(mapBondIndex)
      : normalized.map(mapStockIndex);

    const resultDate = date || (indices.length > 0 ? indices[0].date : "");
    output(success({ type, date: resultDate, count: indices.length, indices }, "fsc"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
