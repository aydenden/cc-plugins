---
name: ecos-macro
description: ECOS(한국은행 경제통계) 한국 매크로 경제 지표 조회. 기준금리, 국고채, CPI, 실업률 확인 시 자동 활성화.
---

# ECOS 한국 매크로 지표

## 필요 환경변수

- `ECOS_API_KEY`: 한국은행 ECOS API 키 (https://ecos.bok.or.kr)

## 스크립트 호출

```bash
# 단일 지표
bun run plugins/korean-trading/scripts/ecos/indicators.ts base_rate
bun run plugins/korean-trading/scripts/ecos/indicators.ts bond_10y 20240101

# 전체 지표
bun run plugins/korean-trading/scripts/ecos/indicators.ts all
```

## 사용 가능한 지표

| ID | 이름 | 주기 | 트레이딩 활용 |
|----|------|------|-------------|
| base_rate | 기준금리 | 월 | 금리 인하 → 유동성 증가 → 성장주 유리 |
| cpi | 소비자물가지수 | 월 | CPI 하락 → 금리 인하 기대 → 긍정적 |
| unemployment | 실업률 | 월 | 상승 시 경기둔화 → 방어주 선호 |
| bond_10y | 국고채 10년 | 일 | 금리 상승 → 주식 할인율 증가 |
| bond_2y | 국고채 2년 | 일 | 장단기 스프레드(10Y-2Y) 역전 → 경기침체 신호 |

## 해석 가이드

### 금리 사이클
1. **긴축기** (기준금리 ↑): 가치주, 은행주 유리
2. **동결기**: 업종별 차별화, 실적 기반 선별
3. **완화기** (기준금리 ↓): 성장주, IT, 바이오 유리

### 장단기 스프레드
- `bond_10y - bond_2y > 0`: 정상 — 경제 확장 기대
- `bond_10y - bond_2y < 0`: 역전 — 경기침체 시그널 (6~18개월 선행)
