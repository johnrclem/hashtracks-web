/**
 * Every HashTracks automation the ops watchdog (`/api/cron/watchdog`) keeps alive: how often it
 * runs, how long a gap is tolerated, and what it must leave behind.
 *
 * Liveness is observed, never self-reported. Each check reads side effects the server can see:
 * the run rows `withCronRun()` writes, the agent API calls `rejectUnlessAgent` records, AuditLog
 * rows, finding drafts, scrape logs, and the pull requests, comments and closes on GitHub. A task
 * that runs but produces nothing counts as down.
 *
 * To add a cron, append it to {@link CRON_JOBS} and wrap its route in
 * `withCronRun("<its id>", …)`; `cron-routes.test.ts` fails until both are done.
 */
import { prisma } from "@/lib/db";
import { isWaitingOnOwner, type GhPull, type OpsGithub } from "@/lib/ops-github";
import { RECUR_COMMENT_PREFIX } from "@/pipeline/audit-filer";

export type AutomationHost = "vercel" | "mac-mini";

/** One thing an automation must produce, already judged against the clock. */
export interface Expectation {
  /** What the automation must leave behind, e.g. "a hareline-prompt call". */
  what: string;
  ok: boolean;
  /** What the check saw, e.g. "last one 31 h ago". */
  seen: string;
}

export interface CheckResult {
  expectations: Expectation[];
  /** Set when the automation is waiting on the owner: the expectation is met without an alarm. */
  blockedOnOwner?: string;
}

export interface CheckContext {
  now: Date;
  /** When the watchdog started tracking this automation. A missing output counts from here. */
  trackedSince: Date;
  /**
   * Desktop tasks only: when the Mac mini last came back after going silent. Gaps count from
   * here at the earliest, so a recovered Mac doesn't set off one alarm per task before each
   * has had its turn to run.
   */
  resumedAt?: Date;
  /** Null when GITHUB_TOKEN is unset; GitHub-based checks then can't run. */
  github: OpsGithub | null;
  /** Open pull requests, read at most once per watchdog run. */
  openPulls(): Promise<GhPull[]>;
}

export interface AutomationSpec {
  id: string;
  label: string;
  host: AutomationHost;
  /** When it runs, in words. */
  cadence: string;
  /** Issue title and email subject while overdue; default "<label> is overdue". */
  alarmTitle?: string;
  /** What the owner should check, shown in the issue; default points at `docs/ops/system.md`. */
  runbook?: string;
  check(ctx: CheckContext): Promise<CheckResult>;
}

/** Every watchdog issue body and comment starts with `<!-- ops:<automation> -->`. */
export const OPS_MARKER_PREFIX = "<!-- ops:";

/** Agent API calls the checks read, as `rejectUnlessAgent` names them (`agent:` + route path). */
export const AGENT_CALLS = {
  submitFinding: "agent:submit-finding",
  discardDraft: "agent:drafts/discard",
  harelinePrompt: "agent:hareline-prompt",
  opsDigest: "agent:ops-digest",
} as const;

const HOUR_MS = 3_600_000;

// ── Expectation helpers ─────────────────────────────────────────────────────

function hoursAgo(then: Date, now: Date): string {
  const h = (now.getTime() - then.getTime()) / HOUR_MS;
  return h < 1 ? `${Math.max(0, Math.round(h * 60))} min ago` : `${Math.round(h)} h ago`;
}

/**
 * The output must be newer than `maxAgeHours`. With none at all, the gap counts from when the
 * watchdog started tracking the automation, so a deploy doesn't alarm on crons that simply
 * haven't run since their run rows began.
 */
export function fresh(what: string, lastSeen: Date | null, maxAgeHours: number, ctx: CheckContext): Expectation {
  const base = lastSeen ?? ctx.trackedSince;
  const from = ctx.resumedAt && ctx.resumedAt > base ? ctx.resumedAt : base;
  const ok = ctx.now.getTime() - from.getTime() <= maxAgeHours * HOUR_MS;
  const seen = lastSeen
    ? `last one ${hoursAgo(lastSeen, ctx.now)}`
    : `none since tracking began ${hoursAgo(ctx.trackedSince, ctx.now)}`;
  return { what: `${what} at least every ${maxAgeHours} h`, ok, seen };
}

const latest = (...dates: Array<Date | null | undefined>): Date | null =>
  dates.reduce<Date | null>((best, d) => (d && (!best || d > best) ? d : best), null);

function requireGithub(ctx: CheckContext): OpsGithub {
  if (!ctx.github) throw new Error("GITHUB_TOKEN is not set, so GitHub output can't be checked");
  return ctx.github;
}

/** Newest successful run row (crons) or recorded call (agent calls) among `automations`. */
async function lastRun(automations: string[]): Promise<Date | null> {
  const row = await prisma.automationRun.findFirst({
    where: { automation: { in: automations }, status: "SUCCESS" },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true },
  });
  return row?.startedAt ?? null;
}

/** Open PRs with `label` still waiting on the owner. */
async function waitingPulls(ctx: CheckContext, label: string): Promise<GhPull[]> {
  return (await ctx.openPulls()).filter((pr) => pr.labels.includes(label) && isWaitingOnOwner(pr));
}

function blockedWhen(waiting: GhPull[], limit: number, label: string): string | undefined {
  if (waiting.length < limit) return undefined;
  const numbers = waiting.map((pr) => `#${pr.number}`).join(", ");
  return `${waiting.length} \`${label}\` PRs wait on the owner (${numbers})`;
}

// ── Crons ───────────────────────────────────────────────────────────────────

/**
 * Cron routes wrapped in `withCronRun()`. Each must leave a successful run row at least every
 * `everyHours + graceHours`. `/api/cron/scrape/[sourceId]` isn't here: it runs ~480 times a day
 * and `ScrapeLog` covers it (see the `scraping` automation).
 */
export const CRON_JOBS = [
  { id: "cron:dispatch", cadence: "hourly via QStash; daily 06:00 UTC Vercel backstop", everyHours: 1, graceHours: 1 },
  {
    id: "cron:promote-audit-findings",
    cadence: "hourly via QStash (:05); daily 14:00 UTC Vercel backstop",
    everyHours: 1,
    graceHours: 1,
  },
  { id: "cron:watchdog", cadence: "hourly via QStash (:20); daily 15:40 UTC Vercel backstop", everyHours: 1, graceHours: 1 },
  { id: "cron:audit", cadence: "daily 12:00 UTC", everyHours: 24, graceHours: 2 },
  { id: "cron:sync-audit-issues", cadence: "daily 12:30 UTC", everyHours: 24, graceHours: 2 },
  { id: "cron:travel-draft-gc", cadence: "daily 03:00 UTC", everyHours: 24, graceHours: 2 },
  { id: "cron:scrape-log-gc", cadence: "daily 03:30 UTC", everyHours: 24, graceHours: 2 },
  { id: "cron:strava-cache-purge", cadence: "daily 03:45 UTC", everyHours: 24, graceHours: 2 },
  { id: "cron:prediction-ledger", cadence: "weekly, Monday 08:00 UTC", everyHours: 168, graceHours: 6 },
  { id: "cron:rule-drift", cadence: "weekly, Monday 09:00 UTC", everyHours: 168, graceHours: 6 },
] as const satisfies ReadonlyArray<{ id: `cron:${string}`; cadence: string; everyHours: number; graceHours: number }>;

export type CronJobId = (typeof CRON_JOBS)[number]["id"];

const cronSpecs: AutomationSpec[] = CRON_JOBS.map((job) => ({
  id: job.id,
  label: `${job.id.slice("cron:".length)} cron`,
  host: "vercel",
  cadence: job.cadence,
  check: async (ctx) => ({
    expectations: [fresh("a successful run", await lastRun([job.id]), job.everyHours + job.graceHours, ctx)],
  }),
}));

// ── Scheduled tasks on the Mac mini ─────────────────────────────────────────

/** A daily task may slip a few hours (local time, a long previous run) before it counts as down. */
const DAILY_MAX_AGE = 28;
/** Daily tasks that legitimately skip days (the research backlog stop, the implementer's queue). */
const SKIPPY_MAX_AGE = 78;
/** The fixer and implementer are blocked, not down, once this many of their PRs wait on the owner. */
const FIXER_BLOCKED_AT = 4;
const IMPLEMENTER_BLOCKED_AT = 2;
/** Comments the server posts itself (the filer's recurrence note, the watchdog's own); not the fixer's work. */
const SERVER_COMMENT_PREFIXES = [RECUR_COMMENT_PREFIX, OPS_MARKER_PREFIX];

const desktopSpecs: AutomationSpec[] = [
  {
    id: "deep-dive",
    label: "Kennel deep dive",
    host: "mac-mini",
    cadence: "5 runs a day on the Mac mini",
    check: async (ctx) => {
      const [log, call] = await Promise.all([
        prisma.auditLog.findFirst({
          where: { type: "KENNEL_DEEP_DIVE" },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        }),
        lastRun([AGENT_CALLS.submitFinding, AGENT_CALLS.discardDraft]),
      ]);
      return {
        expectations: [
          fresh("a KENNEL_DEEP_DIVE AuditLog row", log?.createdAt ?? null, DAILY_MAX_AGE, ctx),
          fresh("a submit-finding or drafts/discard call", call, DAILY_MAX_AGE, ctx),
        ],
      };
    },
  },
  {
    id: "hareline-audit",
    label: "Hareline audit",
    host: "mac-mini",
    cadence: "daily 08:30 (Mac mini, local time)",
    check: async (ctx) => {
      const [call, draft] = await Promise.all([
        lastRun([AGENT_CALLS.harelinePrompt]),
        prisma.auditFindingDraft.findFirst({
          where: { stream: "CHROME_EVENT" },
          orderBy: { submittedAt: "desc" },
          select: { submittedAt: true },
        }),
      ]);
      return {
        expectations: [
          fresh("a hareline-prompt call", call, DAILY_MAX_AGE, ctx),
          fresh("a CHROME_EVENT finding draft", draft?.submittedAt ?? null, 7 * 24 + 12, ctx),
        ],
      };
    },
  },
  {
    id: "ops-digest",
    label: "Ops digest",
    host: "mac-mini",
    cadence: "daily 07:15 (Mac mini, local time)",
    check: async (ctx) => ({
      expectations: [fresh("an ops-digest call", await lastRun([AGENT_CALLS.opsDigest]), DAILY_MAX_AGE, ctx)],
    }),
  },
  {
    id: "audit-fixer",
    label: "Audit fixer",
    host: "mac-mini",
    cadence: "daily 10:30 (Mac mini, local time)",
    check: async (ctx) => {
      const github = requireGithub(ctx);
      const since = new Date(ctx.now.getTime() - 7 * 24 * HOUR_MS);
      const [prs, closed, touched, comments, waiting] = await Promise.all([
        github.listIssues({ labels: "audit-fix", state: "all", sort: "created", limit: 5 }),
        github.listIssues({ labels: "audit", state: "closed", sort: "updated", since, limit: 20 }),
        github.listIssues({ labels: "audit", state: "all", sort: "updated", since, limit: 100 }),
        github.listIssueComments(since),
        waitingPulls(ctx, "audit-fix"),
      ]);
      const auditIssues = new Set(touched.map((i) => i.number));
      const fixerComments = comments.filter(
        (c) =>
          !c.byBot &&
          auditIssues.has(c.issueNumber) &&
          !SERVER_COMMENT_PREFIXES.some((prefix) => c.body.startsWith(prefix)),
      );
      const output = latest(
        ...prs.filter((i) => i.pull).map((i) => i.createdAt),
        ...closed.map((i) => i.closedAt),
        ...fixerComments.map((c) => c.createdAt),
      );
      return {
        expectations: [fresh("an audit-fix PR, an audit-issue comment or a close", output, DAILY_MAX_AGE, ctx)],
        blockedOnOwner: blockedWhen(waiting, FIXER_BLOCKED_AT, "audit-fix"),
      };
    },
  },
  {
    id: "kennel-research",
    label: "Kennel research (onboarding)",
    host: "mac-mini",
    cadence: "daily 03:00 (Mac mini, local time)",
    check: async (ctx) => {
      const github = requireGithub(ctx);
      const [handoffs, holds] = await Promise.all([
        github.listIssues({ labels: "onboarding-handoff", state: "all", sort: "created", limit: 5 }),
        github.listIssues({ labels: "onboarding-blocked", state: "open", limit: 5 }),
      ]);
      const hold = holds.find((i) => !i.pull);
      return {
        expectations: [
          fresh("an onboarding-handoff PR", latest(...handoffs.filter((i) => i.pull).map((i) => i.createdAt)), SKIPPY_MAX_AGE, ctx),
        ],
        blockedOnOwner: hold ? `held by onboarding-blocked issue #${hold.number}` : undefined,
      };
    },
  },
  {
    id: "kennel-implementer",
    label: "Kennel implementer",
    host: "mac-mini",
    cadence: "daily 05:00 (Mac mini, local time)",
    check: async (ctx) => {
      const github = requireGithub(ctx);
      const [prs, waiting] = await Promise.all([
        github.listIssues({ labels: "onboarding-impl", state: "all", sort: "updated", limit: 10 }),
        waitingPulls(ctx, "onboarding-impl"),
      ]);
      const output = latest(...prs.filter((i) => i.pull).flatMap((i) => [i.createdAt, i.pull?.mergedAt]));
      return {
        expectations: [fresh("an onboarding-impl PR opened or merged", output, SKIPPY_MAX_AGE, ctx)],
        blockedOnOwner: blockedWhen(waiting, IMPLEMENTER_BLOCKED_AT, "onboarding-impl"),
      };
    },
  },
];

// ── Pipelines ───────────────────────────────────────────────────────────────

/** A PENDING draft older than this has missed at least one hourly promoter run. */
export const PROMOTER_MAX_PENDING_HOURS = 2;
/** An unfinished migration younger than this may still be running in a production build. */
const MIGRATION_IN_FLIGHT_MINUTES = 15;

/**
 * Migrations that started but neither finished nor were rolled back (excluding any still in
 * flight). Each blocks every later deploy until the owner runs `prisma migrate resolve`
 * (docs/ops/system.md#migrations). Shared by the watchdog and the ops digest.
 */
export async function loadFailedMigrations(): Promise<Array<{ name: string; startedAt: Date }>> {
  const rows = await prisma.$queryRaw<Array<{ migration_name: string; started_at: Date }>>`
    SELECT migration_name, started_at FROM "_prisma_migrations"
    WHERE finished_at IS NULL AND rolled_back_at IS NULL
      AND started_at < now() - make_interval(mins => ${MIGRATION_IN_FLIGHT_MINUTES}::int)
    ORDER BY started_at`;
  return rows.map((r) => ({ name: r.migration_name, startedAt: r.started_at }));
}

const pipelineSpecs: AutomationSpec[] = [
  {
    id: "scraping",
    label: "Scraping",
    host: "vercel",
    cadence: "per-source scrapes fanned out hourly by dispatch",
    check: async (ctx) => {
      const log = await prisma.scrapeLog.findFirst({ orderBy: { startedAt: "desc" }, select: { startedAt: true } });
      return { expectations: [fresh("a ScrapeLog row", log?.startedAt ?? null, 2, ctx)] };
    },
  },
  {
    id: "promoter-queue",
    label: "Finding promoter queue",
    host: "vercel",
    cadence: "drained hourly by the promote-audit-findings cron",
    check: async (ctx) => {
      const oldest = await prisma.auditFindingDraft.findFirst({
        where: { status: "PENDING" },
        orderBy: { submittedAt: "asc" },
        select: { submittedAt: true },
      });
      const ok =
        !oldest || ctx.now.getTime() - oldest.submittedAt.getTime() <= PROMOTER_MAX_PENDING_HOURS * HOUR_MS;
      return {
        expectations: [
          {
            what: `no PENDING finding draft older than ${PROMOTER_MAX_PENDING_HOURS} h`,
            ok,
            seen: oldest ? `oldest PENDING draft submitted ${hoursAgo(oldest.submittedAt, ctx.now)}` : "queue empty",
          },
        ],
      };
    },
  },
  {
    id: "migrations",
    label: "Prisma migrations",
    host: "vercel",
    cadence: "applied by `migrate deploy` on each production build",
    alarmTitle: "a failed migration is blocking deploys",
    runbook: 'Follow docs/ops/system.md, "When a migration fails in prod". Only the owner runs `prisma migrate resolve`.',
    check: async () => {
      const failed = await loadFailedMigrations();
      return {
        expectations: [
          {
            what: "no failed migration (`finished_at` and `rolled_back_at` both NULL)",
            ok: failed.length === 0,
            seen: failed.length === 0 ? "none" : `${failed.map((m) => m.name).join(", ")}: deploys can't migrate`,
          },
        ],
      };
    },
  },
];

export const AUTOMATIONS: readonly AutomationSpec[] = [...cronSpecs, ...desktopSpecs, ...pipelineSpecs];

/**
 * Synthetic automation: when no desktop task is OK and at least one is overdue, the watchdog
 * raises this one alarm instead of one per task.
 */
export const MAC_MINI_ID = "mac-mini";
export const MAC_MINI_LABEL = "Mac mini (scheduled tasks)";

export function automationLabel(id: string): string {
  if (id === MAC_MINI_ID) return MAC_MINI_LABEL;
  return AUTOMATIONS.find((a) => a.id === id)?.label ?? id;
}
