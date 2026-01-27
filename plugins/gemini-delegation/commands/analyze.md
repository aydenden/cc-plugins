---
description: "Gemini CLI로 분석 수행"
argument-hint: "<type> <target>"
allowed-tools:
  - Bash
  - Read
  - Glob
  - Task
---

# Gemini 분석 명령어

사용자가 `/gemini-delegation:analyze` 명령어를 실행했다.

## 인자 파싱

인자 형식: `<type> <target>`
- **type**: 분석 유형 (code, log, review)
- **target**: 분석 대상 파일/디렉토리 경로

예시:
- `/gemini-delegation:analyze code ./src`
- `/gemini-delegation:analyze log ./error.log`
- `/gemini-delegation:analyze review` (현재 브랜치 diff)

## 분석 유형별 처리

### code (코드베이스 분석)
gemini-codebase 에이전트를 호출하여 코드 분석 수행.

### log (로그 분석)
gemini-logs 에이전트를 호출하여 로그 분석 수행.

### review (코드 리뷰)
gemini-review 에이전트를 호출하여 PR/변경사항 리뷰 수행.

## 실행 절차

1. 인자에서 type과 target 추출
2. target 경로 유효성 확인
3. 해당 유형의 gemini-* 에이전트 호출
4. 분석 결과 반환

## 인자 없이 실행 시

분석 유형을 사용자에게 질문:
- 코드베이스 분석 (code)
- 로그/에러 분석 (log)
- PR/코드 리뷰 (review)
