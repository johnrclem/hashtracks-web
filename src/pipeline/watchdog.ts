/**
 * The ops watchdog (`/api/cron/watchdog`, hourly via QStash with a daily Vercel backstop).
 *
 * Each run checks every automation in `src/lib/automation-registry.ts` against the side effects
 * it must leave, and keeps one `AutomationState` row per automation:
 *
 * - **Alarm state changes only through conditional updates.** OK → OVERDUE is
 *   `UPDATE … WHERE automation = $1 AND status = 'OK' RETURNING`; recovery is the same with
 *   `status = 'OVERDUE'`. Only the run whose update returns the row acts on the change, so an
 *   overlapping run (the QStash run and the Vercel backstop, or a QStash retry) never acts twice.
 *   Runs are also serialised by an advisory lock (`runWatchdogExclusive`).
 * - **Alarms survive a crash.** An OVERDUE row records `alertedAt` (Sentry), `issueNumber` (the
 *   `lane:ops` issue) and `emailedAt`; every run delivers whichever is still missing. Sentry and
 *   email are claimed with a conditional update before they're sent. An issue is found by its
 *   `<!-- ops:<automation> -->` marker among the open `lane:ops` issues before one is created, so
 *   a crash between creating and recording it never leaves two.
 * - **On recovery** it sends a Sentry info event and one recovered email (if the alarm was
 *   emailed), then comments on the issue and closes it.
 * - **Mac mini.** When no scheduled task on the Mac mini is OK and at least one is overdue, it
 *   raises one "Mac mini silent" alarm and leaves the tasks' own alarm states alone.
 * - **Blocked on the owner is not down.** A BLOCKED_ON_OWNER verdict counts as OK for alarms.
 * - **UNKNOWN** (the check itself failed, e.g. GitHub unreachable) changes nothing.
 */
import * as Sentry from "@sentry/nextjs";

import type { AutomationStatus, AutomationVerdict } from "@/generated/prisma/client";
import { withAdvisoryXactLock, type AdvisoryLockResult } from "@/lib/advisory-lock";
import {
  AUTOMATIONS,
  MAC_MINI_ID,
  MAC_MINI_LABEL,
  OPS_MARKER_PREFIX,
  type AutomationHost,
  type AutomationSpec,
  type CheckContext,
  type Expectation,
} from "@/lib/automation-registry";
import { prisma } from "@/lib/db";
import { emailOwner, ownerEmailConfigured, type OwnerEmail, type NotifyResult } from "@/lib/notify";
import type { GhIssue, GhPull, OpsGithub } from "@/lib/ops-github";

export const OPS_LABEL = "lane:ops";
/** Run rows are kept this long; the watchdog deletes older ones once a day, in this UTC hour. */
export const RUN_RETENTION_DAYS = 90;
const PRUNE_HOUR_UTC = 3;
export const WATCHDOG_LOCK_KEY = 0x4f_50_57_44; // "OPWD"

const DAY_MS = 86_400_000;

export const issueMarker = (automation: string) => `${OPS_MARKER_PREFIX}${automation} -->`;

// ── Store ───────────────────────────────────────────────────────────────────

export interface StateRow {
  automation: string;
  status: AutomationStatus;
  since: Date;
  issueNumber: number | null;
  alertedAt: Date | null;
  emailedAt: Date | null;
  detail: string | null;
  createdAt: Date;
}

/** The watchdog's reads and conditional writes. Each write is one atomic statement. */
export interface WatchdogStore {
  /** Run `job` unless another watchdog run holds the lock. */
  withLock<T>(job: () => Promise<T>): Promise<AdvisoryLockResult<T>>;
  /** Insert an OK row for each automation that has none. */
  ensureStates(ids: string[]): Promise<void>;
  loadStates(): Promise<Map<string, StateRow>>;
  recordCheck(id: string, verdict: AutomationVerdict, detail: string, now: Date): Promise<void>;
  /** OK → OVERDUE. Returns the row only to the run that made the change. */
  markOverdue(id: string, now: Date): Promise<StateRow | null>;
  /** OVERDUE (entered at `since`) → OK. Returns the row only to the run that made the change. */
  markRecovered(id: string, since: Date, now: Date): Promise<StateRow | null>;
  /** Claim the outage's Sentry alarm; true only for the run that claimed it. */
  claimAlert(id: string, since: Date, now: Date): Promise<boolean>;
  /** Claim the outage's email; true only for the run that claimed it. */
  claimEmail(id: string, since: Date, now: Date): Promise<boolean>;
  /** Undo a claim whose send failed, so the next run retries. */
  releaseEmail(id: string, since: Date, claimedAt: Date): Promise<void>;
  /** Record the outage's issue, if none is recorded yet. */
  setIssue(id: string, since: Date, issueNumber: number): Promise<void>;
  /** Forget an issue once it's closed after a recovery. */
  clearIssue(id: string, issueNumber: number): Promise<void>;
  deleteRunsBefore(cutoff: Date): Promise<number>;
}

const STATE_SELECT = {
  automation: true,
  status: true,
  since: true,
  issueNumber: true,
  alertedAt: true,
  emailedAt: true,
  detail: true,
  createdAt: true,
} as const;

/**
 * The Prisma-backed store. `lockIdleMs` should be the route's `maxDuration` plus 30 s: if the
 * function is killed mid-run, Postgres ends the lock's idle transaction after that and the lock
 * frees itself (see `withAdvisoryXactLock`).
 */
export function prismaWatchdogStore({ lockIdleMs }: { lockIdleMs: number }): WatchdogStore {
  const s = prisma.automationState;
  return {
    withLock: (job) => withAdvisoryXactLock(WATCHDOG_LOCK_KEY, lockIdleMs, job),
    async ensureStates(ids) {
      await s.createMany({ data: ids.map((automation) => ({ automation })), skipDuplicates: true });
    },
    async loadStates() {
      const rows = await s.findMany({ select: STATE_SELECT });
      return new Map(rows.map((r) => [r.automation, r]));
    },
    async recordCheck(id, verdict, detail, now) {
      await s.update({ where: { automation: id }, data: { verdict, detail, checkedAt: now } });
    },
    async markOverdue(id, now) {
      const [row] = await s.updateManyAndReturn({
        where: { automation: id, status: "OK" },
        // issueNumber is cleared too: one left over from a recovery whose close was cut short may
        // already be closed. A still-open one is found again by its marker.
        data: { status: "OVERDUE", since: now, alertedAt: null, emailedAt: null, issueNumber: null },
        select: STATE_SELECT,
      });
      return row ?? null;
    },
    async markRecovered(id, since, now) {
      const [row] = await s.updateManyAndReturn({
        where: { automation: id, status: "OVERDUE", since },
        data: { status: "OK", since: now, alertedAt: null, emailedAt: null },
        select: STATE_SELECT,
      });
      return row ?? null;
    },
    async claimAlert(id, since, now) {
      const { count } = await s.updateMany({
        where: { automation: id, status: "OVERDUE", since, alertedAt: null },
        data: { alertedAt: now },
      });
      return count === 1;
    },
    async claimEmail(id, since, now) {
      const { count } = await s.updateMany({
        where: { automation: id, status: "OVERDUE", since, emailedAt: null },
        data: { emailedAt: now },
      });
      return count === 1;
    },
    async releaseEmail(id, since, claimedAt) {
      await s.updateMany({ where: { automation: id, since, emailedAt: claimedAt }, data: { emailedAt: null } });
    },
    async setIssue(id, since, issueNumber) {
      await s.updateMany({
        where: { automation: id, status: "OVERDUE", since, issueNumber: null },
        data: { issueNumber },
      });
    },
    async clearIssue(id, issueNumber) {
      await s.updateMany({ where: { automation: id, status: "OK", issueNumber }, data: { issueNumber: null } });
    },
    async deleteRunsBefore(cutoff) {
      const { count } = await prisma.automationRun.deleteMany({ where: { startedAt: { lt: cutoff } } });
      return count;
    },
  };
}

// ── Alarms ──────────────────────────────────────────────────────────────────

export interface AlarmSink {
  /** Error-level event, its own Sentry issue per automation per outage. */
  overdue(e: { automation: string; label: string; since: Date; detail: string }): void;
  /** Info-level event when an outage ends. */
  recovered(e: { automation: string; label: string; outageSince: Date; detail: string }): void;
  flush(): Promise<void>;
}

export const sentryAlarms: AlarmSink = {
  overdue({ automation, label, since, detail }) {
    Sentry.captureMessage(`Ops watchdog: ${label} is overdue`, {
      level: "error",
      // A new fingerprint per outage, so a second outage opens a new Sentry issue
      // (and fires the alert rule) instead of joining one already seen.
      fingerprint: ["ops-watchdog-overdue", automation, since.toISOString()],
      tags: { ops_watchdog: "overdue", automation },
      extra: { detail, since: since.toISOString() },
    });
  },
  recovered({ automation, label, outageSince, detail }) {
    Sentry.captureMessage(`Ops watchdog: ${label} recovered`, {
      level: "info",
      fingerprint: ["ops-watchdog-recovered", automation, outageSince.toISOString()],
      tags: { ops_watchdog: "recovered", automation },
      extra: { detail, outageSince: outageSince.toISOString() },
    });
  },
  async flush() {
    await Sentry.flush(2000);
  },
};

export interface Mailer {
  configured(): boolean;
  send(email: OwnerEmail): Promise<NotifyResult>;
}

export const resendMailer: Mailer = { configured: ownerEmailConfigured, send: emailOwner };

// ── Evaluation ──────────────────────────────────────────────────────────────

export interface Evaluation {
  id: string;
  label: string;
  host: AutomationHost;
  cadence: string;
  /** Issue title and email subject while overdue. */
  alarmTitle: string;
  /** What the owner should check, in the issue. */
  runbook: string;
  verdict: AutomationVerdict;
  detail: string;
  expectations: Expectation[];
}

const DEFAULT_RUNBOOK = "Check the automation's latest run or log. See `docs/ops/system.md` for what it should produce.";

const describe = (es: Expectation[]) => es.map((e) => `${e.what}: ${e.seen}`).join("; ");

async function evaluate(spec: AutomationSpec, ctx: CheckContext): Promise<Evaluation> {
  const base = {
    id: spec.id,
    label: spec.label,
    host: spec.host,
    cadence: spec.cadence,
    alarmTitle: spec.alarmTitle ?? `${spec.label} is overdue`,
    runbook: spec.runbook ?? DEFAULT_RUNBOOK,
  };
  try {
    const { expectations, blockedOnOwner } = await spec.check(ctx);
    const failing = expectations.filter((e) => !e.ok);
    if (failing.length === 0) return { ...base, verdict: "OK", detail: describe(expectations), expectations };
    if (blockedOnOwner) {
      return { ...base, verdict: "BLOCKED_ON_OWNER", detail: `${blockedOnOwner}; ${describe(failing)}`, expectations };
    }
    return { ...base, verdict: "OVERDUE", detail: describe(failing), expectations };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...base, verdict: "UNKNOWN", detail: `check failed: ${message}`.slice(0, 500), expectations: [] };
  }
}

/** No desktop task is OK and at least one is overdue: the Mac mini itself has gone quiet. */
function macMiniEvaluation(desktop: Evaluation[]): Evaluation {
  const silent = !desktop.some((e) => e.verdict === "OK") && desktop.some((e) => e.verdict === "OVERDUE");
  return {
    id: MAC_MINI_ID,
    label: MAC_MINI_LABEL,
    host: "mac-mini",
    cadence: "always on; runs every scheduled task",
    alarmTitle: "Mac mini silent, no scheduled task is producing output",
    runbook:
      "Check that the Mac mini is awake, online and signed in, and that Claude Code's scheduled tasks are enabled. The tasks' own alarms are held while this one is open.",
    verdict: silent ? "OVERDUE" : "OK",
    detail: silent
      ? `no scheduled task produced output: ${desktop.map((e) => `${e.label} ${e.verdict}`).join(", ")}`
      : "at least one scheduled task is producing output",
    expectations: desktop.map((e) => ({ what: e.label, ok: e.verdict !== "OVERDUE", seen: e.detail })),
  };
}

// ── Issue and email text ────────────────────────────────────────────────────

function issueBody(ev: Evaluation, since: Date): string {
  const rows = ev.expectations.map((e) => `| ${e.ok ? "✅" : "❌"} ${e.what} | ${e.seen.replaceAll("|", "\\|")} |`);
  return [
    issueMarker(ev.id),
    `**${ev.label}** has been overdue since ${since.toISOString()}.`,
    "",
    `Runs: ${ev.cadence}.`,
    "",
    "| Expected | Seen |",
    "|---|---|",
    ...rows,
    "",
    ev.runbook,
    "",
    "_Filed by the ops watchdog (`/api/cron/watchdog`). It comments and closes this issue when the automation recovers._",
  ].join("\n");
}

function alarmEmail(ev: Evaluation, since: Date): OwnerEmail {
  return {
    subject: ev.alarmTitle,
    text: `${ev.label} has been overdue since ${since.toISOString()}.\n\n${ev.detail}\n\nRuns: ${ev.cadence}.`,
    idempotencyKey: `ops-watchdog/${ev.id}/${since.getTime()}/overdue`,
  };
}

function recoveredEmail(ev: Evaluation, outageSince: Date, now: Date): OwnerEmail {
  return {
    subject: `Recovered: ${ev.label}`,
    text: `${ev.label} recovered at ${now.toISOString()} (overdue since ${outageSince.toISOString()}).\n\n${ev.detail}`,
    idempotencyKey: `ops-watchdog/${ev.id}/${outageSince.getTime()}/recovered`,
  };
}

// ── The run ─────────────────────────────────────────────────────────────────

export interface WatchdogDeps {
  store: WatchdogStore;
  github: OpsGithub | null;
  alarms: AlarmSink;
  mailer: Mailer;
  now: Date;
  specs?: readonly AutomationSpec[];
}

export interface WatchdogSummary {
  checked: number;
  ok: number;
  blockedOnOwner: number;
  overdue: number;
  unknown: number;
  wentOverdue: number;
  recovered: number;
  alarmsSent: number;
  issuesOpened: number;
  issuesClosed: number;
  emailsSent: number;
  prunedRuns: number;
  errorCount: number;
  overdueAutomations: string[];
  errors: string[];
}

export async function runWatchdog(deps: WatchdogDeps): Promise<WatchdogSummary> {
  const { store, github, alarms, mailer, now } = deps;
  const specs = deps.specs ?? AUTOMATIONS;

  await store.ensureStates([...specs.map((s) => s.id), MAC_MINI_ID]);
  const before = await store.loadStates();

  // 1. Evaluate. Desktop tasks count gaps from the Mac mini's last recovery at the earliest.
  const mac = before.get(MAC_MINI_ID);
  const macResumedAt = mac && mac.status === "OK" && mac.since > mac.createdAt ? mac.since : undefined;
  let pulls: Promise<GhPull[]> | null = null;
  const openPulls = () => {
    if (!github) return Promise.reject(new Error("GITHUB_TOKEN is not set"));
    pulls ??= github.listOpenPulls();
    return pulls;
  };
  const evals = await Promise.all(
    specs.map((spec) =>
      evaluate(spec, {
        now,
        trackedSince: before.get(spec.id)?.createdAt ?? now,
        resumedAt: spec.host === "mac-mini" ? macResumedAt : undefined,
        github,
        openPulls,
      }),
    ),
  );
  const macEval = macMiniEvaluation(evals.filter((e) => e.host === "mac-mini"));
  // While the Mac is silent, and in the run that sees it come back, its tasks' own alarm states
  // are held. From the next run their gaps count from the recovery (`macResumedAt`).
  const holdDesktop = macEval.verdict === "OVERDUE" || mac?.status === "OVERDUE";
  const all = [...evals, macEval];
  const byId = new Map(all.map((e) => [e.id, e]));

  const count = (verdict: AutomationVerdict) => all.filter((e) => e.verdict === verdict).length;
  const summary: WatchdogSummary = {
    checked: all.length,
    ok: count("OK"),
    blockedOnOwner: count("BLOCKED_ON_OWNER"),
    overdue: count("OVERDUE"),
    unknown: count("UNKNOWN"),
    wentOverdue: 0,
    recovered: 0,
    alarmsSent: 0,
    issuesOpened: 0,
    issuesClosed: 0,
    emailsSent: 0,
    prunedRuns: 0,
    errorCount: 0,
    overdueAutomations: [],
    errors: [],
  };
  const fail = (what: string, err: unknown) =>
    summary.errors.push(`${what}: ${err instanceof Error ? err.message : String(err)}`.slice(0, 300));

  // 2. Record verdicts and make state changes. Only the run whose conditional update wins acts.
  for (const ev of all) {
    try {
      await store.recordCheck(ev.id, ev.verdict, ev.detail, now);
      if (ev.verdict === "UNKNOWN" || (holdDesktop && ev.host === "mac-mini" && ev.id !== MAC_MINI_ID)) continue;

      const prev = before.get(ev.id);
      if (ev.verdict === "OVERDUE") {
        if (await store.markOverdue(ev.id, now)) summary.wentOverdue++;
      } else if (prev?.status === "OVERDUE") {
        const won = await store.markRecovered(ev.id, prev.since, now);
        if (won) {
          summary.recovered++;
          alarms.recovered({ automation: ev.id, label: ev.label, outageSince: prev.since, detail: ev.detail });
          if (prev.emailedAt) {
            const res = await mailer.send(recoveredEmail(ev, prev.since, now));
            if (res.sent) summary.emailsSent++;
            else fail(`recovered email for ${ev.id}`, res.reason);
          }
        }
      }
    } catch (err) {
      fail(ev.id, err);
    }
  }

  // 3. Deliver what each state still owes: alarms for outages, closes for recoveries.
  // The open lane:ops issues are listed at most once per run, however many outages need one.
  let opsIssues: Promise<GhIssue[]> | null = null;
  const run: AlarmRun = {
    deps,
    summary,
    fail,
    openOpsIssues: (gh) => (opsIssues ??= gh.listIssues({ labels: OPS_LABEL, state: "open", limit: 300 })),
  };
  const after = await store.loadStates();
  for (const row of after.values()) {
    const ev = byId.get(row.automation);
    if (!ev) continue; // no longer registered
    try {
      if (row.status === "OVERDUE") await deliverAlarm(row, ev, run);
      else if (row.issueNumber !== null && github) {
        await github.comment(
          row.issueNumber,
          `${issueMarker(row.automation)}\nRecovered at ${row.since.toISOString()}: ${ev.detail}\n\nClosing.`,
        );
        await github.close(row.issueNumber);
        await store.clearIssue(row.automation, row.issueNumber);
        summary.issuesClosed++;
      }
    } catch (err) {
      fail(`deliver ${row.automation}`, err);
    }
    if (row.status === "OVERDUE") summary.overdueAutomations.push(row.automation);
  }

  if (now.getUTCHours() === PRUNE_HOUR_UTC) {
    try {
      summary.prunedRuns = await store.deleteRunsBefore(new Date(now.getTime() - RUN_RETENTION_DAYS * DAY_MS));
    } catch (err) {
      fail("prune runs", err);
    }
  }

  await alarms.flush();
  summary.errorCount = summary.errors.length;
  return summary;
}

interface AlarmRun {
  deps: WatchdogDeps;
  summary: WatchdogSummary;
  fail: (what: string, err: unknown) => void;
  openOpsIssues: (github: OpsGithub) => Promise<GhIssue[]>;
}

async function deliverAlarm(row: StateRow, ev: Evaluation, run: AlarmRun): Promise<void> {
  const { store, github, alarms, mailer, now } = run.deps;
  const { summary, fail } = run;
  const id = row.automation;

  if (!row.alertedAt && (await store.claimAlert(id, row.since, now))) {
    alarms.overdue({ automation: id, label: ev.label, since: row.since, detail: ev.detail });
    summary.alarmsSent++;
  }

  // Filed only from a run that sees the outage itself; an UNKNOWN check has no reason to show.
  if (row.issueNumber === null && ev.verdict === "OVERDUE") {
    if (!github) {
      fail(`issue for ${id}`, "GITHUB_TOKEN is not set");
    } else {
      try {
        const open = await run.openOpsIssues(github);
        const existing = open.find((i) => !i.pull && i.body.includes(issueMarker(id)));
        const number =
          existing?.number ??
          (await github.createIssue({ title: `ops: ${ev.alarmTitle}`, body: issueBody(ev, row.since), labels: [OPS_LABEL] }));
        if (!existing) summary.issuesOpened++;
        await store.setIssue(id, row.since, number);
      } catch (err) {
        fail(`issue for ${id}`, err);
      }
    }
  }

  if (!row.emailedAt && mailer.configured() && (await store.claimEmail(id, row.since, now))) {
    const res = await mailer.send(alarmEmail(ev, row.since));
    if (res.sent) summary.emailsSent++;
    else {
      await store.releaseEmail(id, row.since, now);
      fail(`email for ${id}`, res.reason);
    }
  }
}

/** One watchdog run under the advisory lock; a run that finds the lock taken does nothing. */
export async function runWatchdogExclusive(
  deps: WatchdogDeps,
): Promise<WatchdogSummary | { skipped: "locked" }> {
  const run = await deps.store.withLock(() => runWatchdog(deps));
  return run.acquired ? run.result : { skipped: "locked" };
}
