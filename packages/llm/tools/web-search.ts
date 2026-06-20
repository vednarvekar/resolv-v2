// packages/tools/web-search.ts
// Web search for the agent. Two modes:
// 1. Brave Search API (fast, structured) — set BRAVE_SEARCH_API_KEY
// 2. DuckDuckGo HTML scraping (no key needed, rate-limited fallback)
//
// Returns top N results as title + URL + snippet for the LLM to reason over.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DDG_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 10_000;

/** Strip HTML tags for snippet extraction */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

async function braveSearch(query: string, apiKey: string, count: number): Promise<SearchResult[]> {
  const url = `${BRAVE_ENDPOINT}?q=${encodeURIComponent(query)}&count=${count}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Accept-Encoding": "gzip",
      "X-Subscription-Token": apiKey,
    },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`Brave Search HTTP ${res.status}`);

  const data = (await res.json()) as {
    web?: {
      results?: Array<{ title?: string; url?: string; description?: string }>;
    };
  };

  return (data.web?.results ?? []).slice(0, count).map((r) => ({
    title: r.title ?? "",
    url: r.url ?? "",
    snippet: r.description ?? "",
  }));
}

async function duckDuckGoSearch(query: string, count: number): Promise<SearchResult[]> {
  const body = new URLSearchParams({ q: query, b: "" });
  const res = await fetch(DDG_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Mozilla/5.0 (compatible; resolv-cli/2.0)",
    },
    body: body.toString(),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`DuckDuckGo HTTP ${res.status}`);

  const html = await res.text();
  const results: SearchResult[] = [];

  // Extract result blocks: <div class="result__body">
  const blockRegex = /<div class="result__body">([\s\S]*?)<\/div>\s*<\/div>/g;
  const titleRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null && results.length < count) {
    const block = match[1] ?? "";
    const titleMatch = titleRegex.exec(block);
    const snippetMatch = snippetRegex.exec(block);

    if (!titleMatch) continue;

    // DDG uses redirect URLs, extract the real URL
    let url = titleMatch[1] ?? "";
    const uddg = url.match(/uddg=([^&]+)/);
    if (uddg) url = decodeURIComponent(uddg[1] ?? "");

    results.push({
      title: stripHtml(titleMatch[2] ?? ""),
      url,
      snippet: stripHtml(snippetMatch?.[1] ?? ""),
    });
  }

  return results;
}

/**
 * Search the web. Uses Brave Search if BRAVE_SEARCH_API_KEY is set,
 * otherwise falls back to DuckDuckGo HTML scraping.
 */
export async function searchWeb(query: string, count = DEFAULT_RESULTS): Promise<SearchResult[]> {
  const braveKey = process.env.BRAVE_SEARCH_API_KEY;

  if (braveKey) {
    try {
      return await braveSearch(query, braveKey, count);
    } catch {
      // Fall through to DDG
    }
  }

  return duckDuckGoSearch(query, count);
}

export function formatSearchResults(results: SearchResult[]): string {
  if (results.length === 0) return "No results found.";

  return results
    .map((r, i) => `[${i + 1}] ${r.title}\n    ${r.url}\n    ${r.snippet}`)
    .join("\n\n");
}