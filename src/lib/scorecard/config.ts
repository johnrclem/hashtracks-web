/**
 * The November–December 2026 round's scorecard: objectives O1–O10, their measures and the target
 * at each checkpoint. Source: plan v3.2 section 2
 * (`~/.claude/plans/hashtracks-next-round-2026-11/next-round-plan.md`), approved 25 Nov 2026.
 *
 * Change a target here, in a PR, and the next weekly run judges against it. A new round replaces
 * this file's CHECKPOINTS and MEASURES.
 */

export type CheckpointId = "CP1" | "CP2" | "CP3" | "CP4";

export interface Checkpoint {
  id: CheckpointId;
  /** The Monday the weekly cron runs it, UTC date. */
  date: string;
}

export const CHECKPOINTS: readonly Checkpoint[] = [
  { id: "CP1", date: "2026-11-30" },
  { id: "CP2", date: "2026-12-07" },
  { id: "CP3", date: "2026-12-14" },
  { id: "CP4", date: "2026-12-21" },
];

/** A measure's value this week; null when the server has no source for it yet. */
export interface MeasureValue {
  value: number | null;
  /** What the table shows instead of the bare number, e.g. "21/22 OK", "12 of 829". */
  display?: string;
  /** Why it's not available, or a caveat on how it was read. */
  note?: string;
  /**
   * Only part of the population was read (a weekly slice, a sweep cut short), so the value is a
   * lower bound: it can meet an "at least" target but never miss one.
   */
  partial?: boolean;
}

export type Values = Record<string, MeasureValue>;

export type Target =
  | { kind: "atLeast"; value: number }
  | { kind: "atMost"; value: number }
  | { kind: "tracked" }
  /** Judged against other measures or last week's value (e.g. "falling week over week"). */
  | { kind: "relative"; describe: string; judge(value: number, values: Values, previous: Values | null): boolean | null };

export interface Measure {
  id: string;
  objective: string;
  label: string;
  baseline: string;
  unit?: "%" | "h" | "min";
  /** Targets by checkpoint. A checkpoint without its own target is judged against the next one's, as "not yet". */
  targets: Partial<Record<CheckpointId, Target>>;
  /** A guardrail: a miss is a regression, not a shortfall. */
  guardrail?: boolean;
}

const tracked: Target = { kind: "tracked" };
const atLeast = (value: number): Target => ({ kind: "atLeast", value });
const atMost = (value: number): Target => ({ kind: "atMost", value });

export const MEASURES: readonly Measure[] = [
  // O1 Findable on search
  { id: "o1_sitemap_read", objective: "O1", label: "Sitemap: GSC read within 7 days, 0 errors (1 = yes)", baseline: "Couldn't fetch", targets: { CP2: atLeast(1), CP4: atLeast(1) } },
  { id: "o1_hubs_indexed", objective: "O1", label: "Kennel + region sitemap URLs indexed (URL Inspection)", baseline: "~3", targets: { CP2: atLeast(25), CP4: atLeast(150) } },
  { id: "o1_impressions_28d", objective: "O1", label: "Search impressions, last 28 days", baseline: "~10", targets: { CP2: tracked, CP4: atLeast(300) } },
  { id: "o1_soft404_families", objective: "O1", label: "Soft-404 route families (unknown id answers 200)", baseline: "3", targets: { CP2: atMost(3), CP4: atMost(0) } },
  // O2 Real people use it
  { id: "o2_active_users_28d", objective: "O2", label: "Active non-owner users, 28 days (check-ins)", baseline: "1", targets: { CP2: tracked, CP4: atLeast(3) } },
  { id: "o2_human_visitors_week", objective: "O2", label: "Human visitors per week (bot-filtered)", baseline: "unknown", targets: { CP2: tracked, CP4: tracked } },
  // O3 Repair catches up
  { id: "o3_defects_closed_week", objective: "O3", label: "lane:defect closed as completed, 7 days", baseline: "5", targets: {
    CP2: atLeast(15),
    CP4: { kind: "relative", describe: "≥ this week's inflow", judge: (v, values) => (values.o3_defects_opened_week?.value == null ? null : v >= values.o3_defects_opened_week.value) },
  } },
  { id: "o3_defects_opened_week", objective: "O3", label: "lane:defect opened, 7 days (inflow)", baseline: "~33", targets: { CP2: tracked, CP4: tracked } },
  { id: "o3_open_defects", objective: "O3", label: "Open lane:defect", baseline: "115", targets: {
    CP2: atMost(160),
    CP4: { kind: "relative", describe: "below last week", judge: (v, _values, prev) => (prev?.o3_open_defects?.value == null ? null : v < prev.o3_open_defects.value) },
  } },
  { id: "o3_not_planned_share", objective: "O3", label: "Guard: not-planned share of lane:defect closes, 7 days", baseline: "—", unit: "%", targets: { CP2: atMost(20), CP4: atMost(20) }, guardrail: true },
  { id: "o3_reopened_share", objective: "O3", label: "Guard: closes reopened within 30 days", baseline: "—", unit: "%", targets: { CP2: atMost(10), CP4: atMost(10) }, guardrail: true },
  // O4 Owner isn't the bottleneck
  { id: "o4_oldest_waiting_h", objective: "O4", label: "Oldest agent/workstream PR waiting on owner", baseline: "247 h", unit: "h", targets: { CP2: atMost(72), CP4: atMost(36) } },
  { id: "o4_waiting_prs", objective: "O4", label: "Agent/workstream PRs waiting on owner", baseline: "10", targets: { CP2: atMost(7), CP4: atMost(6) } },
  { id: "o4_handoffs_self_merged", objective: "O4", label: "Research handoff PRs (opened 2–14 days ago) merged", baseline: "0 of 2", unit: "%", targets: { CP2: atLeast(100), CP4: atLeast(100) } },
  // O5 Automations produce
  { id: "o5_watchdog_not_ok", objective: "O5", label: "Watchdog: automations not OK", baseline: "0 (22/22)", targets: { CP1: atMost(0), CP2: atMost(0), CP3: atMost(0), CP4: atMost(0) }, guardrail: true },
  { id: "o5_agent_prs_merged_week", objective: "O5", label: "Fixer + implementer PRs merged, 7 days", baseline: "0", targets: { CP2: atLeast(3), CP4: atLeast(5) } },
  // O6 Sources healthy
  { id: "o6_failing_sources", objective: "O6", label: "Failing enabled sources", baseline: "17", targets: { CP2: atMost(10), CP4: atMost(5) } },
  { id: "o6_alerts_week", objective: "O6", label: "Alerts created, 7 days", baseline: "66", targets: { CP2: atMost(55), CP4: atMost(40) } },
  { id: "o6_scrape_success_7d", objective: "O6", label: "Scrape success, 7 days", baseline: "98.4%", unit: "%", targets: { CP1: atLeast(98.4), CP2: atLeast(98.4), CP3: atLeast(98.4), CP4: atLeast(98.4) }, guardrail: true },
  // O7 Listings alive and honest
  { id: "o7_dark_dispositions", objective: "O7", label: "Dark kennels (95) with a recorded disposition", baseline: "0", targets: { CP2: atLeast(30), CP4: atLeast(95) } },
  { id: "o7_dark_to_live", objective: "O7", label: "Dark kennels moved to live", baseline: "0", targets: { CP2: atLeast(3), CP4: atLeast(10) } },
  // Counts what the listings show, through WS11's display fragment; the rows stay stored for Travel.
  { id: "o7_projections_beyond_horizon", objective: "O7", label: "Unposted runs >90 days out shown on listings (schedule-only or no source data)", baseline: "2048 (before WS11)", targets: { CP2: atMost(0), CP4: atMost(0) } },
  { id: "o7_far_future_rows", objective: "O7", label: "Far-future rows >365 days (bobbh3, pormeh3, bullmoon)", baseline: "351", targets: { CP2: atMost(0), CP4: atMost(0) } },
  { id: "o7_kennels_real_run_60d", objective: "O7", label: "Kennels with a real run in the next 60 days", baseline: "309", targets: { CP2: tracked, CP4: tracked } },
  // O8 Audit pipeline fast
  { id: "o8_finding_filed_median_min", objective: "O8", label: "Finding → filed median, 7 days", baseline: "50 min", unit: "min", targets: { CP1: atMost(90), CP2: atMost(90), CP3: atMost(90), CP4: atMost(90) }, guardrail: true },
  // O9 Coverage grows
  { id: "o9_new_kennels_week", objective: "O9", label: "New visible kennels created, 7 days", baseline: "0", targets: { CP2: atLeast(2), CP4: atLeast(3) } },
  { id: "o9_handoff_to_live_median", objective: "O9", label: "Handoff → live median", baseline: "unknown", targets: { CP2: tracked, CP4: tracked } },
  // O10 Safe and stable
  { id: "o10_ruleset_on", objective: "O10", label: "Active ruleset rules on main (>0 = on)", baseline: "off", targets: { CP2: atLeast(1), CP4: atLeast(1) } },
  { id: "o10_sentry_n1_week", objective: "O10", label: "Sentry events, scrape-route N+1, 7 days", baseline: "~125", targets: { CP2: atMost(25), CP4: atMost(25) } },
  { id: "o10_sentry_other_week", objective: "O10", label: "Other Sentry error events, 7 days", baseline: "measured at CP1", targets: { CP2: tracked, CP4: tracked } },
];

/** The Sentry issue for the scrape-route N+1 (O10). */
export const SENTRY_N1_ISSUE = "JAVASCRIPT-NEXTJS-3";

/** WS3's evidence gate merged here (PR #2779); later 30-day snapshots are its first cohorts. */
export const PREDICTION_GATE_MERGED_AT = "2026-11-07T14:20:10Z";

/**
 * One-off checks tied to a checkpoint (plan section 9). An automated check runs from
 * `DATED_CHECK_RUNNERS` in `run.ts`, keyed by its id; a manual one is done by the checkpoint
 * review session.
 */
export type AutomatedCheckId = "cp1_sitemap_read" | "cp2_horizon_180" | "cp3_cohorts";

export type DatedCheck =
  | { id: AutomatedCheckId; checkpoint: CheckpointId; title: string }
  | { id: string; checkpoint: CheckpointId; title: string; manual: string };

export const DATED_CHECKS: readonly DatedCheck[] = [
  { id: "cp1_sitemap_read", checkpoint: "CP1", title: "Google reads the sitemap (GSC sitemap status)" },
  { id: "cp2_horizon_180", checkpoint: "CP2", title: "180-day prediction horizon: first matured 180-day snapshots" },
  {
    id: "cp2_usage",
    checkpoint: "CP2",
    title: "Vercel and Railway usage",
    manual: "Read this month's usage in the Vercel and Railway dashboards (`vercel` CLI, Railway MCP) and note anything above plan.",
  },
  { id: "cp3_cohorts", checkpoint: "CP3", title: "First post-gate 30-day cohorts: HIGH precision should beat MEDIUM" },
  {
    id: "cp4_round_close",
    checkpoint: "CP4",
    title: "Round close",
    manual: "Summarise the round against every objective and draft the next round's plan.",
  },
];
