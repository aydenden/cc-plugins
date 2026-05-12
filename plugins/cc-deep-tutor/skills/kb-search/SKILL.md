---
name: kb-search
description: memsearch KB에서 검색·확장·인덱싱. "KB 검색", "자료 찾아줘", "memsearch"에 활성화.
---

# KB Search

memsearch CLI 래퍼. PDF 추출·인덱싱·검색을 한 곳에서. OC 위임 없음 (단순 CLI 래퍼).

## 사전 체크

```bash
PLUGIN_ROOT="${CLAUDE_PLUGIN_ROOT:?}"
eval "$("$PLUGIN_ROOT/scripts/resolve-config.sh")"

if ! command -v memsearch >/dev/null 2>&1; then
  echo "ERROR: memsearch 미설치" >&2
  exit 2
fi
```

## 명령 라우팅

`$ARGUMENTS`의 첫 단어로 분기:

| 명령 | 동작 |
|------|------|
| `search <쿼리> [-k N]` | `memsearch search "<쿼리>" -k <N or 5>` |
| `expand <hash>` | `memsearch expand <hash>` (L2 풀 컨텐츠) |
| `add <pdf>` | `${CLAUDE_PLUGIN_ROOT}/scripts/extract.sh <pdf>` (추출 + 자동 index) |
| `add-md <md>` | `memsearch index <md>` (markdown 직접) |
| `stats` | `memsearch stats` |
| `watch <dir>` | `memsearch watch <dir>` (디렉토리 자동 인덱싱) |

명령 모호하면 사용자에게 어떤 동작인지 묻기.

## 출력 가공

검색 결과는 표 형식:

```
| 점수 | 출처 | preview |
|------|------|---------|
| 0.50 | papers/attention.md (p.5) | Self-attention computes ... |
```

점수 0.4 미만은 회색 표시 + "관련도 낮음" 경고.

## 인자

`$ARGUMENTS`: 위 명령 중 하나 + 인자.

## 사용 예

```
/cc-deep-tutor:kb-search search "self-attention"
/cc-deep-tutor:kb-search add materials/papers/attention.pdf
/cc-deep-tutor:kb-search stats
```
