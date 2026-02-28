/**
 * Auto-issue filing for the self-healing automation loop.
 *
 * When critical alerts are generated during a scrape, this module automatically
 * creates GitHub issues with structured context that the Claude Code Action
 * triage workflow can parse and act on.
 *
 * Flow: scrapeSource() → health analysis → persistAlerts() → autoFileIssuesForAlerts()
 */

import { prisma } from "@/lib/db";
import type { AlertType } from "@/generated/prisma/client";

/** GitHub repo slug — reads GITHUB_REPOSITORY env var (set by GitHub Actions) with fallback. */
function getGithubRepo(): string {
  return process.env.GITHUB_REPOSITORY ?? "johnrclem/hashtracks-web";
}

/** GitHub API timeout for issue creation and search (10 seconds). */
const FETCH_TIMEOUT_MS = 10_000;

/** Alert types eligible for automatic issue filing. */
const AUTO_FILE_ALERT_TYPES = new Set([
  "SCRAPE_FAILURE",
  "CONSECUTIVE_FAILURES",
  "STRUCTURE_CHANGE",
  "FIELD_FILL_DROP",
]);

/** Severities eligible for automatic issue filing. */
const AUTO_FILE_SEVERITIES = new Set(["CRITICAL", "WARNING"]);

/** Maximum auto-filed issues per source per day (rate limiting). */
const MAX_ISSUES_PER_SOURCE_PER_DAY = 3;

/** Cooldown period: don't re-file for same alert type + source within this window. */
const COOLDOWN_HOURS = 48;

/** Map source type to the adapter file path pattern. */
const ADAPTER_FILE_MAP: Record<string, string> = {
  GOOGLE_CALENDAR: "src/adapters/google-calendar/adapter.ts",
  GOOGLE_SHEETS: "src/adapters/google-sheets/adapter.ts",
  ICAL_FEED: "src/adapters/ical/adapter.ts",
  HASHREGO: "src/adapters/hashrego/adapter.ts",
  MEETUP: "src/adapters/meetup/adapter.ts",
  RSS_FEED: "src/adapters/rss/adapter.ts",
  STATIC_SCHEDULE: "src/adapters/static-schedule/adapter.ts",
};

/** URL patterns to adapter file paths for HTML scrapers. */
const HTML_SCRAPER_FILE_MAP: [RegExp, string][] = [
  [/hashnyc\.com/i, "src/adapters/html-scraper/hashnyc.ts"],
  [/benfranklinmob/i, "src/adapters/html-scraper/bfm.ts"],
  [/hashphilly/i, "src/adapters/html-scraper/hashphilly.ts"],
  [/cityhash\.org/i, "src/adapters/html-scraper/city-hash.ts"],
  [/westlondonhash/i, "src/adapters/html-scraper/west-london-hash.ts"],
  [/barnesh3\.com/i, "src/adapters/html-scraper/barnes-hash.ts"],
  [/och3\.org/i, "src/adapters/html-scraper/och3.ts"],
  [/londonhash\.org\/slah3/i, "src/adapters/html-scraper/slash-hash.ts"],
  [/londonhash\.org/i, "src/adapters/html-scraper/london-hash.ts"],
  [/enfieldhash\.org/i, "src/adapters/html-scraper/enfield-hash.ts"],
  [/chicagohash\.org/i, "src/adapters/html-scraper/chicago-hash.ts"],
  [/chicagoth3\.com/i, "src/adapters/html-scraper/chicago-th3.ts"],
  [/sfh3\.com/i, "src/adapters/html-scraper/sfh3.ts"],
  [/ewh3\.com/i, "src/adapters/html-scraper/ewh3.ts"],
  [/dch4\.org/i, "src/adapters/html-scraper/dch4.ts"],
  [/ofh3\.com/i, "src/adapters/html-scraper/ofh3.ts"],
  [/hangoverhash\.digitalpress/i, "src/adapters/html-scraper/hangover.ts"],
];

/** Resolve the adapter file path for a given source type and URL. */
export function resolveAdapterFile(sourceType: string, sourceUrl: string): string {
  if (sourceType === "HTML_SCRAPER") {
    for (const [pattern, file] of HTML_SCRAPER_FILE_MAP) {
      if (pattern.test(sourceUrl)) return file;
    }
    return "src/adapters/html-scraper/hashnyc.ts"; // default HTML scraper
  }
  return ADAPTER_FILE_MAP[sourceType] ?? "src/adapters/registry.ts";
}

/** Derive the test file path from an adapter file path. */
function resolveTestFile(adapterFile: string): string {
  return adapterFile.replace(/\.ts$/, ".test.ts");
}

/** Build relevant files list for an alert, using actual adapter resolution. */
export function buildRelevantFiles(alertType: string, sourceType: string, sourceUrl: string): string[] {
  const adapterFile = resolveAdapterFile(sourceType, sourceUrl);
  const files: string[] = [adapterFile];

  switch (alertType) {
    case "UNMATCHED_TAGS":
      files.push("src/pipeline/kennel-resolver.ts", "prisma/seed.ts");
      break;
    case "STRUCTURE_CHANGE":
      files.push("src/pipeline/structure-hash.ts");
      break;
    case "FIELD_FILL_DROP":
      files.push("src/pipeline/fill-rates.ts");
      break;
    case "SCRAPE_FAILURE":
    case "CONSECUTIVE_FAILURES":
      files.push("src/pipeline/scrape.ts");
      break;
    case "EVENT_COUNT_ANOMALY":
      files.push("src/pipeline/scrape.ts", "src/pipeline/merge.ts");
      break;
    case "SOURCE_KENNEL_MISMATCH":
      files.push("src/pipeline/merge.ts", "src/pipeline/kennel-resolver.ts", "prisma/seed.ts");
      break;
  }

  return [...new Set(files)]; // deduplicate
}

/** Build the alert context section for the issue body. */
function buildContextSection(alertType: string, ctx: Record<string, unknown> | null): string {
  if (!ctx) return "";

  switch (alertType) {
    case "UNMATCHED_TAGS": {
      const tagList = (Array.isArray(ctx.tags) ? ctx.tags : []).map((t: string) => "- `" + t + "`").join("\n");
      return `### Unmatched Tags\n${tagList}\n\nThese tags appeared in scraped events but couldn't be resolved to any kennel.\nThe kennel resolver checked: shortName → alias → pattern match → no match.`;
    }
    case "EVENT_COUNT_ANOMALY":
      return `### Event Count\n- **Baseline avg:** ${ctx.baselineAvg} (last ${ctx.baselineWindow} scrapes)\n- **Current:** ${ctx.currentCount}\n- **Drop:** ${ctx.dropPercent}%`;
    case "FIELD_FILL_DROP": {
      const drop = (ctx.baselineAvg as number) - (ctx.currentRate as number);
      return `### Field Quality\n- **Field:** ${ctx.field}\n- **Baseline:** ${ctx.baselineAvg}%\n- **Current:** ${ctx.currentRate}%\n- **Drop:** ${drop}pp`;
    }
    case "STRUCTURE_CHANGE": {
      const prevHash = (ctx.previousHash as string)?.slice(0, 16) ?? "";
      const currHash = (ctx.currentHash as string)?.slice(0, 16) ?? "";
      return `### Structure Change\n- **Previous hash:** \`${prevHash}...\`\n- **Current hash:** \`${currHash}...\`\n\nThe HTML tag hierarchy changed between scrapes, which may break field extraction.`;
    }
    case "SCRAPE_FAILURE":
    case "CONSECUTIVE_FAILURES": {
      const errorList = (Array.isArray(ctx.errorMessages) ? ctx.errorMessages : []).slice(0, 5).map((e: string) => "- " + e).join("\n");
      const failureSuffix = typeof ctx.consecutiveCount === "number"
        ? `\n\n**Consecutive failures:** ${ctx.consecutiveCount}`
        : "";
      return `### Errors\n${errorList}${failureSuffix}`;
    }
    case "SOURCE_KENNEL_MISMATCH": {
      const blockedList = (Array.isArray(ctx.tags) ? ctx.tags : []).map((t: string) => "- `" + t + "`").join("\n");
      return `### Blocked Tags\n${blockedList}\n\nThese tags resolved to valid kennels but those kennels are not linked to this source via SourceKennel.`;
    }
    default:
      return "";
  }
}

/** Format AI recovery note for the issue body. */
function formatAiNote(ai: { attempted?: number; succeeded?: number; failed?: number } | undefined): string {
  if (!ai?.attempted) return "";
  if (ai.failed && ai.failed > 0) {
    return `\n\n**AI Recovery:** Attempted on ${ai.attempted} parse errors — ${ai.succeeded} recovered, ${ai.failed} failed. The failures likely represent format changes that need code-level fixes.`;
  }
  return `\n\n**AI Recovery:** All ${ai.succeeded} parse errors were automatically recovered by AI. Consider adding the new format pattern to the deterministic parser.`;
}

/** Build suggested approach text for the issue body. */
function buildSuggestedApproach(alertType: string, ctx: Record<string, unknown> | null): string {
  const ai = ctx?.aiRecovery as { attempted?: number; succeeded?: number; failed?: number } | undefined;
  const aiNote = formatAiNote(ai);

  switch (alertType) {
    case "UNMATCHED_TAGS":
      return "Add aliases in the database mapping these tags to existing kennels, or create new kennels if these are genuinely new organizations.";
    case "STRUCTURE_CHANGE":
      return "Fetch the current page and compare HTML structure to the expected format. Update CSS selectors and extraction patterns in the adapter." + aiNote;
    case "FIELD_FILL_DROP":
      return "Examine sample raw events to identify which extraction patterns stopped matching. Update extraction regex patterns in the adapter." + aiNote;
    case "EVENT_COUNT_ANOMALY":
      return "Check if the source website is accessible. Verify the scrape window is appropriate. Check for structural changes." + aiNote;
    case "SCRAPE_FAILURE":
    case "CONSECUTIVE_FAILURES":
      return "Check source URL accessibility. Review error messages for network, auth, or parsing failures.";
    case "SOURCE_KENNEL_MISMATCH":
      return "Add the SourceKennel link if the source legitimately provides events for that kennel, or update the adapter to produce the correct tag.";
    default:
      return "Investigate the alert context and relevant files.";
  }
}

interface AlertWithSource {
  id: string;
  type: string;
  severity: string;
  title: string;
  sourceId: string;
  context: unknown;
  source: {
    name: string;
    url: string;
    type: string;
  };
}

/** Build a GitHub issue body from an alert, including machine-readable agent context. */
export function buildIssueBody(alert: AlertWithSource): { title: string; body: string; labels: string[] } {
  const ctx = alert.context as Record<string, unknown> | null;
  const typeName = alert.type.replaceAll("_", " ").toLowerCase();

  const adapterFile = resolveAdapterFile(alert.source.type, alert.source.url);
  const testFile = resolveTestFile(adapterFile);
  const relevantFiles = buildRelevantFiles(alert.type, alert.source.type, alert.source.url);

  const contextSection = buildContextSection(alert.type, ctx);
  const suggestedApproach = buildSuggestedApproach(alert.type, ctx);

  const agentContextRaw = JSON.stringify({
    alertId: alert.id,
    alertType: alert.type,
    sourceId: alert.sourceId,
    sourceName: alert.source.name,
    sourceType: alert.source.type,
    sourceUrl: alert.source.url,
    severity: alert.severity,
    adapterFile,
    testFile,
    relevantFiles,
    context: ctx,
  }, null, 2);
  // Escape HTML comment close sequence to prevent prompt injection via scraped data
  const agentContext = agentContextRaw.replaceAll("-->", "--&gt;");

  const title = `[Alert] ${alert.title} — ${alert.source.name}`;

  const body = `## Source Alert: ${typeName}

**Source:** ${alert.source.name} (${alert.source.type})
**URL:** ${alert.source.url}
**Severity:** ${alert.severity}
**Alert ID:** ${alert.id}

${contextSection}

### Relevant Files
${relevantFiles.map((f) => `- \`${f}\``).join("\n")}

### Suggested Approach
${suggestedApproach}

---
*Auto-filed by HashTracks self-healing pipeline*

<!-- AGENT_CONTEXT
${agentContext}
-->`;

  const typeLabel = `alert:${alert.type.toLowerCase().replaceAll("_", "-")}`;
  const severityLabel = `severity:${alert.severity.toLowerCase()}`;
  const labels = ["alert", typeLabel, severityLabel, "claude-fix"];

  return { title, body, labels };
}

/** Check if we've recently filed an issue for this alert type + source (cooldown). */
async function isOnCooldown(sourceId: string, alertType: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - COOLDOWN_HOURS * 60 * 60 * 1000);
  const recentAlerts = await prisma.alert.findMany({
    where: {
      sourceId,
      type: alertType as AlertType,
      repairLog: { not: { equals: null } },
      updatedAt: { gte: cutoff },
    },
    select: { repairLog: true },
  });

  return recentAlerts.some((alert) => {
    if (!Array.isArray(alert.repairLog)) return false;
    return (alert.repairLog as { action: string }[]).some(
      (entry) => entry.action === "auto_file_issue",
    );
  });
}

/** Check rate limit: max issues per source per day. */
async function isRateLimited(sourceId: string): Promise<boolean> {
  const dayStart = new Date();
  dayStart.setUTCHours(0, 0, 0, 0);

  const alerts = await prisma.alert.findMany({
    where: {
      sourceId,
      updatedAt: { gte: dayStart },
      repairLog: { not: { equals: null } },
    },
    select: { repairLog: true },
  });

  let autoFiledCount = 0;
  for (const alert of alerts) {
    if (Array.isArray(alert.repairLog)) {
      for (const entry of alert.repairLog as { action: string; timestamp: string }[]) {
        if (entry.action === "auto_file_issue" && new Date(entry.timestamp) >= dayStart) {
          autoFiledCount++;
        }
      }
    }
  }

  return autoFiledCount >= MAX_ISSUES_PER_SOURCE_PER_DAY;
}

/** Check if an open GitHub issue already exists for this alert type + source. */
async function hasExistingOpenIssue(sourceId: string, alertType: string): Promise<boolean> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return false;

  const typeLabel = `alert:${alertType.toLowerCase().replaceAll("_", "-")}`;

  try {
    const repo = getGithubRepo();
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues?state=open&labels=${encodeURIComponent(typeLabel)},alert&per_page=100`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!res.ok) return false;

    const issues = (await res.json()) as { body?: string }[];
    // Check if any open issue contains this source ID in its AGENT_CONTEXT
    return issues.some((issue) => issue.body?.includes(sourceId));
  } catch {
    return false;
  }
}

/**
 * File a GitHub issue for an alert and record it in the repair log.
 * Returns the issue URL on success, or null if skipped/failed.
 */
async function fileGitHubIssue(
  alert: AlertWithSource,
): Promise<string | null> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return null;

  const { title, body, labels } = buildIssueBody(alert);

  try {
    const repo = getGithubRepo();
    const res = await fetch(
      `https://api.github.com/repos/${repo}/issues`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title, body, labels }),
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      },
    );

    if (!res.ok) {
      console.error(`[auto-issue] GitHub API ${res.status} for alert ${alert.id}`);
      return null;
    }

    const issue = (await res.json()) as { html_url: string; number: number };

    // Read existing repair log and append new entry
    const existing = await prisma.alert.findUnique({
      where: { id: alert.id },
      select: { repairLog: true },
    });
    const log = Array.isArray(existing?.repairLog) ? existing.repairLog : [];
    await prisma.alert.update({
      where: { id: alert.id },
      data: {
        repairLog: [
          ...log,
          {
            action: "auto_file_issue",
            timestamp: new Date().toISOString(),
            adminId: "system",
            details: { issueUrl: issue.html_url, issueNumber: issue.number },
            result: "success",
          },
        ] as unknown as never,
      },
    });

    return issue.html_url;
  } catch (err) {
    console.error(`[auto-issue] Failed for alert ${alert.id}:`, err);
    return null;
  }
}

/**
 * Process newly created/updated alerts and auto-file GitHub issues for eligible ones.
 *
 * Called after persistAlerts() in the scrape pipeline.
 * Respects rate limits, cooldown periods, and deduplication.
 */
export async function autoFileIssuesForAlerts(
  sourceId: string,
  alertIds: string[],
): Promise<{ filed: number; skipped: number }> {
  if (alertIds.length === 0) return { filed: 0, skipped: 0 };

  const token = process.env.GITHUB_TOKEN;
  if (!token) return { filed: 0, skipped: alertIds.length };

  // Fetch alerts with source info
  const alerts = await prisma.alert.findMany({
    where: { id: { in: alertIds }, sourceId },
    include: { source: { select: { name: true, url: true, type: true } } },
  });

  let filed = 0;
  let skipped = 0;

  for (const alert of alerts) {
    // Only auto-file for eligible types and severities
    if (!AUTO_FILE_ALERT_TYPES.has(alert.type) || !AUTO_FILE_SEVERITIES.has(alert.severity)) {
      skipped++;
      continue;
    }

    // Check rate limit
    if (await isRateLimited(alert.sourceId)) {
      skipped++;
      continue;
    }

    // Check cooldown
    if (await isOnCooldown(alert.sourceId, alert.type)) {
      skipped++;
      continue;
    }

    // Check for existing open issue
    if (await hasExistingOpenIssue(alert.sourceId, alert.type)) {
      skipped++;
      continue;
    }

    const issueUrl = await fileGitHubIssue(alert);
    if (issueUrl) {
      filed++;
    } else {
      skipped++;
    }
  }

  return { filed, skipped };
}
