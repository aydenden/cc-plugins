# KIS API 엔드포인트 레퍼런스

## 공통 헤더

```
authorization: Bearer {token}
appkey: {KIS_APP_KEY}
appsecret: {KIS_APP_SECRET}
tr_id: {거래ID}
Content-Type: application/json; charset=utf-8
```

## 엔드포인트 목록

| 기능 | 엔드포인트 | TR ID |
|------|-----------|-------|
| 일봉 차트 | `/uapi/domestic-stock/v1/quotations/inquire-daily-itemchartprice` | `FHKST03010100` |
| 지수 현재가 | `/uapi/domestic-stock/v1/quotations/inquire-index-price` | `FHPUP02100000` |
| 투자자별 매매 | `/uapi/domestic-stock/v1/quotations/invest-opbysec` | `FHKST663400C0` |
| 투자의견 | `/uapi/domestic-stock/v1/quotations/invest-opinion` | `FHKST663300C0` |
| 재무비율 | `/uapi/domestic-stock/v1/finance/financial-ratio` | `FHKST66430300` |

## 시장구분 코드

| 코드 | 의미 |
|------|------|
| J | 주식 (종목) |
| U | 지수 |

## 응답 구조

```json
{
  "rt_cd": "0",        // 0=성공
  "msg_cd": "...",
  "msg1": "...",
  "output": {...},     // 단일 결과
  "output2": [...]     // 목록 결과 (일봉 등)
}
```

## 에러 코드

| 코드 | 의미 | 대응 |
|------|------|------|
| `EGW00201` | Rate limit 초과 | 200ms 대기 후 재시도 |
| `OPSP0007` | 데이터 없음 | 정상 — 빈 결과 반환 |
| `OPSP0002` | 데이터 없음 | 정상 — 빈 결과 반환 |

## 주요 종목코드

| 코드 | 종목 | | 코드 | 종목 |
|------|------|-|------|------|
| 005930 | 삼성전자 | | 000660 | SK하이닉스 |
| 035420 | NAVER | | 035720 | 카카오 |
| 051910 | LG화학 | | 006400 | 삼성SDI |
| 068270 | 셀트리온 | | 055550 | 신한지주 |
| 000270 | 기아 | | 012330 | 현대모비스 |

## 지수 코드

| 코드 | 지수 |
|------|------|
| 0001 | KOSPI |
| 1001 | KOSDAQ |
| 2001 | KOSPI200 |
