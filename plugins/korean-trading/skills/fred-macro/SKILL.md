---
name: fred-macro
description: FRED(미국 연방준비은행) 매크로 경제 지표를 조회하고 해석하는 스킬. 금리, VIX, 환율, CPI 등 미국 거시경제 데이터 분석 시 자동 활성화.
---

# FRED 매크로 경제 지표

## 스크립트 호출

```bash
# 단일 시리즈
node plugins/korean-trading/dist/fred/indicators.js FEDFUNDS

# 전체 시리즈
node plugins/korean-trading/dist/fred/indicators.js all

# 기간 지정
node plugins/korean-trading/dist/fred/indicators.js T10Y2Y 2024-01-01
```

## 필요 환경변수

- `FRED_API_KEY`: FRED API 키 (https://fred.stlouisfed.org/docs/api/api_key.html)

## 사용 가능한 시리즈

| ID | 이름 | 트레이딩 활용 |
|----|------|-------------|
| FEDFUNDS | 연방기금금리 | 금리 방향 → 성장주/가치주 로테이션 |
| T10Y2Y | 10Y-2Y 스프레드 | 역전 시 경기침체 시그널 |
| VIXCLS | VIX 지수 | >25 공포, <15 탐욕, 급등 시 단기 반등 기대 |
| DGS10 | 10년물 국채 | 금리 상승 → 주식 할인율 증가 |
| BAMLH0A0HYM2 | 하이일드 스프레드 | 확대 시 신용위험 증가, 리스크오프 |
| DTWEXBGS | 달러지수 | 강달러 → 신흥국 자금유출, 원화 약세 |
| CPIAUCSL | CPI | 인플레이션 추세 → 연준 정책 방향 |
| UNRATE | 실업률 | 고용시장 강도 → 경기 사이클 판단 |
| DEXKOUS | 원/달러 환율 | 원화 약세 시 외국인 매도 압력 증가 |

## 응답 해석 가이드

### JSON 구조
```json
{
  "ok": true,
  "data": {
    "FEDFUNDS": {
      "name": "연방기금금리",
      "observations": [{"date": "2024-01-01", "value": 5.33}, ...],
      "latest": {"date": "2024-12-01", "value": 4.33}
    }
  },
  "meta": {"source": "fred", "fetched_at": "..."}
}
```

### 핵심 해석 규칙
1. **금리 방향**: FEDFUNDS 하락 추세 → 유동성 완화, 성장주 유리
2. **수익률곡선**: T10Y2Y < 0 → 장단기 역전, 6~18개월 내 침체 가능성
3. **VIX 레벨**: <15 낮은 변동성(안정), 15~25 보통, >25 높은 변동성(주의), >35 극단적 공포
4. **달러-원화 연동**: DTWEXBGS ↑ + DEXKOUS ↑ → 외국인 순매도 강화 예상
5. **하이일드 스프레드**: 400bp 이상 → 신용시장 스트레스, 방어적 포지션 권장
