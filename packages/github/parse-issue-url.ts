export interface ParsedIssueUrl {
  owner: string;
  repo: string;
  issueNumber: number;
}

export function parseIssueUrl(
  url: string
): ParsedIssueUrl {

  const match = url.match(
    /github\.com\/([^/]+)\/([^/]+)\/issues\/(\d+)/
  );

  if (!match) {
    throw new Error("Invalid GitHub issue URL");
  }

  return {
    owner: match[1]!,
    repo: match[2]!,
    issueNumber: Number(match[3])
  };
}