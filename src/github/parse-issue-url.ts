export interface ParsedIssueUrl {
  owner: string;
  repo: string;
  issueNumber: number;
}

export function parseIssueUrl(url: string): ParsedIssueUrl {
  const match = url.match(/github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/);

  if (!match) {
    throw new Error("Invalid GitHub issue URL. Expected format: https://github.com/<owner>/<repo>/issues/<number>");
  }

  const owner = match[1];
  const repo = match[2];
  const issueNumber = Number(match[3]);

  if (!owner || !repo || Number.isNaN(issueNumber)) {
    throw new Error("Could not parse owner, repo, or issue number from URL");
  }

  return { owner, repo, issueNumber };
}
