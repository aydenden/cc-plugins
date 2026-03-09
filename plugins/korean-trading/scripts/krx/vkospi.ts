#!/usr/bin/env node
// --- KRX VKOSPI (변동성지수) ---
// Usage: bun run scripts/krx/vkospi.ts [date]
// 2-stage fallback: 정식 API → 샘플 API, 날짜 미지정 시 오늘부터 3일 역추적

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";

const KRX_API = "https://data-dbg.krx.co.kr/svc/apis/idx/drvprod_dd_trd";
const KRX_SAMPLE = "https://data-dbg.krx.co.kr/svc/sample/apis/idx/drvprod_dd_trd";

interface VkospiData {
  date: string;
  close: number;
  name: string;
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

async function fetchVkospi(apiKey: string, basDd: string): Promise<VkospiData | null> {
  // Stage 1: 정식 API (AUTH_KEY in header)
  try {
    log(`Trying official API for ${basDd}`);
    const url = `${KRX_API}?basDd=${basDd}`;
    const resp = await fetchWithRetry(url, {
      headers: { AUTH_KEY: apiKey },
      maxRetries: 1,
    });
    if (resp.ok) {
      const data = await parseVkospi(resp, basDd);
      if (data) return data;
    }
  } catch (err) {
    log(`Official API failed: ${(err as Error).message}`);
  }

  // Stage 2: 샘플 API (AUTH_KEY in query)
  try {
    log(`Trying sample API for ${basDd}`);
    const url = `${KRX_SAMPLE}?basDd=${basDd}&AUTH_KEY=${apiKey}`;
    const resp = await fetchWithRetry(url, { maxRetries: 1 });
    if (resp.ok) {
      return await parseVkospi(resp, basDd);
    }
  } catch (err) {
    log(`Sample API failed: ${(err as Error).message}`);
  }

  return null;
}

async function parseVkospi(resp: Response, basDd: string): Promise<VkospiData | null> {
  const json = await resp.json() as { OutBlock_1?: Array<{ IDX_NM: string; BAS_DD: string; CLSPRC_IDX: string }> };
  const rows = json.OutBlock_1;
  if (!rows || rows.length === 0) return null;

  const vkospi = rows.find((r) => r.IDX_NM.includes("VKOSPI") || r.IDX_NM.includes("변동성"));
  if (!vkospi) return null;

  const close = parseFloat(vkospi.CLSPRC_IDX);
  if (isNaN(close)) return null;

  return {
    date: `${basDd.slice(0, 4)}-${basDd.slice(4, 6)}-${basDd.slice(6, 8)}`,
    close,
    name: vkospi.IDX_NM,
  };
}

// --- Main ---

async function main() {
  const apiKey = requireEnv("KRX_API_KEY");
  const argDate = process.argv[2];
  const baseDate = argDate ?? formatDate(new Date());

  // 최대 3일 역추적 (휴일/비영업일 대응)
  for (let i = 0; i <= 2; i++) {
    const targetDate = i === 0 ? baseDate : prevBusinessDay(baseDate, i);
    const data = await fetchVkospi(apiKey, targetDate);
    if (data) {
      output(success(data, "krx"));
      return;
    }
    log(`No data for ${targetDate}, trying previous day`);
  }

  output(fail("NOT_FOUND", `VKOSPI 데이터 없음 (${baseDate} 기준 3일 역추적)`));
}

main();
