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
import { GITHUB_MIN_WRITE_GAP_MS, buildCronActions } from "./audit-issue";
import { loadSuppressions } from "./audit-runner";
import { buildCanonicalBlock } from "@/lib/audit-canonical";
import {
  AUDIT_LABEL,
  ALERT_LABEL,
  ONBOARDING_CANDIDATE_LABEL,
  STREAM_LABELS,
  isSourceGapRule,
  kennelLabel,
} from "@/lib/audit-labels";
import { AUDIT_STREAM, type AuditStream } from "@/lib/audit-stream-meta";
import { withAdvisoryXactLock } from "@/lib/advisory-lock";

/**
 * Per-run GitHub-write cap. Higher than the structural cron's MAX_ISSUES_PER_RUN
 * (3) because these drafts are agent-verified against source and the agent is
 * itself capped at 8 findings/run — they're high-signal and human-curated, so a
 * larger drain is appropriate while still bounding a runaway-agent blast radius.
 *
 * Sized to clear a normal day's inflow (~15 drafts from five daily deep dives
 * plus the hareline audit, Nov 2026) and still work down a backlog. At 12 the
 * queue grew by ~3 a day and drafts went stale before they were filed.
 */
export const MAX_PROMOTIONS_PER_RUN = 30;

/** ERROR drafts retry until this attempt count, then they're left for admin attention. */
const MAX_PROMOTE_ATTEMPTS = 3;

/**
 * `maxDuration` (seconds) of the function a run lives in. The cron route passes its
 * own exported `maxDuration`; this default covers the admin "Promote now" action,
 * which runs under the platform default (also 300 s). If that action or its page
 * (`src/app/admin/audit/page.tsx`) ever gets a longer `maxDuration`, raise this
 * too, or the lock could free itself while a run is still filing.
 */
export const DEFAULT_PROMOTER_MAX_DURATION_S = 300;

/** Slack past `maxDuration` before Postgres ends an abandoned lock transaction. */
const LOCK_IDLE_SLACK_S = 30;

/** Fixed advisory-lock key: one promoter run at a time, across every instance.
 *  Must differ from the audit-issue sync's key (`audit-issue-sync.ts`). */
export const PROMOTER_LOCK_KEY = 0x41_44_50_52; // "ADPR"

export interface PromotionSummary {
  /** Set when another run held the promoter lock; nothing was read or filed. */
  skipped?: "locked";
  considered: number;
  filed: number;
  recurred: number;
  suppressed: number;
  rejected: number;
  errored: number;
  /** Drafts deferred to a later run because a sibling with the same dedup key
   *  was already processed this batch (see the in-run dedup guard), or because
   *  GitHub couldn't answer the dedup search (left PENDING, see `github-list-failed`). */
  deferred: number;
}

function emptySummary(): PromotionSummary {
  return { considered: 0, filed: 0, recurred: 0, suppressed: 0, rejected: 0, errored: 0, deferred: 0 };
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
 * Promote up to MAX_PROMOTIONS_PER_RUN queued drafts, oldest first. Idempotent and
 * concurrency-safe: an optimistic CAS on `promoteAttempts` claims each draft
 * before the GitHub side-effect, so a cron run and a manual "Promote now" can't
 * double-process the same row. Even under a lost claim, `fileAuditFinding`'s
 * strict tier is the backstop (a re-file becomes a recurrence comment, never a
 * duplicate issue).
 */
export async function promoteAuditDrafts({
  maxDurationSeconds = DEFAULT_PROMOTER_MAX_DURATION_S,
}: { maxDurationSeconds?: number } = {}): Promise<PromotionSummary> {
  // One run at a time: the hourly QStash run, the daily Vercel backstop and an
  // admin "Promote now" can overlap. Two overlapping runs would each file one of
  // two sibling drafts (the in-run dedup guard below only sees its own batch), so
  // a second run skips instead of waiting. See `withAdvisoryXactLock` for why a
  // run killed mid-way can't leave the lock stuck.
  const run = await withAdvisoryXactLock(
    PROMOTER_LOCK_KEY,
    (maxDurationSeconds + LOCK_IDLE_SLACK_S) * 1000,
    promoteUnderLock,
  );
  if (!run.acquired) {
    console.log("[promote-audit] Another promoter run holds the lock; skipping.");
    return { ...emptySummary(), skipped: "locked" };
  }
  return run.result;
}

async function promoteUnderLock(): Promise<PromotionSummary> {
  // Paced: a full batch is up to 30 creates/comments, and GitHub rate-limits
  // mutating requests sent less than a second apart.
  const actions = buildCronActions({ minWriteGapMs: GITHUB_MIN_WRITE_GAP_MS });
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

  const summary: PromotionSummary = { ...emptySummary(), considered: drafts.length };

  // In-run dedup guard (mutated by promoteOneDraft). Two PENDING drafts that map
  // to the SAME GitHub issue — same fingerprint, or same kennel+rule for
  // non-fingerprintable rules — can't both be filed in one batch: the first
  // creates an issue that isn't in the AuditIssue mirror yet (the sync cron hasn't
  // run), so `fileAuditFinding`'s strict tier would miss it and the second draft
  // would fork a DUPLICATE. Defer the sibling to a later run. (Codex P2 #2298.)
  const processedKeys = new Set<string>();

  // Once GitHub can't answer the dedup search, it's down for this run: leave the
  // rest of the batch untouched (no claim, no fetch) instead of timing out on each.
  let gitHubUnavailable = false;

  for (const draft of drafts) {
    if (gitHubUnavailable) {
      summary.deferred += 1;
      continue;
    }
    try {
      const kind = await promoteOneDraft(draft, actions, suppressions, processedKeys);
      if (kind === "github-unavailable") {
        gitHubUnavailable = true;
        summary.deferred += 1;
      } else if (kind !== "skipped") {
        summary[kind] += 1;
      }
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
  | "skipped"
  | "github-unavailable";

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
    // Untracked sources and missing history go to the onboarding automation.
    ...(isSourceGapRule(draft.ruleSlug) ? [ONBOARDING_CANDIDATE_LABEL] : []),
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
  // GitHub couldn't answer the dedup search, so nothing was filed: filing blind
  // could fork a duplicate. Leave the draft in its status (PENDING stays PENDING)
  // with the reason, and hand back the attempt so an outage can't use up an
  // ERROR draft's retries. The next hourly run tries again.
  if (outcome.reason === "github-list-failed") {
    await prisma.auditFindingDraft.updateMany({
      where: { id: draft.id, status: draft.status },
      data: { errorReason: outcome.reason, promoteAttempts: { decrement: 1 } },
    });
    console.warn(`[promote-audit] GitHub dedup search failed; left draft ${draft.id} ${draft.status}`);
    return "github-unavailable";
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
  filerTier?: "strict" | "bridging" | "coarse" | "github-search";
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
