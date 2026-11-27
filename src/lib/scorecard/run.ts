/**
 * The weekly scorecard run (`/api/cron/weekly-scorecard`, Mondays 06:00 UTC): compute every
 * measure, judge it against the round's targets, file one `lane:decision` checkpoint issue and
 * email the owner the same summary.
 *
 * Retry-safe: the issue is deduped by a body marker for the run's checkpoint and UTC date, and the
 * email by a Resend idempotency key built from the same marker.
 */
import { LANE_LABELS } from "@/lib/audit-labels";
import { prisma } from "@/lib/db";
import { getValidatedRepo, HASHTRACKS_REPO } from "@/lib/github-repo";
import { gscFromEnv } from "@/lib/gsc/client";
import { emailOwner, type NotifyResult } from "@/lib/notify";
import { opsGithubFromEnv, type OpsGithub } from "@/lib/ops-github";

import { DATED_CHECKS, type AutomatedCheckId, type Values } from "./config";
import { checkpointFor, evaluate, misses, renderMarkdown, renderText, scorecardTitle, type DatedCheckResult, type Scorecard } from "./evaluate";
import {
  errText,
  githubMeasures,
  gscMeasures,
  type GscSetup,
  horizon180Check,
  MANUAL_MEASURES,
  postGateCohortCheck,
  sentryMeasures,
  soft404Measure,
  sqlMeasures,
} from "./measures";

export const SCORECARD_AUTOMATION = "cron:weekly-scorecard";
const MARKER_PREFIX = "<!-- scorecard:";
/** A previous run counts as "last week" only if it ran at least this long ago (skips same-week previews). */
const PREVIOUS_MIN_AGE_MS = 5 * 86_400_000;

export function scorecardMarker(card: Pick<Scorecard, "checkpoint" | "generatedAt">): string {
  return `${MARKER_PREFIX}${card.checkpoint ?? "weekly"}:${card.generatedAt.slice(0, 10)} -->`;
}

/** What the run row stores in `AutomationRun.metrics`; the ops digest reads it back. */
export interface StoredScorecard {
  checkpoint: string | null;
  preview: boolean;
  generatedAt: string;
  issueNumber: number | null;
  emailed: boolean;
  missed: number;
  /** Per measure: value, what the table showed, and its status. */
  values: Record<string, { v: number | null; shown: string; status: string; target: string }>;
  datedChecks: DatedCheckResult[];
}

export function toStored(card: Scorecard, issueNumber: number | null, emailed: boolean): StoredScorecard {
  return {
    checkpoint: card.checkpoint,
    preview: card.preview,
    generatedAt: card.generatedAt,
    issueNumber,
    emailed,
    missed: misses(card).length,
    values: Object.fromEntries(
      card.rows.map((r) => [r.id, { v: r.value, shown: r.shown, status: r.status, target: r.target }]),
    ),
    datedChecks: card.datedChecks,
  };
}

/** The newest finished scorecard run, any status: a FAILED run (issue or email not delivered) still stored its table. */
export async function latestScorecardRun(): Promise<{
  ranAt: string;
  status: string;
  summary: string | null;
  scorecard: StoredScorecard | null;
} | null> {
  const run = await prisma.automationRun.findFirst({
    where: { automation: SCORECARD_AUTOMATION, status: { not: "RUNNING" } },
    orderBy: { startedAt: "desc" },
    select: { startedAt: true, status: true, summary: true, metrics: true },
  });
  if (!run) return null;
  return { ranAt: run.startedAt.toISOString(), status: run.status, summary: run.summary, scorecard: asStored(run.metrics) };
}

function asStored(metrics: unknown): StoredScorecard | null {
  return metrics && typeof metrics === "object" && "values" in metrics ? (metrics as StoredScorecard) : null;
}

/** Last week's values from the newest successful run at least five days old; null if none or unreadable. */
async function loadPrevious(now: Date): Promise<Values | null> {
  try {
    const row = await prisma.automationRun.findFirst({
      where: { automation: SCORECARD_AUTOMATION, status: "SUCCESS", startedAt: { lte: new Date(now.getTime() - PREVIOUS_MIN_AGE_MS) } },
      orderBy: { startedAt: "desc" },
      select: { metrics: true },
    });
    const stored = asStored(row?.metrics)?.values;
    return stored ? Object.fromEntries(Object.entries(stored).map(([id, s]) => [id, { value: s.v }])) : null;
  } catch (err) {
    // Last week's values only feed the relative targets; without them those show "unjudged".
    console.error("[weekly-scorecard] couldn't read last week's run:", err);
    return null;
  }
}

/** The automated dated checks; a `DATED_CHECKS` id without an entry here fails to compile. */
const DATED_CHECK_RUNNERS: Record<AutomatedCheckId, (values: Values) => Promise<{ ok: boolean | null; detail: string }>> = {
  cp1_sitemap_read: async (values) => {
    const v = values.o1_sitemap_read;
    return { ok: v?.value == null ? null : v.value === 1, detail: v?.display ?? v?.note ?? "not available" };
  },
  cp2_horizon_180: horizon180Check,
  cp3_cohorts: postGateCohortCheck,
};

async function runDatedChecks(checkpoint: string | null, values: Promise<Values>): Promise<DatedCheckResult[]> {
  return Promise.all(
    DATED_CHECKS.filter((c) => c.checkpoint === checkpoint).map(async (c): Promise<DatedCheckResult> => {
      if ("manual" in c) return { id: c.id, title: c.title, ok: null, detail: `Manual: ${c.manual}` };
      try {
        return { id: c.id, title: c.title, ...(await DATED_CHECK_RUNNERS[c.id](await values)) };
      } catch (err) {
        return { id: c.id, title: c.title, ok: null, detail: `check failed: ${errText(err)}` };
      }
    }),
  );
}

export async function buildScorecard(
  now: Date,
  deps: { github: OpsGithub | null; gsc: GscSetup; fetchImpl?: typeof fetch },
): Promise<Scorecard> {
  const { checkpoint, preview } = checkpointFor(now);
  const cp = checkpoint?.id ?? null;
  const values = Promise.all([
    sqlMeasures(process.env.OWNER_EMAIL),
    githubMeasures(deps.github, now),
    soft404Measure(deps.fetchImpl),
    gscMeasures(deps.gsc, now, deps.fetchImpl),
    sentryMeasures(deps.fetchImpl),
  ]).then((parts): Values => Object.assign({}, MANUAL_MEASURES, ...parts));
  // Last week's values and the SQL-only dated checks don't wait for the (slow) measures.
  const [measured, previous, datedChecks] = await Promise.all([values, loadPrevious(now), runDatedChecks(cp, values)]);
  return { generatedAt: now.toISOString(), checkpoint: cp, preview, rows: evaluate(measured, cp, previous), datedChecks };
}

/**
 * File the checkpoint issue unless this run's marker is already on one. Never throws: a GitHub
 * failure comes back as the reason, and the run still stores its scorecard and sends the email.
 */
export async function fileCheckpointIssue(
  github: OpsGithub | null,
  card: Scorecard,
): Promise<{ number: number | null; reason: string }> {
  if (!github) return { number: null, reason: "no GitHub credential" };
  try {
    const marker = scorecardMarker(card);
    // The marker is date-scoped, so only issues touched since that UTC day can carry it.
    const since = new Date(`${card.generatedAt.slice(0, 10)}T00:00:00Z`);
    const recent = await github.listIssues({ labels: LANE_LABELS.decision, state: "all", sort: "created", since, limit: 50 });
    const existing = recent.find((i) => !i.pull && i.body.includes(marker));
    if (existing) return { number: existing.number, reason: "already filed" };
    const number = await github.createIssue({
      title: scorecardTitle(card),
      body: `${marker}\n${renderMarkdown(card)}`,
      labels: [LANE_LABELS.decision],
    });
    return { number, reason: "filed" };
  } catch (err) {
    return { number: null, reason: `github: ${errText(err)}` };
  }
}

export interface ScorecardRunResult {
  card: Scorecard;
  issue: { number: number | null; reason: string };
  email: NotifyResult;
  stored: StoredScorecard;
}

export async function runWeeklyScorecard(
  now: Date = new Date(),
  deps: { github?: OpsGithub | null; gsc?: GscSetup; fetchImpl?: typeof fetch; email?: typeof emailOwner } = {},
): Promise<ScorecardRunResult> {
  const github = deps.github === undefined ? safe(opsGithubFromEnv).client : deps.github;
  const gsc = deps.gsc ?? safe(() => gscFromEnv(deps.fetchImpl));
  const card = await buildScorecard(now, { github, gsc, fetchImpl: deps.fetchImpl });
  const issue = await fileCheckpointIssue(github, card);
  const issueUrl = issue.number ? `https://github.com/${repoName()}/issues/${issue.number}` : null;
  const email = await (deps.email ?? emailOwner)({
    subject: scorecardTitle(card),
    text: renderText(card, issueUrl),
    idempotencyKey: `weekly-scorecard/${card.checkpoint ?? "weekly"}/${card.generatedAt.slice(0, 10)}`,
  });
  return { card, issue, email, stored: toStored(card, issue.number, email.sent) };
}

/** Build a client without letting a bad env (malformed key or repo) fail the run. */
function safe<T>(build: () => T | null): { client: T | null; error?: string } {
  try {
    return { client: build() };
  } catch (err) {
    console.error("[weekly-scorecard] client setup failed:", err);
    return { client: null, error: errText(err) };
  }
}

function repoName(): string {
  try {
    return getValidatedRepo();
  } catch {
    return HASHTRACKS_REPO;
  }
}
