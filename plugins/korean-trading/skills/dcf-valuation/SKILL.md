---
name: dcf-valuation
description: DCF(Discounted Cash Flow) 밸류에이션 분석. "DCF", "적정가", "내재가치", "밸류에이션" 등에 자동 활성화
---

# DCF 밸류에이션 분석

## Workflow

### Step 1: 기업 데이터 수집 (병렬)
```bash
# 재무비율 (PER/PBR/ROE/EPS)
bun run plugins/korean-trading/scripts/kis/financial-ratio.ts {ticker}
# 현재가 (시총, 상장주수)
bun run plugins/korean-trading/scripts/kis/current-price.ts {ticker}
# 기업재무정보 (매출액, 영업이익, 순이익, 총자산, 총부채)
bun run plugins/korean-trading/scripts/fsc/financial-statements.ts {crno} {year} summary
# 한국 금리 (10년 국고채 = 무위험수익률)
bun run plugins/korean-trading/scripts/ecos/indicators.ts bond_10y
```

### Step 2: FCFF(Free Cash Flow to Firm) 추정
1. **과거 재무 데이터 분석**
   - 최근 3~5년 매출 성장률 추세
   - 영업이익률 추세
   - CAPEX 비율 (있다면)

2. **5년 FCFF 프로젝션**
   - 매출 성장률: 과거 추세 + 업종 전망 고려
   - 영업이익률: 최근 3년 평균 기준
   - FCFF = EBIT × (1 - 세율) + 감가상각 - CAPEX - 운전자본 증가
   - 한국 법인세 실효세율: 약 20~25%
   - 감가상각/CAPEX 데이터 부족 시: FCFF ≈ 영업이익 × (1 - 세율) × 0.7 (보수적 추정)

3. **성장률 시나리오**
   | 시나리오 | Year 1-2 | Year 3-5 | 영구성장률 |
   |---------|---------|---------|----------|
   | Bear    | 과거 성장률 × 0.5 | 과거 × 0.3 | 1.5% |
   | Base    | 과거 성장률 | 과거 × 0.7 | 2.0% |
   | Bull    | 과거 성장률 × 1.3 | 과거 × 1.0 | 2.5% |

### Step 3: WACC(가중평균자본비용) 산출
1. **자기자본비용 (Ke)** = Rf + β × ERP
   - Rf (무위험수익률): 한국 10년 국고채 수익률 (ECOS bond_10y)
   - β: 업종 평균 베타 사용 (데이터 없으면 1.0 가정)
   - ERP (주식위험프리미엄): 한국 시장 6% (선진국 대비 높음)

2. **타인자본비용 (Kd)**: 회사채 수익률 또는 업종 평균 차입금리 × (1 - 세율)

3. **WACC** = Ke × (E/V) + Kd × (1-t) × (D/V)
   - E(시가총액) = current-price의 market_cap
   - D(부채) = financial-statements의 총부채
   - V = E + D
   - 데이터 부족 시 WACC 8~12% 범위로 가정

### Step 4: 기업가치 산출
1. **PV of FCFF** = Σ(FCFFt / (1+WACC)^t) for t=1 to 5
2. **터미널 가치(TV)** = FCFF5 × (1+g) / (WACC - g)
   - g = 영구성장률 (한국: 1.5~2.5%, 명목GDP 성장률 이하)
3. **PV of TV** = TV / (1+WACC)^5
4. **기업가치(EV)** = PV of FCFF + PV of TV
5. **주주가치** = EV - 순부채(= 총부채 - 현금성자산)
6. **적정 주가** = 주주가치 / 상장주수

### Step 5: 결과 출력

```
## DCF 밸류에이션 — {종목명} ({ticker})

### 핵심 가정
| 항목 | 값 |
|------|-----|
| 무위험수익률 (Rf) | {bond_10y}% |
| 주식위험프리미엄 (ERP) | 6.0% |
| 베타 (β) | {beta} |
| WACC | {wacc}% |
| 영구성장률 (g) | {g}% |

### 5년 FCFF 프로젝션
| 연도 | 매출액 | 성장률 | 영업이익 | FCFF |
|------|-------|--------|---------|------|
| Year 1 | ... | ...% | ... | ... |
| ... | ... | ... | ... | ... |

### 밸류에이션 결과
| 시나리오 | 적정주가 | 현재가 대비 |
|---------|---------|-----------|
| Bear    | {bear_price}원 | {bear_upside}% |
| Base    | {base_price}원 | {base_upside}% |
| Bull    | {bull_price}원 | {bull_upside}% |

### 민감도 분석 (WACC × 영구성장률)
| WACC \ g | 1.5% | 2.0% | 2.5% |
|----------|------|------|------|
| WACC-1% | ... | ... | ... |
| WACC    | ... | ... | ... |
| WACC+1% | ... | ... | ... |
```

### Step 6: 한계점 명시
- DCF는 가정에 민감 — 결과는 참고용
- 감가상각/CAPEX 데이터 부족 시 FCFF 추정 부정확
- 한국 기업 특수요소: 재벌 할인, 지배구조 리스크

## Important Notes
- crno(법인등록번호)가 없으면 DART corp-codes에서 조회 필요: `bun run plugins/korean-trading/scripts/dart/corp-codes.ts` → ticker로 검색
- 재무제표 데이터가 없으면 financial-ratio의 EPS/BPS 기반 간이 DCF로 대체
- 매매 추천이 아님, 투자 판단은 사용자 책임
