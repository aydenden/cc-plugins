# llm-wiki 검색 백엔드 설계 (자체 Bun CLI)

- 상태: **설계 확정 · Rust→Bun 전환 · WASM 속도 spike 완료 · 구현 대기** (구현은 다음 세션)
- 작성일: 2026-07-25 (2026-07 라이브러리 검증·볼트 실측·Bun 전환·임베딩 속도 spike 반영)
- 대상 플러그인: `plugins/obsidian-knowledge`
- 산출물: 볼트 검색 전용 Bun/TypeScript CLI **`llm-wiki`** + 이를 호출하도록 개편된 스킬/커맨드
- **스택 전환 배경**: 초안은 Rust(tantivy+lindera+fastembed+usearch)였으나, 회사 Windows PC의 MSVC 툴체인·`ort` 크로스컴파일·코드서명 마찰을 없애기 위해 **Bun/TS**로 전환. 크로스컴파일·GHA matrix·코드서명은 **npm이 플랫폼별 native 프리빌트를 자동 제공**하므로 우리가 안 한다.
- **ONNX 백엔드 = native `onnxruntime-node`**(device cpu/coreml). 임베딩 속도 spike 결과(부록 E) "순수 WASM 통일"은 폐기 — Transformers.js의 Bun/Node 빌드가 `device: "wasm"`을 미지원하고 WASM 추론이 과도하게 느리기 때문. **회사 PC에서 `.node`/`onnxruntime.dll` 실행을 수용**(사용자 확정). 한국어 형태소 `lindera-wasm`만 WASM(순수). (Rust 초안 세부는 부록 D.)

---

## 1. 배경과 문제 정의

이 플러그인은 Karpathy의 [LLM Wiki gist](https://gist.github.com/karpathy/442a6bf555914893e9891c11519de94f) 패턴으로 Obsidian 볼트를 운영한다. gist 댓글 998개를 분석(신호필터 811개)하여 업그레이드 방향을 도출했고, 실사용 볼트를 실측해 근본 문제를 확인했다.

### 실측된 문제 (볼트: `$WIKI_PATH`, 2026-07-25 기준)

| 지표 | 값 | 의미 |
|---|---|---|
| 위키 페이지 | **562개** (concepts 496 · comparisons 36 · entities 7 · queries 4) | 이미 중규모 |
| `concepts/` 구조 | 완전 평면 (하위폴더 0) | MOC/계층 전무 |
| `index.md` 등록 링크 | **146개** | **562개 중 26%만 등록, 74% 누락** |
| `index.md` 크기 | 30k자 (~7.5k토큰) | 146개만 담고도 이 크기 |

**근본 원인**: `index.md`가 ① LLM 검색 진입점(`recall`이 여기를 Grep)이자 ② 사람 네비게이션을 겸한다. 수동 등록이라 74%가 누락됐고, 그 결과 **recall이 index를 Grep해도 페이지의 3/4를 못 찾는다.** 단일 `index.md` 전략은 이미 실질적으로 붕괴했다.

댓글 실증으로 확인된 임계점:
- **~100 페이지에서 `index.md` 자체가 context window overflow** (singularityjason, OMEGA)
- **`index.md`는 1000 소스 미만에서만 RAG 대체로 유효** (alxraun 압축 스펙)
- **grep은 500+ docs에서 느려짐** (tashisleepy), **10k+에서 Obsidian 그래프 붕괴** (RadekZebrowski)

### 해결 방향

검색 진입점을 **`index.md` Grep → 전용 검색 인덱스**로 교체한다. `index.md`는 사람용 네비게이션(MOC/Dataview, 별도 후속 작업)으로 역할을 분리한다. 검색 백엔드는 파일시스템 전체를 인덱싱하므로 **등록 여부와 무관하게 562개 전부 검색**된다 → 74% 누락 원천 해소.

---

## 2. 왜 외부 도구가 아니라 자체 제작인가

조사한 후보와 탈락 사유:

| 도구 | 언어 | 강점 | 탈락/한계 |
|---|---|---|---|
| qmd (tobi) | Node | hybrid, 모델 설정가능 | node-llama-cpp + GGUF 2GB, **Windows 미검증** |
| qmd (qntx-labs) | Rust | 경량·빠름 | **임베딩 모델 AllMiniLM(영어) 하드코딩, CLI로 교체 불가** → 포크 필요. BM25가 FTS5라 한국어 약함 |
| markdown-vdb | Rust | 모델 교체(Ollama/OpenAI), tantivy+usearch, agent memory | **Ollama/OpenAI 데몬 의존**(vector 시), 자체 memory 모델이 이 볼트 컨벤션과 충돌 |
| knowledge-rag | Python | 성숙(238★), ONNX 자족, 20 파서 | Python(Windows 마찰), MCP 중심 |
| KINDX | Node | Ollama 호환 | 신생(0★), node-llama-cpp |

**결론**: 각 도구의 장점(qmd/markdown-vdb의 Rust 경량, markdown-vdb의 모델교체·RRF·agent memory 신호, knowledge-rag의 ONNX 자족)을 취하고 약점을 버린 **자체 CLI**를 만든다. 자체 제작의 결정적 명분은 **이 볼트의 구조(frontmatter 택소노미, wikilink 그래프, sha256 provenance, log 날짜)를 검색 신호로 직접 활용**할 수 있다는 점 — 범용 도구엔 없는 이점이다.

### 핵심 제약 (사용자 확정)

1. **언어: Bun/TypeScript** — 이 플러그인이 이미 TS/JS 생태계(hooks `.mjs`, `src/index.ts`)라 일관. Rust 대비 순수 검색속도는 낮지만 543~수천 페이지 규모에선 무의미(Orama 인메모리 수십 ms). ~~Rust `<10ms`~~는 이 규모에서 실익 없음.
2. **크로스플랫폼 필수** — 맥북(개인) + Windows(**회사 PC**) 병행. **회사 PC의 MSVC 툴체인·`ort` 크로스컴파일·코드서명 마찰을 없애는 것이 스택 전환의 동기.** → Bun+npm으로 전환하면 **onnxruntime-node의 플랫폼별 native 프리빌트를 npm이 자동 제공** → 우리가 크로스컴파일/서명 안 함. (spike 결과 "순수 WASM 통일"은 폐기 — §11·부록 E. 네이티브 `.node`/`.dll` 실행을 회사 PC에서 수용.)
3. **한국어/영어 혼재 볼트** — 검색 품질의 핵심 변수. 형태소는 `lindera-wasm-nodejs-ko-dic`(WASM)로 **유지**(Rust lindera와 동일 ko-dic).
4. **로컬 자족(데몬 없음)** — 임베딩/rerank를 **프로세스 내장 ONNX(native onnxruntime-node)** 로 처리. Ollama/OpenAI 등 외부 데몬·API 불필요.
5. **품질 우선** — 임베딩 모델은 크기보다 품질(bge-m3). 첫 인덱싱 ~17분(spike 실측, 맥 native)은 백그라운드 1회 + sha256 증분으로 감수.

---

## 3. 아키텍처 결정 (ADR 요약)

### ADR-1: 검색 스택 (Bun/TS)
**`Orama`(BM25+vector+hybrid) + `lindera-wasm`(한국어 형태소, WASM) + `Transformers.js`(ONNX 임베딩/리랭크, native onnxruntime-node) + RRF**

Rust 스택(tantivy+lindera+fastembed+usearch)의 각 역할을 JS 대체재로 매핑:

| 역할 | Rust 초안 | **Bun 채택** | 비고 |
|---|---|---|---|
| BM25 + vector + hybrid | tantivy + usearch + 자체 RRF | **`@orama/orama`** | full-text·vector·hybrid 내장, 디스크 persist(JSON). 543~수천 docs 인메모리로 충분 |
| 한국어 형태소 | lindera(Rust) | **`lindera-wasm-nodejs-ko-dic`** | 동일 ko-dic. Orama 커스텀 tokenizer로 주입. 형태소 유지 |
| 임베딩 bge-m3 | fastembed `Bgem3Embedding` | **Transformers.js** + `onnx-community/bge-m3-ONNX` | 백엔드 = **native onnxruntime-node** |
| rerank 다국어 | fastembed `TextRerank` | **Transformers.js** + `onnx-community/bge-reranker-v2-m3-ONNX` | 다국어 cross-encoder |
| HNSW vector | usearch | Orama vector(브루트포스/HNSW) | 543 docs면 코사인 전수도 수 ms → HNSW 불필요 |
| RRF·frontmatter·sha256·chunk | 자체 Rust | 순수 TS(gray-matter, `crypto`) | 더 단순 |

근거:
- **ONNX 백엔드 = native onnxruntime-node** (spike 확정, 부록 E): Transformers.js의 Bun/Node 빌드는 `device: "wasm"` 미지원 + WASM 추론이 과도하게 느려 "순수 WASM 통일"은 폐기. 대신 **npm이 플랫폼별 native 프리빌트 `.node`를 자동 제공** → 우리가 크로스컴파일/서명 안 함(Rust `ort` 대비 이점 유지). 회사 PC의 `.node`/`.dll` 실행은 수용(사용자 확정). 형태소용 `lindera-wasm`만 순수 WASM.
- **`Orama`**: 검색엔진+RAG를 한 패키지로(2kb). BM25 파라미터 튜닝·hybrid mode·persist 지원. tantivy+usearch+RRF 3개를 하나로 대체.
- **`lindera-wasm`**: `lindera-wasm-nodejs-ko-dic` npm으로 형태소 유지("전략을"→"전략"+"을"). Rust lindera를 안 쓰고도 동일 ko-dic 품질. **한국어 검색 품질이 스택 전환에도 안 꺾임.**
- **`Transformers.js`**: HF ONNX 모델을 JS에서 로드. bge-m3 임베딩·bge-reranker-v2-m3 rerank ONNX 변환본 존재(§7). native onnxruntime-node 백엔드로 데몬 없이 자족.
- **RRF**: Orama hybrid가 내부적으로 BM25+vector를 융합. 필요 시 자체 RRF로 튜닝 가능.

### ADR-2: 준비 모델 (우리가 빌드/서명하는 바이너리 없음)
**우리가 컴파일·크로스컴파일·서명하는 바이너리가 없다** — 코드는 TS이고, native `onnxruntime-node`(.node/.dll)는 **npm이 플랫폼별 프리빌트를 자동 제공**한다. git 레포엔 **TS 소스만**. 5타깃 matrix·우리 서명 워크플로 전부 삭제. 준비는 두 단계로 **설치/첫 실행 시점**에 일어난다:

1. **의존성 준비** (설치 시): `bun install` → `@orama/orama`·`lindera-wasm-nodejs-ko-dic`(WASM)·`@huggingface/transformers`(+ `onnxruntime-node`가 **현재 플랫폼용 프리빌트 `.node` 자동 다운로드**). 회사 PC면 win-x64 프리빌트를 받음.
2. **모델 + 인덱스 준비** (첫 `llm-wiki index` 시): Transformers.js가 bge-m3·reranker ONNX(~1GB)를 HF에서 자동 다운로드/캐시 + 볼트 임베딩(~17분, 부록 E) → Orama 인덱스 생성.

**실행 방식**: 기본은 `bun run`(컴파일 불필요, Bun 런타임만 있으면 TS 직접 실행). 각 기기에 **Bun 런타임(단일 바이너리, MSVC 불필요)** 만 설치. `bun build --compile` 단일 exe는 **선택**(native `.node` 임베드가 필요해 복잡 → 기본은 안 함). 회사 PC에 Bun 설치가 부담이면 맥북에서 exe로 묶는 fallback을 검토하나, native `.node` 크로스임베드 제약이 있어 기본 경로는 각 기기 `bun install`.

근거: 초안(Rust)은 `ort`를 우리가 5타깃 크로스컴파일+서명해야 했다(크로스컴파일 지옥). **Bun+npm은 native 바이너리를 npm 생태계가 플랫폼별로 관리**하므로 우리가 빌드/서명할 게 없다 — git엔 소스만. 무거운 건 모델(~1GB)뿐이고 어차피 런타임 다운로드. 단, "네이티브 실행 자체를 0으로" 만들진 못한다(회사 PC에서 onnxruntime `.node`/`.dll` 로드; 수용 결정 — §11).

### ADR-3: 캐시/인덱스 위치 분리
- **모델(ONNX)** = 기기별 공유 자산. Transformers.js 캐시 사용 — `TRANSFORMERS_CACHE`(또는 `HF_HOME`)를 플러그인 캐시(`${CLAUDE_PLUGIN_ROOT}/.cache/models`, 쓰기 불가 시 `$XDG_CACHE_HOME`/`%LOCALAPPDATA%`)로 지정. (Rust 초안의 "우리 빌드 바이너리" 항목은 삭제 — native `.node`는 npm 프리빌트가 관리.)
- **node_modules(native `.node` + wasm 포함)** = `bun install` 산출물. 플러그인 디렉토리 또는 캐시.
- **검색 인덱스(Orama persist)** = 볼트 종속 자산이므로 **볼트 내 `.llm-wiki/`**(`.obsidian`과 나란히). `.gitignore` 권장. 볼트마다 별도 인덱스.

### ADR-4: CLI 이름 = `llm-wiki`
커뮤니티에서 널리 쓰는 명칭. `bun run`(또는 선택적 exe)으로 **플러그인 내부에서 호출**하므로 PATH 등록/충돌 없음(hermes의 `llm-wiki` 스킬과 무관).

---

## 4. CLI 인터페이스 (`llm-wiki`)

스킬은 `--json`으로만 소비한다. 인간용 출력은 부차적.

```
llm-wiki index [--vault <path>] [--file <path>] [--force]
    볼트를 인덱싱. --file은 단일 파일 증분(near-instant, capture 직후 호출).
    sha256으로 변경분만 재임베딩(§5). --force는 전체 재빌드.

llm-wiki search <query> [옵션]
    --mode hybrid|semantic|lexical   (기본 hybrid=BM25+vector RRF)
    --exact                          정확검색 레인 강제(한국어 2글자/코드심볼)
    --filter type=concept,tags=rust  frontmatter 필터
    --boost-links                    wikilink 교차참조로 재랭킹
    --decay [--half-life 90d]        updated/log 날짜 기반 최신 가중
    --rerank                         cross-encoder 재랭크(모델 준비 시)
    -n 10                            결과 수
    --json                           스킬용 출력
    --level 1|2|3|4                  progressive disclosure 토큰 예산(§5)

llm-wiki status        인덱스 건강·모델 준비 상태·의존성(bun install) 진행
llm-wiki links <file>  1-hop 이웃(그래프)
llm-wiki orphans       인바운드 링크 0 페이지 (lint 통합용)
llm-wiki doctor        깨진 링크·인덱스 불일치 (lint 통합용)
llm-wiki bootstrap     의존성(bun install)·모델(ONNX) 준비를 명시적으로 트리거
```

### `search --json` 출력 스키마 (progressive disclosure)

```json
{
  "query": "백테스트 슬리피지",
  "mode": "hybrid",
  "degraded": false,
  "results": [
    {
      "path": "concepts/backtest-slippage.md",
      "title": "백테스트 슬리피지 모델링",
      "type": "concept",
      "tags": ["backtest", "execution"],
      "confidence": "high",
      "score": 0.87,
      "snippet": "…슬리피지는 체결가와 의도가의 차이로…",
      "updated": "2026-06-30"
    }
  ]
}
```

- **Level 1**: path+title (최소)
- **Level 2**: +tags+type+confidence+1줄 요약
- **Level 3**: +매칭 스니펫(~300토큰 예산)  ← recall 기본값
- **Level 4**: 스킬이 `Read`로 전체 본문 확장

recall은 L3로 후보를 좁히고 필요한 것만 L4(Read)로 확장 → 토큰 절약.

---

## 5. 인덱싱 파이프라인

```
볼트 discovery → frontmatter 파싱 → section chunk → sha256 증분판정 → embed → index
```

1. **Discovery**: 볼트 `**/*.md` 스캔(Bun `Glob`). `raw/`·`.obsidian/`·`.llm-wiki/`·`index.md`·`log.md`·`SCHEMA.md`·`CLAUDE.md` 제외(검색 대상은 위키 페이지: entities/concepts/comparisons/queries).
2. **Parse**: frontmatter(`title/type/tags/confidence/updated/sources` + `[[wikilink]]`) 추출. 기존 `src/index.ts`의 `parseFrontmatter` 로직 **그대로 재사용**(같은 TS 생태계라 이식 불필요).
3. **Chunk (section-level)**: heading(`#`/`##`) 단위 분할 + 토큰 상한(bge-m3는 8192 지원하나 chunk는 512~1024 권장). 결과에 heading 계층 포함 → 정밀도↑.
4. **sha256 증분**: 각 페이지 본문 sha256을 인덱스에 저장(Bun `crypto`). **이 볼트는 이미 raw/에 sha256 provenance를 쓰므로 그 관습을 위키 페이지로 확장** → 변경분만 재임베딩. `--file`은 단일 파일만. **첫 인덱싱만 무겁고(부록 E: ~17분) 이후 capture당 near-instant라 증분이 특히 중요**.
5. **Embed**: Transformers.js(native onnxruntime-node)로 chunk 벡터화(content-hash skip; 배치는 패딩 낭비로 이득 없어 직렬 권장 — 부록 E). 모델 미준비/다운로드 중이면 이 단계 skip → Orama BM25-only(lexical) 인덱스로 동작(degradation). ⚠ **첫 전체 인덱싱**: 15,781 chunk × ~65ms ≈ **17분(맥 native, 실측)**, 회사 PC는 배수 → 백그라운드 진행 + 진행률. chunk greedy 병합으로 chunk 수 관리.
6. **Index**: **Orama** 인스턴스에 BM25(lindera-wasm 토크나이저) + vector(bge-m3 dense)를 함께 적재. 메타데이터 = frontmatter. `@orama/plugin-data-persistence`로 `.llm-wiki/`에 직렬화(JSON/바이너리).

### 검색 3-레인 + 융합

```
query → ┌ BM25   (Orama + lindera-wasm)      ─┐
        ├ Vector (Transformers.js→Orama)     ─┤→ hybrid/RRF → 필터 → link-boost → decay → rerank(Transformers.js) → 결과
        └ Exact  (리터럴 substring)          ─┘
```

- **Exact 레인**: 한국어 2글자·코드심볼처럼 vector가 약하고 형태소로도 놓치는 정확 매칭 보장. `--exact`거나 쿼리가 짧을 때 가중.
- **hybrid/RRF**: Orama `mode: 'hybrid'`가 BM25+vector 융합을 내장 제공. 필요 시 자체 RRF로 대체/튜닝.

---

## 6. 8개 볼트-구조 활용 기능 (전부 채택) + 단계

자체 제작의 명분. 이 볼트의 SCHEMA/wikilink/날짜/sha256을 검색 신호로 재활용.

| # | 기능 | 근거·소스 | 단계 |
|---|---|---|---|
| 1 | **frontmatter 필터** (`type/tags/confidence`) | SCHEMA 택소노미 | 1차 |
| 2 | **progressive disclosure**(~300토큰 스니펫) | 댓글 token-budget 팁 | 1차 |
| 3 | **hybrid RRF**(BM25+vector) | markdown-vdb | 1차 |
| 5 | **rerank**(cross-encoder 다국어) | OMEGA/knowledge-rag + **볼트 실측: 후보 폭증**(§12부록) | **1차 ↑** |
| + | **section-level chunk** | markdown-vdb | 1차(기본 인덱싱) |
| 4 | **정확검색 fallback**(리터럴 레인) | 한국어 2글자 실측 | 2차 |
| 8 | **sha256 증분 인덱싱** | 이 볼트 기존 provenance | 2차 |
| + | **lint 통합**(orphans/doctor + **제목중복 탐지**) | RTFM/markdown-vdb + **볼트 실측: 제목 near-dup 십수 개** | **2차 ↑** |
| 6 | **link-boost**(wikilink 재랭킹) | markdown-vdb `--boost-links` | 3차 |
| 7 | **time decay**(updated/log 날짜) | markdown-vdb `--decay` | 3차 |

**구현 단계** (볼트 실측 반영 재배치 — §12 부록)

이 볼트를 실측한 결과 세 신호가 나왔다: ① 본문 복붙형 중복은 사실상 없음(자카드 0.5+ = 0쌍) → **dedup용 vector 명분 기각**. ② 특정 주제에 문서 편중(`nautilus-trader` 80·`krx` 72·`backtest` 47) → **핵심 키워드 검색 시 후보 40~80개 폭증** → rerank로 정밀 정렬할 실익 확정. ③ 한/영 혼재 → 어휘불일치 대비 vector 유효(실이점은 미확정이나 **품질 우선 결정으로 1차 채택**). 따라서 rerank를 1차로 올리고(후보 폭증 대응), 위키를 의미있게 유지하는 lint/중복탐지를 2차로 올린다.

- **1차 (MVP)**: `index`/`search`, Orama BM25(lindera-wasm), Transformers.js vector(bge-m3, WASM), **rerank(bge-reranker-v2-m3, WASM)**, `BM25+vector → hybrid/RRF → rerank` 풀 하이브리드, section chunk, frontmatter 필터, progressive JSON, 준비(bun install + bge-m3 + reranker 모델). → recall이 이걸 호출하도록 교체.
- **2차**: 정확 fallback, sha256 증분, **lint 통합**(orphans/doctor + 제목중복 탐지 → 위키 의미유지·중복 누적 차단).
- **3차**: link-boost, time decay, watch 모드.

인덱스 스키마는 **처음부터 8개를 다 수용**하게 설계(frontmatter·링크·날짜·해시 필드 미리 확보). 확장점을 비워두되 로직은 단계적.

---

## 7. 모델 선정 (품질 우선, Transformers.js ONNX)

Transformers.js가 로드 가능한 HF ONNX 모델 중 선택. 백엔드 = **native onnxruntime-node**.

| 용도 | 선정 | HF ONNX 저장소 | 크기 | 근거 |
|---|---|---|---|---|
| **임베딩** | **bge-m3** (BAAI/bge-m3) | `onnx-community/bge-m3-ONNX` | ~568M / q8 ~600MB | 100+언어, **한국어 최상급**, 8192 토큰. 품질 우선 |
| 임베딩 대안(경량) | multilingual-e5-base | `Xenova/multilingual-e5-base` | 278M | 인덱싱 속도가 문제면 절충(~절반) |
| **rerank** | **bge-reranker-v2-m3** | `onnx-community/bge-reranker-v2-m3-ONNX` | ~568M | 다국어 cross-encoder. ONNX 변환본 확인됨 |

**✅ 확인 완료(2026-07 조사)**: `onnx-community/bge-m3-ONNX`(임베딩)·`onnx-community/bge-reranker-v2-m3-ONNX`(rerank) 모두 **Transformers.js 호환 ONNX 변환본이 존재**. fastembed enum 제약(사전 변환 모델만) 대신 HF ONNX 생태계를 직접 쓰므로 모델 선택 폭이 더 넓다. jina-reranker-v2-multilingual도 후보이나, bge-reranker-v2-m3 ONNX가 확정적이라 **1차는 bge-reranker-v2-m3**.

- **양자화(q8/q4) 선택 중요**: 추론 속도·메모리를 위해 Transformers.js `dtype` 옵션으로 양자화 로드(spike는 q8). 품질/속도 절충의 핵심 레버.
- bge-m3는 dense+sparse+ColBERT를 내지만, **1차는 Orama BM25(lindera-wasm) + bge-m3 dense vector** 조합. sparse는 후속 검토.

---

## 8. 준비 흐름 상세 (우리가 빌드/서명할 바이너리 없음)

목표: 사용자는 "플러그인 추가 + Bun 런타임" 외에 아무것도 안 한다. **우리가 운영할 크로스컴파일·5타깃 matrix·코드서명 워크플로가 전부 사라진다**(native `.node`는 npm 프리빌트가 관리 — Bun 전환의 핵심 이득).

### 흐름
```
스킬 실행(recall/capture/lint 등 최초)
  └ wrapper(session-start 또는 커맨드)가 준비 상태 점검
      ├ Bun 런타임 없음 → 설치 안내(단일 바이너리, MSVC 불필요) 또는 exe fallback
      ├ node_modules 없음 → `bun install`(wasm + 플랫폼별 native `.node` 프리빌트 자동)
      └ 있음 → `bun run llm-wiki …` 바로 실행
  └ llm-wiki 첫 index → 모델(ONNX) 확인 (Transformers.js 캐시)
      ├ 없음 → 백그라운드 다운로드(~1GB), 이번 검색은 Orama BM25-only → "degraded": true
      └ 준비됨 → hybrid + rerank
```

### 실행/배포 (택1)
- **기본: `bun run`** — git엔 TS 소스만. 각 기기에 Bun 런타임 설치 후 `bun install`(현재 플랫폼용 onnxruntime `.node` 프리빌트 자동) → `bun run`. 우리 컴파일 산출물 없음.
- **선택: 단일 exe** — `bun build --compile`로 Bun 런타임+소스를 exe로 묶음. 단 native `onnxruntime-node` `.node`를 exe에 임베드해야 하고 크로스타깃(`--target=bun-windows-x64`) 시 타 플랫폼 `.node` 확보가 까다로워, **기본 경로는 각 기기 `bun install`**. exe는 회사 PC에 Bun조차 못 깔 때만 검토.

### 남는 준비 항목
- **Bun 런타임**: 각 기기 1회 설치(`curl`/`npm i -g bun`/`powershell`). 단일 바이너리라 MSVC 같은 무거운 툴체인 불필요.
- **모델 ONNX ~1GB**: 첫 index 시 Transformers.js가 HF에서 자동 다운로드/캐시(§11 리스크3). 진행률·재개 필요.
- **lindera-wasm ko-dic**: npm 패키지에 포함(별도 다운로드 없음, 순수 WASM). 오프라인 BM25 보장.
- **onnxruntime-node 프리빌트**: `bun install`이 플랫폼별 `.node` 자동. 우리가 빌드/서명 안 함.

### 코드서명 리스크 — **우리 몫은 소거, 실행은 native**
우리가 서명/배포하는 자작 바이너리는 **없다**(코드=TS, Bun 런타임=공식 서명 배포판, onnxruntime `.node`=npm 프리빌트). Rust 초안처럼 **우리가** macOS 공증·Windows 서명 워크플로를 운영할 일은 **없다**. 단 **실행 시 회사 PC에서 onnxruntime `.node`/`.dll`이 로드**되므로, 회사 EDR/정책이 이를 허용해야 한다(수용 결정 — §11 리스크2). "네이티브 실행 0"은 아니다.

---

## 9. 스킬/커맨드 통합 (변경점)

| 파일 | 현재 | 변경 |
|---|---|---|
| `commands/recall.md` | `index.md` Grep → 본문 보조검색 | **`llm-wiki search "$ARGS" --json --level 3` 호출** → 결과 후보만 Read. 74% 누락 해소. index.md 미의존 |
| `commands/capture.md` | 페이지 작성 후 index.md 수동 갱신 | 작성 후 **`llm-wiki index --file <새파일>`** 증분 인덱싱 추가. index.md는 사람용으로 격하(MOC 전환은 후속) |
| `commands/lint.md` | Glob+Grep로 orphan/broken 계산 | **`llm-wiki orphans` / `doctor`** 로 가속(3차) |
| `hooks/session-start.sh` | 볼트 경로/SCHEMA 검증 | **준비 상태 점검**(Bun 런타임·`node_modules`·모델 준비 여부 1줄 안내) 추가 |
| `skills/wiki-schema/SKILL.md` | index.md 갱신 규칙(규칙5) | 검색 진입점이 CLI로 이동했음을 반영. index.md=사람용 MOC로 역할 재정의(별도 후속) |

**주의**: 이 설계는 **검색 백엔드**에 집중한다. gist 분석에서 나온 나머지 업그레이드 축(triage-first ingest 승인 게이트, questions/ 폴더, `[[path\|Name]]` 포맷 강제, recall confidence 표면화, MOC/Dataview 사람용 인덱스)은 **별도 후속 작업**으로 분리한다. 단 검색 CLI가 축1(규모별 인덱스=검색 진입점)을 근본 해결하고, sha256 증분(축2 무결성)·frontmatter 필터(축3 품질)·결정론적 CLI(축4)를 관통한다.

---

## 10. 디렉토리 레이아웃 (구현 시)

```
plugins/obsidian-knowledge/
├── src/                           # 신설/확장: Bun/TS CLI (기존 src/index.ts와 통합)
│   ├── cli.ts                     #   clap 대신 Bun의 인자 파싱 (llm-wiki 엔트리)
│   ├── index-build.ts             #   인덱싱 (discovery·parse·chunk·embed·Orama 적재)
│   ├── search.ts                  #   BM25+vector hybrid·rerank·필터·progressive JSON
│   ├── tokenizer.ts               #   lindera-wasm 래핑(Orama 커스텀 tokenizer)
│   └── models.ts                  #   Transformers.js 임베딩/rerank (native onnxruntime-node)
├── package.json                   # 신설: @orama/orama, lindera-wasm-nodejs-ko-dic, @huggingface/transformers
├── scripts/
│   └── bootstrap.mjs              # 신설: Bun 확인·`bun install`·모델 준비 트리거 (크로스컴파일/서명 없음)
├── commands/  (recall/capture/lint 개편)
├── skills/    (wiki-schema 개편)
├── hooks/     (session-start 준비 점검 추가)
└── docs/2026-07-25-llm-wiki-search-design.md   # 이 문서
# (.github/workflows/release.yml — 삭제: 네이티브 릴리스 불필요)

# 런타임 (git 아님)
<플러그인 캐시>/.cache/models/                    # ONNX 모델 (Transformers.js/HF 캐시, 기기 공유)
plugins/obsidian-knowledge/node_modules/          # bun install 산출물 (wasm 포함)
<볼트>/.llm-wiki/                                 # Orama 인덱스 persist (볼트 종속, gitignore)
```

---

## 11. 리스크 / 미확인 (다음 세션 착수 전 확인)

**Bun 전환으로 소거된 리스크** (Rust 초안의 1~3·5): ~~lindera-tantivy 정합~~·~~fastembed reranker~~·~~ort 크로스컴파일~~·~~macOS quarantine/Windows SmartScreen(우리 서명 워크플로)~~ — npm이 native 프리빌트를 관리하므로 **우리가 크로스컴파일/서명할 게 없다**(§8). Rust 초안 리스크 표는 부록 D.

전환 후 남은/새 리스크:

1. ~~**WASM 추론 속도**~~ **[spike 완료, 부록 E]** — "순수 WASM 통일"은 폐기(Transformers.js Bun은 `device:"wasm"` 미지원). **native onnxruntime-node로 실측: bge-m3 q8, 실제 chunk 15,781개 × ~65ms ≈ 첫 인덱싱 ~17분(맥)**. 배치는 이득 없음(직렬). 회사 PC는 배수. 대응: 백그라운드+진행률, sha256 증분(첫 1회만), 정 느리면 e5-base 경량화, chunk greedy 병합. **검색 쿼리 임베딩은 수십~수백ms라 실사용 무관.**
2. **회사 PC에서 native `.node`/`.dll` 실행** **[핵심·수용됨]** — vector/rerank가 native onnxruntime-node를 로드. 회사 EDR/AppLocker가 이를 막으면 검색이 BM25-only로 degraded. **사용자가 "가능은 해"로 수용**. Bun 런타임 설치도 필요(단일 바이너리, MSVC 불필요). 실제 회사 PC 검증은 구현 후 판정.
3. **모델 다운로드 ~1GB** — bge-m3 q8 ~600MB + reranker ~수백MB. 첫 index 시 Transformers.js 자동 다운로드. 진행률·재개·회사 방화벽(HF 접근) 확인 필요.
4. **Orama 스케일 한계** — 인메모리 엔진이라 수만 docs+에선 메모리/로드 부담. 현재 543p엔 무관하나, 10k+ 성장 시 재평가(persist 로드 시간·RAM). 이 규모 도달 전까진 비이슈.
5. **인덱스 stale** — 볼트가 외부(hermes, 직접 편집)로 바뀔 때 재인덱싱 트리거. `--file` 증분 + 주기적 `status`에서 mtime/sha 불일치 감지.
6. **볼트 경로 공백** — `$WIKI_PATH`에 공백 포함(`Knowledge Repository`). 모든 경로 처리에서 인용 필수(Bun `Glob`/`fs`도 동일).

---

## 12. 다음 세션 체크리스트

- [x] ~~임베딩 속도 spike~~ — **완료(부록 E)**. bge-m3 q8 native onnxruntime-node: 실제 chunk 15,781개 × ~65ms ≈ 첫 인덱싱 **~17분(맥)**. `device:"wasm"`은 Bun 미지원 → native 수용 결정. 검색 쿼리는 실사용 무관.
- [x] ~~Rust 리스크 1·2·3·5(lindera-tantivy·fastembed reranker·ort 크로스컴파일·서명)~~ — **Bun 전환으로 소거/무관**(§8·§11).
- [ ] 스캐폴딩: `src/`(cli.ts, index-build.ts, search.ts, tokenizer.ts, models.ts) + `package.json`(@orama/orama, lindera-wasm-nodejs-ko-dic, @huggingface/transformers)
- [ ] MVP(1차): `index` + `search`(**`BM25+vector → hybrid/RRF → rerank` 풀 하이브리드**, Orama BM25+lindera-wasm, bge-m3 vector, bge-reranker-v2-m3, section chunk, frontmatter 필터, progressive JSON)
- [ ] `scripts/bootstrap.mjs`(Bun 확인·`bun install`·모델 준비 트리거 — 크로스컴파일/서명 없음) — 모델 ~1GB 진행률/재개
- [ ] `commands/recall.md`를 `bun run llm-wiki search --json` 호출로 교체 → 74% 누락 실측 해소 확인
- [ ] `commands/capture.md`에 `--file` 증분 인덱싱 추가
- [ ] 2차: 정확 fallback·sha256 증분·**lint 통합(orphans/doctor + 제목중복 탐지 → 위키 의미유지)**
- [ ] 3차: link-boost·time decay·watch
- [ ] (별도 트랙) 사람용 인덱스: index.md → MOC/Dataview 전환, triage-first ingest, questions/ 폴더 등

---

## 부록 A: 볼트 near-dup·편중 실측 (2026-07-25, 후속 세션)

vector/rerank/chunk를 1차에 넣을지 판단하기 위해 볼트를 임베딩 없이 토큰 자카드로 실측(`scratchpad/vault_probe.py`). 위키 페이지 **543개**(concepts 496·comparisons 36·entities 7·queries 4).

| 측정 | 결과 | 함의 |
|---|---|---|
| 본문 토큰 자카드 0.5+ 쌍 | **0쌍** | 복붙형 near-duplicate 사실상 없음 → **dedup용 vector 명분 기각** |
| 본문 자카드 0.3+ 쌍 | 7쌍(14p, 2.6%) | 의미 유사는 자카드로 미측정(그건 vector 영역) |
| 제목 토큰 자카드 0.5+ 쌍 | 105쌍 | 대부분 정상(research-digest 시계열 등), **정리감은 십수 개**(v2/v3, 접두·어순 차이) → 문자열 lint로 처리 |
| 태그 집중 | `nautilus-trader 80`·`krx 72`·`backtest 47`·`rust 45`·`claude-code 30`·`mcp 30`·`opencode 27` | **주제 편중** → 핵심 키워드 검색 시 후보 40~80개 **폭증** → rerank 정밀 정렬 실익 확정 |

**결론**: 사용자 관찰 "키워드 치면 의외로 많이 나온다"의 정체는 **본문 중복이 아니라 주제 편중**. 이 때문에 ① dedup 명분은 죽고 ② rerank 명분이 서고 ③ 어휘불일치(한/영 혼재)용 vector는 실이점 미확정이나 품질 우선 결정으로 1차 채택. → §6 단계 재배치 근거.

## 부록 B: 라이브러리 조사 (2026-07, Bun 스택)

| 패키지 | 역할 | 핵심 사실 |
|---|---|---|
| `@orama/orama` | BM25+vector+hybrid+persist | 검색엔진+RAG 한 패키지(2kb). `mode: 'hybrid'` 내장. tantivy+usearch+RRF 대체. 인메모리(수만 docs+ 재평가) |
| `lindera-wasm-nodejs-ko-dic` | 한국어 형태소(WASM) | Rust lindera와 동일 ko-dic(mecab-ko-dic fork). Orama 커스텀 tokenizer로 주입. 형태소 유지 |
| `@huggingface/transformers` (Transformers.js) | ONNX 임베딩/rerank | 백엔드 native onnxruntime-node 선택 가능. `dtype`로 q8/q4 양자화 |
| `onnx-community/bge-m3-ONNX` | 임베딩 모델 | Transformers.js 호환 확인. 100+언어·8192토큰 |
| `onnx-community/bge-reranker-v2-m3-ONNX` | rerank 모델 | Transformers.js 호환 확인. 다국어 cross-encoder |
| Bun `bun build --compile` | 배포(선택) | 단일 exe. 단 native `.node` 임베드·크로스타깃 제약으로 **기본은 `bun run`**(각 기기 `bun install`) |
| `onnxruntime-node` | ONNX 백엔드(native) | `bun install`이 플랫폼별 프리빌트 `.node` 자동. 우리가 빌드/서명 안 함 |

## 부록 C: 조사 산출물 위치 (설계 세션)

- gist 댓글 원본·버킷·인사이트: 세션 scratchpad (`gist_comments.json`, `insights_wip.md`, `structure_top.md`, `repos.txt` 등)
- 핵심 인사이트 요약: `insights_wip.md` (소스 무결성/스케일 임계점/순수 md 탈피/dual-layer/triage-first/confidence/결정론/HITL 등)
- 조사한 오픈소스 306개 레포 목록: `repos.txt`
- 볼트 실측 스크립트: `scratchpad/vault_probe.py`

## 부록 D: Rust 초안 (보존 — 폐기)

> 초안은 Rust 네이티브 CLI였다. **회사 Windows PC의 MSVC 툴체인·`ort` 5타깃 크로스컴파일·코드서명 마찰** 때문에 Bun으로 전환하며 폐기. 라이브러리 검증 자체는 유효했으므로 기록을 남긴다.

**Rust 스택(폐기)**: `tantivy 0.25`(BM25, lindera-tantivy 4.0.0이 0.25 핀 강제) + `lindera 4.0.0`(ko-dic) + `fastembed 5.17.3`(백엔드 `ort 2.0.0-rc.12`; `Bgem3Embedding`, `RerankerModel`에 `JINARerankerV2BaseMultiligual`·`BGERerankerV2M3`) + `usearch 2.25.2`(HNSW) + RRF.

**전환으로 소거된 Rust 리스크**: ① lindera-tantivy 버전 정합 ② fastembed reranker enum ③ ort 크로스컴파일(`cargo-zigbuild`는 Windows MSVC 미지원, `cargo-xwin`/GHA matrix 필요) ④ **우리가 운영할** macOS 공증 / Windows 서명 워크플로. **npm이 native 프리빌트를 관리하므로 우리가 빌드/서명할 게 없어짐.** 대신 새 리스크(첫 인덱싱 속도, 회사 PC native `.node` 실행, Bun 설치)가 들어옴 — §11.

**전환의 순이득**: 우리 빌드 바이너리 0 → git엔 소스만 · 크로스컴파일/서명 워크플로 불필요(npm 프리빌트) · 코드베이스(TS) 일관 · lindera-wasm으로 형태소 유지. **순손실**: "네이티브 실행 0" 목표는 포기(회사 PC에서 onnxruntime `.node` 로드 수용) · Bun 런타임 의존.

## 부록 E: 임베딩 속도 spike (2026-07-25 실측)

WASM/native 백엔드와 bge-m3 인덱싱 시간을 실측(`scratchpad/wasm-spike/`). 환경: 맥북 11코어/36GB, Bun 1.3.14, Transformers.js 4.2.0, bge-m3 q8.

**핵심 발견**
1. **Transformers.js의 Bun/Node 빌드는 `device: "wasm"` 미지원** (`cpu, coreml, webgpu`만) → Bun에서 Transformers.js는 native `onnxruntime-node`가 기본. "순수 WASM 통일" 계획 폐기 근거.
2. **실측(native cpu, q8)**:
   - 초기 오추정: 문서를 2000자 통짜 1개로 임베딩 → per-item 780ms, chunk×5 가정 → 35분(과대, 실측 아닌 외삽).
   - 정정 실측: **실제 heading chunk 15,781개**(533 docs, chunks/doc 29.6은 병합 전 과분할) × **~65ms/chunk** → 첫 인덱싱 **~17분**.
   - **배치는 이득 없음**(batch=32에서 per-chunk 1227ms로 악화 — 패딩 낭비). 직렬 권장.
   - 모델 로드(다운로드 포함) ~48s. 검색 쿼리 임베딩은 수십~수백ms.
3. **결정**: 옵션 A(bge-m3 + native 수용). 첫 인덱싱 17분은 백그라운드 1회 + sha256 증분으로 감수. 회사 PC는 배수라 실사용 검증은 구현 후.

**구현 유의**: chunk를 512토큰까지 **greedy 병합**해 chunk 수를 줄일 것(29.6/doc는 과다). 정 느리면 e5-base(278M)로 ~절반.
