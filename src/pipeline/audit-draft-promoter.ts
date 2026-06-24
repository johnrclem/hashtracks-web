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
import { buildCanonicalBlock } from "@/lib/audit-canonical";
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
  /** Drafts deferred to a later run because a sibling with the same dedup key
   *  was already processed this batch (see the in-run dedup guard). */
  deferred: number;
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
    deferred: 0,
  };

  // In-run dedup guard. Two PENDING drafts that map to the SAME GitHub issue —
  // same fingerprint, or same kennel+rule for non-fingerprintable rules — can't
  // both be filed in one batch: the first creates an issue that isn't in the
  // AuditIssue mirror yet (the sync cron hasn't run), so `fileAuditFinding`'s
  // strict tier would miss it and the second draft would fork a DUPLICATE issue.
  // Defer the sibling to a later run, by which point the sync has mirrored the
  // first issue and the filer routes it to a recurrence instead. (Codex P2 #2298.)
  const processedKeys = new Set<string>();

  for (const draft of drafts) {
    try {
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

      // Dedup key: the filer fingerprint when the rule is fingerprintable, else a
      // coarse kennel+rule key (matches what fileAuditFinding's coarse tier would
      // collapse). If a sibling was already processed this run, defer this one.
      const canonical = buildCanonicalBlock({
        stream: draft.stream,
        kennelCode: draft.kennelCode,
        ruleSlug: draft.ruleSlug,
      });
      const dedupKey =
        canonical?.fingerprint ?? `coarse:${draft.kennelCode}:${draft.ruleSlug}`;
      if (processedKeys.has(dedupKey)) {
        summary.deferred++;
        continue; // leave PENDING; next run (post-sync) routes it as a recurrence
      }

      // Optimistic-lock claim: guard on the observed (status, promoteAttempts) so
      // (a) two concurrent promoters can't both process this row (promoteAttempts
      // changes, so the loser's WHERE no longer matches), and (b) a draft an admin
      // rejected between our read and this claim is no longer PENDING → claim
      // misses → we skip it instead of publishing a rejected finding. (Codex P2 #2298.)
      const claim = await prisma.auditFindingDraft.updateMany({
        where: {
          id: draft.id,
          status: draft.status,
          promoteAttempts: draft.promoteAttempts,
        },
        data: { promoteAttempts: { increment: 1 } },
      });
      if (claim.count === 0) continue; // lost the race / rejected — skip

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
        processedKeys.add(dedupKey);
        await markDraft(draft.id, "FILED", {
          issueNumber: outcome.issueNumber,
          issueUrl: outcome.htmlUrl,
        });
        summary.filed++;
        console.log(`[promote-audit] Filed draft ${draft.id} → issue #${outcome.issueNumber}`);
      } else if (outcome.action === "recurred") {
        processedKeys.add(dedupKey);
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
        // Don't add to processedKeys — no issue exists, so a sibling may still file.
        await markDraft(draft.id, "ERROR", { errorReason: outcome.reason });
        summary.errored++;
        console.error(`[promote-audit] Filer error on draft ${draft.id}: ${outcome.reason}`);
      }
    } catch (err) {
      // Failure isolation: an unexpected throw (network/DB hiccup) must not abort
      // the whole batch and strand every later draft. Record it and move on.
      // (Gemini high #2298.)
      console.error(`[promote-audit] Unexpected error on draft ${draft.id}:`, err);
      summary.errored++;
      await markDraft(draft.id, "ERROR", {
        errorReason: err instanceof Error ? err.message : String(err),
      }).catch((markErr: unknown) => {
        console.error(`[promote-audit] Failed to mark draft ${draft.id} ERROR:`, markErr);
      });
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
