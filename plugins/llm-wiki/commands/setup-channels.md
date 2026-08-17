---
description: 선택 계층 리서치 채널(gh·Reddit·X·YouTube)을 진단하고 설치한다
argument-hint: "[check | plan | install] [채널 id]"
---

선택 계층 리서치 채널을 점검해줘. 인자: $ARGUMENTS

## 이 커맨드가 없어도 리서치는 돈다

필수 계층(WebSearch·WebFetch·논문 5종 무키 API·트윗 단건)은 설치가 없다. 이 커맨드는 **옵트인으로 천장을 올릴 뿐**이며, 한 번도 실행하지 않은 기기에서도 `/llm-wiki:research`는 축퇴 경로로 완주해야 한다. 채널 정의는 `${CLAUDE_PLUGIN_ROOT}/docs/research-channels.md`가 SSoT다.

## 1. 진단 (인자가 없으면 기본)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-channels.mjs" check
```

각 채널을 **실제로 한 번 호출해** 판정한다(`command -v`로 끝내지 않는다 — doctor가 ✅ 하던 `twitter search`가 실호출 404였다). 상태는 넷이다:

| 상태 | 뜻 | 다음 행동 |
|---|---|---|
| `ok` | 설치·인증 완료 | 없음 |
| `auth` | 설치됐지만 로그인 안 됨 | 출력된 인증 명령을 **사용자에게 안내**한다 |
| `missing` | 바이너리 없음 | 2단계 |
| `broken` | 있는데 호출이 깨짐 | 상류 문제다. 설치로 고쳐지지 않으니 축퇴로 처리 |

`주의:` 줄이 붙은 채널은 일부 하위 명령이 죽은 것이다. 그 채널을 "가용"으로 보고할 때 이 주의를 함께 옮긴다.

## 2. 설치 (사용자가 요청했을 때만)

```bash
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-channels.mjs" plan            # 실행할 명령을 보여주기만
node "${CLAUDE_PLUGIN_ROOT}/scripts/setup-channels.mjs" install --yes   # 실제 실행
```

- `--yes` 없이는 **아무것도 바꾸지 않는다.** 먼저 `plan`을 보여주고 사용자 승인을 받은 뒤에 `--yes`를 붙인다.
- 특정 채널만: `--channel yt-dlp,gh`
- 패키지 매니저는 플랫폼에서 자동 감지한다(brew / apt / dnf / pacman / winget / scoop / pipx). 하나도 없으면 설치 불가를 그대로 보고한다.

## 3. 인증은 자동화하지 않는다

스크립트가 할 수 있는 건 바이너리까지다. `gh auth login`, `rdt login`, `twitter login`(브라우저 쿠키 추출)은 **명령을 출력만** 하고 사람에게 넘긴다. 대신 실행하려 들지 않는다 — 대화형 프롬프트와 쿠키 접근은 기기마다 사람이 해야 하는 일이다.

## 4. 보고

`ok`/`auth`/`missing`/`broken` 건수와 각 채널의 다음 행동 한 줄. 설치를 돌렸으면 성공·실패를 그대로 옮긴다. 인증이 남았으면 실행할 명령을 사용자에게 제시하고 끝낸다.
