/**
 * File GitHub issues from audit findings using the GitHub REST API.
 * Runs on Vercel (no `gh` CLI available).
 */
import type { AuditFinding } from "./audit-checks";
import { formatIssueTitle, formatIssueBody } from "./audit-format";

const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_REPO = "johnrclem/hashtracks-web";

function getRepo(): string {
  return process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
}

/**
 * File a GitHub issue with audit findings. Returns the issue URL on success, null on failure.
 * Adds labels in a separate API call so claude-issue-triage receives a clean labeled event.
 */
export async function fileAuditIssue(findings: AuditFinding[]): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("[audit-issue] GITHUB_TOKEN not set");
    return null;
  }

  const today = new Date().toISOString().split("T")[0];

  // Dedup: check if an audit issue already exists for today
  const existing = await checkExistingAuditIssue(token, today);
  if (existing) {
    console.log(`[audit-issue] Audit issue already exists for ${today}: ${existing}`);
    return existing;
  }

  const title = formatIssueTitle(findings, today);
  const body = formatIssueBody(findings);
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };

  try {
    const res = await fetch(
      `https://api.github.com/repos/${getRepo()}/issues`,
      {
        method: "POST",
        headers,
        body: JSON.stringify({
          title,
          body,
          labels: ["audit", "alert"],
        }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      console.error(`[audit-issue] GitHub API ${res.status}: ${await res.text()}`);
      return null;
    }

    const issue = (await res.json()) as { html_url: string; number: number };

    // Add claude-autofix directly — audit issues skip triage (findings are already well-structured)
    try {
      await fetch(
        `https://api.github.com/repos/${getRepo()}/issues/${issue.number}/labels`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ labels: ["claude-autofix"] }),
          signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        },
      );
    } catch (err) {
      console.error(`[audit-issue] Failed to add claude-autofix label to #${issue.number}:`, err);
    }

    console.log(`[audit-issue] Created issue #${issue.number}: ${issue.html_url}`);
    return issue.html_url;
  } catch (err) {
    console.error("[audit-issue] Failed to create GitHub issue:", err);
    return null;
  }
}

/** Check if an audit issue already exists for the given date. */
async function checkExistingAuditIssue(token: string, date: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://api.github.com/repos/${getRepo()}/issues?state=open&labels=audit&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );
    if (!res.ok) return null;
    const issues = (await res.json()) as { title: string; html_url: string }[];
    const todaysIssue = issues.find(i => i.title.includes(date));
    return todaysIssue?.html_url ?? null;
  } catch (err) {
    console.error("[audit-issue] Failed to check for existing audit issues:", err);
    return null;
  }
}
