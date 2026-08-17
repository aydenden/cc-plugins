# 리서치 채널 레지스트리

조사 채널의 SSoT. `/llm-wiki:research`의 조사 서브에이전트가 이 파일을 읽고 그대로 따른다.
근거 실측은 `docs/research/2026-08-16-research-channels.md`(레포 루트)에 있다.

## 원칙

1. **질의 성격이 채널을 고른다.** 가용성은 그다음이다. 쓰지도 않을 채널을 탐지하지 않는다.
2. **필수 계층은 탐지하지 않는다.** 설치가 없으므로 항상 가용하다.
3. **선택 계층은 그 질의에 필요할 때만 1회 탐지한다.** `agent-reach doctor`를 매 조사마다 부르지 않는다.
4. **축퇴는 예외가 아니라 상시 경로다.** 채널이 없거나 상류가 깨지면 필수 계층만으로 완주하고,
   빠진 채널을 **산출물에 명시한다**. 조용히 빠뜨리는 것이 유일한 금지다.
5. **유료 서비스는 쓰지 않는다.** 무료·무키 경로만 채택한다.

## 필수 계층 — 전 기기, 설치 없음

| 질의 성격 | 채널 | 호출 |
|---|---|---|
| 학술 근거·논문 | arXiv · OpenAlex · Crossref · Europe PMC · PubMed | `scripts/research-channels.mjs papers` |
| 일반 웹·공식 문서 | CC 내장 WebSearch → WebFetch | 도구 직접 |
| 라이브러리 API·버전 | context7 MCP | `resolve-library-id` → `query-docs` |
| 인용된 트윗 원문 확인 | cdn.syndication.twimg.com | `scripts/research-channels.mjs tweet` |

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/research-channels.mjs" papers "<질의>" --limit 5
node "${CLAUDE_PLUGIN_ROOT}/scripts/research-channels.mjs" tweet <트윗 id 또는 URL>
```

- 출력은 이미 압축돼 있다(`title/authors/date/doi/url/abstract`, 중복 병합). 전문이 필요할 때만 `--json`.
- `skipped: <소스> (<사유>)` 줄이 있으면 그 소스는 빠진 것이다 — 산출물의 제외 채널에 옮긴다.
- 스크립트가 없거나 `node`가 없으면 그것도 축퇴다. WebSearch로 대체하고 명시한다.

## 선택 계층 — 주력 기기(설치·인증 완료된 기기)만

| 질의 성격 | 채널 | 탐지 | 축퇴 |
|---|---|---|---|
| 코드·저장소 사실 | `gh` CLI | `command -v gh` | GitHub 웹 페이지를 WebFetch |
| 커뮤니티 여론 | Reddit `rdt-cli` | `command -v rdt` | WebSearch에 `site:reddit.com` |
| 인물 발언·최신 발표 | X `twitter user-posts` / `twitter list` | `command -v twitter` | 신규 수집 포기, 기존 인용만 필수 계층으로 확인 |
| 영상 내용 | YouTube `yt-dlp` 자막 | `command -v yt-dlp` | 영상 채널 제외를 명시 |

설치·인증은 `/llm-wiki:setup-channels`가 담당한다. **조사 도중에 설치를 제안하지 않는다** —
조사 흐름이 끊기고 실패 원인(설치 실패 vs 상류 API 오류)이 뒤엉킨다.

### 탐지는 `command -v`로 끝나지 않는다

2026-08-16 실측에서 `agent-reach doctor`가 ✅로 보고한 `twitter search`가 실호출 HTTP 404였다.
바이너리 존재는 가용성이 아니다. 선택 채널은 **첫 실호출의 성패로 판정**하고, 실패하면 즉시
축퇴해 다음 채널로 넘어간다. 같은 채널을 재시도하며 시간을 쓰지 않는다.

### X는 검색이 아니라 큐레이션 계정 폴링이다

X 전체 검색은 불가능하다(`twitter search` 404, syndication timeline은 IP 레이트리밋으로 사실상
차단). 그래서 **추적 계정 목록 페이지가 채널의 선행 조건**이며, 볼트에 페이지로 둔다
(계정마다 추적 이유를 함께 적는다). 목록이 없으면 X 채널은 동작하지 않으므로 축퇴로 처리한다.

## 감싸지 않는 것

WebSearch·WebFetch(CC 내장), context7(MCP), Reddit·X 수집·YouTube·gh(이미 CLI).
래퍼를 두면 유지비만 늘고 얻는 게 없다.
