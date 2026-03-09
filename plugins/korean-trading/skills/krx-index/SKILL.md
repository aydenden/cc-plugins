---
name: krx-index
description: KRX(한국거래소) 지수 데이터 조회. VKOSPI 변동성지수, 섹터별 지수 확인 시 자동 활성화.
---

# KRX 지수 데이터

## 필요 환경변수

- `KRX_API_KEY`: KRX 데이터 API 키 (https://data.krx.co.kr)

## 스크립트 호출

```bash
# VKOSPI (변동성지수)
bun run plugins/korean-trading/scripts/krx/vkospi.ts              # 최근 영업일
bun run plugins/korean-trading/scripts/krx/vkospi.ts 20240315     # 특정 날짜

# 섹터별 지수
bun run plugins/korean-trading/scripts/krx/sector-index.ts        # 최근 영업일
bun run plugins/korean-trading/scripts/krx/sector-index.ts 20240315
```

## VKOSPI 해석

| 수준 | 의미 | 트레이딩 전략 |
|------|------|-------------|
| < 15 | 극도의 안정 | 옵션 매수, 변동성 확대 대비 |
| 15~20 | 보통 | 정상 트레이딩 |
| 20~25 | 불안 | 포지션 축소, 손절 타이트 |
| 25~30 | 공포 | 단기 반등 매매 가능, 소량만 |
| > 30 | 극단적 공포 | 현금 비중 극대화, 관망 |

## 비영업일 처리

- 휴일/주말 날짜로 호출 시 자동으로 최대 3일 역추적하여 마지막 영업일 데이터 반환
- 정식 API 실패 시 샘플 API로 자동 fallback
