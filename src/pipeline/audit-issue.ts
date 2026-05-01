/**
 * File GitHub issues from audit findings using the GitHub REST API.
 * Files up to MAX_ISSUES_PER_RUN issues per cron run, one per top
 * audit group. All issues are filed with just `audit`+`alert`+stream
 * and kennel labels; admins add `claude-autofix` manually after triaging.
 *
 * Dedup is fingerprint-based (via the shared `audit-filer` module):
 *   - Strict tier: open AuditIssue with same fingerprint → comment +
 *     increment recurrenceCount instead of filing a duplicate.
 *   - Bridging tier: legacy null-fingerprint row with matching
 *     kennelCode + ruleSlug-extracted-from-title → atomic backfill
 *     + comment.
 *   - Otherwise: file fresh.
 *
 * For non-fingerprintable rules (cross-row checks), the filer falls
 * through to fresh-create. Title-based same-run dedup still wraps
 * fresh-creates so the same group within one cron run never doubles
 * up if the call site looped twice.
 */
import type { AuditGroup } from "./audit-runner";
import { formatGroupIssueTitle, formatGroupIssueBody } from "./audit-format";
import {
  AUDIT_LABEL,
  ALERT_LABEL,
  STREAM_LABELS,
  kennelLabel,
} from "@/lib/audit-labels";
import { prisma } from "@/lib/db";
import { AUDIT_STREAM } from "@/lib/audit-stream-meta";
import { toIsoDateString } from "@/lib/date";
import { fileAuditFinding, type FilerActions } from "./audit-filer";

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
 * Build the cron's GitHub IO actions on top of the GITHUB_TOKEN env.
 *
 * Deliberately separate from `buildApiActions` in
 * `src/app/api/audit/file-finding/route.ts`: the api path uses
 * `URL` constructor + `getValidatedRepo()` + an integer guard on
 * issueNumber so Codacy's tainted-URL rule sees a literal-template
 * URL bound directly to `fetch`. Cron is server-internal and inherits
 * the existing `auto-issue.ts` envelope (template URL + `getRepo()`).
 * Don't unify the two without addressing both constraints.
 */
function buildCronActions(token: string): FilerActions {
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
  };
  return {
    async createIssue({ title, body, labels }) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${getRepo()}/issues`,
          {
            method: "POST",
            headers: { ...headers },
            body: JSON.stringify({ title, body, labels }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        if (!res.ok) {
          console.error(`[audit-issue] GitHub API ${res.status}: ${await res.text()}`);
          return null;
        }
        const issue = (await res.json()) as { html_url: string; number: number };
        return { number: issue.number, htmlUrl: issue.html_url };
      } catch (err) {
        console.error("[audit-issue] Failed to create GitHub issue:", err);
        return null;
      }
    },
    async postComment(issueNumber, body) {
      try {
        const res = await fetch(
          `https://api.github.com/repos/${getRepo()}/issues/${issueNumber}/comments`,
          {
            method: "POST",
            headers: { ...headers },
            body: JSON.stringify({ body }),
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
          },
        );
        if (!res.ok) {
          console.error(
            `[audit-issue] Comment failed (#${issueNumber}, ${res.status})`,
          );
          return false;
        }
        return true;
      } catch (err) {
        console.error("[audit-issue] Comment threw:", err);
        return false;
      }
    },
  };
}

/**
 * File audit issues for the top audit groups (up to MAX_ISSUES_PER_RUN).
 * Returns array of created/recurred issue URLs. Skips groups whose
 * fresh-create would clash with an existing same-run title (defends
 * against a runner accidentally double-feeding the same group).
 */
export async function fileAuditIssues(groups: AuditGroup[]): Promise<string[]> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.error("[audit-issue] GITHUB_TOKEN not set");
    return [];
  }

  const today = toIsoDateString(new Date());
  const existingTitles = await getExistingAuditIssueTitles(token);
  const actions = buildCronActions(token);

  const urls: string[] = [];
  for (const group of groups) {
    if (urls.length >= MAX_ISSUES_PER_RUN) break;

    const title = formatGroupIssueTitle(group, today);

    // Same-run / same-day defense: an exact-title match in the mirror
    // means a previous cron in this same calendar day already filed a
    // group with this title, OR fingerprint dedup landed it on
    // yesterday's open row. Skip the no-op rather than calling the
    // filer (which would still strict-tier-skip but cost a DB
    // round-trip and a comment).
    if (existingTitles.includes(title)) {
      console.log(`[audit-issue] Skipping "${title}" — exact title already in mirror`);
      continue;
    }

    const isCodeFix = !DATA_REMEDIATION_RULES.has(group.rule);
    const labels = [
      AUDIT_LABEL,
      ALERT_LABEL,
      STREAM_LABELS.AUTOMATED,
      kennelLabel(group.kennelCode),
    ];
    const body = formatGroupIssueBody(group);

    const outcome = await fileAuditFinding(
      {
        stream: AUDIT_STREAM.AUTOMATED,
        kennelCode: group.kennelCode,
        ruleSlug: group.rule,
        title,
        bodyMarkdown: body,
        labels,
      },
      actions,
    );

    if (outcome.action === "error") {
      console.error(`[audit-issue] Filing failed for "${title}": ${outcome.reason}`);
      continue;
    }

    const tag = isCodeFix ? "code-fix candidate" : "data remediation";
    if (outcome.action === "created") {
      console.log(`[audit-issue] Created issue #${outcome.issueNumber} [${tag}]: ${outcome.htmlUrl}`);
    } else {
      console.log(
        `[audit-issue] Recurred (${outcome.tier}) on #${outcome.issueNumber} ` +
        `(count=${outcome.recurrenceCount}) [${tag}]: ${outcome.htmlUrl}`,
      );
    }
    urls.push(outcome.htmlUrl);
  }

  return urls;
}

/**
 * Query titles of all open audit issues for same-run dedup.
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
