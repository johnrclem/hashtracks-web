/**
 * File GitHub issues from audit findings using the GitHub REST API.
 * Files up to 3 individual issues (one per top audit group). All issues are filed with
 * just `audit`+`alert`; admins add `claude-autofix` manually after triaging.
 */
import type { AuditGroup } from "./audit-runner";
import { formatGroupIssueTitle, formatGroupIssueBody } from "./audit-format";
import { AUDIT_LABEL, ALERT_LABEL, STREAM_LABELS, kennelLabel } from "@/lib/audit-labels";
import { prisma } from "@/lib/db";
import { AUDIT_STREAM } from "@/lib/audit-stream-meta";
import { buildCanonicalBlock } from "@/lib/audit-canonical";

/**
 * Rules where the fix is running a backfill/re-scrape, not a code change.
 * These get filed as audit issues for human review but don't trigger autofix.
 */
const DATA_REMEDIATION_RULES = new Set([
  "title-raw-kennel-code",    // run backfill-event-titles.ts
  "hare-cta-text",            // stale data, re-scrape filters it
  "location-duplicate-segments", // pipeline fix deployed, needs re-scrape
]);

const FETCH_TIMEOUT_MS = 10_000;
const DEFAULT_REPO = "johnrclem/hashtracks-web";
const MAX_ISSUES_PER_RUN = 3;

/** If the mirror's most recent syncedAt is older than this, fall back to GitHub API. */
const MIRROR_STALE_MS = 25 * 60 * 60 * 1000; // 25 hours

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

/** Create a GitHub issue for one audit group. All audit issues require human review before
 *  any autofix workflow runs — add `claude-autofix` manually after triaging. */
async function createIssueForGroup(token: string, title: string, group: AuditGroup): Promise<string | null> {
  const canonical = buildCanonicalBlock({
    stream: AUDIT_STREAM.AUTOMATED,
    kennelCode: group.kennelCode,
    ruleSlug: group.rule,
  });
  const body = formatGroupIssueBody(group, canonical);
  const isCodeFix = !DATA_REMEDIATION_RULES.has(group.rule);
  const labels = [AUDIT_LABEL, ALERT_LABEL, STREAM_LABELS.AUTOMATED, kennelLabel(group.kennelCode)];

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
    const tag = isCodeFix ? "code-fix candidate" : "data remediation";
    console.log(`[audit-issue] Created issue #${issue.number} [${tag}]: ${issue.html_url}`);
    return issue.html_url;
  } catch (err) {
    console.error("[audit-issue] Failed to create GitHub issue:", err);
    return null;
  }
}

/**
 * Query titles of all open audit issues for deduplication.
 *
 * Primary source: local AuditIssue mirror (fast, no external call).
 * Fallback: GitHub API when the mirror is stale (no sync within {@link MIRROR_STALE_MS})
 * or when the DB query fails. This prevents duplicate filings when the audit cron
 * runs before the mirror sync has caught up.
 */
async function getExistingAuditIssueTitles(token: string): Promise<string[]> {
  try {
    const latest = await prisma.auditIssue.aggregate({
      _max: { syncedAt: true },
    });
    const lastSync = latest._max.syncedAt;
    if (lastSync && Date.now() - lastSync.getTime() < MIRROR_STALE_MS) {
      const openIssues = await prisma.auditIssue.findMany({
        where: { state: "open", delistedAt: null },
        select: { title: true },
      });
      return openIssues.map((i: { title: string }) => i.title);
    }
    console.log("[audit-issue] Mirror stale or empty — falling back to GitHub API");
  } catch (err) {
    console.error("[audit-issue] Mirror query failed — falling back to GitHub API:", err);
  }

  return fetchAuditIssueTitlesFromGitHub(token);
}

/** Fetch open audit issue titles directly from the GitHub API (fallback path). */
async function fetchAuditIssueTitlesFromGitHub(token: string): Promise<string[]> {
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
    return issues.map((i) => i.title);
  } catch (err) {
    console.error("[audit-issue] GitHub API fallback also failed:", err);
    return [];
  }
}
