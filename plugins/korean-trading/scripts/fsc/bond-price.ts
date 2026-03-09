#!/usr/bin/env bun
// --- 금융위원회 채권시세 조회 ---
// Usage: bun run scripts/fsc/bond-price.ts [date] [KTS|소액채권|일반채권]
// date: YYYYMMDD 형식, 생략 시 최근 영업일 자동 탐색
// market: 기본 KTS

import { fetchWithRetry, success, fail, output, requireEnv, log } from "../common/http.ts";

const BASE_URL = "https://apis.data.go.kr/1160100/service/GetBondSecuritiesInfoService/getBondPriceInfo";

interface DataGoKrResponse {
  response: {
    header: { resultCode: string; resultMsg: string };
    body: {
      totalCount: number;
      items: { item: Record<string, string>[] | Record<string, string> };
    };
  };
}

interface BondPrice {
  date: string;
  name: string;
  code: string;
  market: string;
  close_price: number;
  close_yield: number;
  volume: number;
  trade_amount: number;
  maturity: number;
}

function todayYYYYMMDD(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function subtractDays(dateStr: string, days: number): string {
  const d = new Date(`${dateStr.slice(0, 4)}-${dateStr.slice(4, 6)}-${dateStr.slice(6, 8)}`);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function normalizeItems(items: Record<string, string>[] | Record<string, string>): Record<string, string>[] {
  return Array.isArray(items) ? items : [items];
}

async function fetchBonds(serviceKey: string, date: string, market: string): Promise<{ items: Record<string, string>[]; totalCount: number } | null> {
  const params = new URLSearchParams({
    serviceKey,
    resultType: "json",
    numOfRows: "50",
    pageNo: "1",
    basDt: date,
    mrktCtg: market,
  });

  const url = `${BASE_URL}?${params}`;
  log(`Fetching bond prices for ${date}, market=${market}`);

  const resp = await fetchWithRetry(url);
  if (!resp.ok) {
    throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
  }

  const json = (await resp.json()) as DataGoKrResponse;

  if (json.response.header.resultCode !== "00") {
    throw new Error(`API 오류: ${json.response.header.resultMsg}`);
  }

  const totalCount = json.response.body.totalCount;
  if (totalCount === 0 || !json.response.body.items?.item) {
    return null;
  }

  return { items: normalizeItems(json.response.body.items.item), totalCount };
}

async function main() {
  const serviceKey = requireEnv("DATA_GO_KR_API_KEY");
  const inputDate = Bun.argv[2];
  const market = Bun.argv[3] ?? "KTS";

  try {
    let date = inputDate ?? todayYYYYMMDD();
    let result: { items: Record<string, string>[]; totalCount: number } | null = null;

    for (let attempt = 0; attempt < 4; attempt++) {
      result = await fetchBonds(serviceKey, date, market);
      if (result) break;
      log(`${date}에 데이터 없음, 이전 날짜로 재시도`);
      date = subtractDays(date, 1);
    }

    if (!result) {
      output(fail("NO_DATA", `최근 4일 내 ${market} 채권 데이터가 없습니다`));
      return;
    }

    const bonds: BondPrice[] = result.items.map((item) => ({
      date: item.basDt,
      name: item.itmsNm,
      code: item.srtnCd,
      market: item.mrktCtg,
      close_price: parseFloat(item.clprPrc ?? "0"),
      close_yield: parseFloat(item.clprBnfRt ?? "0"),
      volume: parseInt(item.trqu ?? "0", 10),
      trade_amount: parseFloat(item.trPrc ?? "0"),
      maturity: parseFloat(item.xpYrCnt ?? "0"),
    }));

    output(success({ date, market, count: bonds.length, bonds }, "fsc"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
