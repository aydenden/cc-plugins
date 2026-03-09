---
name: peer-comps
description: 동종업체 비교(Comparable Companies) 분석. "비교", "동종업체", "peer", "comps", "섹터 비교" 등에 자동 활성화
---

# 동종업체 비교 분석 (Peer Comps)

## Workflow

### Step 1: 대상 기업 데이터 수집
```bash
# 대상 기업 현재가 + 밸류에이션
bun run plugins/korean-trading/scripts/kis/current-price.ts {ticker}
bun run plugins/korean-trading/scripts/kis/financial-ratio.ts {ticker}
```

### Step 2: 비교군 선정
1. **업종 확인**: current-price 응답의 `sector` (업종 한글명) 확인
2. **WICS 섹터 매핑**: `bun run plugins/korean-trading/scripts/market/sector.ts` 에서 동일 섹터 종목 추출
3. **비교군 선정 기준**:
   - 동일 WICS 대분류 (최소 3개, 최대 8개)
   - 시가총액 유사 범위 (0.2x ~ 5x)
   - 사업 모델 유사성 고려

### Step 3: 비교군 데이터 수집 (병렬)
각 비교 대상 종목에 대해:
```bash
bun run plugins/korean-trading/scripts/kis/current-price.ts {peer_ticker}
bun run plugins/korean-trading/scripts/kis/financial-ratio.ts {peer_ticker}
```

### Step 4: 핵심 배수(Multiple) 비교
| 배수 | 산출 방법 |
|------|----------|
| PER | current-price의 per |
| PBR | current-price의 pbr |
| EV/EBITDA | (시총 + 순부채) / EBITDA — 데이터 제한 시 PER로 대체 |
| PSR | 시총 / 매출액 — financial-statements 필요 |
| ROE | financial-ratio의 roe |
| 배당수익률 | financial-ratio의 dps / price |

### Step 5: 통계 분석
각 배수별로:
- Min, 25th Percentile, Median, 75th Percentile, Max
- 대상 기업의 위치 (백분위)

### Step 6: 결과 출력

```
## 동종업체 비교 — {종목명} ({ticker})

### 비교군
| 종목 | 시총(억) | PER | PBR | ROE(%) | 배당률(%) |
|------|---------|-----|-----|--------|----------|
| **{대상}** | **{cap}** | **{per}** | **{pbr}** | **{roe}** | **{div}** |
| {peer1} | ... | ... | ... | ... | ... |
| {peer2} | ... | ... | ... | ... | ... |
| ... | ... | ... | ... | ... | ... |

### 배수 통계
| 배수 | Min | 25th | Median | 75th | Max | {대상} | 위치 |
|------|-----|------|--------|------|-----|--------|------|
| PER  | ... | ...  | ...    | ...  | ... | ...    | ...  |
| PBR  | ... | ...  | ...    | ...  | ... | ...    | ...  |
| ROE  | ... | ...  | ...    | ...  | ... | ...    | ...  |

### Implied Valuation (중앙값 기준)
| 배수 기준 | 적정주가 | 현재가 대비 |
|----------|---------|-----------|
| Median PER 적용 | ...원 | ...% |
| Median PBR 적용 | ...원 | ...% |

### 판단
- 프리미엄/디스카운트 사유 분석
- 한국 특수요소: 재벌 할인 (지배구조), 소액주주 리스크
```

## Important Notes
- 비교군이 3개 미만이면 인접 섹터로 확대
- EV/EBITDA는 재무제표 데이터 필요 — 없으면 PER/PBR 중심으로 분석
- 적자 기업(PER 음수)은 PBR, PSR 중심으로 비교
- 매매 추천이 아님, 투자 판단은 사용자 책임
