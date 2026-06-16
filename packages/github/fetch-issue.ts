export interface GitHubComment {
  author: string;
  body: string;
  createdAt: string;
}

export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
  comments: GitHubComment[];
}

function authHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = { Accept: "application/vnd.github+json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

export async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string
): Promise<GitHubIssue> {
  const headers = authHeaders(token);

  const issueResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers }
  );

  if (!issueResponse.ok) {
    throw new Error(`Failed to fetch issue (${issueResponse.status})`);
  }

  const issue = (await issueResponse.json()) as {
    number: number;
    title: string;
    body: string | null;
    state: string;
    labels: { name: string }[];
  };

  // comments live at a separate endpoint
  const commentsResponse = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}/comments`,
    { headers }
  );

  let comments: GitHubComment[] = [];
  if (commentsResponse.ok) {
    const rawComments = (await commentsResponse.json()) as {
      user: { login: string } | null;
      body: string | null;
      created_at: string;
    }[];
    comments = rawComments.map((c) => ({
      author: c.user?.login ?? "unknown",
      body: c.body ?? "",
      createdAt: c.created_at,
    }));
  }
  // if comments fail to fetch (rate limit, etc.) we still return the issue itself

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    state: issue.state,
    labels: issue.labels.map((label: { name: string }) => label.name),
    comments,
  };
}