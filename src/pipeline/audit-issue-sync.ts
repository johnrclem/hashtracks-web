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

const FETCH_TIMEOUT_MS = 15_000;
const DEFAULT_REPO = "johnrclem/hashtracks-web";
const PAGE_SIZE = 100;
const MAX_PAGES = 20; // safety cap; ~2000 issues

function getRepo(): string {
  return process.env.GITHUB_REPOSITORY ?? DEFAULT_REPO;
}

/** Shape of a GitHub issue from the REST API (only the fields we use). */
export interface GitHubIssue {
  number: number;
  title: string;
  html_url: string;
  state: "open" | "closed";
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
  errors: string[];
}

/** Normalize the labels array — GH returns either strings or `{name}` objects. */
export function extractLabelNames(labels: GitHubIssue["labels"]): string[] {
  return labels.map((l) => (typeof l === "string" ? l : l.name));
}

/**
 * Resolve an issue's stream from its label set. The first matching stream
 * sub-label wins; missing → UNKNOWN.
 */
export function resolveStream(labelNames: readonly string[]): AuditStream {
  for (const name of labelNames) {
    const key = parseStreamLabel(name);
    if (key) return AuditStream[key];
  }
  return AuditStream.UNKNOWN;
}

/** Resolve an issue's kennelCode from its `kennel:<code>` label, or null. */
export function resolveKennel(labelNames: readonly string[]): string | null {
  for (const name of labelNames) {
    const code = parseKennelLabel(name);
    if (code) return code;
  }
  return null;
}

/**
 * Paginate the GitHub Issues API for `audit`-labeled issues in any state.
 * Filters out pull requests (the issues endpoint returns both).
 */
export async function fetchAllAuditIssues(token: string): Promise<GitHubIssue[]> {
  const repo = getRepo();
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
 * Run a full sync against the GitHub `audit`-labeled corpus. Updates the
 * AuditIssue snapshot table and appends AuditIssueEvent rows for every
 * transition observed since the previous sync.
 */
export async function syncAuditIssues(): Promise<SyncResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error("GITHUB_TOKEN not set");
  }

  const issues = await fetchAllAuditIssues(token);
  const result: SyncResult = {
    scanned: issues.length,
    opened: 0,
    closed: 0,
    reopened: 0,
    relabeled: 0,
    errors: [],
  };

  // Look up every prior snapshot in one round trip.
  const githubNumbers = issues.map((i) => i.number);
  const priors = await prisma.auditIssue.findMany({
    where: { githubNumber: { in: githubNumbers } },
  });
  const priorByNumber = new Map(priors.map((p) => [p.githubNumber, p]));

  const now = new Date();
  const eventsToAppend: EventToAppend[] = [];

  for (const issue of issues) {
    try {
      const labelNames = extractLabelNames(issue.labels);
      const stream = resolveStream(labelNames);
      const kennelCode = resolveKennel(labelNames);
      const githubCreatedAt = new Date(issue.created_at);
      const githubClosedAt = issue.closed_at ? new Date(issue.closed_at) : null;

      const prior = priorByNumber.get(issue.number) ?? null;

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
      // upsert first lets us batch the events afterwards.
      const upserted = await prisma.auditIssue.upsert({
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
        },
        update: {
          stream,
          state: issue.state,
          title: issue.title,
          htmlUrl: issue.html_url,
          kennelCode: kennelCode ?? null,
          githubClosedAt: githubClosedAt ?? null,
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
    await prisma.auditIssueEvent.createMany({
      data: eventsToAppend.map((e) => ({
        issueId: e.issueId,
        type: e.type,
        stream: e.stream,
        occurredAt: e.occurredAt,
        fromStream: e.fromStream ?? null,
      })),
    });
  }

  console.log(
    `[audit-sync] scanned=${result.scanned} opened=${result.opened} closed=${result.closed} reopened=${result.reopened} relabeled=${result.relabeled} errors=${result.errors.length}`,
  );
  return result;
}
