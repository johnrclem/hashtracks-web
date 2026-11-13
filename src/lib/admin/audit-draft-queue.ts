/**
 * The audit finding review queue (`AuditFindingDraft` rows still waiting to be
 * filed), shared by the `/admin/audit` dashboard and the token-gated agent API.
 *
 * Findings wait here until the daily promotion cron files them, and some go
 * stale on the way: the fix ships, or a backfill lands, before the finding is
 * filed. Discarding one marks it REJECTED with a recorded reason so it's never
 * filed. A discarded draft stays in the table; nothing is deleted.
 */

import { normalizeDiscardReason } from "@/lib/admin/audit-discard-reason";
import { prisma } from "@/lib/db";

/** Statuses a draft can still be filed from (ERROR rows retry under a cap). */
const QUEUED_DRAFT_STATUSES = ["PENDING", "ERROR"] as const;

/** Who discarded a draft; prefixed onto the stored reason. */
export type DiscardActor = "admin" | "agent";

/** Queued drafts, PENDING before ERROR, oldest first within each. The body is
 *  only read when asked for: it can be up to 32 KB a row. */
export function loadQueuedDrafts({
  kennelCode,
  limit,
  includeBody = false,
}: {
  kennelCode?: string;
  limit: number;
  includeBody?: boolean;
}) {
  return prisma.auditFindingDraft.findMany({
    where: {
      status: { in: [...QUEUED_DRAFT_STATUSES] },
      ...(kennelCode ? { kennelCode } : {}),
    },
    orderBy: [{ status: "asc" }, { submittedAt: "asc" }],
    take: limit,
    select: {
      id: true,
      stream: true,
      status: true,
      kennelCode: true,
      ruleSlug: true,
      title: true,
      bodyMarkdown: includeBody,
      errorReason: true,
      submittedAt: true,
      kennel: { select: { shortName: true } },
    },
  });
}

/** What a discard did: `invalid-reason` (blank or too long; nothing changed) or
 *  `not-queued` (no queued draft has that id: already filed, suppressed or
 *  discarded). */
export type DiscardOutcome = "discarded" | "invalid-reason" | "not-queued";

/**
 * Mark a queued draft REJECTED so it's never filed. The trimmed reason goes in
 * `errorReason` as `discarded by <actor>: <reason>`; the promoter also records
 * why it rejects a draft in that column.
 *
 * Race with the promoter: a discard that lands after the promoter has claimed
 * the draft but before it marks the outcome still wins the row (the promoter
 * won't overwrite a status it didn't claim), but the GitHub issue may already
 * exist. Discard before the daily 14:00 UTC run to be sure.
 */
export async function discardQueuedDraft(
  id: string,
  rawReason: unknown,
  actor: DiscardActor,
): Promise<DiscardOutcome> {
  const reason = normalizeDiscardReason(rawReason);
  if (!reason) return "invalid-reason";
  const { count } = await prisma.auditFindingDraft.updateMany({
    where: { id, status: { in: [...QUEUED_DRAFT_STATUSES] } },
    data: {
      status: "REJECTED",
      promotedAt: new Date(),
      errorReason: `discarded by ${actor}: ${reason}`,
    },
  });
  return count > 0 ? "discarded" : "not-queued";
}
