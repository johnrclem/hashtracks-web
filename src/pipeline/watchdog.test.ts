import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { fresh, MAC_MINI_ID, type AutomationSpec } from "@/lib/automation-registry";
import type { NotifyResult, OwnerEmail } from "@/lib/notify";
import type { GhIssue, OpsGithub } from "@/lib/ops-github";
import {
  issueMarker,
  OPS_LABEL,
  runWatchdog,
  runWatchdogExclusive,
  type AlarmSink,
  type Mailer,
  type StateRow,
  type WatchdogDeps,
  type WatchdogStore,
} from "./watchdog";

const HOUR = 3_600_000;
const T0 = new Date("2026-11-17T00:00:00Z");
const at = (hours: number) => new Date(T0.getTime() + hours * HOUR);

/**
 * In-memory store with the Prisma store's semantics: each conditional update runs to completion
 * before any other code (no await inside), so it is as atomic as the single SQL statement.
 */
class MemoryStore implements WatchdogStore {
  rows = new Map<string, StateRow>();
  private locked = false;
  failSetIssueOnce = false;
  constructor(private clock: () => Date) {}

  async withLock<T>(job: () => Promise<T>) {
    if (this.locked) return { acquired: false as const };
    this.locked = true;
    try {
      return { acquired: true as const, result: await job() };
    } finally {
      this.locked = false;
    }
  }
  async ensureStates(ids: string[]) {
    const now = this.clock();
    for (const automation of ids) {
      if (!this.rows.has(automation)) {
        this.rows.set(automation, {
          automation,
          status: "OK",
          since: now,
          createdAt: now,
          issueNumber: null,
          alertedAt: null,
          emailedAt: null,
          detail: null,
        });
      }
    }
  }
  async loadStates() {
    return new Map([...this.rows].map(([k, v]) => [k, { ...v }]));
  }
  async recordCheck(id: string, _verdict: string, detail: string) {
    this.rows.get(id)!.detail = detail;
  }
  private update(id: string, where: (r: StateRow) => boolean, data: Partial<StateRow>): StateRow | null {
    const row = this.rows.get(id);
    if (!row || !where(row)) return null;
    Object.assign(row, data);
    return { ...row };
  }
  async markOverdue(id: string, now: Date) {
    return this.update(id, (r) => r.status === "OK", { status: "OVERDUE", since: now, alertedAt: null, emailedAt: null });
  }
  async markRecovered(id: string, since: Date, now: Date) {
    return this.update(id, (r) => r.status === "OVERDUE" && +r.since === +since, {
      status: "OK",
      since: now,
      alertedAt: null,
      emailedAt: null,
    });
  }
  async claimAlert(id: string, since: Date, now: Date) {
    return !!this.update(id, (r) => r.status === "OVERDUE" && +r.since === +since && !r.alertedAt, { alertedAt: now });
  }
  async claimEmail(id: string, since: Date, now: Date) {
    return !!this.update(id, (r) => r.status === "OVERDUE" && +r.since === +since && !r.emailedAt, { emailedAt: now });
  }
  async releaseEmail(id: string, since: Date, claimedAt: Date) {
    this.update(id, (r) => +r.since === +since && +(r.emailedAt ?? 0) === +claimedAt, { emailedAt: null });
  }
  async setIssue(id: string, since: Date, issueNumber: number) {
    if (this.failSetIssueOnce) {
      this.failSetIssueOnce = false;
      throw new Error("connection reset (crash between creating and recording the issue)");
    }
    this.update(id, (r) => r.status === "OVERDUE" && +r.since === +since && r.issueNumber === null, { issueNumber });
  }
  async clearIssue(id: string, issueNumber: number) {
    this.update(id, (r) => r.status === "OK" && r.issueNumber === issueNumber, { issueNumber: null });
  }
  async deleteRunsBefore() {
    return 0;
  }
}

interface FakeIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
  open: boolean;
  comments: string[];
}

class FakeGithub implements OpsGithub {
  issues: FakeIssue[] = [];
  down = false;
  private next = 4000;
  private check() {
    if (this.down) throw new Error("GitHub GET /issues: HTTP 502");
  }
  async listIssues({ labels, state }: { labels: string; state: string }): Promise<GhIssue[]> {
    this.check();
    return this.issues
      .filter((i) => i.labels.includes(labels) && (state === "all" || (state === "open") === i.open))
      .map((i) => ({ ...i, createdAt: T0, closedAt: null, pull: null }));
  }
  async listOpenPulls() {
    return [];
  }
  async listIssueComments() {
    return [];
  }
  async createIssue({ title, body, labels }: { title: string; body: string; labels: string[] }) {
    this.check();
    const number = this.next++;
    this.issues.push({ number, title, body, labels, open: true, comments: [] });
    return number;
  }
  async comment(n: number, body: string) {
    this.check();
    this.issues.find((i) => i.number === n)!.comments.push(body);
  }
  async close(n: number) {
    this.check();
    this.issues.find((i) => i.number === n)!.open = false;
  }
}

class FakeAlarms implements AlarmSink {
  overdueEvents: Array<{ automation: string; since: Date }> = [];
  recoveredEvents: Array<{ automation: string; outageSince: Date }> = [];
  overdue(e: { automation: string; since: Date }) {
    this.overdueEvents.push({ automation: e.automation, since: e.since });
  }
  recovered(e: { automation: string; outageSince: Date }) {
    this.recoveredEvents.push({ automation: e.automation, outageSince: e.outageSince });
  }
  async flush() {}
}

class FakeMailer implements Mailer {
  isConfigured = true;
  failNext = false;
  sent: OwnerEmail[] = [];
  configured() {
    return this.isConfigured;
  }
  async send(email: OwnerEmail): Promise<NotifyResult> {
    if (this.failNext) {
      this.failNext = false;
      return { sent: false, reason: "Resend: 503" };
    }
    this.sent.push(email);
    return { sent: true, id: `email-${this.sent.length}` };
  }
}

/** An automation whose output the test controls. */
function controllable(id: string, maxAgeHours: number, host: "vercel" | "mac-mini" = "vercel") {
  const output = { lastSeen: null as Date | null, broken: false };
  const spec: AutomationSpec = {
    id,
    label: `${id} task`,
    host,
    cadence: "test cadence",
    check: async (ctx) => {
      if (output.broken) throw new Error("GitHub GET /pulls: HTTP 502");
      return { expectations: [fresh("a run", output.lastSeen, maxAgeHours, ctx)] };
    },
  };
  return { spec, output };
}

function harness(specs: AutomationSpec[]) {
  let now = T0;
  const store = new MemoryStore(() => now);
  const github = new FakeGithub();
  const alarms = new FakeAlarms();
  const mailer = new FakeMailer();
  const deps = (): WatchdogDeps => ({ store, github, alarms, mailer, now, specs });
  return {
    store,
    github,
    alarms,
    mailer,
    setNow: (d: Date) => {
      now = d;
    },
    tick: async (d: Date) => {
      now = d;
      return runWatchdogExclusive(deps());
    },
    deps,
  };
}

const opsIssues = (github: FakeGithub, id: string) => github.issues.filter((i) => i.body.includes(issueMarker(id)));

describe("runWatchdog: one alarm per outage, one recovery", () => {
  let h: ReturnType<typeof harness>;
  let job: ReturnType<typeof controllable>;
  // A daily job with 2 h grace: overdue once its last run is more than 26 h old.
  beforeEach(() => {
    job = controllable("cron:audit", 26);
    h = harness([job.spec]);
    job.output.lastSeen = T0;
  });

  it("pausing raises exactly one alarm within the grace period plus 1 hour", async () => {
    for (let hour = 0; hour <= 72; hour++) await h.tick(at(hour));

    expect(h.alarms.overdueEvents).toHaveLength(1);
    const alarmAt = h.alarms.overdueEvents[0].since;
    expect(alarmAt.getTime()).toBeGreaterThan(at(26).getTime());
    expect(alarmAt.getTime()).toBeLessThanOrEqual(at(26 + 1).getTime());

    const issues = opsIssues(h.github, "cron:audit");
    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ open: true, labels: [OPS_LABEL] });
    expect(issues[0].title).toBe("ops: cron:audit task is overdue");
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.mailer.sent[0].idempotencyKey).toBe(`ops-watchdog/cron:audit/${alarmAt.getTime()}/overdue`);
    expect(h.store.rows.get("cron:audit")).toMatchObject({ status: "OVERDUE", issueNumber: issues[0].number });
  });

  it("resuming sends one recovery: a Sentry info event, one email, a comment and a close", async () => {
    for (let hour = 0; hour <= 30; hour++) await h.tick(at(hour));
    const outageSince = h.store.rows.get("cron:audit")!.since;

    job.output.lastSeen = at(30.5);
    for (let hour = 31; hour <= 40; hour++) await h.tick(at(hour));

    expect(h.alarms.recoveredEvents).toEqual([{ automation: "cron:audit", outageSince }]);
    expect(h.mailer.sent.map((e) => e.subject)).toEqual(["cron:audit task is overdue", "Recovered: cron:audit task"]);
    const [issue] = opsIssues(h.github, "cron:audit");
    expect(issue.open).toBe(false);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0]).toMatch(/^<!-- ops:cron:audit -->\nRecovered at /);
    expect(h.store.rows.get("cron:audit")).toMatchObject({ status: "OK", issueNumber: null });
  });

  it("a second outage gets its own Sentry fingerprint (since) and its own issue", async () => {
    for (let hour = 0; hour <= 30; hour++) await h.tick(at(hour));
    job.output.lastSeen = at(30.5);
    await h.tick(at(31));
    for (let hour = 32; hour <= 60; hour++) await h.tick(at(hour));

    expect(h.alarms.overdueEvents).toHaveLength(2);
    expect(+h.alarms.overdueEvents[0].since).not.toBe(+h.alarms.overdueEvents[1].since);
    expect(opsIssues(h.github, "cron:audit").map((i) => i.open)).toEqual([false, true]);
  });

  it("a QStash retry of the same run duplicates nothing", async () => {
    await h.tick(at(0));
    await h.tick(at(27));
    await h.tick(at(27));
    await h.tick(at(27));
    expect(h.alarms.overdueEvents).toHaveLength(1);
    expect(opsIssues(h.github, "cron:audit")).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(1);
  });
});

describe("runWatchdog: overlapping runs and crashes", () => {
  it("two overlapping runs: the second finds the lock taken and does nothing", async () => {
    const job = controllable("cron:audit", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    await h.tick(at(0));
    h.setNow(at(27));
    const [a, b] = await Promise.all([runWatchdogExclusive(h.deps()), runWatchdogExclusive(h.deps())]);

    expect([a, b].filter((r) => "skipped" in r)).toHaveLength(1);
    expect(h.alarms.overdueEvents).toHaveLength(1);
    expect(opsIssues(h.github, "cron:audit")).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("even without the lock, the conditional updates give one state change, one Sentry alarm and one email", async () => {
    const job = controllable("cron:audit", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    await h.tick(at(0));
    h.setNow(at(27));
    const [a, b] = await Promise.all([runWatchdog(h.deps()), runWatchdog(h.deps())]);

    expect(a.wentOverdue + b.wentOverdue).toBe(1);
    expect(h.alarms.overdueEvents).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("a crash between creating the issue and recording it never leaves two issues", async () => {
    const job = controllable("cron:audit", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    await h.tick(at(0));
    h.store.failSetIssueOnce = true;
    const first = await h.tick(at(27));
    expect(first).toMatchObject({ errorCount: 1 });
    expect(h.store.rows.get("cron:audit")!.issueNumber).toBeNull();

    await h.tick(at(28));
    const issues = opsIssues(h.github, "cron:audit");
    expect(issues).toHaveLength(1);
    expect(h.store.rows.get("cron:audit")!.issueNumber).toBe(issues[0].number);
  });

  it("GitHub down at alarm time: Sentry and email still go out, the issue follows once GitHub is back", async () => {
    const job = controllable("cron:audit", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    await h.tick(at(0));
    h.github.down = true;
    await h.tick(at(27));
    expect(h.alarms.overdueEvents).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(1);
    expect(h.github.issues).toHaveLength(0);

    h.github.down = false;
    await h.tick(at(28));
    await h.tick(at(29));
    expect(opsIssues(h.github, "cron:audit")).toHaveLength(1);
    expect(h.alarms.overdueEvents).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("email is retried every run until it's sent, and sent once", async () => {
    const job = controllable("cron:audit", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    await h.tick(at(0));
    h.mailer.isConfigured = false;
    await h.tick(at(27));
    expect(h.store.rows.get("cron:audit")!.emailedAt).toBeNull();

    h.mailer.isConfigured = true;
    h.mailer.failNext = true;
    await h.tick(at(28));
    expect(h.mailer.sent).toHaveLength(0);
    expect(h.store.rows.get("cron:audit")!.emailedAt).toBeNull();

    await h.tick(at(29));
    await h.tick(at(30));
    expect(h.mailer.sent).toHaveLength(1);
  });

  it("no recovered email when the alarm was never emailed", async () => {
    const job = controllable("cron:audit", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    h.mailer.isConfigured = false;
    await h.tick(at(0));
    await h.tick(at(27));
    job.output.lastSeen = at(27.5);
    await h.tick(at(28));
    expect(h.alarms.recoveredEvents).toHaveLength(1);
    expect(h.mailer.sent).toHaveLength(0);
  });
});

describe("runWatchdog: verdicts that raise no alarm", () => {
  it("UNKNOWN (the check itself failed) neither raises nor clears an alarm", async () => {
    const job = controllable("audit-fixer", 26);
    const h = harness([job.spec]);
    job.output.lastSeen = T0;
    await h.tick(at(0));
    job.output.broken = true;
    await h.tick(at(40));
    expect(h.alarms.overdueEvents).toHaveLength(0);

    job.output.broken = false;
    await h.tick(at(41));
    expect(h.store.rows.get("audit-fixer")!.status).toBe("OVERDUE");
    job.output.broken = true;
    const run = await h.tick(at(42));
    expect(run).toMatchObject({ unknown: 1 });
    expect(h.store.rows.get("audit-fixer")!.status).toBe("OVERDUE");
    expect(h.alarms.recoveredEvents).toHaveLength(0);
  });

  it("BLOCKED_ON_OWNER meets the expectation without an alarm", async () => {
    const spec: AutomationSpec = {
      id: "kennel-implementer",
      label: "Kennel implementer",
      host: "vercel",
      cadence: "daily",
      check: async (ctx) => ({
        expectations: [fresh("an onboarding-impl PR", T0, 78, ctx)],
        blockedOnOwner: "2 `onboarding-impl` PRs wait on the owner (#2940, #2979)",
      }),
    };
    const h = harness([spec]);
    await h.tick(at(0));
    const run = await h.tick(at(100));
    expect(run).toMatchObject({ blockedOnOwner: 1, overdue: 0 });
    expect(h.alarms.overdueEvents).toHaveLength(0);
    expect(h.store.rows.get("kennel-implementer")!.detail).toMatch(/^2 `onboarding-impl` PRs wait on the owner/);
  });

  it("a cron with no run rows yet isn't overdue until its window has passed since tracking began", async () => {
    const job = controllable("cron:rule-drift", 174);
    const h = harness([job.spec]);
    await h.tick(at(0));
    await h.tick(at(170));
    expect(h.store.rows.get("cron:rule-drift")!.status).toBe("OK");
    await h.tick(at(175));
    expect(h.store.rows.get("cron:rule-drift")!.status).toBe("OVERDUE");
  });
});

describe("runWatchdog: the Mac mini", () => {
  function macHarness() {
    const tasks = ["deep-dive", "hareline-audit", "ops-digest"].map((id) => controllable(id, 28, "mac-mini"));
    const h = harness(tasks.map((t) => t.spec));
    for (const t of tasks) t.output.lastSeen = T0;
    return { h, tasks };
  }

  it("raises one 'Mac mini silent' alarm instead of one per task", async () => {
    const { h } = macHarness();
    for (let hour = 0; hour <= 40; hour++) await h.tick(at(hour));

    expect(h.alarms.overdueEvents.map((e) => e.automation)).toEqual([MAC_MINI_ID]);
    expect(h.github.issues.map((i) => i.title)).toEqual(["ops: Mac mini silent, no scheduled task is producing output"]);
    expect(h.mailer.sent).toHaveLength(1);
    for (const id of ["deep-dive", "hareline-audit", "ops-digest"]) expect(h.store.rows.get(id)!.status).toBe("OK");
  });

  it("when the Mac comes back, the tasks get a full window before their own alarms", async () => {
    const { h, tasks } = macHarness();
    for (let hour = 0; hour <= 40; hour++) await h.tick(at(hour));

    // The Mac is back: the deep dive runs; the other two tasks haven't had their turn yet.
    tasks[0].output.lastSeen = at(40.5);
    await h.tick(at(41));
    expect(h.alarms.recoveredEvents.map((e) => e.automation)).toEqual([MAC_MINI_ID]);
    expect(h.github.issues[0].open).toBe(false);

    for (let hour = 42; hour <= 41 + 28; hour++) await h.tick(at(hour));
    expect(h.alarms.overdueEvents).toHaveLength(1);

    // Still nothing from the digest a full window after the Mac came back: now it alarms alone.
    tasks[0].output.lastSeen = at(70);
    tasks[1].output.lastSeen = at(70);
    await h.tick(at(71));
    expect(h.alarms.overdueEvents.map((e) => e.automation)).toEqual([MAC_MINI_ID, "ops-digest"]);
  });

  it("one silent task while the others run is that task's own alarm", async () => {
    const { h, tasks } = macHarness();
    for (let hour = 0; hour <= 40; hour++) {
      tasks[0].output.lastSeen = at(hour);
      tasks[1].output.lastSeen = at(hour);
      await h.tick(at(hour));
    }
    expect(h.alarms.overdueEvents.map((e) => e.automation)).toEqual(["ops-digest"]);
  });
});
