#!/usr/bin/env bun
// --- KRX 섹터별 지수 ---
// Usage: bun run scripts/krx/sector-index.ts [date]
// KRX 파생상품 일별 거래 데이터에서 전체 지수 목록 조회

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";

const KRX_API = "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd";
const KRX_SAMPLE = "https://data-dbg.krx.co.kr/svc/sample/apis/idx/drvprod_dd_trd";

interface IndexData {
  name: string;
  date: string;
  close: number;
}

function formatDate(d: Date): string {
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

function prevBusinessDay(dateStr: string, daysBack: number): string {
  const y = parseInt(dateStr.slice(0, 4));
  const m = parseInt(dateStr.slice(4, 6)) - 1;
  const d = parseInt(dateStr.slice(6, 8));
  const date = new Date(y, m, d);
  date.setDate(date.getDate() - daysBack);
  return formatDate(date);
}

async function fetchIndices(apiKey: string, basDd: string): Promise<IndexData[] | null> {
  // Stage 1: 정식 API
  try {
    const url = `${KRX_API}?basDd=${basDd}`;
    const resp = await fetchWithRetry(url, { headers: { AUTH_KEY: apiKey }, maxRetries: 1 });
    if (resp.ok) {
      const data = await parseIndices(resp, basDd);
      if (data && data.length > 0) return data;
    }
  } catch { /* fallback */ }

  // Stage 2: 샘플 API
  try {
    const url = `${KRX_SAMPLE}?basDd=${basDd}&AUTH_KEY=${apiKey}`;
    const resp = await fetchWithRetry(url, { maxRetries: 1 });
    if (resp.ok) {
      return await parseIndices(resp, basDd);
    }
  } catch { /* ignore */ }

  return null;
}

async function parseIndices(resp: Response, basDd: string): Promise<IndexData[]> {
  const json = await resp.json() as { OutBlock_1?: Array<{ IDX_NM: string; BAS_DD: string; CLSPRC_IDX: string }> };
  const rows = json.OutBlock_1;
  if (!rows) return [];

  return rows
    .map((r) => ({
      name: r.IDX_NM,
      date: `${basDd.slice(0, 4)}-${basDd.slice(4, 6)}-${basDd.slice(6, 8)}`,
      close: parseFloat(r.CLSPRC_IDX),
    }))
    .filter((r) => !isNaN(r.close));
}

// --- Main ---

async function main() {
  const apiKey = requireEnv("KRX_API_KEY");
  const argDate = Bun.argv[2];
  const baseDate = argDate ?? formatDate(new Date());

  for (let i = 0; i <= 2; i++) {
    const targetDate = i === 0 ? baseDate : prevBusinessDay(baseDate, i);
    log(`Fetching indices for ${targetDate}`);
    const data = await fetchIndices(apiKey, targetDate);
    if (data && data.length > 0) {
      output(success({ date: targetDate, indices: data, count: data.length }, "krx"));
      return;
    }
  }

  output(fail("NOT_FOUND", `KRX 지수 데이터 없음 (${baseDate} 기준 3일 역추적)`));
}

main();
