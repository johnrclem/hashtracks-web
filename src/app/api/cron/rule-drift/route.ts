import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { prisma } from "@/lib/db";
import { detectRuleDrift, fileRuleDriftIssue, writeRuleDriftSnapshot } from "@/pipeline/rule-drift";

/**
 * Weekly schedule-rule drift check.
 *
 * Flags kennels whose active rule predicts a different weekday than the kennel's recent
 * independent events actually fall on — a season switch, a permanent change, or a rule that
 * flattened a seasonal kennel. Files ONE deduplicated GitHub issue (labels `rule-drift` and
 * `lane:defect`) so the finding self-surfaces; closing it lets the next real drift re-file.
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 */
export const POST = withCronRun("cron:rule-drift", async () => {
  const findings = await detectRuleDrift(prisma);
  // Persist every run (even 0 drift) so /admin/predictions shows "last checked" + findings
  // without re-running the heavy sweep on the page path.
  await writeRuleDriftSnapshot(prisma, findings);
  let issue = { filed: false, reason: "no drift" };
  if (findings.length > 0) issue = await fileRuleDriftIssue(findings);
  console.log(`[rule-drift] ${findings.length} drifted kennel(s); issue: ${issue.reason}`);
  return NextResponse.json({ data: { driftCount: findings.length, issue, findings } });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
