/**
 * tokenizer.ts — 한국어/영어 혼재 볼트를 위한 형태소 토크나이저.
 *
 * lindera-wasm-nodejs-ko-dic(ko-dic, WASM 동기 로드)로 한국어를 형태소 단위로
 * 분해하고("전략을" → "전략" + "을"), 그 결과를 Orama 커스텀 tokenizer 컴포넌트로
 * 노출한다. 영어/숫자/코드 심볼은 lindera가 공백·기호 경계로 분해하므로 별도 처리
 * 불필요. 순수 WASM이라 오프라인에서도 BM25 색인이 보장된다(설계 5.6/부록B).
 */

import { TokenizerBuilder } from "lindera-wasm-nodejs-ko-dic"
import { getChoseong } from "es-hangul"

/** Orama 3.x 커스텀 tokenizer 컴포넌트 인터페이스(필수 필드만). */
export interface OramaTokenizer {
  language: string
  normalizationCache: Map<string, string>
  tokenize(input: string, language?: string, prop?: string): string[]
}

interface LinderaToken {
  surface: string
  /** ko-dic 품사 태그 (예: NNG, NNP, JKO, EF, SF) */
  partOfSpeechTag?: string
}

// 검색 신호가 없는 품사 = 조사(J*)·어미(E*)·구두점/기호(S*). 색인·쿼리에서 제거.
// 명사(NN*/NR/NP)·용언 어간(VV/VA)·외국어(SL)·숫자(SN)·한자(SH)는 유지한다.
const DROP_POS = new Set([
  // 조사
  "JKS", "JKC", "JKG", "JKO", "JKB", "JKV", "JKQ", "JX", "JC",
  // 어미
  "EP", "EF", "EC", "ETN", "ETM",
  // 구두점/기호
  "SF", "SE", "SSO", "SSC", "SC", "SY",
])

// ko-dic 사전은 수십 MB이므로 프로세스당 1회만 build 하고 재사용한다.
let sharedTokenizer: { tokenize(text: string): LinderaToken[] } | null = null

function getLinderaTokenizer(): { tokenize(text: string): LinderaToken[] } {
  if (sharedTokenizer) return sharedTokenizer
  const builder = new TokenizerBuilder()
  builder.setDictionary("embedded://ko-dic")
  builder.setMode("normal")
  builder.setKeepWhitespace(false)
  sharedTokenizer = builder.build()
  return sharedTokenizer
}

// 순수 구두점/공백 토큰은 색인에서 제외한다(검색 신호가 없음).
const PUNCT_ONLY = /^[\s\p{P}\p{S}]+$/u

/**
 * 텍스트를 형태소 표층형(surface) 배열로 분해한다.
 * 소문자화 + 구두점 제거. BM25 색인·쿼리 양쪽에서 동일하게 쓰인다.
 */
export function tokenizeText(input: string): string[] {
  if (!input) return []
  const tokenizer = getLinderaTokenizer()
  const tokens = tokenizer.tokenize(input) as LinderaToken[]
  const out: string[] = []
  for (const t of tokens) {
    if (t.partOfSpeechTag && DROP_POS.has(t.partOfSpeechTag)) continue
    const surface = (t.surface ?? "").trim().toLowerCase()
    if (!surface || PUNCT_ONLY.test(surface)) continue
    out.push(surface)
  }
  return out
}

/**
 * 초성 문자열로 변환(공백 제거). 정확검색 초성 레인용(2차).
 * "슬리피지 모델링" → "ㅅㄹㅍㅈㅁㄷㄹ". 한글이 아닌 문자는 es-hangul이 원문 유지.
 */
export function toChoseong(input: string): string {
  if (!input) return ""
  return getChoseong(input).replace(/\s+/g, "")
}

/** 쿼리가 초성만으로 이뤄졌는지(초성 검색 의도 판정). 예: "ㅅㄹㅍㅈ" */
export function isChoseongQuery(input: string): boolean {
  const s = input.replace(/\s+/g, "")
  return s.length >= 2 && /^[ㄱ-ㅎ]+$/.test(s)
}

/**
 * Orama에 주입할 커스텀 tokenizer 컴포넌트를 만든다.
 * `create({ components: { tokenizer: createOramaTokenizer() } })` 형태로 사용.
 */
export function createOramaTokenizer(): OramaTokenizer {
  return {
    language: "korean",
    normalizationCache: new Map(),
    tokenize(input: string): string[] {
      // Orama는 문자열이 아닌 값(숫자 등)도 넘길 수 있어 방어.
      if (typeof input !== "string") return []
      return tokenizeText(input)
    },
  }
}
