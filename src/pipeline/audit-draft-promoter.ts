/**
 * Promote queued chrome-stream audit findings into GitHub issues.
 *
 * The Chrome agent deposits findings into `AuditFindingDraft` (PENDING) via
 * `/api/audit/submit-finding` — a non-publishing internal write. This promoter
 * (run by `/api/cron/promote-audit-findings`, or manually from the admin UI)
 * takes PENDING drafts and files them through the shared `fileAuditFinding`
 * cascade with server credentials. This is the trusted, session-less side of
 * the decouple — the external publish never rides the interactive agent.
 *
 * Dedup layering (kept orthogonal):
 *   - The queue's partial-unique `contentHash` dedupes same-run re-submits
 *     (one PENDING row per identical finding).
 *   - `fileAuditFinding`'s strict/bridging/coarse tiers own cross-issue dedup
 *     and recurrence. We hand every non-suppressed draft to the filer and let
 *     it decide created-vs-recurred — the promoter never pre-dedupes by title
 *     or fingerprint (that would lose recurrence history).
 */

import { prisma } from "@/lib/db";
import { fileAuditFinding } from "./audit-filer";
import { buildCronActions } from "./audit-issue";
import { loadSuppressions } from "./audit-runner";
import {
  AUDIT_LABEL,
  ALERT_LABEL,
  STREAM_LABELS,
  kennelLabel,
} from "@/lib/audit-labels";
import { AUDIT_STREAM, type AuditStream } from "@/lib/audit-stream-meta";

/**
 * Per-run GitHub-write cap. Higher than the structural cron's MAX_ISSUES_PER_RUN
 * (3) because these drafts are agent-verified against source and the agent is
 * itself capped at 8 findings/run — they're high-signal and human-curated, so a
 * larger drain is appropriate while still bounding a runaway-agent blast radius.
 */
const MAX_PROMOTIONS_PER_RUN = 12;

/** ERROR drafts retry until this attempt count, then they're left for admin attention. */
const MAX_PROMOTE_ATTEMPTS = 3;

export interface PromotionSummary {
  considered: number;
  filed: number;
  recurred: number;
  suppressed: number;
  rejected: number;
  errored: number;
}

interface PromotableDraft {
  id: string;
  stream: AuditStream;
  kennelCode: string | null;
  ruleSlug: string;
  title: string;
  bodyMarkdown: string;
  status: "PENDING" | "ERROR";
  promoteAttempts: number;
}

function streamLabel(stream: AuditStream): string {
  return stream === AUDIT_STREAM.CHROME_KENNEL
    ? STREAM_LABELS.CHROME_KENNEL
    : STREAM_LABELS.CHROME_EVENT;
}

/**
 * Promote up to MAX_PROMOTIONS_PER_RUN queued drafts. Idempotent and
 * concurrency-safe: an optimistic CAS on `promoteAttempts` claims each draft
 * before the GitHub side-effect, so a cron run and a manual "Promote now" can't
 * double-process the same row. Even under a lost claim, `fileAuditFinding`'s
 * strict tier is the backstop (a re-file becomes a recurrence comment, never a
 * duplicate issue).
 */
export async function promoteAuditDrafts(): Promise<PromotionSummary> {
  const actions = buildCronActions();
  const suppressions = await loadSuppressions();

  const drafts = (await prisma.auditFindingDraft.findMany({
    where: {
      OR: [
        { status: "PENDING" },
        { status: "ERROR", promoteAttempts: { lt: MAX_PROMOTE_ATTEMPTS } },
      ],
    },
    orderBy: { submittedAt: "asc" },
    take: MAX_PROMOTIONS_PER_RUN,
    select: {
      id: true,
      stream: true,
      kennelCode: true,
      ruleSlug: true,
      title: true,
      bodyMarkdown: true,
      status: true,
      promoteAttempts: true,
    },
  })) as PromotableDraft[];

  const summary: PromotionSummary = {
    considered: drafts.length,
    filed: 0,
    recurred: 0,
    suppressed: 0,
    rejected: 0,
    errored: 0,
  };

  for (const draft of drafts) {
    // A draft with no kennel (kennel deleted → FK SET NULL) can't be filed.
    if (!draft.kennelCode) {
      await markDraft(draft.id, "REJECTED", { errorReason: "missing-kennel" });
      summary.rejected++;
      continue;
    }

    // Suppression filter at promotion time — the enforcement point. A suppressed
    // kennel+rule (or global rule) draft is marked SUPPRESSED and never filed,
    // strictly safer than the old path where the agent filed directly.
    if (
      suppressions.has(`${draft.kennelCode}::${draft.ruleSlug}`) ||
      suppressions.has(`::${draft.ruleSlug}`)
    ) {
      await markDraft(draft.id, "SUPPRESSED", {});
      summary.suppressed++;
      continue;
    }

    // Optimistic-lock claim: guard on the observed promoteAttempts so two
    // concurrent promoters can't both process this row (the column actually
    // changes, so the loser's WHERE no longer matches after the winner commits).
    const claim = await prisma.auditFindingDraft.updateMany({
      where: { id: draft.id, promoteAttempts: draft.promoteAttempts },
      data: { promoteAttempts: { increment: 1 } },
    });
    if (claim.count === 0) continue; // lost the race — another promoter has it

    const labels = [
      AUDIT_LABEL,
      ALERT_LABEL,
      streamLabel(draft.stream),
      kennelLabel(draft.kennelCode),
    ];

    const outcome = await fileAuditFinding(
      {
        stream: draft.stream,
        kennelCode: draft.kennelCode,
        ruleSlug: draft.ruleSlug,
        title: draft.title,
        bodyMarkdown: draft.bodyMarkdown,
        labels,
      },
      actions,
    );

    if (outcome.action === "created") {
      await markDraft(draft.id, "FILED", {
        issueNumber: outcome.issueNumber,
        issueUrl: outcome.htmlUrl,
      });
      summary.filed++;
      console.log(`[promote-audit] Filed draft ${draft.id} → issue #${outcome.issueNumber}`);
    } else if (outcome.action === "recurred") {
      await markDraft(draft.id, "RECURRED", {
        issueNumber: outcome.issueNumber,
        issueUrl: outcome.htmlUrl,
        filerTier: outcome.tier,
      });
      summary.recurred++;
      console.log(
        `[promote-audit] Recurred (${outcome.tier}) draft ${draft.id} → issue #${outcome.issueNumber}`,
      );
    } else {
      // Filer error: leave the draft as ERROR (retryable next run until the cap).
      // Do NOT roll back promoteAttempts — the increment is what enforces the cap.
      await markDraft(draft.id, "ERROR", { errorReason: outcome.reason });
      summary.errored++;
      console.error(`[promote-audit] Filer error on draft ${draft.id}: ${outcome.reason}`);
    }
  }

  return summary;
}

interface DraftOutcomeFields {
  issueNumber?: number;
  issueUrl?: string;
  filerTier?: "strict" | "bridging" | "coarse";
  errorReason?: string;
}

async function markDraft(
  id: string,
  status: "FILED" | "RECURRED" | "SUPPRESSED" | "REJECTED" | "ERROR",
  fields: DraftOutcomeFields,
): Promise<void> {
  await prisma.auditFindingDraft.update({
    where: { id },
    data: {
      status,
      promotedAt: new Date(),
      issueNumber: fields.issueNumber ?? null,
      issueUrl: fields.issueUrl ?? null,
      filerTier: fields.filerTier ?? null,
      errorReason: fields.errorReason ?? null,
    },
  });
}
