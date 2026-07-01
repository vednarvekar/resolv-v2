import type { ToolDefinition } from "../../core/types.js";
import { parseIssueUrl } from "../../context-agent/github/parse-issue-url.js";
import { fetchIssue } from "../../context-agent/github/fetch-issue.js";
import { searchWeb, formatSearchResults } from "../tools/web-search.js";

export function createRemoteTools(): ToolDefinition[] {
  return [
    {
      name: "fetch_github_issue",
      description: "Fetch a GitHub issue's title, body, labels, and comments by URL.",
      inputSchema: {
        type: "object",
        properties: {
          url: { type: "string", description: "Full GitHub issue URL" },
        },
        required: ["url"],
      },
      async execute(input) {
        const { owner, repo, issueNumber } = parseIssueUrl(String(input.url));
        const issue = await fetchIssue(owner, repo, issueNumber);
        const commentSummary = issue.comments.length > 0
          ? issue.comments.slice(-3).map((c) => `  @${c.author}: ${c.body.slice(0, 200)}`).join("\n")
          : "  (no comments)";
        return {
          output: `#${issue.number}: ${issue.title}\nState: ${issue.state}\nLabels: ${issue.labels.join(", ") || "none"}\n\nBody:\n${issue.body}\n\nRecent comments:\n${commentSummary}`,
          isError: false,
        };
      },
    },
    {
      name: "search_web",
      description: "Search the web for information. Uses Brave Search (if BRAVE_SEARCH_API_KEY is set) or DuckDuckGo. Returns top results with titles, URLs, and snippets.",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          count: { type: "number", description: "Number of results (default: 5, max: 10)" },
        },
        required: ["query"],
      },
      async execute(input) {
        const query = String(input.query ?? "");
        const count = Math.min(10, Math.max(1, Number(input.count ?? 5)));
        if (!query) return { output: "No query provided", isError: true };

        try {
          const results = await searchWeb(query, count);
          return { output: formatSearchResults(results), isError: false };
        } catch (err) {
          return { output: `Search failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
        }
      },
    },
  ];
}
