# CC Plugins

개인용 Claude Code 플러그인 마켓플레이스. codex CLI에서도 동일한 `.claude-plugin/plugin.json` 구조로 인식되어 양쪽에서 사용 가능.

## 설치

### 마켓플레이스로 등록

```bash
# Claude Code
/plugin marketplace add aydenden/cc-plugins

# Private repo
/plugin marketplace add https://github.com/aydenden/cc-plugins.git

# codex CLI
codex plugin marketplace add aydenden/cc-plugins
```

등록 후 `/plugin` 명령어로 개별 플러그인을 선택하여 설치할 수 있습니다.

### 개별 플러그인 직접 사용

```bash
git clone https://github.com/aydenden/cc-plugins.git
claude --plugin-dir ./cc-plugins/plugins/<plugin-name>
```

## 포함된 플러그인

| 플러그인 | 버전 | 설명 | 커맨드 | 스킬 | 에이전트 | OpenCode |
|---------|------|------|--------|------|----------|----------|
| [obsidian-knowledge](./plugins/obsidian-knowledge) | v0.4.0 | Obsidian 볼트 기반 LLM Wiki — 엔티티 타입 분류, 출처 추적, 교차참조, 위키 건강점검. cc-opencode 가용 시 외부 조사·문서 작성을 OC에 위임 | 4 | 1 | 1 | O (`@aydenden/plugin-obsidian-knowledge`) |
| [korean-trading](./plugins/korean-trading) | v0.4.0 | 한국 주식 단타 트레이딩 분석 — KIS, KRX, DART, ECOS, FRED API | 6 | 17 | - | - |
| [worktree-task](./plugins/worktree-task) | v0.11.1 | Git worktree 기반 태스크 격리 개발 — 생성/제거, main 보호 | - | 3 | 1 | - |
| [pm](./plugins/pm) | v0.1.1 | PMS + Beads 통합 PM 워크플로우 — 로드맵, PRD, 에픽 분해 | 5 | 2 | 1 | - |
| [cmux-tools](./plugins/cmux-tools) | v0.1.0 | cmux 워크플로우 도구 | - | 1 | - | - |
| [codex-opencode-cmux](./plugins/codex-opencode-cmux) | v0.1.1 | codex captain + opencode crew + cmux IPC 3-tool orchestration | - | 4 | 1 | - |
| [cc-opencode](./plugins/cc-opencode) | v0.2.4 | Claude Code Opus(오케스트레이터) + OpenCode(저렴 모델 구현) + cmux(병렬 세션) 3-tool 위임 — 7종 task type, SSE 기반 hang 감지, 작업별 권한 차등 | 5 | 2 | 1 | - |
| [cc-deep-tutor](./plugins/cc-deep-tutor) | v0.1.0 | DeepTutor 메커니즘의 CC 네이티브 재구현 — memsearch KB + 분해·조사·풀이·출제·소크라테스 학습 루프. cc-opencode 가용 시 조사/압축/집필을 OC에 위임 | - | 5 | 7 | - |

## Agent 모델 정책

이 마켓플레이스의 모든 agent는 codex 1차 호환을 위해 codex 모델 ID를 사용합니다 (2026-05 기준).

| 역할 | 모델 |
|---|---|
| forwarding wrapper / 라우팅 | `gpt-5.4-mini` (codex subagent 공식 권장) |
| 조사·작성 / 구조화 추론 / 복잡 코딩 | `gpt-5.5` (most tasks 공식 추천) |

> `gpt-5.5`는 ChatGPT 로그인 인증 전용. BYOK 환경에선 `gpt-5.4` 또는 `gpt-5.3-codex`로 다운그레이드 필요.

## 디렉토리 구조

```
cc-plugins/
├── .claude-plugin/marketplace.json   # 마켓플레이스 정의
└── plugins/
    └── {plugin-name}/
        ├── .claude-plugin/plugin.json
        ├── commands/    # 슬래시 명령어 (.md)
        ├── skills/      # Agent Skills (SKILL.md)
        ├── agents/      # 서브에이전트 (.md, codex 모델 사용)
        └── hooks/       # 이벤트 훅 (hooks.json)
```

## 라이선스

MIT
