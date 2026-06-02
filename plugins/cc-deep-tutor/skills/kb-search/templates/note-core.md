<!--
note-core.md — 모든 cc-deep-tutor KB 노트의 공통 골격.
작성 규약 (검색 신뢰도의 핵심 — 반드시 지킬 것):
  1. summary 에 핵심 개념어의 "원형"을 반드시 포함한다 (grep 1차 히트 지점).
  2. tags 는 _wiki/tags.md 레지스트리에 있는 것만 사용한다.
     신규 개념이면 tags.md 에 한 줄 먼저 추가한 뒤 사용한다.
  3. Citations 는 `kb:<materials 기준 상대경로>#<h2 섹션>` 형식으로 고정한다.
검색 4대 필드 = id / title / summary / tags. 나머지는 출처추적·인용용.
종류별 추가 필드/섹션은 note-extract.md / note-research.md / note-solve.md 참조.
-->
---
id: <slug>                 # 파일명과 동일, 안정적 식별자 (백링크 대상)
type: <extract|research|solve|note>
title: <사람이 읽는 제목>
summary: <1~2줄. 검색 1차 타깃 — 핵심 개념어 원형 포함>
tags: [<tag1>, <tag2>]     # _wiki/tags.md 레지스트리에서만 선택
source: <pdf 경로 | url | "derived">
date: <YYYY-MM-DD>
---

# <title>

## 요약
<summary 를 2~3문장으로 확장>

## 본문
<종류별 확장 템플릿이 섹션을 지정>

## Citations
- kb:<상대경로>#<h2섹션>
- <url>
