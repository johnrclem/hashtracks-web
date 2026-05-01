/**
 * Sync GitHub `audit`-labeled issues into the AuditIssue mirror + AuditIssueEvent log.
 *
 * Strategy: full-pull every run (not incremental). At the current scale of ~150
 * audit issues this is 1-2 GH API pages and lets every sync re-evaluate stream
 * + kennel labels from current state. Avoids the `since=` trap where a manual
 * relabel never gets observed because the issue's `updated_at` didn't change.
 *
 * On every issue we diff the freshly-resolved values against the prior snapshot
 * row (looked up by githubNumber) and emit AuditIssueEvent rows for each
 * transition: OPENED, CLOSED, REOPENED, RELABELED. The append-only log is the
 * source of truth for trend math; the snapshot row only answers "what's open
 * right now" for stat cards.
 *
 * Limitations:
 *   - REOPENED events use `now()` as occurredAt because the basic Issues API
 *     does not expose a reopen timestamp. The Issues Timeline API would, but
 *     it doubles request count for marginal benefit. Daily-resolution trends
 *     are fine.
 *   - When the sync first observes an issue that was opened-then-closed
 *     entirely between syncs, both events are emitted (OPENED dated to
 *     github.created_at, CLOSED dated to github.closed_at). Trend rollups
 *     count both correctly.
 */

import { prisma } from "@/lib/db";
import { AuditStream, AuditIssueEventType } from "@/generated/prisma/client";
import {
  AUDIT_LABEL,
  parseStreamLabel,
  parseKennelLabel,
} from "@/lib/audit-labels";
import { getValidatedRepo } from "@/lib/github-repo";
import { buildCanonicalBlock } from "@/lib/audit-canonical";

const FETCH_TIMEOUT_MS = 15_000;
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // safety cap; ~2000 issues

/** Shape of a GitHub issue from the REST API (only the fields we use). */
export interface GitHubIssue {
  number: number;
  title: string;
  /** Issue body — markdown. Parsed for the `<!-- audit-canonical: {...} -->`
   *  block (see `src/lib/audit-canonical.ts`) so the sync can
   *  populate `AuditIssue.fingerprint` without re-deriving the hash. */
  body: string | null;
  html_url: string;
  state: "open" | "closed";
  // GitHub's `state_reason` field — `"completed"` when an issue is
  // closed normally, `"not_planned"` when the operator picked the
  // "Close as not planned" option, `"reopened"` after a reopen,
  // `null` for issues that have never been closed. Populated since
  // 2022; null on legacy mirror rows until the next sync re-upserts
  // them via the `state=all` query.
  state_reason: "completed" | "not_planned" | "reopened" | null;
  created_at: string;
  closed_at: string | null;
  labels: Array<{ name: string } | string>;
  pull_request?: unknown;
}

export interface SyncResult {
  scanned: number;
  opened: number;
  closed: number;
  reopened: number;
  relabeled: number;
  delisted: number;
  errors: string[];
}

/** Normalize the labels array — GH returns either strings or `{name}` objects. */
export function extractLabelNames(labels: GitHubIssue["labels"]): string[] {
  return labels.map((l) => (typeof l === "string" ? l : l.name));
}

export interface StreamResolution {
  stream: AuditStream;
  /** True when the label set carried more than one stream sub-label. */
  conflict: boolean;
}

/**
 * Resolve an issue's stream from its label set. Exactly one stream sub-label
 * → that stream. Zero sub-labels → UNKNOWN. **More than one** sub-label →
 * UNKNOWN + `conflict: true` so the caller can surface the misconfiguration
 * in sync logs instead of silently bucketing the issue based on GitHub's
 * (undefined) label order.
 */
export function resolveStream(labelNames: readonly string[]): StreamResolution {
  const matches: AuditStream[] = [];
  for (const name of labelNames) {
    const key = parseStreamLabel(name);
    if (key) matches.push(AuditStream[key]);
  }
  if (matches.length === 0) return { stream: AuditStream.UNKNOWN, conflict: false };
  if (matches.length === 1) return { stream: matches[0], conflict: false };
  return { stream: AuditStream.UNKNOWN, conflict: true };
}

/**
 * Resolve an issue's kennelCode from its `kennel:<code>` label. Returns null
 * when no label is present OR when the label's code does not correspond to a
 * real kennel. The caller passes in a set of known codes from a single
 * Kennel.findMany() round trip; unknown codes return null rather than being
 * blindly written to `AuditIssue.kennelCode` (which is a FK — blind writes
 * fail with a constraint violation and drop the issue from the mirror).
 */
/**
 * Extract the rule slug from a cron-filed audit issue title.
 *
 * Cron titles follow the format produced by `formatGroupIssueTitle`:
 *   `[Audit] {kennelShortName} — {categoryLabel} [{ruleSlug}] (N events) — yyyy-mm-dd`
 *
 * The regex matches only slug-shaped brackets (lowercase + digits +
 * hyphens), so the literal `[Audit]` and any uppercase operator-added
 * tags like `[REVIEWED]` are skipped. The first remaining match is
 * the rule slug. Returns null when no slug-shaped bracket is present
 * — chrome-filed titles are free-form prose and won't match.
 */
const RULE_SLUG_IN_TITLE_RE = /\[([a-z][a-z0-9-]*)\]/g;
export function extractRuleSlugFromAutomatedTitle(title: string): string | null {
  const match = RULE_SLUG_IN_TITLE_RE.exec(title);
  // `exec` on a /g regex updates lastIndex; reset so subsequent calls
  // restart from the beginning of the input.
  RULE_SLUG_IN_TITLE_RE.lastIndex = 0;
  return match?.[1] ?? null;
}

/**
 * Re-derive `AuditIssue.fingerprint` from labels + title — the only
 * inputs the sync can trust. Codex review on PR #1171b flagged that
 * reading the operator-editable body block as authoritative was a
 * dedup-poisoning vector: a forged block could inject an arbitrary
 * fingerprint and absorb future findings under the wrong row.
 *
 * Authoritative path is currently AUTOMATED-stream only — those titles
 * carry a structured rule slug. Chrome-stream issues won't ship with a
 * sync-derivable identity until bundle 5b's file-finding endpoint
 * lands; until then the sync leaves their fingerprint untouched and
 * lets the endpoint write directly at filing time.
 *
 * The canonical block in the body is still emitted by the cron path
 * (and will be by 5b's endpoint) for human / debugger inspection, but
 * the sync deliberately ignores it here.
 */
export function computeFingerprintFromIdentity(
  stream: AuditStream,
  kennelCode: string | null,
  title: string,
): string | null {
  if (stream !== AuditStream.AUTOMATED) return null;
  if (!kennelCode) return null;
  const ruleSlug = extractRuleSlugFromAutomatedTitle(title);
  if (!ruleSlug) return null;
  const block = buildCanonicalBlock({ stream, kennelCode, ruleSlug });
  return block?.fingerprint ?? null;
}

export function resolveKennel(
  labelNames: readonly string[],
  knownKennelCodes: ReadonlySet<string>,
): string | null {
  for (const name of labelNames) {
    const code = parseKennelLabel(name);
    if (code && knownKennelCodes.has(code)) return code;
  }
  return null;
}

/**
 * Paginate the GitHub Issues API for `audit`-labeled issues in any state.
 * Filters out pull requests (the issues endpoint returns both).
 */
export async function fetchAllAuditIssues(token: string): Promise<GitHubIssue[]> {
  const repo = getValidatedRepo();
  const issues: GitHubIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = `https://api.github.com/repos/${repo}/issues?labels=${AUDIT_LABEL}&state=all&per_page=${PAGE_SIZE}&page=${page}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!res.ok) {
      throw new Error(`GitHub API ${res.status} on page ${page}: ${await res.text()}`);
    }
    const batch = (await res.json()) as GitHubIssue[];
    // Skip pull requests — the /issues endpoint returns both.
    issues.push(...batch.filter((i) => !i.pull_request));
    if (batch.length < PAGE_SIZE) break;
  }
  return issues;
}

/**
 * Diff a freshly-fetched GitHub issue against its prior snapshot row and
 * return the events that should be appended. Pure function — no DB I/O.
 *
 * @param prior - the prior AuditIssue snapshot (or null for new issues)
 * @param current - resolved current state (stream, state, closedAt)
 * @param now - reference clock for REOPENED/RELABELED events. Defaults to now.
 */
export function diffIssue(
  prior: { stream: AuditStream; state: string; githubClosedAt: Date | null } | null,
  current: {
    stream: AuditStream;
    state: "open" | "closed";
    githubCreatedAt: Date;
    githubClosedAt: Date | null;
  },
  now: Date = new Date(),
): Array<Omit<EventToAppend, "issueId">> {
  const events: Array<Omit<EventToAppend, "issueId">> = [];

  // First time we've seen this issue: emit OPENED at github.created_at.
  // If it's also already closed, emit CLOSED at github.closed_at.
  if (!prior) {
    events.push({
      type: AuditIssueEventType.OPENED,
      stream: current.stream,
      occurredAt: current.githubCreatedAt,
      fromStream: null,
    });
    if (current.state === "closed" && current.githubClosedAt) {
      events.push({
        type: AuditIssueEventType.CLOSED,
        stream: current.stream,
        occurredAt: current.githubClosedAt,
        fromStream: null,
      });
    }
    return events;
  }

  // State transitions
  if (prior.state === "open" && current.state === "closed") {
    events.push({
      type: AuditIssueEventType.CLOSED,
      stream: current.stream,
      // Trust github.closed_at when present; fallback to now.
      occurredAt: current.githubClosedAt ?? now,
      fromStream: null,
    });
  } else if (prior.state === "closed" && current.state === "open") {
    events.push({
      type: AuditIssueEventType.REOPENED,
      stream: current.stream,
      // GitHub Issues API doesn't expose a reopen timestamp without the
      // Timeline API. `now()` is a coarse approximation; daily-resolution
      // trends are unaffected.
      occurredAt: now,
      fromStream: null,
    });
  }

  // Stream transition (manual relabel by an operator). Emit even if state
  // also changed — the dashboard wants both signals.
  if (prior.stream !== current.stream) {
    events.push({
      type: AuditIssueEventType.RELABELED,
      stream: current.stream,
      occurredAt: now,
      fromStream: prior.stream,
    });
  }

  return events;
}

interface EventToAppend {
  issueId: string;
  type: AuditIssueEventType;
  stream: AuditStream;
  occurredAt: Date;
  fromStream: AuditStream | null;
}

/**
 * Postgres advisory lock key for the audit sync. Two concurrent syncs would
 * race the read-diff-write cycle and double-count events. The lock is held
 * for the duration of the transaction; pg_try_advisory_xact_lock returns
 * immediately if held, so a retry/cron-overlap exits cleanly instead of
 * waiting (and thus hitting the function timeout).
 */
const SYNC_LOCK_KEY = 0x4155_4954; // "AUIT" — arbitrary 32-bit constant

/**
 * Run a full sync against the GitHub `audit`-labeled corpus. Updates the
 * AuditIssue snapshot table and appends AuditIssueEvent rows for every
 * transition observed since the previous sync. Wrapped in a transaction
 * with a Postgres advisory lock so concurrent runs are serialized — two
 * overlapping invocations cannot both observe the same pre-transition
 * state and double-emit lifecycle events.
 *
 * Stale-row reconciliation: any AuditIssue row whose githubNumber is NOT
 * in the freshly-fetched audit corpus (e.g. an operator removed the
 * `audit` label, or the issue was deleted) is dropped from the snapshot
 * so the dashboard stops counting it. The event log keeps its prior
 * OPENED/CLOSED history — only the current-state mirror is removed.
 */
export async function syncAuditIssues(): Promise<SyncResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not set");
  }

  // Fetch outside the transaction — network I/O shouldn't hold a DB lock.
  const issues = await fetchAllAuditIssues(token);
  const result: SyncResult = {
    scanned: issues.length,
    opened: 0,
    closed: 0,
    reopened: 0,
    relabeled: 0,
    delisted: 0,
    errors: [],
  };

  await prisma.$transaction(async (tx) => {
    // Try to acquire the advisory lock; bail if another sync is in flight.
    const lockRows = await tx.$queryRaw<Array<{ pg_try_advisory_xact_lock: boolean }>>`
      SELECT pg_try_advisory_xact_lock(${SYNC_LOCK_KEY}) AS pg_try_advisory_xact_lock
    `;
    if (!lockRows[0]?.pg_try_advisory_xact_lock) {
      throw new Error("Another audit-issue sync is already in progress");
    }

    // Look up every prior snapshot for the issue numbers in the current fetch
    // AND every existing snapshot row, so we can reconcile rows that fell out
    // of the audit corpus. One round trip per side keeps the per-row diff
    // hot-loop allocation-free.
    const githubNumbers = issues.map((i) => i.number);
    const priors = await tx.auditIssue.findMany({
      where: { githubNumber: { in: githubNumbers } },
    });
    const priorByNumber = new Map(priors.map((p) => [p.githubNumber, p]));

    // Known-kennel set for the kennel-label resolver. Loaded once so the
    // per-issue loop can reject unknown codes in O(1) and never write a
    // broken FK into AuditIssue.kennelCode. See codex review on the label-
    // sync plan for the underlying failure mode.
    const kennelRows = await tx.kennel.findMany({ select: { kennelCode: true } });
    const knownKennelCodes = new Set(kennelRows.map((k) => k.kennelCode));

    const allMirrored = await tx.auditIssue.findMany({
      select: { id: true, githubNumber: true, delistedAt: true },
    });
    const fetchedNumbers = new Set(githubNumbers);
    const staleIds = allMirrored
      .filter((m) => !fetchedNumbers.has(m.githubNumber) && m.delistedAt === null)
      .map((m) => m.id);

    const now = new Date();
    const eventsToAppend: EventToAppend[] = [];

    for (const issue of issues) {
      try {
        const labelNames = extractLabelNames(issue.labels);
        const streamResolution = resolveStream(labelNames);
        const kennelCode = resolveKennel(labelNames, knownKennelCodes);
        const githubCreatedAt = new Date(issue.created_at);
        const githubClosedAt = issue.closed_at ? new Date(issue.closed_at) : null;

        const prior = priorByNumber.get(issue.number) ?? null;

        // Multi-stream conflict: preserve the prior stream in the snapshot
        // (never overwrite known-good attribution with UNKNOWN) and skip
        // RELABELED emission so the event log isn't polluted with synthetic
        // transitions. The issue still surfaces as an error in the cron
        // summary so operators know manual repair is needed.
        let stream: AuditStream;
        if (streamResolution.conflict) {
          stream = prior?.stream ?? AuditStream.UNKNOWN;
          result.errors.push(
            `#${issue.number}: multi-stream label conflict — preserving prior stream=${stream}`,
          );
        } else {
          stream = streamResolution.stream;
        }

        const newEvents = diffIssue(
          prior
            ? {
                stream: prior.stream,
                state: prior.state,
                githubClosedAt: prior.githubClosedAt,
              }
            : null,
          { stream, state: issue.state, githubCreatedAt, githubClosedAt },
          now,
        );

        // Upsert the snapshot. We need the row id to attach events; doing the
        // upsert first lets us batch the events afterwards. `delistedAt` is
        // cleared on every update so a re-listed issue (operator re-added
        // the `audit` label) automatically comes back into the dashboard.
        // Re-derive the fingerprint from labels + title — the only
        // inputs the sync can trust. Operator-editable body blocks are
        // ignored for sync purposes (see computeFingerprintFromIdentity
        // for rationale). Returns null for chrome-stream issues; on
        // update we leave their fingerprint untouched so bundle 5b's
        // file-finding endpoint owns that path.
        const reDerivedFingerprint = computeFingerprintFromIdentity(
          stream,
          kennelCode,
          issue.title,
        );
        const isAutomated = stream === AuditStream.AUTOMATED;

        const upserted = await tx.auditIssue.upsert({
          where: { githubNumber: issue.number },
          create: {
            githubNumber: issue.number,
            stream,
            state: issue.state,
            title: issue.title,
            htmlUrl: issue.html_url,
            kennelCode: kennelCode ?? undefined,
            githubCreatedAt,
            githubClosedAt: githubClosedAt ?? undefined,
            closeReason: issue.state_reason ?? undefined,
            fingerprint: reDerivedFingerprint ?? undefined,
          },
          update: {
            stream,
            state: issue.state,
            title: issue.title,
            htmlUrl: issue.html_url,
            kennelCode: kennelCode ?? null,
            githubClosedAt: githubClosedAt ?? null,
            closeReason: issue.state_reason ?? null,
            // For AUTOMATED, write the re-derived value (or null when
            // identity drifted) — addresses Codex's stale-fingerprint
            // finding. For non-AUTOMATED streams, leave the column alone
            // so the file-finding endpoint's authoritative writes aren't
            // clobbered on the next sync.
            ...(isAutomated ? { fingerprint: reDerivedFingerprint } : {}),
            delistedAt: null,
          },
        });

        for (const ev of newEvents) {
          eventsToAppend.push({ ...ev, issueId: upserted.id });
          if (ev.type === AuditIssueEventType.OPENED) result.opened++;
          if (ev.type === AuditIssueEventType.CLOSED) result.closed++;
          if (ev.type === AuditIssueEventType.REOPENED) result.reopened++;
          if (ev.type === AuditIssueEventType.RELABELED) result.relabeled++;
        }
      } catch (err) {
        result.errors.push(`#${issue.number}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (eventsToAppend.length > 0) {
      await tx.auditIssueEvent.createMany({
        data: eventsToAppend.map((e) => ({
          issueId: e.issueId,
          type: e.type,
          stream: e.stream,
          occurredAt: e.occurredAt,
          fromStream: e.fromStream ?? null,
        })),
      });
    }

    // Soft-delete reconciliation. Rows that fell out of the audit corpus
    // get `delistedAt` set but the snapshot + AuditIssueEvent history are
    // preserved. The prior code hard-deleted the snapshot, which cascaded
    // through the FK and permanently wiped historical trend data every
    // time an operator temporarily relabeled an issue. Dashboard queries
    // filter on `delistedAt IS NULL` for current-state counts but the
    // event log stays untouched for trend math.
    if (staleIds.length > 0) {
      await tx.auditIssue.updateMany({
        where: { id: { in: staleIds } },
        data: { delistedAt: now },
      });
      result.delisted = staleIds.length;
    }
  });

  console.log(
    `[audit-sync] scanned=${result.scanned} opened=${result.opened} closed=${result.closed} reopened=${result.reopened} relabeled=${result.relabeled} delisted=${result.delisted} errors=${result.errors.length}`,
  );
  return result;
}
