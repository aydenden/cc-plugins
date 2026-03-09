#!/usr/bin/env node
// --- 네이버 뉴스 검색 ---
// Usage: bun run scripts/news/search.ts <query> [count]
// count: 검색 결과 수 (기본 10, 최대 100)

import { fetchWithRetry, requireEnv, success, fail, output, log } from "../common/http.ts";

const NAVER_SEARCH_URL = "https://openapi.naver.com/v1/search/news.json";

interface NewsItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
}

async function main() {
  const query = process.argv[2];
  if (!query) {
    output(fail("INVALID_ARGS", "사용법: bun run search.ts <검색어> [결과수]"));
    return;
  }

  const count = Math.min(parseInt(process.argv[3] ?? "10"), 100);
  const clientId = requireEnv("NAVER_CLIENT_ID");
  const clientSecret = requireEnv("NAVER_CLIENT_SECRET");

  try {
    const params = new URLSearchParams({
      query,
      display: String(count),
      sort: "date",
    });

    const resp = await fetchWithRetry(`${NAVER_SEARCH_URL}?${params}`, {
      headers: {
        "X-Naver-Client-Id": clientId,
        "X-Naver-Client-Secret": clientSecret,
      },
    });

    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

    const json = await resp.json() as { items?: Array<{ title: string; originallink: string; link: string; description: string; pubDate: string }> };

    const items: NewsItem[] = (json.items ?? []).map((item) => ({
      title: item.title.replace(/<[^>]+>/g, ""),
      link: item.originallink || item.link,
      description: item.description.replace(/<[^>]+>/g, ""),
      pubDate: item.pubDate,
    }));

    output(success({ query, count: items.length, articles: items }, "naver_news"));
  } catch (err) {
    output(fail("API_ERROR", (err as Error).message));
  }
}

main();
