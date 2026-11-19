/**
 * One-shot relabel for ops plan S1: give every open issue exactly one lane label, and retire
 * `alert` from audit issues.
 *
 *   npx tsx scripts/relabel-open-issues-lanes.ts                       # dry run: list every open issue
 *   npx tsx scripts/relabel-open-issues-lanes.ts --set 2048=coverage   # override one proposal
 *   npx tsx scripts/relabel-open-issues-lanes.ts --apply [--set …]     # write to GitHub
 *
 * The dry run prints each open issue with its proposed lane, why, and whether it drops `alert`,
 * then the count per lane. `--apply` writes only after the owner has approved that list: it
 * creates any missing lane label, adds each issue's lane and removes `alert` from audit issues.
 * An issue with no proposal (not an audit issue and no label that implies a lane) is left alone
 * unless `--set <number>=<lane>` names one. Re-running is safe: an issue that already has its
 * lane and no `alert` needs no write.
 *
 * Reads `GITHUB_TOKEN` and `GITHUB_REPOSITORY` from the environment or `.env`.
 */
import "dotenv/config";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  AUDIT_LABEL,
  LANE_LABEL_META,
  LANE_LABELS,
  isLane,
  NEEDS_DECISION_LABEL,
  ONBOARDING_CANDIDATE_LABEL,
  laneForRule,
  type Lane,
} from "@/lib/audit-labels";
import { parseAuditIdentity } from "@/lib/audit-canonical";
import { getValidatedRepo } from "@/lib/github-repo";
import { extractLabelNames, resolveLane, type GitHubIssue } from "@/pipeline/audit-issue-sync";
import { DRIFT_LABEL } from "@/pipeline/rule-drift";

const ALERT_LABEL = "alert";
const FIXER_SKIP_LABEL = "audit-fixer:skip";
const USER_FEEDBACK_LABEL = "user-feedback";
const ENHANCEMENT_LABEL = "enhancement";

const API_ORIGIN = "https://api.github.com";
const TIMEOUT_MS = 15_000;
const PER_PAGE = 100;
const MAX_PAGES = 10;
/** GitHub asks integrations to leave a second between writes. */
const WRITE_GAP_MS = 1_000;

export interface OpenIssue {
  number: number;
  title: string;
  body: string;
  labels: string[];
}

export interface Proposal {
  lane: Lane | null;
  reason: string;
  /** The issue already carries more than one lane label; the owner untangles it by hand. */
  conflict?: true;
}

export interface PlannedChange {
  issue: OpenIssue;
  lane: Lane | null;
  reason: string;
  /** Labels to add: the lane, plus `onboarding-candidate` on a coverage issue without it. */
  addLabels: string[];
  dropAlert: boolean;
  /** `--set` named a different lane than the one the issue already has; nothing is written. */
  overrideRejected?: true;
}

/**
 * The lane an open issue belongs in, from its labels and, for audit issues, the rule in its
 * identity marker. The first rule that matches wins.
 */
export function proposeLane(issue: OpenIssue): Proposal {
  const labels = new Set(issue.labels);
  // The same one-lane rule the mirror applies.
  const existing = resolveLane(issue.labels);
  if (existing.conflict) return { lane: null, reason: "conflict: more than one lane label", conflict: true };
  if (existing.lane) return { lane: existing.lane, reason: "already labelled" };

  if (labels.has(NEEDS_DECISION_LABEL)) return { lane: "decision", reason: NEEDS_DECISION_LABEL };
  if (labels.has(ONBOARDING_CANDIDATE_LABEL)) return { lane: "coverage", reason: ONBOARDING_CANDIDATE_LABEL };
  if (labels.has(AUDIT_LABEL)) return proposeAuditLane(issue, labels);
  if (labels.has(DRIFT_LABEL)) return { lane: "defect", reason: DRIFT_LABEL };
  if (labels.has(USER_FEEDBACK_LABEL)) return { lane: "decision", reason: USER_FEEDBACK_LABEL };
  if (labels.has(ENHANCEMENT_LABEL)) return { lane: "decision", reason: ENHANCEMENT_LABEL };
  return { lane: null, reason: "no rule matches; pass --set" };
}

/** An audit issue's lane: the same rule → lane mapping the filers use for new issues. */
function proposeAuditLane(issue: OpenIssue, labels: ReadonlySet<string>): Proposal {
  const ruleSlug = parseAuditIdentity(issue.body)?.ruleSlug;
  const ruleLane = ruleSlug ? laneForRule(ruleSlug) : "defect";
  if (ruleLane !== "defect") return { lane: ruleLane, reason: `rule ${ruleSlug}` };
  // The fixer has already looked at these and handed them back: they need a supervised
  // session or the owner's call.
  if (labels.has(FIXER_SKIP_LABEL)) return { lane: "decision", reason: FIXER_SKIP_LABEL };
  return { lane: "defect", reason: ruleSlug ? `rule ${ruleSlug}` : "audit finding" };
}

/** Each issue's lane (an override wins over the proposal) and the label writes it needs. */
export function planRelabel(
  issues: readonly OpenIssue[],
  overrides: ReadonlyMap<number, Lane> = new Map(),
): PlannedChange[] {
  return issues.map((issue) => {
    const proposal = proposeLane(issue);
    const override = overrides.get(issue.number);
    // An override never stacks a second lane label: it applies only to an issue without one
    // (adding a label doesn't remove the old lane), and a conflict is untangled by hand.
    const hasLane = proposal.conflict || proposal.reason === "already labelled";
    const overrideRejected = override !== undefined && hasLane && override !== proposal.lane;
    const useOverride = override !== undefined && !overrideRejected;
    const lane = useOverride ? override : proposal.lane;
    const reason = overrideRejected
      ? `--set ${override} rejected: ${proposal.reason}`
      : useOverride
        ? `--set (proposed: ${proposal.lane ?? "none"})`
        : proposal.reason;
    const wanted = lane ? [LANE_LABELS[lane], ...(lane === "coverage" ? [ONBOARDING_CANDIDATE_LABEL] : [])] : [];
    const addLabels = overrideRejected ? [] : wanted.filter((label) => !issue.labels.includes(label));
    const dropAlert = !overrideRejected && issue.labels.includes(AUDIT_LABEL) && issue.labels.includes(ALERT_LABEL);
    return { issue, lane, reason, addLabels, dropAlert, ...(overrideRejected ? { overrideRejected: true as const } : {}) };
  });
}

/** Parse `--apply` and `--set <number>=<lane>` (repeatable); `null` on bad usage. */
export function parseArgs(args: readonly string[]): { apply: boolean; overrides: Map<number, Lane> } | null {
  const overrides = new Map<number, Lane>();
  let apply = false;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--apply") {
      apply = true;
      continue;
    }
    if (arg !== "--set") return null;
    const match = /^(\d+)=([a-z]+)$/.exec(args[i + 1] ?? "");
    const lane = match?.[2];
    const issueNumber = Number(match?.[1]);
    if (!match || !lane || !isLane(lane) || !Number.isSafeInteger(issueNumber) || issueNumber <= 0) return null;
    overrides.set(issueNumber, lane);
    i += 1;
  }
  return { apply, overrides };
}

function needsWrite(change: PlannedChange): boolean {
  return change.addLabels.length > 0 || change.dropAlert;
}

/**
 * Problems that stop `--apply` before any write: an override naming an issue that isn't open,
 * or one rejected because the issue already has a different lane.
 */
export function overrideProblems(plan: readonly PlannedChange[], overrides: ReadonlyMap<number, Lane>): string[] {
  const open = new Set(plan.map((c) => c.issue.number));
  return [
    ...[...overrides.keys()].filter((n) => !open.has(n)).map((n) => `--set ${n}: not an open issue`),
    ...plan.filter((c) => c.overrideRejected).map((c) => `#${c.issue.number}: ${c.reason}`),
  ];
}

/** The dry-run listing: one line per issue, then the count per lane. */
export function formatPlan(plan: readonly PlannedChange[]): string {
  const lines = plan.map((c) => {
    const lane = c.lane ? LANE_LABELS[c.lane] : "(no lane)";
    const change = [...c.addLabels.map((label) => `+${label}`), ...(c.dropAlert ? [`-${ALERT_LABEL}`] : [])].join(" ");
    return `#${c.issue.number}\t${lane}\t${change || "no change"}\t${c.reason}\t${c.issue.title}`;
  });
  const perLane = new Map<string, number>();
  for (const c of plan) {
    const key = c.lane ? LANE_LABELS[c.lane] : "(no lane)";
    perLane.set(key, (perLane.get(key) ?? 0) + 1);
  }
  const counts = [...perLane.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([k, n]) => `${k}: ${n}`);
  const writes = plan.filter(needsWrite).length;
  const dropped = plan.filter((c) => c.dropAlert).length;
  return [
    "number\tlane\tchange\treason\ttitle",
    ...lines,
    "",
    `${plan.length} open issues. ${counts.join(", ")}.`,
    `${writes} issues need a write; ${dropped} drop \`${ALERT_LABEL}\`.`,
  ].join("\n");
}

// ── GitHub ──

function headers(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function github(token: string, pathname: string, init: RequestInit = {}): Promise<Response> {
  // Every path is built in this file, and the URL constructor plus the origin check pin each
  // request to api.github.com.
  const url = new URL(`/repos/${getValidatedRepo()}${pathname}`, API_ORIGIN);
  if (url.origin !== API_ORIGIN) throw new Error(`Refusing a request off ${API_ORIGIN}: ${url.origin}`);
  // nosemgrep: rules_lgpl_javascript_ssrf_rule-node-ssrf
  return fetch(url, { ...init, headers: headers(token), signal: AbortSignal.timeout(TIMEOUT_MS) });
}

function issueNumberPath(issueNumber: number): string {
  if (!Number.isInteger(issueNumber) || issueNumber <= 0) throw new Error(`Invalid issue number: ${issueNumber}`);
  return `/issues/${issueNumber}`;
}

async function fetchOpenIssues(token: string): Promise<OpenIssue[]> {
  const issues: OpenIssue[] = [];
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const res = await github(token, `/issues?state=open&per_page=${PER_PAGE}&page=${page}`);
    if (!res.ok) throw new Error(`GitHub list issues page ${page}: HTTP ${res.status}`);
    const batch = (await res.json()) as Array<{
      number: number;
      title: string;
      body: string | null;
      labels: GitHubIssue["labels"];
      pull_request?: unknown;
    }>;
    for (const raw of batch) {
      if (raw.pull_request) continue;
      issues.push({
        number: raw.number,
        title: raw.title,
        body: raw.body ?? "",
        labels: extractLabelNames(raw.labels),
      });
    }
    if (batch.length < PER_PAGE) return issues.sort((a, b) => a.number - b.number);
  }
  throw new Error(`More than ${MAX_PAGES * PER_PAGE} open issues; raise MAX_PAGES`);
}

async function ensureLaneLabels(token: string): Promise<void> {
  for (const [name, meta] of Object.entries(LANE_LABEL_META)) {
    const existing = await github(token, `/labels/${encodeURIComponent(name)}`);
    if (existing.ok) continue;
    if (existing.status !== 404) throw new Error(`GitHub get label ${name}: HTTP ${existing.status}`);
    const res = await github(token, "/labels", { method: "POST", body: JSON.stringify({ name, ...meta }) });
    if (!res.ok) throw new Error(`GitHub create label ${name}: HTTP ${res.status}`);
    console.log(`created label ${name}`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** GitHub is throttling the batch; the remaining writes would only fail too. */
class ThrottledError extends Error {}

function check(res: Response, what: string): void {
  if (res.ok) return;
  const throttled = res.status === 429 || (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
  const retryAfter = res.headers.get("retry-after");
  const message = `${what}: HTTP ${res.status}${retryAfter ? ` (retry after ${retryAfter}s)` : ""}`;
  throw throttled ? new ThrottledError(message) : new Error(message);
}

async function applyChange(token: string, change: PlannedChange): Promise<void> {
  const base = issueNumberPath(change.issue.number);
  if (change.addLabels.length > 0) {
    const res = await github(token, `${base}/labels`, { method: "POST", body: JSON.stringify({ labels: change.addLabels }) });
    check(res, `add ${change.addLabels.join(", ")}`);
    await sleep(WRITE_GAP_MS);
  }
  if (change.dropAlert) {
    const res = await github(token, `${base}/labels/${ALERT_LABEL}`, { method: "DELETE" });
    // 404: already gone, which is the goal.
    if (res.status !== 404) check(res, `remove ${ALERT_LABEL}`);
    await sleep(WRITE_GAP_MS);
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args) {
    console.error("usage: npx tsx scripts/relabel-open-issues-lanes.ts [--apply] [--set <number>=<lane> …]");
    process.exit(2);
  }
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error("GITHUB_TOKEN is not set");

  const plan = planRelabel(await fetchOpenIssues(token), args.overrides);
  console.log(formatPlan(plan));
  const problems = overrideProblems(plan, args.overrides);
  for (const problem of problems) console.error(problem);
  if (!args.apply) {
    console.log("\nDry run: nothing written. Re-run with --apply once the owner has approved this list.");
    return;
  }
  if (problems.length > 0) {
    console.error("\nNothing written: fix the --set problems above first.");
    process.exit(2);
  }

  await ensureLaneLabels(token);
  const failures: string[] = [];
  for (const change of plan.filter(needsWrite)) {
    try {
      await applyChange(token, change);
    } catch (err) {
      failures.push(`#${change.issue.number}: ${err instanceof Error ? err.message : String(err)}`);
      if (err instanceof ThrottledError) {
        failures.push("Stopped: GitHub is throttling. Re-run later; finished issues need no write.");
        break;
      }
    }
  }
  console.log(`\nApplied. ${failures.length} failure(s).`);
  for (const failure of failures) console.error(failure);
  if (failures.length > 0) process.exitCode = 1;
}

const isEntrypoint =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isEntrypoint) {
  main().catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
