/**
 * Propose schedule-rule fixes from independent event history (read-only).
 *
 * Phase 1 of the Travel Mode prediction-quality work. For every visible kennel, derives the
 * schedule its REAL independent events imply and compares it to the kennel's current ScheduleRule,
 * bucketing into:
 *   C.3 contradicted   — has a HIGH/MEDIUM dated rule whose weekday disagrees with reality
 *   C.2 under-rated     — only LOW rules (biweekly/monthly sentinels) but a regular real cadence
 *   C.1 predictable-dark — no active rule but a regular real cadence
 * and emits a proposed rrule (+ anchorDate / seasonal split) for each.
 *
 * Honesty guards (per Codex review):
 * - Derivation uses only days 28–200 ago; the most recent 4 weeks are HELD OUT.
 * - Each proposal is scored on that holdout window via the REAL projection engine (projectTrails),
 *   alongside the current rule, so we report generalization — not a fit to the same data.
 * - "Independent" = isEligibleActual (≥1 non-STATIC_SCHEDULE RawEvent); STATIC_SCHEDULE-generated
 *   events never count as ground truth.
 *
 * Output: docs/audits/rule-fix-proposals-<YYYY-MM-DD>.md + .json. No writes to the DB.
 *
 * Usage:
 *   npx tsx scripts/propose-rule-fixes.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import { EVENT_ELIGIBILITY_SELECT, isEligibleActual } from "@/lib/event-eligibility";
import { projectTrails, type ScheduleRuleInput } from "@/lib/travel/projections";
import { utcNoon, addDays, fmtDate, pct, writeAuditReport } from "./lib/audit-shared";

// ──────────────────────────────────────────────────────────────────────────
// Tunables
// ──────────────────────────────────────────────────────────────────────────
const DERIV_START_DAYS_AGO = 200;
const DERIV_END_DAYS_AGO = 28; // most recent 4 weeks held out for validation
const HOLDOUT_DAYS = 28;
const DAY_MS = 24 * 60 * 60 * 1000;
const MIN_EVENTS_DERIV = 6; // need this many independent events to propose anything
const MIN_DOMINANT_SHARE = 0.6; // dominant weekday must be ≥60% of events
const MATCH_TOL_DAYS = 1;

const RRULE_DAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"] as const;
const DAY_NAME = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

type Bucket = "C3" | "C2" | "C1";

interface KennelRow {
  id: string;
  shortName: string;
  region: string;
  scheduleNotes: string | null;
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
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers (utcNoon/addDays/fmtDate/pct shared via ./lib/audit-shared)
// ──────────────────────────────────────────────────────────────────────────
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Weekday histogram + dominant day over a set of dates. */
function weekdayStats(dates: Date[]): { hist: number[]; dom: number; share: number } {
  const hist = new Array(7).fill(0);
  for (const d of dates) hist[d.getUTCDay()]++;
  let dom = 0;
  for (let i = 1; i < 7; i++) if (hist[i] > hist[dom]) dom = i;
  const total = dates.length || 1;
  return { hist, dom, share: hist[dom] / total };
}

/**
 * Median gap (days) between consecutive run DATES → cadence label.
 *
 * Collapses same-date events to distinct run days first. Many kennels publish
 * two (or more) events per run day — Walkers @10:00 / Runners @11:00 pace
 * splits, A-to-B legs, etc. (RDH3 does this on ~90% of its run days). Event
 * dates are stored as UTC noon, so co-day rows share an identical getTime();
 * without the dedupe they contribute 0-day gaps and a monthly kennel's median
 * cadence collapses to "weekly" — the spurious "~0d median gap" anomaly.
 * Cadence is a property of run days, not event rows.
 */
function cadenceOf(dates: Date[]): { medianGap: number; cadence: "weekly" | "biweekly" | "monthly" | "irregular" } {
  const distinct = [...new Set(dates.map((d) => d.getTime()))].sort((a, b) => a - b);
  if (distinct.length < 2) return { medianGap: 0, cadence: "irregular" };
  const gaps: number[] = [];
  for (let i = 1; i < distinct.length; i++) gaps.push((distinct[i] - distinct[i - 1]) / DAY_MS);
  const g = median(gaps);
  let cadence: "weekly" | "biweekly" | "monthly" | "irregular";
  if (g <= 10) cadence = "weekly";
  else if (g <= 21) cadence = "biweekly";
  else if (g <= 45) cadence = "monthly";
  else cadence = "irregular";
  return { medianGap: Math.round(g), cadence };
}

/**
 * Seasonality probe: compare CORE summer (May–Aug) vs CORE winter (Nov–Feb), skipping the shoulder
 * months (Mar/Apr, Sep/Oct) where the switch happens — half-year buckets blur the boundary and miss
 * real switchers (the Summit/FH3/Beantown class). Matches the seasonal-detector SQL.
 */
function seasonalitySplit(dates: Date[]): { seasonal: boolean; summerDay: number | null; winterDay: number | null } {
  const inMonths = (d: Date, months: number[]) => months.includes(d.getUTCMonth());
  const summer = dates.filter((d) => inMonths(d, [4, 5, 6, 7])); // May–Aug
  const winter = dates.filter((d) => inMonths(d, [10, 11, 0, 1])); // Nov–Feb
  if (summer.length < 3 || winter.length < 3) return { seasonal: false, summerDay: null, winterDay: null };
  const s = weekdayStats(summer);
  const w = weekdayStats(winter);
  const seasonal = s.dom !== w.dom && s.share >= MIN_DOMINANT_SHARE && w.share >= MIN_DOMINANT_SHARE;
  return { seasonal, summerDay: s.dom, winterDay: w.dom };
}

/** Days spanned by the independent history — used to gate confident flat rules (<1yr = risky). */
function historySpanDays(dates: Date[]): number {
  if (dates.length < 2) return 0;
  // `dates` arrives sorted ascending from the caller (buildProposal's `allIndependent`), so the
  // span is just last − first — no need to scan for min/max.
  const min = dates[0].getTime();
  const max = dates[dates.length - 1].getTime();
  return Math.round((max - min) / (24 * 60 * 60 * 1000));
}
/** Below this much history, a flat weekly rule might be hiding an unseen season. */
const MIN_SPAN_FOR_FLAT_RULE = 330;

/** Current rule's BYDAY weekday index, if the rrule encodes a single weekday. */
function ruleWeekday(rrule: string): number | null {
  const m = /BYDAY=(?:[1-5-]?)([A-Z]{2})/.exec(rrule);
  if (!m) return null;
  return RRULE_DAY.indexOf(m[1] as (typeof RRULE_DAY)[number]);
}

function eventsInRange(dates: Date[], start: Date, end: Date): Date[] {
  return dates.filter((d) => d >= start && d <= end);
}

/** Run a candidate rule through the real engine over the holdout window; count ±tol hits. */
function holdoutHits(
  rule: ScheduleRuleInput,
  holdoutStart: Date,
  holdoutEnd: Date,
  actuals: Date[],
): { predicted: number; hits: number } {
  const projections = projectTrails([rule], holdoutStart, holdoutEnd).filter((p) => p.date);
  let hits = 0;
  for (const p of projections) {
    const lo = p.date!.getTime() - MATCH_TOL_DAYS * DAY_MS;
    const hi = p.date!.getTime() + MATCH_TOL_DAYS * DAY_MS;
    if (actuals.some((a) => a.getTime() >= lo && a.getTime() <= hi)) hits++;
  }
  return { predicted: projections.length, hits };
}

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

// ──────────────────────────────────────────────────────────────────────────
// Proposal model
// ──────────────────────────────────────────────────────────────────────────
interface Proposal {
  bucket: Bucket;
  kennel: KennelRow;
  derivEvents: number;
  domDay: number;
  domShare: number;
  medianGap: number;
  cadence: string;
  seasonal: boolean;
  // Recent (held-out 4w) signal — flags kennels that CHANGED their day since the derivation window.
  recentEvents: number;
  recentDomDay: number | null;
  changed: boolean;
  anchorDate: string | null;
  currentRules: string;
  proposedRrule: string;
  proposedKind: "flat-weekly" | "anchored-biweekly" | "seasonal" | "manual-review";
  manualReviewNote: string | null;
  holdoutCurrent: { predicted: number; hits: number };
  holdoutProposed: { predicted: number; hits: number };
}

function buildProposal(
  kennel: KennelRow,
  rules: RuleRow[],
  allIndependent: Date[],
  today: Date,
): Proposal | null {
  const derivStart = addDays(today, -DERIV_START_DAYS_AGO);
  const derivEnd = addDays(today, -DERIV_END_DAYS_AGO);
  const holdoutStart = addDays(today, -HOLDOUT_DAYS);

  const deriv = eventsInRange(allIndependent, derivStart, derivEnd);
  if (deriv.length < MIN_EVENTS_DERIV) return null;

  const { dom, share } = weekdayStats(deriv);
  if (share < MIN_DOMINANT_SHARE) return null; // too scattered to propose a weekday rule
  const { medianGap, cadence } = cadenceOf(deriv);
  const season = seasonalitySplit(deriv);
  const anchorDate = deriv.length ? fmtDate(deriv[deriv.length - 1]) : null; // latest deriv event

  // Recent-window weekday: if the held-out 4 weeks show a DIFFERENT dominant day than the
  // derivation window, the kennel likely changed its schedule (e.g. FH3 Sun→Thu, Beantown Wed→Sun).
  // Surface it as a flag so the reviewer trusts recent over the derivation-based proposal.
  const recent = eventsInRange(allIndependent, holdoutStart, today);
  const recentStats = recent.length >= 3 ? weekdayStats(recent) : null;
  const changed = recentStats !== null && recentStats.dom !== dom && recentStats.share >= MIN_DOMINANT_SHARE;
  const recentDomDay = recentStats ? recentStats.dom : null;

  // Decide bucket from current rule state.
  const hasConfidentDated = rules.some((r) => r.confidence !== "LOW" && /BYDAY=/.test(r.rrule));
  const onlyLow = rules.length > 0 && rules.every((r) => r.confidence === "LOW");
  const noRule = rules.length === 0;

  let bucket: Bucket;
  if (hasConfidentDated) {
    const ruleDay = rules.map((r) => ruleWeekday(r.rrule)).find((d) => d !== null) ?? null;
    if (ruleDay === dom && !season.seasonal) return null; // rule already agrees with reality
    bucket = "C3";
  } else if (onlyLow) {
    bucket = "C2";
  } else if (noRule) {
    bucket = "C1";
  } else {
    return null;
  }

  // Build the proposed rule.
  let proposedRrule: string;
  let kind: Proposal["proposedKind"];
  let manualNote: string | null = null;

  if (season.seasonal && season.summerDay !== null && season.winterDay !== null) {
    proposedRrule = `Apr–Sep FREQ=WEEKLY;BYDAY=${RRULE_DAY[season.summerDay]} | Oct–Mar FREQ=WEEKLY;BYDAY=${RRULE_DAY[season.winterDay]}`;
    kind = "seasonal";
    manualNote = "Seasonal split — author as scheduleRules[] with validFrom/validUntil; verify boundaries.";
  } else if (cadence === "weekly") {
    proposedRrule = `FREQ=WEEKLY;BYDAY=${RRULE_DAY[dom]}`;
    kind = "flat-weekly";
  } else if (cadence === "biweekly") {
    proposedRrule = `FREQ=WEEKLY;INTERVAL=2;BYDAY=${RRULE_DAY[dom]}`;
    kind = "anchored-biweekly";
  } else {
    proposedRrule = `(${cadence}, ${DAY_NAME[dom]}) — gap≈${medianGap}d`;
    kind = "manual-review";
    manualNote = cadence === "monthly"
      ? "Monthly cadence — needs an ordinal (nth weekday) or BYMONTHDAY; author by hand."
      : "Irregular cadence — not safely projectable; consider leaving LOW or hand-authoring.";
  }

  // A recent day-change makes the derivation-based weekday stale → flag for the reviewer.
  if (changed && recentDomDay !== null) {
    const tail = `⚠ recent 4w runs are ${DAY_NAME[recentDomDay]} (${recent.length} ev), not ${DAY_NAME[dom]} — schedule likely changed; trust recent.`;
    manualNote = manualNote ? `${manualNote} ${tail}` : tail;
  }

  // Guardrail (anti-Summit): never lock in a confident flat weekly rule from <1 full annual cycle —
  // the unseen season may switch the weekday. Flag it for review instead of flattening.
  const spanDays = historySpanDays(allIndependent);
  if (kind === "flat-weekly" && spanDays < MIN_SPAN_FOR_FLAT_RULE) {
    const tail = `⚠ only ${spanDays}d of history (<1yr) — could be seasonal; verify a full annual cycle before locking a flat rule.`;
    manualNote = manualNote ? `${manualNote} ${tail}` : tail;
  }

  // Holdout scoring (real engine) for current rules vs the proposed rule.
  const holdoutActuals = recent;
  const currentInputs = rules.map(ruleToInput);
  const currentAgg = currentInputs.reduce(
    (acc, ri) => {
      const h = holdoutHits(ri, holdoutStart, today, holdoutActuals);
      return { predicted: acc.predicted + h.predicted, hits: acc.hits + h.hits };
    },
    { predicted: 0, hits: 0 },
  );

  let proposedHold = { predicted: 0, hits: 0 };
  if (kind === "flat-weekly" || kind === "anchored-biweekly") {
    const proposedInput: ScheduleRuleInput = {
      id: "proposed",
      kennelId: kennel.id,
      rrule: proposedRrule,
      anchorDate: kind === "anchored-biweekly" ? anchorDate : null,
      startTime: null,
      confidence: "MEDIUM",
      notes: null,
      label: null,
      validFrom: null,
      validUntil: null,
    };
    proposedHold = holdoutHits(proposedInput, holdoutStart, today, holdoutActuals);
  }

  return {
    bucket,
    kennel,
    derivEvents: deriv.length,
    domDay: dom,
    domShare: share,
    medianGap,
    cadence,
    seasonal: season.seasonal,
    recentEvents: recent.length,
    recentDomDay,
    changed,
    anchorDate,
    currentRules: rules.length ? rules.map((r) => r.rrule).join(" | ") : "(none)",
    proposedRrule,
    proposedKind: kind,
    manualReviewNote: manualNote,
    holdoutCurrent: currentAgg,
    holdoutProposed: proposedHold,
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Rendering
// ──────────────────────────────────────────────────────────────────────────
const BUCKET_TITLE: Record<Bucket, string> = {
  C3: "C.3 — Contradicted rules (rule disagrees with real history)",
  C2: "C.2 — Under-rated LOW rules (promote / anchor)",
  C1: "C.1 — Predictable-but-dark (no rule, regular history)",
};

function renderBucket(bucket: Bucket, proposals: Proposal[]): string {
  const rows = proposals.filter((p) => p.bucket === bucket);
  const lines = [
    `### ${BUCKET_TITLE[bucket]} — ${rows.length} kennel(s)`,
    "",
    "| Kennel | Region | Real history (deriv) | Current rule | Proposed | Holdout cur→prop (±1d) | Note |",
    "|---|---|---|---|---|---|---|",
  ];
  for (const p of rows) {
    const hist = `${p.derivEvents} ev, ${DAY_NAME[p.domDay]} ${pct(p.domShare * (p.derivEvents || 1), p.derivEvents || 1, 0)}, ${p.cadence} (~${p.medianGap}d)${p.seasonal ? ", seasonal" : ""}`;
    const cur = `${p.holdoutCurrent.hits}/${p.holdoutCurrent.predicted || 0}`;
    const prop = p.proposedKind === "flat-weekly" || p.proposedKind === "anchored-biweekly"
      ? `${p.holdoutProposed.hits}/${p.holdoutProposed.predicted || 0}`
      : "—";
    const note = p.manualReviewNote ?? "";
    const name = p.changed ? `${p.kennel.shortName} ⚠` : p.kennel.shortName;
    lines.push(
      `| ${name} | ${p.kennel.region} | ${hist} | \`${p.currentRules}\` | \`${p.proposedRrule}\`${p.anchorDate && p.proposedKind === "anchored-biweekly" ? ` (anchor ${p.anchorDate})` : ""} | ${cur} → ${prop} | ${note} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

// ──────────────────────────────────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────────────────────────────────
async function run(prisma: PrismaClient): Promise<void> {
  const today = utcNoon(new Date());
  console.log("🧭 PROPOSE rule fixes (read-only)\n");

  const kennels = (await prisma.kennel.findMany({
    where: { isHidden: false },
    select: { id: true, shortName: true, region: true, scheduleNotes: true },
  })) as KennelRow[];

  const rules = (await prisma.scheduleRule.findMany({
    where: { isActive: true, kennel: { isHidden: false } },
    select: {
      id: true, kennelId: true, rrule: true, anchorDate: true, startTime: true,
      confidence: true, notes: true, label: true, validFrom: true, validUntil: true,
    },
  })) as RuleRow[];

  const loadStart = addDays(today, -(DERIV_START_DAYS_AGO + 5));
  const events = await prisma.event.findMany({
    where: {
      ...CANONICAL_EVENT_WHERE,
      status: "CONFIRMED",
      date: { gte: loadStart, lte: today },
      kennel: { isHidden: false },
    },
    select: {
      kennelId: true,
      date: true,
      eventKennels: { select: { kennelId: true } },
      ...EVENT_ELIGIBILITY_SELECT,
    },
  });

  // Independent event dates per participating kennel.
  const indepByKennel = new Map<string, Date[]>();
  for (const e of events) {
    if (!isEligibleActual(e)) continue;
    const participating = new Set<string>([e.kennelId, ...e.eventKennels.map((ek) => ek.kennelId)]);
    for (const kid of participating) {
      const arr = indepByKennel.get(kid) ?? [];
      arr.push(e.date);
      indepByKennel.set(kid, arr);
    }
  }
  const rulesByKennel = new Map<string, RuleRow[]>();
  for (const r of rules) {
    const arr = rulesByKennel.get(r.kennelId) ?? [];
    arr.push(r);
    rulesByKennel.set(r.kennelId, arr);
  }

  const proposals: Proposal[] = [];
  for (const k of kennels) {
    const indep = (indepByKennel.get(k.id) ?? []).sort((a, b) => a.getTime() - b.getTime());
    const p = buildProposal(k, rulesByKennel.get(k.id) ?? [], indep, today);
    if (p) proposals.push(p);
  }

  const counts = { C3: 0, C2: 0, C1: 0 } as Record<Bucket, number>;
  for (const p of proposals) counts[p.bucket]++;
  const changedCount = proposals.filter((p) => p.changed).length;
  console.log(`Proposals — C.3: ${counts.C3}, C.2: ${counts.C2}, C.1: ${counts.C1} (total ${proposals.length}); ${changedCount} flagged as recently-changed (⚠)`);

  const date = fmtDate(today);
  const md = [
    `# Rule-fix proposals — ${date}`,
    "",
    "Generated by `scripts/propose-rule-fixes.ts` (read-only) against prod. Proposals are derived",
    `from independent (non-STATIC_SCHEDULE) event history in days ${DERIV_END_DAYS_AGO}–${DERIV_START_DAYS_AGO} ago;`,
    `the most recent ${HOLDOUT_DAYS} days are HELD OUT and used only for the "Holdout" hit-rate columns`,
    "(current rule → proposed rule, ±1d, via the real projection engine). **Review before applying** —",
    "seasonal/monthly/irregular rows are flagged for hand-authoring, not mechanical edits.",
    "",
    `Totals — C.3 contradicted: **${counts.C3}**, C.2 under-rated: **${counts.C2}**, C.1 dark: **${counts.C1}**.`,
    "",
    renderBucket("C3", proposals),
    renderBucket("C2", proposals),
    renderBucket("C1", proposals),
    "---",
    "",
    "*Holdout columns read `hits/predicted` on the held-out 4 weeks. A proposed rule that predicts 0",
    "in the holdout (e.g. biweekly whose phase didn't fire in 4 weeks) isn't necessarily wrong — judge",
    "with the real-history cadence column too.*",
    "",
  ].join("\n");

  const { mdPath, jsonPath } = writeAuditReport(
    `rule-fix-proposals-${date}`,
    md,
    { generatedAt: new Date().toISOString(), counts, proposals },
  );

  console.log(`\nWrote ${mdPath}`);
  console.log(`Wrote ${jsonPath}`);
}

async function main(): Promise<void> {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });
  try {
    await run(prisma);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
    await pool.end().catch(() => undefined);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exitCode = 1;
});
