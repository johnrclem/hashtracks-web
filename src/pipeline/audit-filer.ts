/**
 * Shared filing decision logic for the three audit streams.
 *
 * Both the cron path (`fileAuditIssues`) and the chrome-stream
 * endpoint (`/api/audit/file-finding`) call into `fileAuditFinding`,
 * which:
 *
 *   1. Computes the fingerprint via `buildCanonicalBlock`. Rules
 *      flagged `fingerprint: false` in the registry skip the fingerprint
 *      tiers entirely and fall through to a fresh-issue create — the
 *      caller is responsible for any title-based same-run dedup it
 *      wants on top.
 *   2. Strict tier — looks up an open `AuditIssue` with the same
 *      `fingerprint`. On hit, posts a "still recurring …" comment,
 *      atomically increments `recurrenceCount`, returns `recurred`.
 *   3. Bridging tier — looks up open `AuditIssue` rows for the same
 *      `kennelCode` whose `fingerprint IS NULL` (legacy pre-cutover
 *      filings) and whose title carries the same automated rule slug
 *      bracket. On hit, atomically backfills the row's fingerprint
 *      (compare-and-swap on `fingerprint IS NULL`) and posts the
 *      same comment.
 *   4. Otherwise — calls `actions.createIssue` with the canonical
 *      block embedded so the next sync round can fingerprint the
 *      mirror row even if this caller doesn't.
 *
 * GitHub I/O is dependency-injected via `FilerActions` so cron + api
 * can keep their own fetch envelopes (cron uses `GITHUB_TOKEN` env;
 * api uses the URL-constructor pattern that satisfies Codacy) and
 * tests can stub both calls cleanly.
 *
 * Failure modes:
 *   - Comment fails on a strict-tier hit → return `error`. Caller
 *     decides whether to retry; we deliberately don't fork a fresh
 *     issue, since the matching open row already covers this finding.
 *     The recurrenceCount increment is deferred until AFTER comment
 *     success so a retry can't double-count.
 *   - Comment fails on a bridging-tier hit → return `error`, but the
 *     fingerprint backfill is left in place. Backfill is a permanent
 *     improvement to the mirror; rolling it back to null would just
 *     re-bridge on the next attempt. recurrenceCount stays put — the
 *     CAS only sets the fingerprint, increment runs after comment.
 *   - DB increment fails after a successful comment → return
 *     `db-update-failed` (typed) so the caller surfaces a 502. A
 *     retry will hit strict tier, re-comment, and re-attempt the
 *     increment — comment spam is preferable to a lost recurrence
 *     count, especially once 5c-B's escalation is wired in.
 *   - Create fails → return `error`. Caller can retry; the canonical
 *     block hasn't been emitted yet so re-trying is safe.
 *
 * Known follow-ups (deferred from PR #1190 review):
 *   - Rule version-drift check: bridging consults only kennelCode +
 *     extracted ruleSlug, not the rule's version-at-time-of-filing.
 *     Implementing it requires populating `AuditRuleVersionHistory`
 *     from a registry codegen step (table is currently empty).
 *   - Comment-throttling: long-lived issues accumulate one recur
 *     comment per cron day. A "skip if last comment < N days old"
 *     gate is a follow-up.
 *   - Response envelope `{ data, error?, meta? }` (Qodo): the
 *     CLAUDE.md convention isn't enforced anywhere in the existing
 *     audit/admin route surface. Adopting it just here would diverge
 *     from neighbors; tracked as a cross-cutting refactor.
 */

import { prisma } from "@/lib/db";
import {
  buildCanonicalBlock,
  emitCanonicalBlock,
} from "@/lib/audit-canonical";
import { toIsoDateString } from "@/lib/date";
import {
  AUDIT_LABEL,
  NEEDS_DECISION_LABEL,
  kennelLabel,
} from "@/lib/audit-labels";
import type { AuditStream } from "@/lib/audit-stream-meta";
import {
  extractRuleSlugFromAutomatedTitle,
  extractRuleSlugFromChromeTitle,
} from "@/pipeline/audit-issue-sync";

/**
 * Try every known title format until one extracts a recognizable slug.
 * Cron-stream legacy rows match `extractRuleSlugFromAutomatedTitle`;
 * chrome-stream legacy rows (filings made by an early version of the
 * file-finding endpoint or by pasted-prompt admins before 5c-C wires
 * the prompts to the endpoint) match `extractRuleSlugFromChromeTitle`.
 */
function extractRuleSlugFromTitle(title: string): string | null {
  return (
    extractRuleSlugFromAutomatedTitle(title) ??
    extractRuleSlugFromChromeTitle(title)
  );
}

/**
 * Recurrence threshold above which a base finding is escalated to a
 * meta-issue tagged `audit:needs-decision`. 5 consecutive days same
 * fingerprint == "this rule is misconfigured OR the underlying data
 * is intentional and should be suppressed". Either way the operator
 * needs to make a call instead of letting the comment trail bloat.
 *
 * Escalation fires once per (base issue) lifecycle: when the base
 * closes and later reopens, the sync clears `escalatedAt` so the
 * counter starts fresh.
 */
export const ESCALATION_THRESHOLD = 5;

export interface FileFindingInput {
  stream: AuditStream;
  kennelCode: string;
  ruleSlug: string;
  /** Issue title used when filing fresh. Bridging compares this
   *  against the legacy row's title via `extractRuleSlugFromAutomatedTitle`
   *  for ruleSlug equivalence. */
  title: string;
  /** Markdown body for the GitHub issue. The canonical block is
   *  appended automatically when fingerprintable. */
  bodyMarkdown: string;
  /** Labels for a fresh-create only — recur paths only post comments. */
  labels: readonly string[];
}

export type FileFindingOutcome =
  | { action: "created"; issueNumber: number; htmlUrl: string }
  | {
      action: "recurred";
      issueNumber: number;
      htmlUrl: string;
      recurrenceCount: number;
      tier: "strict" | "bridging";
      /** Set when this recur crossed the escalation threshold and a
       *  meta-issue was filed (or had previously been filed for this
       *  base lifecycle). Lets callers surface a link to the meta in
       *  logs / response payloads. */
      escalatedToIssueNumber?: number;
    }
  | {
      action: "error";
      reason: FilerErrorReason;
      /** Issue number of the existing row we matched (strict or bridging
       *  tier) when the comment call failed. Surfaces to the caller so
       *  it can render "your finding may have landed on #42". Absent on
       *  `create-failed` since there's no existing row in that case. */
      existingIssueNumber?: number;
    };

export type FilerErrorReason =
  | "comment-failed-strict"
  | "comment-failed-bridging"
  | "create-failed"
  | "db-update-failed";

/**
 * Function-typed (not method-shorthand) properties so callers can
 * assert against `actions.postComment` directly without tripping
 * eslint's `unbound-method` rule. Cron + api callers also benefit:
 * arrow-function-typed properties are normal callable values, no
 * `this`-binding fragility.
 */
export interface FilerActions {
  /** Returns the created issue's number and html URL on 2xx, null on
   *  any failure. Caller-supplied so cron and api can keep their own
   *  fetch envelopes. */
  createIssue: (input: {
    title: string;
    body: string;
    labels: readonly string[];
  }) => Promise<{ number: number; htmlUrl: string } | null>;
  /** Returns true on successful 2xx comment, false on any failure. */
  postComment: (issueNumber: number, body: string) => Promise<boolean>;
}

/**
 * Format a "still recurring" comment posted on the existing open
 * issue when a finding fingerprints to (or bridges into) it. Includes
 * today's ISO date and the finding's body so operators reading the
 * issue see the freshest event sample without scrolling the timeline.
 */
function formatRecurComment(input: FileFindingInput): string {
  return `**Still recurring on ${toIsoDateString(new Date())}.**\n\n${input.bodyMarkdown}`;
}

/**
 * Build the meta-issue body for an escalation. Pure function; takes
 * resolved kennel shortName so the formatting doesn't have to do its
 * own DB lookup.
 */
function formatEscalationBody(
  baseIssueNumber: number,
  kennelShortName: string,
  input: FileFindingInput,
  recurrenceCount: number,
): string {
  return [
    `Audit finding **${input.ruleSlug}** for **${kennelShortName}** has recurred ${recurrenceCount} consecutive times without resolution.`,
    "",
    `**Base issue:** #${baseIssueNumber}`,
    `**Kennel:** ${kennelShortName} (\`${input.kennelCode}\`)`,
    `**Rule:** \`${input.ruleSlug}\``,
    `**Recurrence count:** ${recurrenceCount}`,
    "",
    "## Decide",
    "",
    `- **Fix** the underlying defect → close #${baseIssueNumber} with \`Closes #${baseIssueNumber}\` in a PR commit.`,
    `- **Suppress** the finding (kennel+rule is intentional) → add to the suppressions endpoint and close both issues.`,
    `- **Reclassify** as schema-gap or low-priority → relabel and add to the relevant tracker.`,
    "",
    "When the base issue closes-and-reopens, this escalation tracker resets and the counter starts fresh.",
  ].join("\n");
}

/**
 * After a strict-tier increment lands, decide whether to file an
 * escalation meta-issue. Best-effort: any failure path returns
 * `undefined` and the recur outcome still succeeds — the counter is
 * already incremented and the operator will see the threshold-crossed
 * row even without the meta.
 *
 * Race safety: we claim the escalation slot **before** creating the
 * GitHub meta-issue, so concurrent callers that cross the threshold
 * simultaneously can never both file a duplicate `audit:needs-decision`
 * issue (Codex 5c-B pass-1 finding). The flow is:
 *
 *   1. CAS `escalatedAt IS NULL → escalatedAt = NOW()`. Loser reads
 *      the existing escalation and returns its meta-issue number.
 *   2. Winner creates the meta-issue. On create-fail, roll back the
 *      claim so a later attempt can retry instead of getting stuck
 *      with `escalatedAt` set and no meta to link.
 *   3. Winner finalizes by writing `escalatedToIssueNumber`. Between
 *      steps 2 and 3 a concurrent reader sees `escalatedAt` set but
 *      no number — they return undefined for this call (no link to
 *      surface yet) and pick up the finalized number on the next.
 */
async function tryEscalate(
  baseIssueId: string,
  baseIssueNumber: number,
  newRecurrenceCount: number,
  kennelShortName: string,
  input: FileFindingInput,
  actions: FilerActions,
): Promise<number | undefined> {
  if (newRecurrenceCount < ESCALATION_THRESHOLD) return undefined;

  // Step 1: atomic claim. A row with `escalatedAt: null` flips to
  // `escalatedAt: now()` (with escalatedToIssueNumber still null —
  // we'll set it after the meta-issue lands). Concurrent callers
  // either win this CAS or read the existing escalation below.
  const claimed = await prisma.auditIssue.updateMany({
    where: { id: baseIssueId, escalatedAt: null },
    data: { escalatedAt: new Date() },
  });
  if (claimed.count === 0) {
    // Lost claim or already escalated for this lifecycle. Read the
    // existing meta-issue number so the caller can include it in logs.
    const existing = await prisma.auditIssue.findUnique({
      where: { id: baseIssueId },
      select: { escalatedToIssueNumber: true },
    });
    return existing?.escalatedToIssueNumber ?? undefined;
  }

  // We hold the claim. Wrap the rest in try/catch so ANY failure
  // (createIssue rejects, finalize update fails) rolls back the
  // claim — otherwise the base would be wedged in a half-escalated
  // state with `escalatedAt` set but `escalatedToIssueNumber` null,
  // and every subsequent caller would lose the CAS forever
  // (Codex 5c-B pass-1 high finding).
  try {
    // Step 2: file the meta-issue.
    const meta = await actions.createIssue({
      title: `[Audit Recurring] ${kennelShortName} — ${input.ruleSlug}: ${newRecurrenceCount}+ days unresolved`,
      body: formatEscalationBody(
        baseIssueNumber,
        kennelShortName,
        input,
        newRecurrenceCount,
      ),
      labels: [AUDIT_LABEL, NEEDS_DECISION_LABEL, kennelLabel(input.kennelCode)],
    });
    if (!meta) {
      console.error(
        `[audit-filer] Escalation meta-issue create failed for base #${baseIssueNumber} — rolling back claim`,
      );
      await rollbackEscalationClaim(baseIssueId);
      return undefined;
    }

    // Step 3: finalize. We hold the escalation slot — no race here.
    await prisma.auditIssue.update({
      where: { id: baseIssueId },
      data: { escalatedToIssueNumber: meta.number },
    });

    // Best-effort link comment. Failure is logged but not surfaced —
    // the meta is filed and tracked regardless, and the next sync cycle
    // gives operators another chance to discover it via the
    // `audit:needs-decision` label.
    const linkOk = await actions.postComment(
      baseIssueNumber,
      `Escalated to meta-issue #${meta.number} after ${newRecurrenceCount} consecutive recurrences without resolution. Pick a remediation path; this tracker resets when the base issue closes-and-reopens.`,
    );
    if (!linkOk) {
      console.warn(
        `[audit-filer] Escalation link comment failed for base #${baseIssueNumber} (meta #${meta.number} still filed)`,
      );
    }

    return meta.number;
  } catch (err) {
    console.error(
      `[audit-filer] Escalation post-claim failure for base #${baseIssueNumber} — rolling back claim:`,
      err,
    );
    await rollbackEscalationClaim(baseIssueId);
    return undefined;
  }
}

/**
 * Best-effort rollback of an escalation claim. If the rollback itself
 * fails the row stays wedged, but we've at least attempted recovery
 * and logged it — operator can clear `escalatedAt` manually.
 */
async function rollbackEscalationClaim(baseIssueId: string): Promise<void> {
  try {
    await prisma.auditIssue.update({
      where: { id: baseIssueId },
      data: { escalatedAt: null, escalatedToIssueNumber: null },
    });
  } catch (rollbackErr) {
    console.error(
      `[audit-filer] Escalation claim rollback failed for ${baseIssueId} — operator must clear escalatedAt manually:`,
      rollbackErr,
    );
  }
}

/**
 * Run the strict-tier match: comment on an existing open issue with
 * the target fingerprint, atomically increment recurrenceCount.
 * Returns the outcome on hit (including comment-failure errors), or
 * null if nothing matched.
 *
 * Shared between the top-of-cascade strict-tier check and the
 * post-CAS-loss recovery path inside `tryBridge` — when bridging
 * loses a CAS race, the row that won may have just stamped this
 * fingerprint, so we re-check strict tier before trying another
 * bridging candidate. This is what closes the concurrent-bridge
 * double-stamp race Codex flagged.
 */
async function runStrictTier(
  fingerprint: string,
  input: FileFindingInput,
  actions: FilerActions,
): Promise<FileFindingOutcome | null> {
  const strict = await prisma.auditIssue.findFirst({
    where: { fingerprint, state: "open", delistedAt: null },
    select: {
      id: true,
      githubNumber: true,
      htmlUrl: true,
      recurrenceCount: true,
      // Kennel shortName is plumbed through to `tryEscalate` so the
      // escalation path doesn't need its own findUnique round-trip
      // (saves one DB call per threshold-crossing recur).
      kennel: { select: { shortName: true } },
    },
    // Deterministic match under the rare case where two open rows
    // share a fingerprint (incident recovery / migration windows):
    // always pick the oldest. Without this, two cron ticks could
    // comment on different rows and split the recurrence thread.
    // Mirrors `tryBridge`'s candidate ordering.
    orderBy: { githubCreatedAt: "asc" },
  });
  if (!strict) return null;

  const ok = await actions.postComment(
    strict.githubNumber,
    formatRecurComment(input),
  );
  if (!ok) {
    return {
      action: "error",
      reason: "comment-failed-strict",
      existingIssueNumber: strict.githubNumber,
    };
  }
  // Increment lives in its own try/catch so a DB failure after a
  // successful GitHub comment doesn't bubble out of the route as a
  // 500. The caller already has the comment landed; we surface a
  // typed `db-update-failed` outcome (idempotent on retry: the
  // strict-tier branch will hit again, post a fresh comment, and
  // re-attempt the increment — comment spam is preferable to a lost
  // recurrence count).
  let newRecurrenceCount: number;
  try {
    const updated = await prisma.auditIssue.update({
      where: { id: strict.id },
      data: { recurrenceCount: { increment: 1 } },
      select: { recurrenceCount: true },
    });
    newRecurrenceCount = updated.recurrenceCount;
  } catch (err) {
    console.error(
      `[audit-filer] Strict-tier recurrenceCount update failed for #${strict.githubNumber}:`,
      err,
    );
    return {
      action: "error",
      reason: "db-update-failed",
      existingIssueNumber: strict.githubNumber,
    };
  }

  // Escalation is best-effort — failures don't roll back the
  // increment. See `tryEscalate` doc for race semantics. We pass
  // the kennel shortName already loaded by the strict-tier query
  // so the escalation path doesn't need its own findUnique.
  const escalatedToIssueNumber = await tryEscalate(
    strict.id,
    strict.githubNumber,
    newRecurrenceCount,
    strict.kennel?.shortName ?? input.kennelCode,
    input,
    actions,
  );

  return {
    action: "recurred",
    issueNumber: strict.githubNumber,
    htmlUrl: strict.htmlUrl,
    recurrenceCount: newRecurrenceCount,
    tier: "strict",
    ...(escalatedToIssueNumber !== undefined ? { escalatedToIssueNumber } : {}),
  };
}

/**
 * Try to bridge into a legacy null-fingerprint row. Returns the
 * outcome on a successful match (including comment-failure errors
 * once the row's been claimed), or null if no candidate matches —
 * caller should fall through to creating a fresh issue.
 *
 * Concurrent-bridge race: if two callers each find the same legacy
 * candidate set and the first wins the CAS on row 1, the second's
 * row-1 CAS returns count=0. The second caller previously moved on
 * to row 2 and stamped the fingerprint there — producing two open
 * rows with the same fingerprint, defeating the dedup. We close
 * that race by re-running strict tier on every CAS loss: if a
 * concurrent caller has stamped the fingerprint anywhere, we land
 * on its row instead of double-stamping.
 */
async function tryBridge(
  fingerprint: string,
  input: FileFindingInput,
  actions: FilerActions,
): Promise<FileFindingOutcome | null> {
  // Same-kennel legacy rows. Cap at a small window — bridging only
  // makes sense for a handful of pre-cutover open rows per kennel,
  // and a runaway candidate set would slow the cron path.
  const candidates = await prisma.auditIssue.findMany({
    where: {
      kennelCode: input.kennelCode,
      fingerprint: null,
      state: "open",
      delistedAt: null,
    },
    select: {
      id: true,
      githubNumber: true,
      htmlUrl: true,
      title: true,
      recurrenceCount: true,
    },
    // Oldest first: when several legacy rows could bridge, claim the
    // canonical (oldest) one and let the others stay un-bridged so an
    // operator can manually merge them.
    orderBy: { githubCreatedAt: "asc" },
    take: 25,
  });

  for (const candidate of candidates) {
    const slugFromTitle = extractRuleSlugFromTitle(candidate.title);
    if (slugFromTitle !== input.ruleSlug) continue;

    // Step 1: backfill the fingerprint only — DO NOT increment
    // recurrenceCount yet. Originally we did both in the same CAS,
    // but Qodo/CodeRabbit/Codex flagged that a comment failure or
    // retry between the CAS and the comment would inflate the count
    // (and trigger escalation prematurely once 5c-B lands). Strict
    // tier already separates increment from comment for the same
    // reason; bridging now matches.
    const claimed = await prisma.auditIssue.updateMany({
      where: { id: candidate.id, fingerprint: null },
      data: { fingerprint },
    });
    if (claimed.count === 0) {
      // CAS lost. The winner may have just stamped THIS fingerprint
      // on the row, in which case we'd double-stamp by trying the
      // next candidate. Re-check strict tier first; if a row now
      // carries the target fingerprint, route through it. Otherwise
      // the lost row was claimed for a different fingerprint and we
      // can move on safely.
      const strictRecovered = await runStrictTier(fingerprint, input, actions);
      if (strictRecovered) return strictRecovered;
      continue;
    }

    // Step 2: post the recur comment. Failure surfaces as 502; the
    // backfilled fingerprint is left in place because that's a
    // permanent mirror improvement (next call hits strict cleanly).
    const ok = await actions.postComment(
      candidate.githubNumber,
      formatRecurComment(input),
    );
    if (!ok) {
      return {
        action: "error",
        reason: "comment-failed-bridging",
        existingIssueNumber: candidate.githubNumber,
      };
    }

    // Step 3: increment recurrenceCount and read back the actual
    // value. Returning `candidate.recurrenceCount + 1` (the original
    // implementation) was racy — a concurrent caller between
    // `findMany` and now could have bumped the count too. The
    // DB-returned value is the only reliable source.
    let newRecurrenceCount: number;
    try {
      const updated = await prisma.auditIssue.update({
        where: { id: candidate.id },
        data: { recurrenceCount: { increment: 1 } },
        select: { recurrenceCount: true },
      });
      newRecurrenceCount = updated.recurrenceCount;
    } catch (err) {
      console.error(
        `[audit-filer] Bridging recurrenceCount update failed for #${candidate.githubNumber}:`,
        err,
      );
      return {
        action: "error",
        reason: "db-update-failed",
        existingIssueNumber: candidate.githubNumber,
      };
    }

    return {
      action: "recurred",
      issueNumber: candidate.githubNumber,
      htmlUrl: candidate.htmlUrl,
      recurrenceCount: newRecurrenceCount,
      tier: "bridging",
    };
  }
  return null;
}

/**
 * File an audit finding through the strict-tier → bridging-tier →
 * create cascade. Returns a tagged outcome so the caller can render
 * appropriate logs / response payloads.
 */
export async function fileAuditFinding(
  input: FileFindingInput,
  actions: FilerActions,
): Promise<FileFindingOutcome> {
  const canonical = buildCanonicalBlock({
    stream: input.stream,
    kennelCode: input.kennelCode,
    ruleSlug: input.ruleSlug,
  });

  if (canonical) {
    const strict = await runStrictTier(canonical.fingerprint, input, actions);
    if (strict) return strict;

    // Bridging tier — only when no strict match.
    const bridged = await tryBridge(canonical.fingerprint, input, actions);
    if (bridged) return bridged;
  }

  // Embedding the canonical block on fresh creates lets the next
  // sync round populate AuditIssue.fingerprint without a registry
  // round-trip; the bridging tier above is the safety net for rows
  // that were created before this PR.
  const finalBody = canonical
    ? `${input.bodyMarkdown}\n\n${emitCanonicalBlock(canonical)}`
    : input.bodyMarkdown;
  const created = await actions.createIssue({
    title: input.title,
    body: finalBody,
    labels: input.labels,
  });
  if (!created) return { action: "error", reason: "create-failed" };

  return {
    action: "created",
    issueNumber: created.number,
    htmlUrl: created.htmlUrl,
  };
}
