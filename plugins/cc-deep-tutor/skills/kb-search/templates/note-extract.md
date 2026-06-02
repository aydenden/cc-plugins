<!--
note-extract.md — PDF/교과서 추출 노트 (type: extract).
note-core.md 의 코어 frontmatter + 아래 추가 필드. extract.sh 가 MinerU 추출 직후
summary/tags 를 OC(oc-summarize)에 위임해 자동 생성한다.
-->
---
id: <slug>
type: extract
title: <문서 제목>
summary: <1~2줄. 핵심 개념어 원형 포함>
tags: [<tag1>, <tag2>]
source: <원본 pdf 경로>
date: <YYYY-MM-DD>
# --- extract 추가 필드 ---
source_pdf: <원본 pdf 절대/상대 경로>
pages: <예: 1-12>
authors: [<저자1>, <저자2>]
---

# <title>

## 요약
<문서 핵심 2~3문장>

## 본문
<MinerU 추출 마크다운 구조(헤딩/수식/표)를 그대로 유지>

## Citations
- kb:<상대경로>#<h2섹션>
