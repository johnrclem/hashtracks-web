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
import { getValidatedRepo } from "@/lib/github-repo";
import { gscFromEnv, type Gsc } from "@/lib/gsc/client";
import { emailOwner, type NotifyResult } from "@/lib/notify";
import { opsGithubFromEnv, type OpsGithub } from "@/lib/ops-github";

import { DATED_CHECKS, type Values } from "./config";
import { checkpointFor, evaluate, misses, renderMarkdown, renderText, scorecardTitle, type DatedCheckResult, type Scorecard } from "./evaluate";
import {
  githubMeasures,
  gscMeasures,
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

/** Last week's values from the newest successful run at least five days old. */
async function loadPrevious(now: Date): Promise<Values | null> {
  const row = await prisma.automationRun.findFirst({
    where: { automation: SCORECARD_AUTOMATION, status: "SUCCESS", startedAt: { lte: new Date(now.getTime() - PREVIOUS_MIN_AGE_MS) } },
    orderBy: { startedAt: "desc" },
    select: { metrics: true },
  });
  const stored = (row?.metrics as unknown as Partial<StoredScorecard> | null)?.values;
  if (!stored) return null;
  return Object.fromEntries(Object.entries(stored).map(([id, s]) => [id, { value: s.v }]));
}

async function runDatedChecks(checkpoint: string | null, values: Values): Promise<DatedCheckResult[]> {
  const due = DATED_CHECKS.filter((c) => c.checkpoint === checkpoint);
  return Promise.all(
    due.map(async (c): Promise<DatedCheckResult> => {
      if (c.manual) return { id: c.id, title: c.title, ok: null, detail: `Manual: ${c.manual}` };
      try {
        if (c.id === "cp1_sitemap_read") {
          const v = values.o1_sitemap_read;
          return { id: c.id, title: c.title, ok: v?.value == null ? null : v.value === 1, detail: v?.display ?? v?.note ?? "not available" };
        }
        if (c.id === "cp2_horizon_180") return { id: c.id, title: c.title, ...(await horizon180Check()) };
        if (c.id === "cp3_cohorts") return { id: c.id, title: c.title, ...(await postGateCohortCheck()) };
        return { id: c.id, title: c.title, ok: null, detail: "no implementation; the review checks it" };
      } catch (err) {
        return { id: c.id, title: c.title, ok: null, detail: `check failed: ${err instanceof Error ? err.message : String(err)}` };
      }
    }),
  );
}

export async function buildScorecard(
  now: Date,
  deps: { github: OpsGithub | null; gsc: Gsc | null; gscError?: string; fetchImpl?: typeof fetch },
): Promise<Scorecard> {
  const { checkpoint, preview } = checkpointFor(now);
  const parts = await Promise.all([
    sqlMeasures(process.env.OWNER_EMAIL),
    githubMeasures(deps.github, now),
    soft404Measure(deps.fetchImpl),
    gscMeasures(deps.gsc, now, deps.fetchImpl, deps.gscError),
    sentryMeasures(deps.fetchImpl),
  ]);
  const values: Values = Object.assign({}, MANUAL_MEASURES, ...parts);
  const previous = await loadPrevious(now);
  const card: Scorecard = {
    generatedAt: now.toISOString(),
    checkpoint: checkpoint?.id ?? null,
    preview,
    rows: evaluate(values, checkpoint?.id ?? null, previous),
    datedChecks: await runDatedChecks(checkpoint?.id ?? null, values),
  };
  return card;
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
    const recent = await github.listIssues({ labels: LANE_LABELS.decision, state: "all", sort: "created", limit: 50 });
    const existing = recent.find((i) => !i.pull && i.body.includes(marker));
    if (existing) return { number: existing.number, reason: "already filed" };
    const number = await github.createIssue({
      title: scorecardTitle(card),
      body: `${marker}\n${renderMarkdown(card)}`,
      labels: [LANE_LABELS.decision],
    });
    return { number, reason: "filed" };
  } catch (err) {
    return { number: null, reason: `github: ${err instanceof Error ? err.message : String(err)}` };
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
  deps: { github?: OpsGithub | null; gsc?: Gsc | null; fetchImpl?: typeof fetch; email?: typeof emailOwner } = {},
): Promise<ScorecardRunResult> {
  const github = deps.github === undefined ? safe(opsGithubFromEnv).client : deps.github;
  const gscSetup = deps.gsc === undefined ? safe(() => gscFromEnv(deps.fetchImpl)) : { client: deps.gsc };
  const card = await buildScorecard(now, { github, gsc: gscSetup.client, gscError: gscSetup.error, fetchImpl: deps.fetchImpl });
  const issue = await fileCheckpointIssue(github, card);
  const issueUrl = issue.number ? `https://github.com/${safeRepo()}/issues/${issue.number}` : null;
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
    return { client: null, error: err instanceof Error ? err.message : String(err) };
  }
}

function safeRepo(): string {
  try {
    return getValidatedRepo();
  } catch {
    return "johnrclem/hashtracks-web";
  }
}
