/**
 * File GitHub issues from audit findings using the GitHub REST API.
 * Files up to 3 individual issues (one per top audit group).
 * Code-fix issues get claude-autofix; data-remediation issues are audit-only.
 */
import type { AuditGroup } from "./audit-runner";
import { formatGroupIssueTitle, formatGroupIssueBody } from "./audit-format";

/**
 * Rules where the fix is running a backfill/re-scrape, not a code change.
 * These get filed as audit issues for human review but don't trigger autofix.
 */
const DATA_REMEDIATION_RULES = new Set([
  "title-raw-kennel-code",    // run backfill-event-titles.ts
  "hare-cta-text",            // stale data, re-scrape filters it
  "location-duplicate-segments", // pipeline fix deployed, needs re-scrape
  "location-region-appended",   // display-time fix deployed, data correct
]);

const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_REPO = "johnrclem/hashtracks-web";
const MAX_ISSUES_PER_RUN = 3;

/** Get the GitHub repository slug from env or fall back to default. */
function getRepo(): string {
  return process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
}

/**
 * File individual GitHub issues for the top audit groups (up to MAX_ISSUES_PER_RUN).
 * Skips groups that already have open issues (dedup by exact title match).
 * Returns array of created issue URLs.
 */
export async function fileAuditIssues(groups: AuditGroup[]): Promise<string[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("[audit-issue] GITHUB_TOKEN not set");
    return [];
  }

  const today = new Date().toISOString().split("T")[0];
  const existingTitles = await getExistingAuditIssueTitles(token);

  const urls: string[] = [];
  for (const group of groups) {
    if (urls.length >= MAX_ISSUES_PER_RUN) break;

    const title = formatGroupIssueTitle(group, today);

    // Exact title match dedup — covers kennel+rule+date
    if (existingTitles.includes(title)) {
      console.log(`[audit-issue] Skipping "${title}" — issue already exists`);
      continue;
    }

    const url = await createIssueForGroup(token, title, group);
    if (url) urls.push(url);
  }

  return urls;
}

/** Create a GitHub issue for one audit group with appropriate labels. */
async function createIssueForGroup(token: string, title: string, group: AuditGroup): Promise<string | null> {
  const body = formatGroupIssueBody(group);
  const isCodeFix = !DATA_REMEDIATION_RULES.has(group.rule);
  const labels = isCodeFix
    ? ["audit", "alert", "claude-autofix"]
    : ["audit", "alert"];

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
        body: JSON.stringify({ title, body, labels }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      console.error(`[audit-issue] GitHub API ${res.status}: ${await res.text()}`);
      return null;
    }

    const issue = (await res.json()) as { html_url: string; number: number };
    const tag = isCodeFix ? "claude-autofix" : "data remediation";
    console.log(`[audit-issue] Created issue #${issue.number} [${tag}]: ${issue.html_url}`);
    return issue.html_url;
  } catch (err) {
    console.error("[audit-issue] Failed to create GitHub issue:", err);
    return null;
  }
}

/** Fetch titles of all open audit issues for deduplication. */
async function getExistingAuditIssueTitles(token: string): Promise<string[]> {
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
    if (!res.ok) return [];
    const issues = (await res.json()) as { title: string }[];
    return issues.map(i => i.title);
  } catch (err) {
    console.error("[audit-issue] Failed to check for existing audit issues:", err);
    return [];
  }
}
