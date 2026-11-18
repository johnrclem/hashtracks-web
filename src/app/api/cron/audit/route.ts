import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import {
  runAudit,
  persistAuditLog,
  updateAuditLogIssuesFiled,
  selfHealSanitizers,
} from "@/pipeline/audit-runner";
import { fileAuditIssues } from "@/pipeline/audit-issue";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { refreshScheduleOnlyFlags, refreshKennelEvidence } from "@/pipeline/kennel-evidence";

/**
 * Daily data quality audit endpoint.
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with Bearer CRON_SECRET.
 * Queries upcoming events for known bad patterns, ranks issue groups,
 * and files up to 3 individual GitHub issues for the top findings.
 */
export const POST = withCronRun("cron:audit", async () => {
  // Refresh lastEventDate cache — non-blocking; failures logged but don't block audit
  try {
    const backfilled = await backfillLastEventDates();
    if (backfilled > 0) console.log(`[audit] lastEventDate backfill: ${backfilled} kennels updated`);
  } catch (err) {
    console.error("[audit] lastEventDate backfill failed:", err instanceof Error ? err.message : err);
  }

  // Refresh schedule-only flags, then kennel evidence (reads the flags). Non-blocking.
  try {
    const flagged = await refreshScheduleOnlyFlags("all");
    const evidence = await refreshKennelEvidence();
    console.log(`[audit] kennel evidence refresh: ${flagged} events flagged, ${evidence} kennels updated`);
  } catch (err) {
    console.error("[audit] kennel evidence refresh failed:", err instanceof Error ? err.message : err);
  }

  // Re-apply merge sanitizers to any stale rows in the audit window before
  // scanning, so the audit doesn't re-file issues for values the sanitizers
  // already know how to clean. Non-blocking; failures logged but don't block
  // the audit.
  try {
    const heal = await selfHealSanitizers();
    if (heal.locationHealed + heal.haresHealed > 0) {
      console.log(
        `[audit] self-heal: ${heal.locationHealed} locations, ${heal.haresHealed} hares (scanned ${heal.scanned})`,
      );
    }
  } catch (err) {
    console.error("[audit] self-heal failed:", err instanceof Error ? err.message : err);
  }

  const result = await runAudit();

  if (result.findings.length === 0) {
    await persistAuditLog(result, 0);
    return NextResponse.json({
      data: {
        eventsScanned: result.eventsScanned,
        findingsCount: 0,
        message: "Clean audit — no data quality issues",
      },
    });
  }

  // Persist log first so a partial GitHub failure still leaves a record (and prevents retry duplication)
  const logId = await persistAuditLog(result, 0);
  // Pass all ranked groups — fileAuditIssues caps at 3 internally after dedup
  const issueUrls = await fileAuditIssues(result.groups);
  await updateAuditLogIssuesFiled(logId, issueUrls.length);

  return NextResponse.json({
    data: {
      eventsScanned: result.eventsScanned,
      findingsCount: result.findings.length,
      groupsFound: result.groups.length,
      issuesFiled: issueUrls.length,
      issueUrls,
      summary: result.summary,
    },
  });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
