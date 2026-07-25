/**
 * types.ts — llm-wiki CLI 전역 데이터 모델.
 *
 * 인덱스 스키마는 설계 6절대로 "처음부터 8개 기능을 다 수용"하도록 필드를
 * 미리 확보한다(frontmatter·links·updated·sha256). 1차에서 안 쓰는 필드도
 * 색인에 저장해 2·3차(증분·link-boost·decay)가 재인덱싱 없이 켜지게 한다.
 */

/** bge-m3 dense 임베딩 차원. */
export const EMBED_DIM = 1024

/** 위키 페이지 1개(파일)를 파싱한 결과. */
export interface WikiPage {
  /** 볼트 루트 기준 상대 경로 (예: concepts/backtest-slippage.md) */
  path: string
  title: string
  type: string
  tags: string[]
  confidence: string
  /** updated 또는 date frontmatter (YYYY-MM-DD, 없으면 "") */
  updated: string
  summary: string
  /** 본문에서 추출한 [[wikilink]] 대상 슬러그들 */
  links: string[]
  /** 본문(frontmatter 제외) */
  body: string
  /** 본문 sha256 (증분 판정용) */
  sha256: string
}

/** section 단위로 쪼갠 청크 = Orama 문서 1건. */
export interface ChunkDoc {
  /** `${path}#${index}` */
  id: string
  path: string
  title: string
  type: string
  tags: string[]
  confidence: string
  updated: string
  /** 이 청크가 속한 heading 계층 (예: "## 백테스트 > ### 슬리피지") */
  heading: string
  summary: string
  links: string[]
  sha256: string
  /** title+heading+content의 초성 문자열(공백 제거) — 정확검색 초성 레인용(2차) */
  choseong: string
  /** 청크 본문(형태소 토크나이저가 BM25 색인) */
  content: string
  /** bge-m3 dense 벡터. 모델 미준비(degraded) 시 0-벡터. */
  embedding: number[]
}

/** search --json 출력 결과 1건. */
export interface SearchHit {
  path: string
  title: string
  type: string
  tags: string[]
  confidence: string
  score: number
  snippet: string
  updated: string
}

/** search --json 최상위 출력. */
export interface SearchOutput {
  query: string
  mode: string
  /** 벡터/rerank 없이 BM25-only로 동작했는지 (모델 미준비 등) */
  degraded: boolean
  results: SearchHit[]
}
