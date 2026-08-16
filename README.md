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

| 플러그인 | 버전 | 설명 | 커맨드 | 스킬 | 에이전트 |
|---------|------|------|--------|------|----------|
| [llm-wiki](./plugins/llm-wiki) | v0.6.0 | Obsidian 볼트 기반 LLM Wiki — 전용 검색 CLI(Orama BM25+형태소+bge-m3 벡터 하이브리드+rerank, 초성·증분·lint·link-boost·decay·watch), 출처 추적, 교차참조 | 4 | 1 | 1 |
| [memory-guard](./plugins/memory-guard) | v0.2.0 | CC auto memory 비대·stale 방지 — MEMORY.md 인덱스 한도 초과 write 차단 + 하루 1회 SessionStart 점검 리포트 | - | - | - |

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
