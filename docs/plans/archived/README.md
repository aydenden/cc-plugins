# 접은 설계들

폐기하거나 다른 레포로 이관한 설계 기록. **무엇을 왜 접었는지** 남기기 위해 지우지 않는다.

설계가 틀려서 접은 것은 하나도 없다. 전부 **제약이 바뀌어서** 접었다 — 여러 기기에서 쓰려니
설치가 걸림돌이 됐거나, 특정 프로젝트 전용이라 마켓플레이스에 있을 이유가 없어졌거나,
쓰지 않는데 유지비만 남았거나.

| 문서 | 접은 이유 |
|---|---|
| [`2026-07-25-llm-wiki-search-design.md`](2026-07-25-llm-wiki-search-design.md) | **자체 검색 백엔드 폐기.** Bun CLI + Orama BM25 + 형태소 분석 + bge-m3 벡터 + rerank. 설계 확정과 WASM 속도 spike까지 마쳤으나 구현 직전에 접었다. 여러 기기에서 쓰려면 `onnxruntime`·형태소 사전 설치가 필요했고, 무설치가 더 중요하다고 판단해 CC 내장 Grep 전수검색으로 갈아탔다 — 볼트 8.5MB에서 `rg` 전수검색이 0.02초라 실측상 충분했다. 결과: llm-wiki 런타임 의존성 0. 이 판단은 나중에 [recall 사후 검증](../../research/2026-08-17-recall-grep-eval.md)으로 확인했다 (MRR 0.955 ≥ 폐기한 하이브리드 0.868) |
| [`2026-05-11-cc-opencode-cmux-design.md`](2026-05-11-cc-opencode-cmux-design.md)<br>[`2026-05-11-cc-opencode-cmux-v0.2.0-knowledge-agents-design.md`](2026-05-11-cc-opencode-cmux-v0.2.0-knowledge-agents-design.md) | **cc-opencode 플러그인 제거** (2026-08-16). OpenCode에 작업을 위임하는 ACP 클라이언트. 장기 미사용 상태에서 유지비만 남았다 — opencode 버전 핀, 권한 정책, 서브에이전트 리다이렉트 훅. 쓰지 않는 기능의 유지비가 그 기능의 값어치를 넘었다 |
| [`2026-05-11-obsidian-knowledge-v0.3.0-phase-A-design.md`](2026-05-11-obsidian-knowledge-v0.3.0-phase-A-design.md) | **llm-wiki의 전신.** 당시 이름은 `obsidian-knowledge`였고, 조사를 OpenCode에 위임하는 구조였다. cc-opencode를 걷어내며 위임 분기를 없애고 직접 조사·작성 단일 경로로 재작성했다 |
| [`2026-06-02-deep-tutor-markdown-wiki-design.md`](2026-06-02-deep-tutor-markdown-wiki-design.md)<br>[`2026-06-02-deep-tutor-markdown-wiki-implementation.md`](2026-06-02-deep-tutor-markdown-wiki-implementation.md) | **cc-deep-tutor를 self-study 레포로 이관** (2026-07-26). 특정 프로젝트 전용이라 범용 마켓플레이스에 둘 이유가 없었다. 설계 자체는 살아서 그 레포에서 돈다. 여기 남은 건 Milvus 벡터검색을 마크다운 위키 + 파일검색으로 전환한 기록이며, 같은 판단이 llm-wiki에도 반복된다 |

이관 직전 스냅샷은 태그로 보존돼 있다 — `archive/removed-plugins-2026-07-25`,
`archive/migrated-plugins-2026-07-26`, `archive/removed-pm-2026-07-26`.
