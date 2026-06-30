// packages/llm/tools/web-search.ts
// Web search for the agent. Two modes:
// 1. Brave Search API (fast, structured) — set BRAVE_SEARCH_API_KEY
// 2. DuckDuckGo HTML scraping (no key needed, rate-limited fallback)
//
// DDG has no official free API — this scrapes their HTML, which is
// inherently fragile (DDG changes markup and rate-limits/CAPTCHAs scrapers
// without warning). If search keeps failing, get a free Brave Search API
// key (2000 queries/month free) and set BRAVE_SEARCH_API_KEY — it's a real
// API and won't randomly break.
//
// Returns top N results as title + URL + snippet for the LLM to reason over.

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

const BRAVE_ENDPOINT = "https://api.search.brave.com/res/v1/web/search";
const DDG_LITE_ENDPOINT = "https://lite.duckduckgo.com/lite/";
const DDG_HTML_ENDPOINT = "https://html.duckduckgo.com/html/";
const DEFAULT_RESULTS = 5;
const SEARCH_TIMEOUT_MS = 10_000;
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

/** Strip HTML tags for snippet extraction */
function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function resolveDdgUrl(rawUrl: string): string {
  let url = rawUrl;
  if (url.startsWith("//")) url = `https:${url}`;
  const uddg = url.match(/uddg=([^&]+)/);
  if (uddg) return decodeURIComponent(uddg[1] ?? "");
  return url;
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

/** DDG's "lite" endpoint: plain table markup, much less prone to breaking than the styled html/ endpoint. Tried first. */
async function duckDuckGoLiteSearch(query: string, count: number): Promise<SearchResult[]> {
  const url = `${DDG_LITE_ENDPOINT}?${new URLSearchParams({ q: query })}`;
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "text/html" },
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`DuckDuckGo (lite) HTTP ${res.status}`);

  const html = await res.text();
  const results: SearchResult[] = [];
  const linkRegex = /<a[^>]+class="result-link"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snippetRegex = /<td class="result-snippet">([\s\S]*?)<\/td>/g;
  const snippets: string[] = [];
  let sMatch: RegExpExecArray | null;
  while ((sMatch = snippetRegex.exec(html)) !== null) snippets.push(stripHtml(sMatch[1] ?? ""));

  let match: RegExpExecArray | null;
  let i = 0;
  while ((match = linkRegex.exec(html)) !== null && results.length < count) {
    results.push({
      title: stripHtml(match[2] ?? ""),
      url: resolveDdgUrl(match[1] ?? ""),
      snippet: snippets[i] ?? "",
    });
    i++;
  }
  return results;
}

/** Fallback: DDG's styled html/ endpoint. Markup here has changed before without notice. */
async function duckDuckGoHtmlSearch(query: string, count: number): Promise<SearchResult[]> {
  const body = new URLSearchParams({ q: query, b: "" });
  const res = await fetch(DDG_HTML_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": UA,
    },
    body: body.toString(),
    signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS),
  });

  if (!res.ok) throw new Error(`DuckDuckGo (html) HTTP ${res.status}`);

  const html = await res.text();
  const results: SearchResult[] = [];

  const blockRegex = /<div class="result results_links[^>]*>([\s\S]*?)<\/div>\s*<\/div>/g;
  const titleRegex = /<a[^>]+class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/;
  const snippetRegex = /<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/;

  let match: RegExpExecArray | null;
  while ((match = blockRegex.exec(html)) !== null && results.length < count) {
    const block = match[1] ?? "";
    const titleMatch = titleRegex.exec(block);
    const snippetMatch = snippetRegex.exec(block);
    if (!titleMatch) continue;

    results.push({
      title: stripHtml(titleMatch[2] ?? ""),
      url: resolveDdgUrl(titleMatch[1] ?? ""),
      snippet: stripHtml(snippetMatch?.[1] ?? ""),
    });
  }

  if (results.length === 0 && /anomaly|unusual traffic|captcha/i.test(html)) {
    throw new Error("DuckDuckGo is rate-limiting/blocking this request (bot detection page returned)");
  }

  return results;
}

async function duckDuckGoSearch(query: string, count: number): Promise<SearchResult[]> {
  try {
    const lite = await duckDuckGoLiteSearch(query, count);
    if (lite.length > 0) return lite;
  } catch {
    // fall through to the html endpoint
  }
  return duckDuckGoHtmlSearch(query, count);
}

/**
 * Search the web. Uses Brave Search if BRAVE_SEARCH_API_KEY is set,
 * otherwise falls back to DuckDuckGo HTML scraping (best-effort — see
 * note above on why DDG is the less reliable option).
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