---
name: dart-disclosure
description: DART(전자공시시스템) 공시 및 재무제표 조회. 기업 공시, 배당, 유상증자, 주요주주, 재무제표 확인 시 자동 활성화.
---

# DART 공시 & 재무제표

## 필요 환경변수

- `DART_API_KEY`: DART OpenAPI 키 (https://opendart.fss.or.kr)

## 스크립트 호출

```bash
# 종목코드 → DART corp_code 변환
node plugins/korean-trading/dist/dart/corp-codes.js 005930

# 공시 10종 일괄 조회
node plugins/korean-trading/dist/dart/disclosure.js 005930 disclosures

# 재무제표
node plugins/korean-trading/dist/dart/disclosure.js 005930 financial 2024 annual
node plugins/korean-trading/dist/dart/disclosure.js 005930 financial 2024 1Q
```

## 공시 유형별 트레이딩 의미

| 공시 | 영향 | 해석 |
|------|------|------|
| 배당 (dividend) | 긍정/중립 | 배당수익률↑ → 배당락일 전 매수 전략 |
| 자사주 취득 | 강한 긍정 | 경영진의 주가 저평가 인식 → 주가 지지 |
| 유상증자 | 부정 | 지분 희석 → 단기 주가 하락 압력 |
| 무상증자 | 긍정 | 주식수 증가 but 기업 자신감 표현 |
| 전환사채(CB) | 약한 부정 | 전환 시 지분 희석 가능성 |
| 주요주주 변동 | 혼합 | 대주주 매도 → 부정, 매수 → 긍정 |
| 임원 주식거래 | 시그널 | 임원 매수 → 내부자의 긍정적 전망 |

## 재무제표 분기 코드

| quarter | 의미 | reprt_code |
|---------|------|-----------|
| 1Q | 1분기 | 11013 |
| 2Q | 반기 | 11012 |
| 3Q | 3분기 | 11014 |
| annual | 사업보고서 | 11011 |

## 종목코드 매핑

- 첫 호출 시 ZIP 파일 다운로드 후 7일간 캐시
- 캐시 위치: `~/.cache/claude-plugins/korean-trading/dart/corp_codes.json`
