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

function getRepo(): string {
  return process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
}

/**
 * File individual GitHub issues for the top audit groups.
 * Returns array of created issue URLs.
 */
export async function fileAuditIssues(groups: AuditGroup[]): Promise<string[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("[audit-issue] GITHUB_TOKEN not set");
    return [];
  }

  const today = new Date().toISOString().split("T")[0];

  // Check which groups already have issues filed today (dedup by kennel+rule in title)
  const existingTitles = await getExistingAuditIssueTitles(token, today);

  const urls: string[] = [];
  for (const group of groups) {
    const title = formatGroupIssueTitle(group, today);

    // Skip if an issue with this title already exists
    if (existingTitles.some(t => t.includes(group.kennelShortName) && t.includes(today))) {
      console.log(`[audit-issue] Skipping ${group.kennelShortName}/${group.rule} — issue already exists`);
      continue;
    }

    const url = await createIssueForGroup(token, title, group);
    if (url) urls.push(url);
  }

  return urls;
}

async function createIssueForGroup(token: string, title: string, group: AuditGroup): Promise<string | null> {
  const body = formatGroupIssueBody(group);
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

    // Only trigger autofix for code-fix rules; data remediation issues are human-reviewed
    const isCodeFix = !DATA_REMEDIATION_RULES.has(group.rule);
    if (isCodeFix) {
      try {
        const labelRes = await fetch(
          `https://api.github.com/repos/${getRepo()}/issues/${issue.number}/labels`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ labels: ["claude-autofix"] }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        if (!labelRes.ok) {
          console.error(`[audit-issue] Failed to add claude-autofix label to #${issue.number}: ${labelRes.status}`);
        }
      } catch (err) {
        console.error(`[audit-issue] Failed to add claude-autofix label to #${issue.number}:`, err);
      }
    }

    const label = isCodeFix ? "claude-autofix" : "audit-only (data remediation)";
    console.log(`[audit-issue] Created issue #${issue.number} [${label}]: ${issue.html_url}`);
    return issue.html_url;
  } catch (err) {
    console.error("[audit-issue] Failed to create GitHub issue:", err);
    return null;
  }
}

/** Get titles of existing open audit issues to avoid duplicates. */
async function getExistingAuditIssueTitles(token: string, _date: string): Promise<string[]> {
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
