/**
 * Audit — Travel Mode prediction model evaluation.
 *
 * Steps back and measures how good Travel Mode's confidence-scored predictions
 * actually are, using the REAL projection engine (src/lib/travel/projections.ts)
 * so the numbers reflect exactly what the UI shows. Read-only.
 *
 * Three analyses (see docs/audits header + the approved plan):
 *
 *   Part A — Coverage census (forward-looking, "what we have today")
 *     Per visible kennel × horizon {30,60,90,180,365}d, classify into the single
 *     best forward signal: CONFIRMED / HIGH / MEDIUM / POSSIBLE / DARK. Answers
 *     "how many kennels do we KNOW have events 90/180d out" vs "how many can we
 *     CONFIDENTLY predict". Also grouped by region.
 *
 *   Part B — Backtest accuracy ("is the confidence honest?")
 *     Replays the engine as-of past reference dates {90,180}d ago over a 45-day
 *     test window that lies in the past, then checks each dated prediction
 *     against ACTUAL confirmed events. Precision/recall per confidence tier.
 *     CRITICAL: actuals are restricted to events backed by ≥1 non-STATIC_SCHEDULE
 *     RawEvent — a STATIC_SCHEDULE source *generates* its events by projecting the
 *     same rule, so matching against them would be circular. Precision/recall are
 *     computed only over "verifiable" kennels (≥1 independent actual in window).
 *
 *   Part C — Gap analysis & prioritized recommendations (feeds the next PR)
 *     Predictable-but-dark, under-rated LOW rules, contradicted rules,
 *     unfairly-degraded kennels, plus a threshold-tuning shortlist.
 *
 * Output: docs/audits/travel-predictions-<YYYY-MM-DD>.md + a .json sidecar of
 * raw counts. Re-runnable to track progress as data improves.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   npx tsx scripts/audit-travel-predictions.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import {
  EVENT_ELIGIBILITY_SELECT,
  isEligibleActual,
} from "@/lib/event-eligibility";
import { groupByRegion } from "@/lib/groupByRegion";
import {
  projectTrails,
  scoreConfidence,
  deduplicateAgainstConfirmed,
  projectionHorizonForStart,
  type ScheduleRuleInput,
  type ProjectedTrail,
  type KennelContext,
} from "@/lib/travel/projections";
import { utcNoon, addDays, fmtDate, pct, writeAuditReport } from "./lib/audit-shared";

// ──────────────────────────────────────────────────────────────────────────
// Tunables
// ──────────────────────────────────────────────────────────────────────────
const HORIZONS = [30, 60, 90, 180, 365] as const;
const BACKTEST_REFERENCES_DAYS_AGO = [90, 180] as const;
const BACKTEST_WINDOW_DAYS = 45;
const EVIDENCE_WINDOW_DAYS = 84; // ≈12 weeks, matches search.ts scoring window
const DAY_MS = 24 * 60 * 60 * 1000;
// "Regular history" threshold for the predictable-but-dark gap list.
const REGULAR_HISTORY_MIN_EVENTS_12W = 6;

type Bucket = "CONFIRMED" | "HIGH" | "MEDIUM" | "POSSIBLE" | "DARK";

// ──────────────────────────────────────────────────────────────────────────
// Loaded data shapes
// ──────────────────────────────────────────────────────────────────────────
interface EvDate {
  date: Date; // UTC noon
  startTime: string | null;
  /** Backed by ≥1 non-STATIC_SCHEDULE RawEvent → verifiable against independent data. */
  eligible: boolean;
}

interface KennelRow {
  id: string;
  shortName: string;
  fullName: string;
  region: string;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  lastEventDate: Date | null;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
}

interface RuleRow {
  id: string;
  kennelId: string;
  rrule: string;
  anchorDate: string | null;
  startTime: string | null;
  confidence: "HIGH" | "MEDIUM" | "LOW";
  notes: string | null;
  label: string | null;
  validFrom: string | null;
  validUntil: string | null;
  lastValidatedAt: Date | null;
}

// ──────────────────────────────────────────────────────────────────────────
// Small helpers (utcNoon/addDays/fmtDate/pct shared via ./lib/audit-shared)
// ──────────────────────────────────────────────────────────────────────────
function ruleToInput(r: RuleRow): ScheduleRuleInput {
  return {
    id: r.id,
    kennelId: r.kennelId,
    rrule: r.rrule,
    anchorDate: r.anchorDate,
    startTime: r.startTime,
    confidence: r.confidence,
    notes: r.notes,
    label: r.label,
    validFrom: r.validFrom,
    validUntil: r.validUntil,
  };
}
function kennelCtx(k: KennelRow, lastEventDateAsOf: Date | null): KennelContext {
  return {
    id: k.id,
    shortName: k.shortName,
    scheduleDayOfWeek: k.scheduleDayOfWeek,
    scheduleTime: k.scheduleTime,
    scheduleFrequency: k.scheduleFrequency,
    lastEventDate: lastEventDateAsOf,
  };
}

/**
 * Whether a dated projection would be visible to a traveler whose trip covers
 * its date, applying the same horizon gating as filterProjectionsByHorizon but
 * per-projection-date (faithful for a census whose window spans many distances):
 *   ≤180d → all (high+medium), 181–365d → high only, >365d → none.
 */
function projectionVisible(proj: ProjectedTrail, reference: Date): boolean {
  if (!proj.date) return false;
  const tier = projectionHorizonForStart(proj.date, reference);
  if (tier === "none") return false;
  if (tier === "high") return proj.confidence === "high";
  return proj.confidence === "high" || proj.confidence === "medium";
}

// ──────────────────────────────────────────────────────────────────────────
// Scoring (mirrors search.ts scoreProjections, but with an injected reference)
// ──────────────────────────────────────────────────────────────────────────
function scoreProjectionsAsOf(
  projections: ProjectedTrail[],
  kennel: KennelRow,
  evidenceCount: number,
  reference: Date,
  ruleValidation: Map<string, Date | null>,
  lastEventDateAsOf: Date | null,
): ProjectedTrail[] {
  const ctx = kennelCtx(kennel, lastEventDateAsOf);
  const nowMs = reference.getTime();
  return projections.map((proj) => ({
    ...proj,
    confidence: scoreConfidence(
      proj.confidence,
      ctx,
      evidenceCount,
      ruleValidation.get(proj.scheduleRuleId) ?? null,
      nowMs,
    ),
  }));
}

// ──────────────────────────────────────────────────────────────────────────
// Per-kennel event index helpers
// ──────────────────────────────────────────────────────────────────────────
function eventsInRange(events: EvDate[], start: Date, end: Date): EvDate[] {
  return events.filter((e) => e.date >= start && e.date <= end);
}
function lastEventOnOrBefore(events: EvDate[], ref: Date): Date | null {
  let best: Date | null = null;
  for (const e of events) {
    if (e.date <= ref && (best === null || e.date > best)) best = e.date;
  }
  return best;
}

// ──────────────────────────────────────────────────────────────────────────
// PART A — Coverage census
// ──────────────────────────────────────────────────────────────────────────
interface CensusRow {
  kennel: KennelRow;
  buckets: Record<number, Bucket>; // horizon → bucket
}

function censusForKennel(
  kennel: KennelRow,
  rules: RuleRow[],
  events: EvDate[],
  today: Date,
): CensusRow {
  const hasRule = rules.length > 0;
  const maxHorizonEnd = addDays(today, Math.max(...HORIZONS));

  // Project once over the full horizon, score as-of today, dedup against
  // confirmed events the kennel has in the full window (UI never double-lists).
  let visibleDated: ProjectedTrail[] = [];
  if (hasRule) {
    const ruleInputs = rules.map(ruleToInput);
    const raw = projectTrails(ruleInputs, today, maxHorizonEnd);
    const ruleValidation = new Map<string, Date | null>(
      rules.map((r) => [r.id, r.lastValidatedAt]),
    );
    const evidenceCount = eventsInRange(
      events,
      addDays(today, -EVIDENCE_WINDOW_DAYS),
      today,
    ).length;
    const scored = scoreProjectionsAsOf(
      raw,
      kennel,
      evidenceCount,
      today,
      ruleValidation,
      kennel.lastEventDate,
    );
    const confirmedRefs = eventsInRange(events, today, maxHorizonEnd).map((e) => ({
      kennelId: kennel.id,
      date: e.date,
      startTime: e.startTime,
    }));
    const deduped = deduplicateAgainstConfirmed(scored, confirmedRefs);
    visibleDated = deduped.filter((p) => p.date && projectionVisible(p, today));
  }

  const buckets: Record<number, Bucket> = {};
  for (const H of HORIZONS) {
    const end = addDays(today, H);
    const confirmedInWindow = eventsInRange(events, today, end).length > 0;
    if (confirmedInWindow) {
      buckets[H] = "CONFIRMED";
      continue;
    }
    const datedInWindow = visibleDated.filter((p) => p.date! > today && p.date! <= end);
    if (datedInWindow.some((p) => p.confidence === "high")) {
      buckets[H] = "HIGH";
    } else if (datedInWindow.some((p) => p.confidence === "medium")) {
      buckets[H] = "MEDIUM";
    } else if (hasRule) {
      // Has a schedule rule but no confident dated hit lands in this window →
      // travel mode would surface it as "possible activity" / low.
      buckets[H] = "POSSIBLE";
    } else {
      buckets[H] = "DARK";
    }
  }
  return { kennel, buckets };
}

function tallyCensus(rows: CensusRow[]): Record<number, Record<Bucket, number>> {
  const out: Record<number, Record<Bucket, number>> = {};
  for (const H of HORIZONS) {
    out[H] = { CONFIRMED: 0, HIGH: 0, MEDIUM: 0, POSSIBLE: 0, DARK: 0 };
  }
  for (const r of rows) {
    for (const H of HORIZONS) out[H][r.buckets[H]]++;
  }
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// PART B — Backtest accuracy
// ──────────────────────────────────────────────────────────────────────────
interface TierStat {
  predictions: number;
  matchStrict: number; // ±0 days
  matchLoose: number; // ±1 day
}
interface BacktestResult {
  referenceDaysAgo: number;
  reference: Date;
  windowEnd: Date;
  high: TierStat;
  medium: TierStat;
  // Recall: eligible actuals (at verifiable kennels-with-rules) covered by ANY prediction.
  eligibleActuals: number;
  eligibleActualsCovered: number;
  // Kennels contributing to precision/recall (had ≥1 eligible actual in window).
  verifiableKennels: number;
  // Kennels skipped because no independent actual existed to verify against.
  unverifiableKennels: number;
  // False-negative coverage gap: eligible actuals at kennels with NO active rule.
  ruleless: { kennels: number; eligibleActuals: number };
}

function matchWithin(actuals: Date[], target: Date, tolDays: number): boolean {
  const lo = target.getTime() - tolDays * DAY_MS;
  const hi = target.getTime() + tolDays * DAY_MS;
  return actuals.some((d) => d.getTime() >= lo && d.getTime() <= hi);
}

function backtest(
  kennels: KennelRow[],
  rulesByKennel: Map<string, RuleRow[]>,
  eventsByKennel: Map<string, EvDate[]>,
  referenceDaysAgo: number,
  today: Date,
): BacktestResult {
  const reference = addDays(today, -referenceDaysAgo);
  const windowEnd = addDays(reference, BACKTEST_WINDOW_DAYS);
  const high: TierStat = { predictions: 0, matchStrict: 0, matchLoose: 0 };
  const medium: TierStat = { predictions: 0, matchStrict: 0, matchLoose: 0 };
  let eligibleActuals = 0;
  let eligibleActualsCovered = 0;
  let verifiableKennels = 0;
  let unverifiableKennels = 0;
  const ruleless = { kennels: 0, eligibleActuals: 0 };

  for (const k of kennels) {
    const events = eventsByKennel.get(k.id) ?? [];
    const actualsInWindow = eventsInRange(events, reference, windowEnd);
    const eligible = actualsInWindow.filter((e) => e.eligible).map((e) => e.date);
    const rules = rulesByKennel.get(k.id) ?? [];

    if (rules.length === 0) {
      if (eligible.length > 0) {
        ruleless.kennels++;
        ruleless.eligibleActuals += eligible.length;
      }
      continue;
    }

    // Only verifiable against independent data.
    if (eligible.length === 0) {
      unverifiableKennels++;
      continue;
    }
    verifiableKennels++;

    // Project + score AS-OF the reference date. No dedup-against-confirmed here:
    // we WANT to keep predictions to compare them against actuals.
    const ruleInputs = rules.map(ruleToInput);
    const raw = projectTrails(ruleInputs, reference, windowEnd);
    const ruleValidation = new Map<string, Date | null>(
      // Treat validation as unknown as-of R — don't assume future validation existed.
      rules.map((r) => [r.id, null]),
    );
    const evidenceCount = eventsInRange(
      events,
      addDays(reference, -EVIDENCE_WINDOW_DAYS),
      reference,
    ).length;
    const lastEventAsOf = lastEventOnOrBefore(events, reference);
    const scored = scoreProjectionsAsOf(
      raw,
      k,
      evidenceCount,
      reference,
      ruleValidation,
      lastEventAsOf,
    );
    const dated = scored.filter(
      (p): p is ProjectedTrail & { date: Date } =>
        p.date !== null && projectionVisible(p, reference),
    );

    for (const p of dated) {
      const tier = p.confidence === "high" ? high : p.confidence === "medium" ? medium : null;
      if (!tier) continue;
      tier.predictions++;
      if (matchWithin(eligible, p.date, 0)) tier.matchStrict++;
      if (matchWithin(eligible, p.date, 1)) tier.matchLoose++;
    }

    // Recall: each eligible actual covered by ANY dated prediction (±1d).
    const predictedDates = dated.map((p) => p.date);
    for (const a of eligible) {
      eligibleActuals++;
      if (matchWithin(predictedDates, a, 1)) eligibleActualsCovered++;
    }
  }

  return {
    referenceDaysAgo,
    reference,
    windowEnd,
    high,
    medium,
    eligibleActuals,
    eligibleActualsCovered,
    verifiableKennels,
    unverifiableKennels,
    ruleless,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// PART C — Gap analysis
// ──────────────────────────────────────────────────────────────────────────
interface GapLists {
  predictableButDark: { kennel: KennelRow; events12w: number; weekdayConsistency: string }[];
  underRated: { kennel: KennelRow; events12w: number; rrule: string }[];
  contradicted: { kennel: KennelRow; rrule: string; precision: string; predictions: number }[];
}

/** Dominant weekday + how dominant, over a set of event dates. */
function weekdayConsistency(dates: Date[]): { day: number; share: number } {
  const counts = new Array(7).fill(0);
  for (const d of dates) counts[d.getUTCDay()]++;
  let best = 0;
  for (let i = 1; i < 7; i++) if (counts[i] > counts[best]) best = i;
  const total = dates.length || 1;
  return { day: best, share: counts[best] / total };
}
const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function buildGapLists(
  kennels: KennelRow[],
  rulesByKennel: Map<string, RuleRow[]>,
  eventsByKennel: Map<string, EvDate[]>,
  today: Date,
): GapLists {
  const predictableButDark: GapLists["predictableButDark"] = [];
  const underRated: GapLists["underRated"] = [];
  const twelveWeeksAgo = addDays(today, -EVIDENCE_WINDOW_DAYS);

  for (const k of kennels) {
    const events = eventsByKennel.get(k.id) ?? [];
    const recent = eventsInRange(events, twelveWeeksAgo, today);
    // Only independent (non-STATIC_SCHEDULE) history counts as "real activity"
    // — STATIC_SCHEDULE events are themselves rule projections.
    const realRecent = recent.filter((e) => e.eligible).map((e) => e.date);
    const rules = rulesByKennel.get(k.id) ?? [];
    const wc = weekdayConsistency(realRecent);

    if (rules.length === 0) {
      if (realRecent.length >= REGULAR_HISTORY_MIN_EVENTS_12W && wc.share >= 0.7) {
        predictableButDark.push({
          kennel: k,
          events12w: realRecent.length,
          weekdayConsistency: `${WEEKDAY[wc.day]} ${(wc.share * 100).toFixed(0)}%`,
        });
      }
      continue;
    }

    // Under-rated: only LOW rules, but history is highly regular → promotable.
    const allLow = rules.every((r) => r.confidence === "LOW");
    if (
      allLow &&
      realRecent.length >= REGULAR_HISTORY_MIN_EVENTS_12W &&
      wc.share >= 0.7
    ) {
      underRated.push({
        kennel: k,
        events12w: realRecent.length,
        rrule: rules.map((r) => r.rrule).join(" | "),
      });
    }
  }

  predictableButDark.sort((a, b) => b.events12w - a.events12w);
  underRated.sort((a, b) => b.events12w - a.events12w);
  return { predictableButDark, underRated, contradicted: [] };
}

/**
 * Contradicted rules: HIGH/MEDIUM rules whose predicted dates the independent
 * history does NOT support. Computed over the union of both backtest windows —
 * a verifiable kennel whose per-kennel precision (±1d) is low.
 */
function buildContradicted(
  kennels: KennelRow[],
  rulesByKennel: Map<string, RuleRow[]>,
  eventsByKennel: Map<string, EvDate[]>,
  today: Date,
): GapLists["contradicted"] {
  const out: GapLists["contradicted"] = [];
  for (const k of kennels) {
    const rules = rulesByKennel.get(k.id) ?? [];
    if (rules.length === 0) continue;
    const hasConfident = rules.some((r) => r.confidence !== "LOW");
    if (!hasConfident) continue;
    const events = eventsByKennel.get(k.id) ?? [];

    let predictions = 0;
    let matches = 0;
    for (const daysAgo of BACKTEST_REFERENCES_DAYS_AGO) {
      const reference = addDays(today, -daysAgo);
      const windowEnd = addDays(reference, BACKTEST_WINDOW_DAYS);
      const eligible = eventsInRange(events, reference, windowEnd)
        .filter((e) => e.eligible)
        .map((e) => e.date);
      if (eligible.length === 0) continue; // unverifiable in this window
      const raw = projectTrails(rules.map(ruleToInput), reference, windowEnd);
      const evidenceCount = eventsInRange(
        events,
        addDays(reference, -EVIDENCE_WINDOW_DAYS),
        reference,
      ).length;
      const lastEventAsOf = lastEventOnOrBefore(events, reference);
      const ruleValidation = new Map<string, Date | null>(rules.map((r) => [r.id, null]));
      const scored = scoreProjectionsAsOf(
        raw,
        k,
        evidenceCount,
        reference,
        ruleValidation,
        lastEventAsOf,
      );
      for (const p of scored) {
        if (!p.date || p.confidence === "low") continue;
        predictions++;
        if (matchWithin(eligible, p.date, 1)) matches++;
      }
    }
    // Flag kennels with a decent number of predictions but poor hit rate.
    if (predictions >= 3 && matches / predictions < 0.5) {
      out.push({
        kennel: k,
        rrule: rules.map((r) => r.rrule).join(" | "),
        precision: pct(matches, predictions),
        predictions,
      });
    }
  }
  out.sort((a, b) => a.predictions - b.predictions);
  return out;
}

// ──────────────────────────────────────────────────────────────────────────
// Markdown rendering
// ──────────────────────────────────────────────────────────────────────────
function renderCensusTable(tally: Record<number, Record<Bucket, number>>, total: number): string {
  const lines: string[] = [
    "| Horizon | Confirmed | High | Medium | Possible | Dark | Confident (Conf+High+Med) |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const H of HORIZONS) {
    const t = tally[H];
    const confident = t.CONFIRMED + t.HIGH + t.MEDIUM;
    lines.push(
      `| ${H}d | ${t.CONFIRMED} (${pct(t.CONFIRMED, total)}) | ${t.HIGH} | ${t.MEDIUM} | ${t.POSSIBLE} | ${t.DARK} | ${confident} (${pct(confident, total)}) |`,
    );
  }
  return lines.join("\n");
}

function renderRegionCensus(rows: CensusRow[]): string {
  const items = rows.map((r) => ({
    region: r.kennel.region || "(no region)",
    shortName: r.kennel.shortName,
    row: r,
  }));
  const grouped = groupByRegion(items);
  const lines: string[] = [
    "Bucket at the **90-day** horizon, per region (C=confirmed, H=high, M=medium, P=possible, D=dark).",
    "",
    "| Region | Kennels | C | H | M | P | D | Confident% |",
    "|---|---|---|---|---|---|---|---|",
  ];
  for (const g of grouped) {
    const t: Record<Bucket, number> = { CONFIRMED: 0, HIGH: 0, MEDIUM: 0, POSSIBLE: 0, DARK: 0 };
    for (const it of g.items) t[it.row.buckets[90]]++;
    const n = g.items.length;
    const confident = t.CONFIRMED + t.HIGH + t.MEDIUM;
    lines.push(
      `| ${g.region} | ${n} | ${t.CONFIRMED} | ${t.HIGH} | ${t.MEDIUM} | ${t.POSSIBLE} | ${t.DARK} | ${pct(confident, n)} |`,
    );
  }
  return lines.join("\n");
}

function renderTierStat(name: string, s: TierStat): string {
  return `| ${name} | ${s.predictions} | ${s.matchStrict} (${pct(s.matchStrict, s.predictions)}) | ${s.matchLoose} (${pct(s.matchLoose, s.predictions)}) |`;
}

function renderBacktest(b: BacktestResult): string {
  const lines: string[] = [
    `### Reference: ${b.referenceDaysAgo} days ago (${fmtDate(b.reference)} → ${fmtDate(b.windowEnd)})`,
    "",
    `Verifiable kennels (≥1 independent actual in window): **${b.verifiableKennels}**. ` +
      `Excluded as unverifiable (rule but no independent actual): ${b.unverifiableKennels}.`,
    "",
    "**Precision** — of the dates we predicted, how many had a real (independent) event:",
    "",
    "| Tier | Predictions | Hit ±0d | Hit ±1d |",
    "|---|---|---|---|",
    renderTierStat("HIGH", b.high),
    renderTierStat("MEDIUM", b.medium),
    "",
    `**Recall** — eligible actual events covered by some prediction (±1d): ` +
      `**${b.eligibleActualsCovered}/${b.eligibleActuals}** (${pct(b.eligibleActualsCovered, b.eligibleActuals)}).`,
    "",
    `**Coverage gap (false negatives)** — independent events at kennels with NO schedule rule: ` +
      `${b.ruleless.eligibleActuals} events across ${b.ruleless.kennels} kennels.`,
    "",
  ];
  const hp = b.high.matchLoose / (b.high.predictions || 1);
  const mp = b.medium.matchLoose / (b.medium.predictions || 1);
  let verdict: string;
  if (b.high.predictions === 0 && b.medium.predictions === 0) {
    verdict = "⚠️ No verifiable predictions in this window — too little independent history to score.";
  } else if (hp >= mp) {
    verdict = `✅ Ordering holds (HIGH ${pct(b.high.matchLoose, b.high.predictions)} ≥ MEDIUM ${pct(b.medium.matchLoose, b.medium.predictions)} at ±1d).`;
  } else {
    verdict = `❌ Inversion: MEDIUM ${pct(b.medium.matchLoose, b.medium.predictions)} > HIGH ${pct(b.high.matchLoose, b.high.predictions)} at ±1d — confidence labels are mis-calibrated.`;
  }
  lines.push(`**Calibration verdict:** ${verdict}`, "");
  return lines.join("\n");
}

function renderGapLists(gaps: GapLists, contradicted: GapLists["contradicted"]): string {
  const lines: string[] = [];

  lines.push(
    "### C.1 — Predictable-but-dark (biggest coverage win)",
    "",
    `Kennels with regular independent history (≥${REGULAR_HISTORY_MIN_EVENTS_12W} events in 12w, ≥70% on one weekday) but **no schedule rule**. Adding a rule turns these from DARK into HIGH/MEDIUM. **${gaps.predictableButDark.length} found.**`,
    "",
  );
  if (gaps.predictableButDark.length) {
    lines.push("| Kennel | Region | Events 12w | Dominant day |", "|---|---|---|---|");
    for (const g of gaps.predictableButDark.slice(0, 30)) {
      lines.push(`| ${g.kennel.shortName} | ${g.kennel.region} | ${g.events12w} | ${g.weekdayConsistency} |`);
    }
    if (gaps.predictableButDark.length > 30) lines.push("", `*…and ${gaps.predictableButDark.length - 30} more*`);
  } else {
    lines.push("*(none)*");
  }
  lines.push("");

  lines.push(
    "### C.2 — Under-rated LOW rules (promote / add anchor)",
    "",
    `Kennels whose only rules are LOW but whose independent history is highly regular — candidates to promote LOW→MEDIUM/HIGH or add an anchorDate. **${gaps.underRated.length} found.**`,
    "",
  );
  if (gaps.underRated.length) {
    lines.push("| Kennel | Region | Events 12w | Rule(s) |", "|---|---|---|---|");
    for (const g of gaps.underRated.slice(0, 30)) {
      lines.push(`| ${g.kennel.shortName} | ${g.kennel.region} | ${g.events12w} | \`${g.rrule}\` |`);
    }
    if (gaps.underRated.length > 30) lines.push("", `*…and ${gaps.underRated.length - 30} more*`);
  } else {
    lines.push("*(none)*");
  }
  lines.push("");

  lines.push(
    "### C.3 — Contradicted rules (rule likely wrong)",
    "",
    `HIGH/MEDIUM rules with ≥3 verifiable predictions but <50% hit rate (±1d) against independent history. The RRULE/anchor probably needs fixing. **${contradicted.length} found.**`,
    "",
  );
  if (contradicted.length) {
    lines.push("| Kennel | Region | Precision (±1d) | Predictions | Rule(s) |", "|---|---|---|---|---|");
    for (const g of contradicted.slice(0, 30)) {
      lines.push(`| ${g.kennel.shortName} | ${g.kennel.region} | ${g.precision} | ${g.predictions} | \`${g.rrule}\` |`);
    }
    if (contradicted.length > 30) lines.push("", `*…and ${contradicted.length - 30} more*`);
  } else {
    lines.push("*(none)*");
  }
  lines.push("");
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
async function loadData(prisma: PrismaClient, today: Date) {
  const kennels: KennelRow[] = await prisma.kennel.findMany({
    where: { isHidden: false },
    select: {
      id: true,
      shortName: true,
      fullName: true,
      region: true,
      country: true,
      latitude: true,
      longitude: true,
      lastEventDate: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
    },
  });

  const rules = (await prisma.scheduleRule.findMany({
    where: { isActive: true, kennel: { isHidden: false } },
    select: {
      id: true,
      kennelId: true,
      rrule: true,
      anchorDate: true,
      startTime: true,
      confidence: true,
      notes: true,
      label: true,
      validFrom: true,
      validUntil: true,
      lastValidatedAt: true,
    },
  })) as RuleRow[];

  // Confirmed canonical events across the span we need: back far enough for
  // backtest evidence/last-event-as-of (≈180d + 84d) and forward for census (365d).
  const loadStart = addDays(today, -(Math.max(...BACKTEST_REFERENCES_DAYS_AGO) + EVIDENCE_WINDOW_DAYS + 30));
  const loadEnd = addDays(today, Math.max(...HORIZONS) + 1);
  const events = await prisma.event.findMany({
    where: {
      ...CANONICAL_EVENT_WHERE,
      status: "CONFIRMED",
      date: { gte: loadStart, lte: loadEnd },
      kennel: { isHidden: false },
    },
    select: {
      kennelId: true,
      date: true,
      startTime: true,
      eventKennels: { select: { kennelId: true } },
      ...EVENT_ELIGIBILITY_SELECT,
    },
  });

  // Index events by every participating kennel (primary + co-hosts).
  const eventsByKennel = new Map<string, EvDate[]>();
  for (const e of events) {
    const eligible = isEligibleActual(e);
    const participating = new Set<string>([e.kennelId, ...e.eventKennels.map((ek) => ek.kennelId)]);
    const ev: EvDate = { date: e.date, startTime: e.startTime, eligible };
    for (const kid of participating) {
      const arr = eventsByKennel.get(kid) ?? [];
      arr.push(ev);
      eventsByKennel.set(kid, arr);
    }
  }

  const rulesByKennel = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const arr = rulesByKennel.get(r.kennelId) ?? [];
    arr.push(r);
    rulesByKennel.set(r.kennelId, arr);
  }

  return { kennels, rulesByKennel, eventsByKennel, eventCount: events.length };
}

async function runAudit(prisma: PrismaClient): Promise<void> {
  const today = utcNoon(new Date());
  console.log("🔭 AUDIT — Travel Mode prediction model\n");

  const { kennels, rulesByKennel, eventsByKennel, eventCount } = await loadData(prisma, today);
  console.log(
    `Loaded ${kennels.length} visible kennels, ${[...rulesByKennel.values()].reduce((a, b) => a + b.length, 0)} active rules, ${eventCount} confirmed events.\n`,
  );

  // Part A
  const census = kennels.map((k) =>
    censusForKennel(k, rulesByKennel.get(k.id) ?? [], eventsByKennel.get(k.id) ?? [], today),
  );
  const tally = tallyCensus(census);
  console.log("Census (kennels per bucket):");
  for (const H of HORIZONS) {
    const t = tally[H];
    console.log(`  ${H}d → C:${t.CONFIRMED} H:${t.HIGH} M:${t.MEDIUM} P:${t.POSSIBLE} D:${t.DARK}`);
  }

  // Part B
  const backtests = BACKTEST_REFERENCES_DAYS_AGO.map((daysAgo) =>
    backtest(kennels, rulesByKennel, eventsByKennel, daysAgo, today),
  );

  // Part C
  const gaps = buildGapLists(kennels, rulesByKennel, eventsByKennel, today);
  const contradicted = buildContradicted(kennels, rulesByKennel, eventsByKennel, today);

  // ── Markdown ──
  const date = fmtDate(today);
  const total = kennels.length;
  const md: string[] = [];
  md.push(
    `# Travel Mode prediction evaluation — ${date}`,
    "",
    "Generated by `scripts/audit-travel-predictions.ts` (read-only) against prod, using the",
    "real projection engine in `src/lib/travel/projections.ts`. Re-run to track progress.",
    "",
    "## Part A — Coverage census",
    "",
    `Each of the **${total}** visible kennels classified into its single best forward signal at each horizon.`,
    "Buckets: **Confirmed** (real event in window) · **High/Medium** (confident dated prediction) ·",
    "**Possible** (has a schedule rule but no confident hit in window) · **Dark** (no rule + no event → travel mode shows nothing).",
    "",
    renderCensusTable(tally, total),
    "",
    "> Note on the 365-day column: a Medium rule still counts here via its NEAR projections (≤180d),",
    "> which are always visible from today. Horizon gating only strips Medium for trips that *start* >180d out.",
    "",
    "### By region",
    "",
    renderRegionCensus(census),
    "",
    "## Part B — Backtest accuracy (is the confidence honest?)",
    "",
    "Replays the engine as-of a past date and checks predictions against ACTUAL events.",
    "**Actuals are restricted to events backed by ≥1 non-STATIC_SCHEDULE source** — matching a rule",
    "against STATIC_SCHEDULE-generated events would be circular (the source *is* the rule). Precision/recall",
    "are computed only over kennels with ≥1 such independent actual in the window.",
    "",
  );
  for (const b of backtests) md.push(renderBacktest(b));
  md.push(
    "## Part C — Gap analysis & recommendations",
    "",
    renderGapLists(gaps, contradicted),
    "### C.4 — Threshold-tuning shortlist",
    "",
    "Concrete knobs in `scoreConfidence()` / horizon bounds to revisit, each driven by the numbers above:",
    "",
    "- **MEDIUM→HIGH boost (`confirmedEventCount >= 3` & validated <30d):** compare HIGH vs MEDIUM precision in Part B. If MEDIUM ±1d precision is already ≳HIGH, the boost bar may be too high (or the 30-day validation gate too strict, since most rules lack `lastValidatedAt`).",
    "- **MEDIUM→LOW on zero evidence:** how many kennels sit in POSSIBLE purely because `confirmedEventCount === 0`? Cross-check against C.1/C.2 — these are recoverable with better evidence windows or backfill.",
    "- **Kennel-inactive degrade (`lastEventDate > 90d` → HIGH→MEDIUM):** count HIGH rules degraded only by staleness whose history is otherwise regular (unfairly-degraded). If large, widen to 120–135d.",
    "- **Horizon bounds (180/365):** Part A shows how much MEDIUM coverage exists between 180–365d that the UI currently hides for late-start trips. If material, consider surfacing MEDIUM further out with a stronger caveat.",
    "",
    "---",
    "",
    "*Re-run: `npx tsx scripts/audit-travel-predictions.ts`. Same-day re-runs overwrite the report.*",
    "",
  );

  // JSON sidecar of raw counts.
  const json = {
    generatedAt: new Date().toISOString(),
    referenceDate: date,
    totalVisibleKennels: total,
    census: tally,
    backtests: backtests.map((b) => ({
      referenceDaysAgo: b.referenceDaysAgo,
      window: [fmtDate(b.reference), fmtDate(b.windowEnd)],
      verifiableKennels: b.verifiableKennels,
      unverifiableKennels: b.unverifiableKennels,
      high: b.high,
      medium: b.medium,
      recall: { covered: b.eligibleActualsCovered, total: b.eligibleActuals },
      rulelessGap: b.ruleless,
    })),
    gaps: {
      predictableButDark: gaps.predictableButDark.length,
      underRated: gaps.underRated.length,
      contradicted: contradicted.length,
    },
  };
  const { mdPath, jsonPath } = writeAuditReport(`travel-predictions-${date}`, md.join("\n"), json);

  console.log(`\nWrote report → ${mdPath}`);
  console.log(`Wrote JSON   → ${jsonPath}`);
}

async function main(): Promise<void> {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await runAudit(prisma);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
