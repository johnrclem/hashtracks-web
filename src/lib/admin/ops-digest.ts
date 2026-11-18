/**
 * Read-only operational snapshot for the daily ops digest scheduled task.
 *
 * The task runs unattended on the owner's Mac, where auto mode refuses direct
 * `psql` reads of the production database. Instead it calls the token-authenticated
 * `/api/audit/agent/ops-digest` route, which runs only these fixed SELECT queries,
 * plus one GitHub read for the pull requests waiting on the owner.
 * Nothing here writes, and nothing is parameterised by the caller.
 */
import type { AutomationStatus, AutomationVerdict } from "@/generated/prisma/client";
import { automationLabel, loadFailedMigrations, PROMOTER_MAX_PENDING_HOURS } from "@/lib/automation-registry";
import { prisma } from "@/lib/db";
import { isWaitingOnOwner, opsGithubFromEnv, type OpsGithub } from "@/lib/ops-github";

export interface FailingSource {
  name: string;
  type: string;
  lastRunAt: string;
  error: string | null;
  /** Consecutive FAILED runs, newest first, within the last 14 days. */
  streak: number;
}

export interface OpenAlert {
  createdAt: string;
  type: string;
  severity: string;
  source: string;
  title: string;
}

export interface LargeCancellation {
  startedAt: string;
  source: string;
  eventsFound: number;
  eventsCancelled: number;
}

export interface FailedMigration {
  name: string;
  startedAt: string;
}

/** The ops watchdog's view of one automation (`AutomationState`). */
export interface WatchdogState {
  automation: string;
  label: string;
  /** Alarm state: OVERDUE means an alarm is out (Sentry, a `lane:ops` issue, email). */
  status: AutomationStatus;
  since: string;
  /** Latest check: BLOCKED_ON_OWNER is no alarm, UNKNOWN means the check itself failed. */
  verdict: AutomationVerdict | null;
  detail: string | null;
  checkedAt: string | null;
  issueNumber: number | null;
}

export interface WaitingPr {
  number: number;
  title: string;
  url: string;
  labels: string[];
  openedAt: string;
  ageHours: number;
  headSha: string;
}

export interface OpsDigest {
  generatedAt: string;
  scrapes24h: { runs: number; failed: number; eventsCreated: number; eventsCancelled: number };
  failingSources: FailingSource[];
  openAlerts: OpenAlert[];
  alertsCreated24h: number;
  largeCancellations24h: LargeCancellation[];
  /** Kennels whose every enabled source found 0 events on its latest successful scrape. */
  allZeroKennels: string[];
  auditQueue: {
    pending: number;
    oldestPendingAt: string | null;
    /** PENDING drafts submitted more than {@link PROMOTER_MAX_PENDING_HOURS} hours ago.
     *  The promoter runs hourly, so any of these means it is stuck or failing. */
    stalePending: number;
  };
  /**
   * Migrations that started but neither finished nor were rolled back. Any row blocks every later
   * deploy until the owner runs `prisma migrate resolve` (docs/ops/system.md#migrations).
   */
  failedMigrations: FailedMigration[];
  /** Overdue first, then blocked on the owner, unknown and OK. */
  watchdog: WatchdogState[];
  /**
   * Open pull requests only the owner can move (not drafts, not yet `owner-approved`, not the
   * research task's self-merged handoffs), oldest first. `prs` is null when GitHub couldn't be read.
   */
  approvalsWaiting: { prs: WaitingPr[] | null; error: string | null };
}

const VERDICT_ORDER: Record<AutomationVerdict, number> = { OVERDUE: 0, BLOCKED_ON_OWNER: 1, UNKNOWN: 2, OK: 3 };
const HOUR_MS = 3_600_000;

async function loadWatchdogStates(): Promise<WatchdogState[]> {
  const rows = await prisma.automationState.findMany({ orderBy: { automation: "asc" } });
  const rank = (r: (typeof rows)[number]) => (r.status === "OVERDUE" ? 0 : VERDICT_ORDER[r.verdict ?? "UNKNOWN"]);
  return rows
    .sort((a, b) => rank(a) - rank(b))
    .map((r) => ({
      automation: r.automation,
      label: automationLabel(r.automation),
      status: r.status,
      since: r.since.toISOString(),
      verdict: r.verdict,
      detail: r.detail,
      checkedAt: iso(r.checkedAt),
      issueNumber: r.issueNumber,
    }));
}

/** `github` undefined means "from the environment", built inside the guard so a bad env can't fail the digest. */
async function loadApprovalsWaiting(
  github: OpsGithub | null | undefined,
  now: Date,
): Promise<OpsDigest["approvalsWaiting"]> {
  try {
    const client = github === undefined ? opsGithubFromEnv() : github;
    if (!client) return { prs: null, error: "GITHUB_TOKEN is not set" };
    const pulls = await client.listOpenPulls();
    return {
      prs: pulls.filter(isWaitingOnOwner).map((pr) => ({
        number: pr.number,
        title: pr.title,
        url: pr.url,
        labels: pr.labels,
        openedAt: pr.createdAt.toISOString(),
        ageHours: Math.floor((now.getTime() - pr.createdAt.getTime()) / HOUR_MS),
        headSha: pr.headSha,
      })),
      error: null,
    };
  } catch (err) {
    return { prs: null, error: err instanceof Error ? err.message : String(err) };
  }
}


/** Postgres COUNT/SUM come back as bigint; the JSON response needs plain numbers. */
const num = (v: unknown): number => (v == null ? 0 : Number(v));
const iso = (v: unknown): string | null => (v instanceof Date ? v.toISOString() : null);

export async function buildOpsDigest(
  now: Date = new Date(),
  github?: OpsGithub | null,
): Promise<OpsDigest> {
  const [
    scrapeRows,
    failingRows,
    alertRows,
    createdRows,
    cancelRows,
    zeroRows,
    queueRows,
    migrationRows,
    watchdog,
    approvalsWaiting,
  ] = await Promise.all([
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT count(*) AS runs,
               count(*) FILTER (WHERE status = 'FAILED') AS failed,
               coalesce(sum("eventsCreated"), 0) AS created,
               coalesce(sum("eventsCancelled"), 0) AS cancelled
        FROM "ScrapeLog" WHERE "startedAt" > now() - interval '24 hours'`,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        WITH recent AS (
          SELECT "sourceId", "startedAt", status::text AS st, errors,
                 row_number() OVER (PARTITION BY "sourceId" ORDER BY "startedAt" DESC) AS rn
          FROM "ScrapeLog"
          WHERE "startedAt" > now() - interval '14 days' AND status IN ('SUCCESS', 'FAILED')
        ),
        streaks AS (
          SELECT "sourceId",
                 coalesce(min(rn) FILTER (WHERE st = 'SUCCESS') - 1, count(*)) AS streak
          FROM recent GROUP BY "sourceId"
        )
        SELECT s.name, s.type::text AS type, r."startedAt", r.errors[1] AS error, st.streak
        FROM streaks st
        JOIN recent r ON r."sourceId" = st."sourceId" AND r.rn = 1
        JOIN "Source" s ON s.id = st."sourceId"
        WHERE s.enabled AND st.streak > 0
        ORDER BY st.streak DESC, s.name`,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT a."createdAt", a.type::text AS type, a.severity::text AS severity,
               s.name AS source, a.title
        FROM "Alert" a JOIN "Source" s ON s.id = a."sourceId"
        WHERE a.status <> 'RESOLVED'
        ORDER BY a."createdAt"`,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT count(*) AS n FROM "Alert" WHERE "createdAt" > now() - interval '24 hours'`,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT l."startedAt", s.name AS source, l."eventsFound", l."eventsCancelled"
        FROM "ScrapeLog" l JOIN "Source" s ON s.id = l."sourceId"
        WHERE l."startedAt" > now() - interval '24 hours' AND l."eventsCancelled" >= 3
        ORDER BY l."eventsCancelled" DESC LIMIT 20`,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        WITH latest AS (
          SELECT DISTINCT ON ("sourceId") "sourceId", "eventsFound"
          FROM "ScrapeLog" WHERE status = 'SUCCESS'
          ORDER BY "sourceId", "startedAt" DESC
        )
        SELECT k."kennelCode"
        FROM "SourceKennel" sk
        JOIN "Source" s ON s.id = sk."sourceId" AND s.enabled
        JOIN latest l ON l."sourceId" = s.id
        JOIN "Kennel" k ON k.id = sk."kennelId"
        GROUP BY k."kennelCode"
        HAVING max(l."eventsFound") = 0
        ORDER BY k."kennelCode"`,
      prisma.$queryRaw<Array<Record<string, unknown>>>`
        SELECT count(*) AS pending, min("submittedAt") AS oldest,
               count(*) FILTER (
                 WHERE "submittedAt" < now() - make_interval(hours => ${PROMOTER_MAX_PENDING_HOURS}::int)
               ) AS stale
        FROM "AuditFindingDraft" WHERE status = 'PENDING'`,
      loadFailedMigrations(),
      loadWatchdogStates(),
      loadApprovalsWaiting(github, now),
    ]);

  const s = scrapeRows[0] ?? {};
  const q = queueRows[0] ?? {};
  return {
    generatedAt: now.toISOString(),
    scrapes24h: {
      runs: num(s.runs),
      failed: num(s.failed),
      eventsCreated: num(s.created),
      eventsCancelled: num(s.cancelled),
    },
    failingSources: failingRows.map((r) => ({
      name: String(r.name),
      type: String(r.type),
      lastRunAt: iso(r.startedAt) ?? "",
      error: r.error == null ? null : String(r.error).slice(0, 200),
      streak: num(r.streak),
    })),
    openAlerts: alertRows.map((r) => ({
      createdAt: iso(r.createdAt) ?? "",
      type: String(r.type),
      severity: String(r.severity),
      source: String(r.source),
      title: String(r.title),
    })),
    alertsCreated24h: num(createdRows[0]?.n),
    largeCancellations24h: cancelRows.map((r) => ({
      startedAt: iso(r.startedAt) ?? "",
      source: String(r.source),
      eventsFound: num(r.eventsFound),
      eventsCancelled: num(r.eventsCancelled),
    })),
    allZeroKennels: zeroRows.map((r) => String(r.kennelCode)),
    auditQueue: {
      pending: num(q.pending),
      oldestPendingAt: iso(q.oldest),
      stalePending: num(q.stale),
    },
    failedMigrations: migrationRows.map((m) => ({ name: m.name, startedAt: m.startedAt.toISOString() })),
    watchdog,
    approvalsWaiting,
  };
}
