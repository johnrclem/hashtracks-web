/**
 * Schedule-rule drift detection (Travel Mode prediction quality).
 *
 * Catches kennels whose active schedule rule predicts a different weekday than the
 * kennel's RECENT independent events actually fall on. This surfaces, automatically:
 *   - a kennel that flipped seasons (summer Mon → winter Sat) before the off-season
 *     rule mis-predicts for months, AND
 *   - a permanent schedule change, AND
 *   - a rule that was authored from a partial-year window and flattened a seasonal kennel.
 *
 * Crucially it is SEASON-AWARE: the "predicted weekday(s)" come from projectTrails over the
 * observed-plus-upcoming span (the same 42d we read actuals from, through the next few weeks),
 * so the rule's validFrom/validUntil gating is honored AND a kennel sitting right on a season
 * boundary keeps its old-season weekday in the predicted set while the recent actuals still lean
 * that way — it never false-fires across the switch. The detector only fires when the live rule
 * disagrees with reality, regardless of why.
 *
 * Reuses the real engine (projectTrails) + isEligibleActual so detection matches production.
 */
import type { Prisma, PrismaClient, ScheduleConfidence } from "@/generated/prisma/client";
import { CANONICAL_EVENT_WHERE } from "@/lib/event-filters";
import { EVENT_ELIGIBILITY_SELECT, isEligibleActual } from "@/lib/event-eligibility";
import { projectTrails, type ScheduleRuleInput } from "@/lib/travel/projections";

const DAY_MS = 24 * 60 * 60 * 1000;
/** Recent independent events window used as ground truth. */
export const DRIFT_RECENT_DAYS = 42;
/** Forward window over which we read the rule's currently-projected weekday(s). */
export const DRIFT_PROJECT_DAYS = 28;
/** Need at least this many recent independent events to judge drift (avoid noise). */
export const DRIFT_MIN_EVENTS = 4;
/** The recent dominant weekday must be at least this share to call it a clear miss. */
export const DRIFT_MIN_SHARE = 0.6;

const WEEKDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

// ── Pure helpers (exported for tests) ─────────────────────────────────────────

/** Dominant UTC weekday over a set of dates + its share and count. */
export function dominantWeekday(dates: Date[]): { day: number; share: number; count: number } {
  if (dates.length === 0) return { day: -1, share: 0, count: 0 };
  const hist = new Array(7).fill(0);
  for (const d of dates) hist[d.getUTCDay()]++;
  let day = 0;
  for (let i = 1; i < 7; i++) if (hist[i] > hist[day]) day = i;
  return { day, share: hist[day] / dates.length, count: dates.length };
}

/**
 * Drift iff the recent dominant weekday is CLEAR (enough events, high share) and is NOT one of
 * the weekdays the rule currently projects. Returns null when there's no drift (or not enough
 * signal). `predictedDays` is the set of weekdays the active rule projects for the near window.
 */
export function judgeDrift(
  predictedDays: ReadonlySet<number>,
  recentDates: Date[],
  minEvents = DRIFT_MIN_EVENTS,
  minShare = DRIFT_MIN_SHARE,
): { actualDay: number; actualShare: number; count: number } | null {
  const dom = dominantWeekday(recentDates);
  if (dom.count < minEvents || dom.share < minShare) return null;
  if (predictedDays.size === 0) return null; // rule projects nothing here — not a weekday-drift signal
  if (predictedDays.has(dom.day)) return null;
  return { actualDay: dom.day, actualShare: dom.share, count: dom.count };
}

export function weekdayName(day: number): string {
  return WEEKDAY[day] ?? "?";
}

// ── Detection ─────────────────────────────────────────────────────────────────
export interface DriftFinding {
  kennelCode: string;
  shortName: string;
  region: string;
  predictedWeekdays: string[];
  actualWeekday: string;
  actualShare: number;
  recentEventCount: number;
  activeRules: string;
}

interface KennelRow { id: string; kennelCode: string; shortName: string; region: string }
interface RuleRow {
  id: string; kennelId: string; rrule: string; anchorDate: string | null; startTime: string | null;
  confidence: ScheduleConfidence; notes: string | null; label: string | null;
  validFrom: string | null; validUntil: string | null;
}

/** Append `val` to the array at `key`, creating the bucket if absent. */
function pushToMap<K, V>(map: Map<K, V[]>, key: K, val: V): void {
  const arr = map.get(key);
  if (arr) arr.push(val);
  else map.set(key, [val]);
}

/** Group eligible (independent) event dates by every participating kennel. */
function groupRecentEventDates<E extends { kennelId: string; date: Date; eventKennels: { kennelId: string }[] }>(
  events: E[],
  isEligible: (e: E) => boolean,
): Map<string, Date[]> {
  const map = new Map<string, Date[]>();
  for (const e of events) {
    if (!isEligible(e)) continue;
    for (const kid of new Set<string>([e.kennelId, ...e.eventKennels.map((ek) => ek.kennelId)])) {
      pushToMap(map, kid, e.date);
    }
  }
  return map;
}

/** "[from..until]" season-window suffix for a rule (∞ for an open end); "" if year-round. */
function formatRuleWindow(r: { validFrom: string | null; validUntil: string | null }): string {
  if (!r.validFrom && !r.validUntil) return "";
  return ` [${r.validFrom ?? "∞"}..${r.validUntil ?? "∞"}]`;
}

/**
 * Drift finding for one kennel, or null if its active rules agree with reality.
 *
 * Season-aware predicted weekdays. Project over the FULL observed-plus-upcoming span
 * [recentStart, projectEnd] — not just the forward window — so a correctly-seasonal kennel that
 * just crossed a validFrom/validUntil boundary keeps its OLD-season weekday in the set while the
 * recent actuals still lean that way. Otherwise the 42d actuals (prior season) would be compared
 * against only the next 28d projections (new season) and false-fire for weeks after every switch
 * (Codex review on PR #2166). A genuinely stale rule still projects only its wrong weekday across
 * the whole span, so real drift is unaffected.
 */
function computeKennelDrift(
  k: KennelRow,
  kRules: RuleRow[],
  recent: Date[],
  recentStart: Date,
  projectEnd: Date,
): DriftFinding | null {
  const ruleInputs: ScheduleRuleInput[] = kRules.map((r) => ({
    id: r.id, kennelId: r.kennelId, rrule: r.rrule, anchorDate: r.anchorDate, startTime: r.startTime,
    confidence: r.confidence, notes: r.notes, label: r.label, validFrom: r.validFrom, validUntil: r.validUntil,
  }));
  const predictedDays = new Set<number>();
  for (const proj of projectTrails(ruleInputs, recentStart, projectEnd)) {
    if (proj.date) predictedDays.add(proj.date.getUTCDay());
  }
  const drift = judgeDrift(predictedDays, recent);
  if (!drift) return null;
  return {
    kennelCode: k.kennelCode,
    shortName: k.shortName,
    region: k.region,
    predictedWeekdays: [...predictedDays].sort((a, b) => a - b).map(weekdayName),
    actualWeekday: weekdayName(drift.actualDay),
    actualShare: drift.actualShare,
    recentEventCount: drift.count,
    activeRules: kRules.map((r) => r.rrule + formatRuleWindow(r)).join(" | "),
  };
}

export async function detectRuleDrift(prisma: PrismaClient, now: Date = new Date()): Promise<DriftFinding[]> {
  const recentStart = new Date(now.getTime() - DRIFT_RECENT_DAYS * DAY_MS);
  const projectEnd = new Date(now.getTime() + DRIFT_PROJECT_DAYS * DAY_MS);

  const [kennels, rules, events] = await Promise.all([
    prisma.kennel.findMany({ where: { isHidden: false }, select: { id: true, kennelCode: true, shortName: true, region: true } }) as Promise<KennelRow[]>,
    prisma.scheduleRule.findMany({
      where: { isActive: true, kennel: { isHidden: false } },
      select: { id: true, kennelId: true, rrule: true, anchorDate: true, startTime: true, confidence: true, notes: true, label: true, validFrom: true, validUntil: true },
    }) as Promise<RuleRow[]>,
    prisma.event.findMany({
      where: { ...CANONICAL_EVENT_WHERE, status: "CONFIRMED", date: { gte: recentStart, lte: now }, kennel: { isHidden: false } },
      select: { kennelId: true, date: true, eventKennels: { select: { kennelId: true } }, ...EVENT_ELIGIBILITY_SELECT },
    }),
  ]);

  const recentByKennel = groupRecentEventDates(events, isEligibleActual);
  const rulesByKennel = new Map<string, RuleRow[]>();
  for (const r of rules) pushToMap(rulesByKennel, r.kennelId, r);

  const findings: DriftFinding[] = [];
  for (const k of kennels) {
    const kRules = rulesByKennel.get(k.id) ?? [];
    if (kRules.length === 0) continue;
    const recent = recentByKennel.get(k.id) ?? [];
    if (recent.length < DRIFT_MIN_EVENTS) continue;
    const finding = computeKennelDrift(k, kRules, recent, recentStart, projectEnd);
    if (finding) findings.push(finding);
  }
  findings.sort((a, b) => a.shortName.localeCompare(b.shortName));
  return findings;
}

/**
 * Persist a drift run (findings + count + `ranAt`) so `/admin/predictions` can render it from a
 * fast single-row read instead of re-running the heavy live sweep on the page path. Called by the
 * weekly cron and the admin recompute action.
 */
export async function writeRuleDriftSnapshot(prisma: PrismaClient, findings: DriftFinding[]): Promise<void> {
  await prisma.ruleDriftSnapshot.create({
    data: { driftCount: findings.length, findings: findings as unknown as Prisma.InputJsonValue },
  });
}
