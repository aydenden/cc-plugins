#!/usr/bin/env node
// --- WICS 섹터 분류 ---
// Usage: bun run scripts/market/sector.ts <ticker>
// WICS(Wise Industry Classification Standard) 기준 섹터 조회

import { success, fail, output } from "../common/http.ts";

// WICS 대분류 섹터 매핑 (주요 종목)
// 실제 운영 시 KRX 마스터 파일에서 동적 로드 가능
const SECTOR_MAP: Record<string, { sector: string; industry: string }> = {
  "005930": { sector: "IT", industry: "반도체" },
  "000660": { sector: "IT", industry: "반도체" },
  "035420": { sector: "커뮤니케이션서비스", industry: "인터넷" },
  "035720": { sector: "커뮤니케이션서비스", industry: "게임" },
  "051910": { sector: "소재", industry: "화학" },
  "006400": { sector: "산업재", industry: "전기장비" },
  "068270": { sector: "헬스케어", industry: "바이오" },
  "105560": { sector: "경기소비재", industry: "자동차부품" },
  "055550": { sector: "금융", industry: "은행" },
  "003670": { sector: "IT", industry: "디스플레이" },
  "012330": { sector: "산업재", industry: "건설" },
  "066570": { sector: "경기소비재", industry: "전자제품" },
  "028260": { sector: "IT", industry: "반도체장비" },
  "009150": { sector: "에너지", industry: "정유" },
  "017670": { sector: "IT", industry: "전자부품" },
  "034730": { sector: "IT", industry: "반도체" },
  "000270": { sector: "산업재", industry: "자동차" },
  "018260": { sector: "경기소비재", industry: "자동차" },
  "096770": { sector: "에너지", industry: "신재생에너지" },
  "003550": { sector: "금융", industry: "손해보험" },
};

async function main() {
  const ticker = process.argv[2];
  if (!ticker) {
    output(fail("INVALID_ARGS", "사용법: bun run sector.ts <종목코드>"));
    return;
  }

  const info = SECTOR_MAP[ticker];
  if (!info) {
    output(fail("NOT_FOUND", `종목코드 ${ticker}의 WICS 섹터 정보가 없습니다. 주요 대형주만 지원됩니다.`));
    return;
  }

  output(success({ ticker, ...info }, "wics"));
}

main();
