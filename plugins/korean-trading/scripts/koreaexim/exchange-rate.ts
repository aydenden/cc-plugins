#!/usr/bin/env bun
// --- 한국수출입은행 환율 조회 ---
// Usage: bun run scripts/koreaexim/exchange-rate.ts [date]
// date: YYYYMMDD 형식, 생략 시 오늘 날짜

import { fetchWithRetry, success, fail, output, requireEnv, log } from "../common/http.ts";

interface ExchangeRateRaw {
  result: number;
  cur_unit: string;
  cur_nm: string;
  ttb: string;
  tts: string;
  deal_bas_r: string;
  bkpr: string;
  kftc_deal_bas_r: string;
}

interface ExchangeRate {
  currency: string;
  name: string;
  base_rate: number;
  buy_rate: number;
  sell_rate: number;
  book_price: number;
}

function parseRate(value: string): number {
  return parseFloat(value.replace(/,/g, ""));
}

function todayYYYYMMDD(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

async function main() {
  const apiKey = requireEnv("KOREAEXIM_API_KEY");
  const date = Bun.argv[2] ?? todayYYYYMMDD();

  const params = new URLSearchParams({
    authkey: apiKey,
    searchdate: date,
    data: "AP01",
  });

  const url = `https://oapi.koreaexim.go.kr/site/program/financial/exchangeJSON?${params}`;
  log(`Fetching exchange rates for ${date}`);

  try {
    const resp = await fetchWithRetry(url);
    if (!resp.ok) {
      throw new Error(`HTTP ${resp.status}: ${resp.statusText}`);
    }

    const json = (await resp.json()) as ExchangeRateRaw[];

    if (!json.length || json[0].result !== 1) {
      const resultCode = json.length ? json[0].result : "empty";
      throw new Error(`API 응답 오류 (result: ${resultCode})`);
    }

    const rates: ExchangeRate[] = json.map((item) => ({
      currency: item.cur_unit,
      name: item.cur_nm,
      base_rate: parseRate(item.deal_bas_r),
      buy_rate: parseRate(item.ttb),
      sell_rate: parseRate(item.tts),
      book_price: parseRate(item.bkpr),
    }));

    output(success({ date, count: rates.length, rates }, "koreaexim"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
