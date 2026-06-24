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
import { fileAuditFinding, type FilerActions } from "./audit-filer";
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

  // In-run dedup guard (mutated by promoteOneDraft). Two PENDING drafts that map
  // to the SAME GitHub issue — same fingerprint, or same kennel+rule for
  // non-fingerprintable rules — can't both be filed in one batch: the first
  // creates an issue that isn't in the AuditIssue mirror yet (the sync cron hasn't
  // run), so `fileAuditFinding`'s strict tier would miss it and the second draft
  // would fork a DUPLICATE. Defer the sibling to a later run. (Codex P2 #2298.)
  const processedKeys = new Set<string>();

  for (const draft of drafts) {
    try {
      const kind = await promoteOneDraft(draft, actions, suppressions, processedKeys);
      if (kind !== "skipped") summary[kind] += 1;
    } catch (err) {
      // Failure isolation: an unexpected throw (network/DB hiccup) must not abort
      // the whole batch and strand every later draft. (Gemini high #2298.)
      console.error(`[promote-audit] Unexpected error on draft ${draft.id}:`, err);
      summary.errored += 1;
      await markDraft(
        draft.id,
        "ERROR",
        { errorReason: err instanceof Error ? err.message : String(err) },
        draft.status,
      ).catch((markErr: unknown) => {
        console.error(`[promote-audit] Failed to mark draft ${draft.id} ERROR:`, markErr);
      });
    }
  }

  return summary;
}

/** The tallyable outcome of promoting one draft. `skipped` increments nothing
 *  (CAS claim lost / draft rejected out from under us). */
type PromotionOutcomeKind =
  | "filed"
  | "recurred"
  | "suppressed"
  | "rejected"
  | "errored"
  | "deferred"
  | "skipped";

/**
 * Promote a single draft through the suppression → dedup → claim → file pipeline.
 * Extracted from the loop to keep `promoteAuditDrafts`' cognitive complexity in
 * check (Sonar S3776). Mutates `processedKeys` for the in-run dedup guard and
 * returns the outcome the caller tallies. Unexpected throws propagate to the
 * caller's per-draft try/catch.
 */
async function promoteOneDraft(
  draft: PromotableDraft,
  actions: FilerActions,
  suppressions: Set<string>,
  processedKeys: Set<string>,
): Promise<PromotionOutcomeKind> {
  // A draft with no kennel (kennel deleted → FK SET NULL) can't be filed.
  if (!draft.kennelCode) {
    await markDraft(draft.id, "REJECTED", { errorReason: "missing-kennel" });
    return "rejected";
  }

  // Suppression filter at promotion time — the enforcement point. A suppressed
  // kennel+rule (or global rule) draft is marked SUPPRESSED and never filed.
  if (
    suppressions.has(`${draft.kennelCode}::${draft.ruleSlug}`) ||
    suppressions.has(`::${draft.ruleSlug}`)
  ) {
    await markDraft(draft.id, "SUPPRESSED", {});
    return "suppressed";
  }

  // Dedup key: filer fingerprint when fingerprintable, else a coarse kennel+rule
  // key. A sibling already processed this run is deferred (left PENDING).
  const canonical = buildCanonicalBlock({
    stream: draft.stream,
    kennelCode: draft.kennelCode,
    ruleSlug: draft.ruleSlug,
  });
  const dedupKey =
    canonical?.fingerprint ?? `coarse:${draft.kennelCode}:${draft.ruleSlug}`;
  if (processedKeys.has(dedupKey)) return "deferred";

  // Optimistic-lock claim on (status, promoteAttempts): a concurrent promoter or
  // an admin reject between our read and here flips one of them, so the claim
  // misses and we skip rather than double-process / publish a rejected finding.
  const claim = await prisma.auditFindingDraft.updateMany({
    where: {
      id: draft.id,
      status: draft.status,
      promoteAttempts: draft.promoteAttempts,
    },
    data: { promoteAttempts: { increment: 1 } },
  });
  if (claim.count === 0) return "skipped";

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
    await markDraft(
      draft.id,
      "FILED",
      { issueNumber: outcome.issueNumber, issueUrl: outcome.htmlUrl },
      draft.status,
    );
    console.log(`[promote-audit] Filed draft ${draft.id} → issue #${outcome.issueNumber}`);
    return "filed";
  }
  if (outcome.action === "recurred") {
    processedKeys.add(dedupKey);
    await markDraft(
      draft.id,
      "RECURRED",
      { issueNumber: outcome.issueNumber, issueUrl: outcome.htmlUrl, filerTier: outcome.tier },
      draft.status,
    );
    console.log(
      `[promote-audit] Recurred (${outcome.tier}) draft ${draft.id} → issue #${outcome.issueNumber}`,
    );
    return "recurred";
  }
  // Filer error: leave ERROR (retryable until the cap). Don't add to processedKeys
  // — no issue exists, so a sibling may still legitimately file.
  await markDraft(draft.id, "ERROR", { errorReason: outcome.reason }, draft.status);
  console.error(`[promote-audit] Filer error on draft ${draft.id}: ${outcome.reason}`);
  return "errored";
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
  // When set, only transition if the row is STILL in this status. Post-claim
  // marks pass the claimed status so an admin reject (or any change) that lands
  // between the claim and the GitHub write is honored — we don't overwrite it
  // back to FILED/ERROR. (Codex P2 / CodeRabbit Major #2298.)
  expectedStatus?: "PENDING" | "ERROR",
): Promise<void> {
  const { count } = await prisma.auditFindingDraft.updateMany({
    where: expectedStatus ? { id, status: expectedStatus } : { id },
    data: {
      status,
      promotedAt: new Date(),
      issueNumber: fields.issueNumber ?? null,
      issueUrl: fields.issueUrl ?? null,
      filerTier: fields.filerTier ?? null,
      errorReason: fields.errorReason ?? null,
    },
  });
  if (expectedStatus && count === 0) {
    console.warn(
      `[promote-audit] Draft ${id} changed status during promotion (likely rejected by an admin) — not overwriting to ${status}.`,
    );
  }
}
