import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { verifyCronAuth } from "@/lib/cron-auth";
import { prisma } from "@/lib/db";
import { getValidatedRepo } from "@/lib/github-repo";
import { detectRuleDrift, type DriftFinding } from "@/pipeline/rule-drift";

/**
 * Weekly schedule-rule drift check.
 *
 * Flags kennels whose active rule predicts a different weekday than the kennel's recent
 * independent events actually fall on — a season switch, a permanent change, or a rule that
 * flattened a seasonal kennel. Files ONE deduplicated GitHub issue (label `rule-drift`) so the
 * finding self-surfaces; closing it lets the next real drift re-file.
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
const DRIFT_LABEL = "rule-drift";

function renderIssueBody(findings: DriftFinding[]): string {
  const rows = findings
    .map(
      (f) =>
        `| ${f.shortName} (\`${f.kennelCode}\`) | ${f.region} | ${f.predictedWeekdays.join("/")} | **${f.actualWeekday}** (${Math.round(f.actualShare * 100)}%, ${f.recentEventCount} ev) | \`${f.activeRules}\` |`,
    )
    .join("\n");
  return [
    "Detected by the weekly rule-drift check (`/api/cron/rule-drift`). Each kennel below has an",
    "active schedule rule whose currently-projected weekday disagrees with its recent independent",
    "events — likely a **seasonal switch**, a permanent schedule change, or a rule that flattened a",
    "seasonal kennel. Fix by authoring/correcting the kennel's `scheduleRules[]` (seasonal slots use",
    "`validFrom`/`validUntil`); see the seasonal-detector workflow.",
    "",
    "| Kennel | Region | Rule predicts | Recent actual | Active rule(s) |",
    "|---|---|---|---|---|",
    rows,
    "",
    "_Close this issue once addressed; the next run re-files if drift remains._",
  ].join("\n");
}

async function fileDriftIssue(findings: DriftFinding[]): Promise<{ filed: boolean; reason: string }> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) return { filed: false, reason: "no GITHUB_TOKEN" };
  const repo = getValidatedRepo();
  const headers = { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "Content-Type": "application/json" };

  // Dedup: skip if an open rule-drift issue already exists. Bail out (don't file) if the check
  // itself fails — a transient non-2xx must NOT fall through to POSTing a possibly-duplicate issue.
  const existing = await fetch(
    `https://api.github.com/repos/${repo}/issues?state=open&labels=${encodeURIComponent(DRIFT_LABEL)}&per_page=1`,
    { headers, signal: AbortSignal.timeout(15_000) },
  );
  if (!existing.ok) return { filed: false, reason: `github dedup check failed: ${existing.status}` };
  const open = (await existing.json()) as unknown[];
  if (Array.isArray(open) && open.length > 0) return { filed: false, reason: "open rule-drift issue exists" };

  const res = await fetch(`https://api.github.com/repos/${repo}/issues`, {
    method: "POST",
    headers,
    signal: AbortSignal.timeout(15_000),
    body: JSON.stringify({
      title: `Schedule-rule drift: ${findings.length} kennel(s) predicting the wrong weekday`,
      body: renderIssueBody(findings),
      labels: [DRIFT_LABEL],
    }),
  });
  if (!res.ok) return { filed: false, reason: `github ${res.status}` };
  return { filed: true, reason: "issue created" };
}

export async function POST(request: Request) {
  const auth = await verifyCronAuth(request);
  if (!auth.authenticated) {
    return NextResponse.json({ data: null, error: "Unauthorized" }, { status: 401 });
  }
  try {
    const findings = await detectRuleDrift(prisma);
    let issue = { filed: false, reason: "no drift" };
    if (findings.length > 0) issue = await fileDriftIssue(findings);
    console.log(`[rule-drift] ${findings.length} drifted kennel(s); issue: ${issue.reason}`);
    return NextResponse.json({ data: { driftCount: findings.length, issue, findings } });
  } catch (err) {
    console.error("[rule-drift] failed:", err);
    Sentry.captureException(err);
    return NextResponse.json(
      { data: null, error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/** Vercel Cron triggers GET requests. */
export async function GET(request: Request) {
  return POST(request);
}
