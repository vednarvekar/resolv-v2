export interface GitHubIssue {
  number: number;
  title: string;
  body: string;
  state: string;
  labels: string[];
}

export async function fetchIssue(
  owner: string,
  repo: string,
  issueNumber: number,
  token?: string
): Promise<GitHubIssue> {

  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json"
  };

  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues/${issueNumber}`,
    { headers }
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch issue (${response.status})`
    );
  }

  const issue = await response.json();

  return {
    number: issue.number,
    title: issue.title,
    body: issue.body ?? "",
    state: issue.state,
    labels: issue.labels.map(
      (label: { name: string }) => label.name
    )
  };
}