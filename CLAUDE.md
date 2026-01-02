# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

개인용 Claude Code 플러그인 마켓플레이스. 여러 플러그인을 `plugins/` 디렉토리에서 관리하고, `.claude-plugin/marketplace.json`으로 전체 목록을 정의합니다.

## 디렉토리 구조

```
cc-plugins/
├── .claude-plugin/marketplace.json   # 마켓플레이스 정의
├── plugins/                          # 개별 플러그인들
│   └── {plugin-name}/
│       ├── .claude-plugin/plugin.json
│       ├── commands/    # 슬래시 명령어 (.md)
│       ├── skills/      # Agent Skills (skill-name/SKILL.md)
│       ├── agents/      # 서브에이전트 (.md)
│       └── hooks/       # 이벤트 훅 (hooks.json)
└── templates/plugin-template/        # 새 플러그인 템플릿
```

## 새 플러그인 추가 방법

1. 템플릿 복사:
   ```bash
   cp -r templates/plugin-template plugins/my-new-plugin
   ```

2. `plugins/my-new-plugin/.claude-plugin/plugin.json` 수정:
   - `name`: 플러그인 이름 (kebab-case)
   - `description`: 플러그인 설명

3. `.claude-plugin/marketplace.json`의 `plugins` 배열에 추가:
   ```json
   {
     "name": "my-new-plugin",
     "source": "./plugins/my-new-plugin",
     "description": "플러그인 설명",
     "version": "0.1.0"
   }
   ```

## 플러그인 테스트

개별 플러그인 테스트:
```bash
claude --plugin-dir ./plugins/example-plugin
```

## 컴포넌트 작성 가이드

### Commands (슬래시 명령어)
- 위치: `plugins/{plugin}/commands/{command}.md`
- 명령어 이름: `/plugin-name:command`
- YAML frontmatter에 `description` 필수

### Skills (자동 감지 기능)
- 위치: `plugins/{plugin}/skills/{skill-name}/SKILL.md`
- YAML frontmatter에 `name`, `description` 필수
- Claude가 작업 맥락에 맞게 자동 호출

### Agents (서브에이전트)
- 위치: `plugins/{plugin}/agents/{agent}.md`
- YAML frontmatter에 `description` 필수

### Hooks (이벤트 핸들러)
- 위치: `plugins/{plugin}/hooks/hooks.json`
- 이벤트: PreToolUse, PostToolUse, Stop, SessionStart 등
- 스크립트 경로에 `${CLAUDE_PLUGIN_ROOT}` 사용

## 다른 기기에서 설치

GitHub에 push 후:
```bash
/plugin marketplace add aydenden/cc-plugins
# 또는 private repo:
/plugin marketplace add https://github.com/aydenden/cc-plugins.git
```
