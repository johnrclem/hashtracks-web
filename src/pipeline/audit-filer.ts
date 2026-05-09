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
import { AUDIT_STREAM, type AuditStream } from "@/lib/audit-stream-meta";
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
      tier: "strict" | "bridging" | "coarse";
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
  | "comment-failed-coarse"
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

  // Step 2: create the meta-issue. Pre-create failures (returns null
  // OR throws) roll back the claim cleanly because no GitHub side
  // effect happened yet.
  let meta: { number: number; htmlUrl: string } | null;
  try {
    meta = await actions.createIssue({
      title: `[Audit Recurring] ${kennelShortName} — ${input.ruleSlug}: ${newRecurrenceCount}+ days unresolved`,
      body: formatEscalationBody(
        baseIssueNumber,
        kennelShortName,
        input,
        newRecurrenceCount,
      ),
      labels: [AUDIT_LABEL, NEEDS_DECISION_LABEL, kennelLabel(input.kennelCode)],
    });
  } catch (err) {
    console.error(
      `[audit-filer] Escalation meta-issue create threw for base #${baseIssueNumber} — rolling back claim:`,
      err,
    );
    await rollbackEscalationClaim(baseIssueId);
    return undefined;
  }
  if (!meta) {
    console.error(
      `[audit-filer] Escalation meta-issue create returned null for base #${baseIssueNumber} — rolling back claim`,
    );
    await rollbackEscalationClaim(baseIssueId);
    return undefined;
  }

  // Step 3+: meta-issue IS filed. From here on, rolling back would
  // orphan it — Codex 5c-B pass-2 P1 finding. Finalize + link
  // comment are best-effort: failures get logged loudly so an
  // operator can manually link, but we never clear the claim.
  // Worst case: `escalatedToIssueNumber` stays null on the row but
  // the meta-issue exists in GitHub with the `audit:needs-decision`
  // label — still discoverable.
  const metaNumber = meta.number;
  await prisma.auditIssue
    .update({
      where: { id: baseIssueId },
      data: { escalatedToIssueNumber: metaNumber },
    })
    .catch((err: unknown) => {
      console.error(
        `[audit-filer] Escalation finalize update failed for base #${baseIssueNumber} (meta #${metaNumber} is filed; column not linked, manual fix needed):`,
        err,
      );
    });

  const linkOk = await actions.postComment(
    baseIssueNumber,
    `Escalated to meta-issue #${metaNumber} after ${newRecurrenceCount} consecutive recurrences without resolution. Pick a remediation path; this tracker resets when the base issue closes-and-reopens.`,
  );
  if (!linkOk) {
    console.warn(
      `[audit-filer] Escalation link comment failed for base #${baseIssueNumber} (meta #${metaNumber} still filed)`,
    );
  }

  return metaNumber;
}

/**
 * Best-effort rollback of an escalation claim. If the rollback itself
 * fails the row stays wedged, but we've at least attempted recovery
 * and logged it — operator can clear `escalatedAt` manually.
 *
 * Uses `.catch()` rather than try/catch so Codacy's "unhandled errors
 * in async function" rule sees the error path explicitly. Same
 * observable behavior — the rollback never throws to its caller.
 */
async function rollbackEscalationClaim(baseIssueId: string): Promise<void> {
  await prisma.auditIssue
    .update({
      where: { id: baseIssueId },
      data: { escalatedAt: null, escalatedToIssueNumber: null },
    })
    .catch((rollbackErr: unknown) => {
      console.error(
        `[audit-filer] Escalation claim rollback failed for ${baseIssueId} — operator must clear escalatedAt manually:`,
        rollbackErr,
      );
    });
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
      // Reading `escalatedToIssueNumber` upfront lets us short-circuit
      // `tryEscalate` when the row is already escalated for this
      // lifecycle (saves the claim CAS round-trip per recur on
      // already-escalated rows). Gemini PR #1197 review.
      escalatedToIssueNumber: true,
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
  // increment. See `tryEscalate` doc for race semantics. Skip the
  // attempt entirely when the row already has an escalation linked
  // for this lifecycle: `tryEscalate`'s claim CAS would lose
  // immediately and we'd just re-read what we already have.
  const escalatedToIssueNumber =
    strict.escalatedToIssueNumber ??
    (await tryEscalate(
      strict.id,
      strict.githubNumber,
      newRecurrenceCount,
      strict.kennel?.shortName ?? input.kennelCode,
      input,
      actions,
    ));

  return {
    action: "recurred",
    issueNumber: strict.githubNumber,
    htmlUrl: strict.htmlUrl,
    recurrenceCount: newRecurrenceCount,
    tier: "strict",
    escalatedToIssueNumber,
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
      escalatedToIssueNumber: true,
      // Plumb kennel shortName for the escalation path's meta-issue
      // title — same optimization as the strict-tier query.
      kennel: { select: { shortName: true } },
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

    // Same escalation logic as strict tier — Codex 5c-B PR #1197 P2
     // / Gemini high. Bridging only crosses threshold in pathological
     // cases (a legacy row with already-high recurrenceCount), but the
     // call is cheap (early-returns below threshold) and keeps the
     // behavior consistent across both tiers.
    const escalatedToIssueNumber =
      candidate.escalatedToIssueNumber ??
      (await tryEscalate(
        candidate.id,
        candidate.githubNumber,
        newRecurrenceCount,
        candidate.kennel?.shortName ?? input.kennelCode,
        input,
        actions,
      ));

    return {
      action: "recurred",
      issueNumber: candidate.githubNumber,
      htmlUrl: candidate.htmlUrl,
      recurrenceCount: newRecurrenceCount,
      tier: "bridging",
      escalatedToIssueNumber,
    };
  }
  return null;
}

/**
 * Bound on the candidate-vanished retry loop in `tryCoarseDedup`. Two
 * attempts handles the rare case where a row closes between findMany
 * and the CAS; if neither attempt finds a stable canonical, the loop
 * exits with `null` (truly no match) and the caller creates fresh.
 */
const COARSE_DEDUP_MAX_RETRIES = 2;

/**
 * Coarse-dedup tier for non-fingerprintable rules. The 5 unmigrated
 * rules (header in `rule-definitions.ts`) skip strict + bridging and
 * would otherwise create a fresh issue per cron tick — that's how #964
 * accumulated 16 daily duplicates for C2H3 / `event-improbable-time`.
 *
 * Stream-scoped to prevent automated/chrome cross-coalescing. For the
 * automated stream, the title's `[<ruleSlug>]` bracket is part of the
 * SQL filter so the 25-row candidate cap can't hide the canonical row
 * behind unrelated open issues. Chrome streams are low-volume; their
 * `Finding: <kennel> <slug>` titles are matched in-memory.
 *
 * Order mirrors `runStrictTier`: post comment first, then CAS-increment
 * `recurrenceCount`. The comment-first ordering keeps retries idempotent
 * across cron ticks — a comment failure surfaces without bumping the
 * count, so the next tick re-runs cleanly. CAS-loss after a successful
 * comment means a peer caller raced to the increment; we refetch the
 * row's current state and return the peer's count (mild duplicate
 * recurrence comments under contention is the same trade-off the
 * strict tier accepts and is preferable to over-counting).
 */
async function tryCoarseDedup(
  input: FileFindingInput,
  actions: FilerActions,
): Promise<FileFindingOutcome | null> {
  // Push the rule-slug discriminator into SQL so the 25-row LIMIT can't
  // push the canonical row outside the candidate window for kennels with
  // deep backlogs. Per-stream because the title formats differ:
  //   - automated: `[Audit] {kennel} — {category} [{slug}] (...) — date`
  //   - chrome:    `Finding: {kennel} {slug}`
  //   - unknown:   no enforced format → no SQL filter, fall back to in-memory
  const titleFilter = ((): { contains: string } | { endsWith: string } | undefined => {
    if (input.stream === AUDIT_STREAM.AUTOMATED) return { contains: `[${input.ruleSlug}]` };
    if (input.stream === AUDIT_STREAM.CHROME_EVENT || input.stream === AUDIT_STREAM.CHROME_KENNEL) {
      return { endsWith: ` ${input.ruleSlug}` };
    }
    return undefined;
  })();

  for (let attempt = 0; attempt < COARSE_DEDUP_MAX_RETRIES; attempt++) {
    const candidates = await prisma.auditIssue.findMany({
      where: {
        kennelCode: input.kennelCode,
        stream: input.stream,
        fingerprint: null,
        state: "open",
        delistedAt: null,
        ...(titleFilter ? { title: titleFilter } : {}),
      },
      select: {
        id: true,
        githubNumber: true,
        htmlUrl: true,
        title: true,
        recurrenceCount: true,
        escalatedToIssueNumber: true,
        kennel: { select: { shortName: true } },
      },
      orderBy: { githubCreatedAt: "asc" },
      take: 25,
    });

    // In-memory identity check. Two reasons we don't trust the SQL
    // filter alone: (1) the chrome regex is intentionally permissive
    // (`extractRuleSlugFromChromeTitle` accepts any trailing slug-shaped
    // token, so a title like `Finding: NYCH3 note about hare-cta-text`
    // would parse as that slug); (2) operator-edited titles can drift
    // from the canonical format. For chrome streams we additionally
    // require the exact format `Finding: <kennelShortName> <ruleSlug>`
    // so an edited title can't silently absorb the wrong recurrence.
    const canonical = candidates.find((c) => {
      const slug = extractRuleSlugFromTitle(c.title);
      if (slug !== input.ruleSlug) return false;
      if (input.stream === AUDIT_STREAM.CHROME_EVENT || input.stream === AUDIT_STREAM.CHROME_KENNEL) {
        const expected = `Finding: ${c.kennel?.shortName ?? input.kennelCode} ${input.ruleSlug}`;
        if (c.title !== expected) return false;
      }
      return true;
    });
    if (!canonical) return null;

    // Step 1: post comment first (idempotent ordering). On failure we
    // surface a typed error WITHOUT incrementing — next cron tick will
    // re-find the same canonical and retry cleanly.
    const ok = await actions.postComment(
      canonical.githubNumber,
      formatRecurComment(input),
    );
    if (!ok) {
      return {
        action: "error",
        reason: "comment-failed-coarse",
        existingIssueNumber: canonical.githubNumber,
      };
    }

    // Step 2: CAS-increment `recurrenceCount`. On loss, a concurrent
    // caller already incremented this same canonical row — refetch its
    // current state and return their count (no additional increment
    // from us; mild double-comment is the accepted trade-off).
    let claim;
    try {
      claim = await prisma.auditIssue.updateMany({
        where: {
          id: canonical.id,
          recurrenceCount: canonical.recurrenceCount,
          state: "open",
          delistedAt: null,
        },
        data: { recurrenceCount: { increment: 1 } },
      });
    } catch (err) {
      console.error(
        `[audit-filer] Coarse-dedup CAS update failed for #${canonical.githubNumber}:`,
        err,
      );
      return {
        action: "error",
        reason: "db-update-failed",
        existingIssueNumber: canonical.githubNumber,
      };
    }

    if (claim.count === 0) {
      // CAS lost. Refetch the canonical's current state.
      const refetched = await prisma.auditIssue.findUnique({
        where: { id: canonical.id },
        select: {
          recurrenceCount: true,
          escalatedToIssueNumber: true,
          state: true,
          delistedAt: true,
        },
      });
      if (refetched && refetched.state === "open" && !refetched.delistedAt) {
        return {
          action: "recurred",
          issueNumber: canonical.githubNumber,
          htmlUrl: canonical.htmlUrl,
          recurrenceCount: refetched.recurrenceCount,
          tier: "coarse",
          escalatedToIssueNumber: refetched.escalatedToIssueNumber ?? undefined,
        };
      }
      // Row vanished (closed / delisted between findMany and refetch).
      // Retry from scratch — there may be another open canonical.
      continue;
    }

    // We won the CAS.
    const newRecurrenceCount = canonical.recurrenceCount + 1;
    const escalatedToIssueNumber =
      canonical.escalatedToIssueNumber ??
      (await tryEscalate(
        canonical.id,
        canonical.githubNumber,
        newRecurrenceCount,
        canonical.kennel?.shortName ?? input.kennelCode,
        input,
        actions,
      ));

    return {
      action: "recurred",
      issueNumber: canonical.githubNumber,
      htmlUrl: canonical.htmlUrl,
      recurrenceCount: newRecurrenceCount,
      tier: "coarse",
      escalatedToIssueNumber,
    };
  }
  // Exhausted retries — every attempt found a candidate that vanished
  // before we could attach. No stable canonical exists; create-fresh
  // is the correct fallthrough.
  return null;
}

/**
 * File an audit finding through the dedup cascade.
 *   - Fingerprintable (canonical !== null): strict → bridging → create.
 *   - Non-fingerprintable (canonical === null): coarse-dedup → create.
 *
 * Coarse-dedup is gated to the canonical-null branch on purpose:
 * bridging already handles the (kennelCode, ruleSlug) match for
 * fingerprintable rules and additionally backfills the fingerprint.
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
  } else {
    // Coarse-dedup tier — only for non-fingerprintable rules.
    const coarse = await tryCoarseDedup(input, actions);
    if (coarse) return coarse;
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
