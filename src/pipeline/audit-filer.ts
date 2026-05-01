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
 *   - Comment fails on a bridging-tier hit → return `error`, but the
 *     fingerprint backfill is left in place. Backfill is a permanent
 *     improvement to the mirror; rolling it back to null would just
 *     re-bridge on the next attempt.
 *   - Create fails → return `error`. Caller can retry; the canonical
 *     block hasn't been emitted yet so re-trying is safe.
 */

import { prisma } from "@/lib/db";
import {
  buildCanonicalBlock,
  emitCanonicalBlock,
} from "@/lib/audit-canonical";
import { toIsoDateString } from "@/lib/date";
import type { AuditStream } from "@/lib/audit-stream-meta";
import { extractRuleSlugFromAutomatedTitle } from "@/pipeline/audit-issue-sync";

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
  | "create-failed";

export interface FilerActions {
  /** Returns the created issue's number and html URL on 2xx, null on
   *  any failure. Caller-supplied so cron and api can keep their own
   *  fetch envelopes. */
  createIssue(input: {
    title: string;
    body: string;
    labels: readonly string[];
  }): Promise<{ number: number; htmlUrl: string } | null>;
  /** Returns true on successful 2xx comment, false on any failure. */
  postComment(issueNumber: number, body: string): Promise<boolean>;
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
    },
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
  const updated = await prisma.auditIssue.update({
    where: { id: strict.id },
    data: { recurrenceCount: { increment: 1 } },
    select: { recurrenceCount: true },
  });
  return {
    action: "recurred",
    issueNumber: strict.githubNumber,
    htmlUrl: strict.htmlUrl,
    recurrenceCount: updated.recurrenceCount,
    tier: "strict",
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
    const slugFromTitle = extractRuleSlugFromAutomatedTitle(candidate.title);
    if (slugFromTitle !== input.ruleSlug) continue;

    // Compare-and-swap: only claim rows that are still null.
    const claimed = await prisma.auditIssue.updateMany({
      where: { id: candidate.id, fingerprint: null },
      data: {
        fingerprint,
        recurrenceCount: { increment: 1 },
      },
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

    const ok = await actions.postComment(
      candidate.githubNumber,
      formatRecurComment(input),
    );
    if (!ok) {
      // Backfill is a permanent improvement to the mirror — leaving
      // it in place means the next call hits the strict tier cleanly
      // instead of re-bridging.
      return {
        action: "error",
        reason: "comment-failed-bridging",
        existingIssueNumber: candidate.githubNumber,
      };
    }
    return {
      action: "recurred",
      issueNumber: candidate.githubNumber,
      htmlUrl: candidate.htmlUrl,
      recurrenceCount: candidate.recurrenceCount + 1,
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
