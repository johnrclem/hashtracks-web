/**
 * ScheduleRule backfill for Travel Mode.
 *
 * Two-pass idempotent backfill that populates ScheduleRule from existing data:
 *
 * - Pass 1: STATIC_SCHEDULE sources → HIGH confidence rules using the real RRULE
 *           from Source.config. Resolves kennelId via SourceKennel join.
 *
 * - Pass 2: Kennel display strings (scheduleDayOfWeek + scheduleFrequency +
 *           scheduleTime) → MEDIUM confidence rules. Parses the four
 *           display fields into RFC 5545 RRULE subset (what parseRRule accepts).
 *
 * Idempotent via upsert on the natural key `(kennelId, rrule, source)` which is
 * enforced by a unique constraint in the schema. Retries are safe — existing rules
 * are updated in place (non-destructive for lastValidatedAt, sourceReference).
 *
 * Unparseable frequencies (Annual, Irregular, Multiple, Quarterly, Twice monthly,
 * "Varies" days) are SKIPPED intentionally — the projection engine cannot generate
 * dates for them, and they'd create noise. The kennel still has its display fields
 * for the kennel detail page.
 *
 * ## RRULE vs CADENCE convention
 *
 * The `rrule` column stores two kinds of values:
 *
 * - **Parseable RRULE** (`FREQ=WEEKLY;BYDAY=SA`, `FREQ=MONTHLY;BYDAY=2SA`):
 *   Valid RFC 5545 subset that `parseRRule()` from the static-schedule adapter
 *   can handle. Confidence is HIGH or MEDIUM. The projection engine generates
 *   specific dates from these.
 *
 * - **Non-parseable sentinels** (`CADENCE=BIWEEKLY;BYDAY=SA`, `CADENCE=MONTHLY;BYDAY=SA`,
 *   `FREQ=LUNAR`): Stored for display and possible-activity purposes but MUST NOT
 *   be fed to `parseRRule()`. Confidence is always LOW. The projection engine
 *   emits these as "possible activity" with `date: null`.
 *
 * The projection engine MUST check confidence before calling parseRRule:
 *   if (rule.confidence === "LOW") → emit possible activity, no date
 *   if (rule.confidence === "HIGH" || "MEDIUM") → parseRRule + generate dates
 *
 * Usage:
 *   npx tsx scripts/backfill-schedule-rules.ts            # dry run (default)
 *   npx tsx scripts/backfill-schedule-rules.ts --apply    # apply changes
 *   npx tsx scripts/backfill-schedule-rules.ts --verbose  # show every rule
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import {
  PrismaClient,
  ScheduleConfidence,
  ScheduleRuleSource,
} from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { ANCHOR_WEEKDAYS, ANCHOR_RULES } from "@/adapters/static-schedule/lunar";
import { parseRRule } from "@/adapters/static-schedule/adapter";
import { isValidTimezone } from "@/lib/timezone";
import { KENNELS, type KennelScheduleRuleSeed } from "../prisma/seed-data/kennels";

/**
 * Source-reference strings persisted on `ScheduleRule.sourceReference`. Centralized
 * here so the admin UI / verify-fixes tooling has one place to grep for the conventions.
 */
const SOURCE_REF = {
  kennelDisplay: "Kennel.scheduleDayOfWeek/Frequency",
  kennelSeed: (code: string) => `KennelSeed.scheduleRules[${code}]`,
} as const;

interface BackfillOptions {
  verbose?: boolean;
}

// ============================================================================
// Parsing helpers
// ============================================================================

const DAY_MAP: Record<string, string> = {
  Sunday: "SU",
  Monday: "MO",
  Tuesday: "TU",
  Wednesday: "WE",
  Thursday: "TH",
  Friday: "FR",
  Saturday: "SA",
};

/**
 * Day-name word-boundary regexes precompiled at module scope. The previous
 * implementation called `new RegExp(\`\\b${name}\\b\`, "i")` inside the
 * frequency-prose scan loop, which Codacy and SonarCloud flagged as a ReDoS
 * candidate (and rebuilt the same regex on every kennel). Hoisting the
 * compilation removes both the scanner warning and per-iteration cost.
 * Inputs are hardcoded English day names — there's no untrusted text in
 * the regex source — but the precompiled form documents that intent.
 *
 * SonarCloud S2631 (dynamic regex injection) is a false positive here: the
 * `name` interpolated into the pattern is keyed off the module-scope DAY_MAP
 * literal — fully static, no user input ever reaches this construction.
 */
const DAY_REGEXES: ReadonlyArray<{ token: string; re: RegExp }> = Object.entries(
  DAY_MAP,
  // NOSONAR S2631 — inputs are hardcoded DAY_MAP keys, no injection surface.
).map(([name, token]) => ({ token, re: new RegExp(String.raw`\b${name}\b`, "i") })); // NOSONAR

/**
 * Parse a scheduleTime display string into HH:MM 24-hour format.
 *
 * Accepts "7:00 PM", "12:00 Noon", "12:00 Midnight", "19:30".
 * Returns null on unparseable input — caller decides whether to skip or default.
 */
export function parseScheduleTime(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();

  // Already 24h: "19:30", "09:00"
  const mil = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (mil) {
    const h = Number.parseInt(mil[1], 10);
    const m = Number.parseInt(mil[2], 10);
    if (h >= 0 && h < 24 && m >= 0 && m < 60) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }

  // Noon / Midnight literals
  if (/noon/i.test(s)) return "12:00";
  if (/midnight/i.test(s)) return "00:00";

  // "7:00 PM", "12:30 AM"
  const match = /^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i.exec(s);
  if (!match) return null;
  let hour = Number.parseInt(match[1], 10);
  const min = match[2] ? Number.parseInt(match[2], 10) : 0;
  const ampm = match[3].toUpperCase();
  if (!Number.isFinite(hour) || hour < 1 || hour > 12) return null;
  if (min < 0 || min >= 60) return null;
  if (ampm === "PM" && hour !== 12) hour += 12;
  if (ampm === "AM" && hour === 12) hour = 0;
  return `${String(hour).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export interface ParsedRule {
  rrule: string;
  confidence: ScheduleConfidence;
  notes?: string;
}

/**
 * Parse a scheduleFrequency + scheduleDayOfWeek pair into zero or more ParsedRules.
 *
 * Returns an empty array if the frequency is unparseable (Annual, Irregular, etc.)
 * or the day is missing/"Varies" for a day-required frequency.
 *
 * A single kennel can produce multiple rules when the display fields encode
 * multiple days ("Sunday / Monday", "Every Wednesday and Saturday").
 */
export function parseFrequencyDay(
  frequency: string | null | undefined,
  dayOfWeek: string | null | undefined,
): ParsedRule[] {
  if (!frequency) return [];
  const freq = frequency.trim();

  // Full moon → sentinel rrule, LOW confidence, null date in projection engine
  if (/full moon/i.test(freq)) {
    return [{ rrule: "FREQ=LUNAR", confidence: "LOW", notes: "Full moon schedule" }];
  }

  // Parse days. Handles "Monday", "Sunday / Monday", "Every Wednesday and Saturday"
  const days = parseDays(dayOfWeek, freq);
  if (days.length === 0) return [];

  // Normalize the frequency. Return zero rules for unparseable patterns.
  const rrulePrefix = frequencyToRRulePrefix(freq);
  if (!rrulePrefix) return [];

  // Weekly (simple, no interval): parseable RRULE, MEDIUM confidence
  if (rrulePrefix === "FREQ=WEEKLY") {
    return days.map((d) => ({
      rrule: `FREQ=WEEKLY;BYDAY=${d}`,
      confidence: "MEDIUM" as const,
    }));
  }

  // Biweekly WITHOUT an anchor: the recurrence engine aligns the first
  // occurrence to the query-window start, so dates drift between searches.
  // This is a user-visible correctness failure (Codex review finding #1).
  // → Store as non-parseable CADENCE sentinel at LOW confidence (possible
  //   activity only). Upgrade to MEDIUM with a real RRULE later when we
  //   add anchor inference from event history.
  if (rrulePrefix === "FREQ=WEEKLY;INTERVAL=2") {
    return days.map((d) => ({
      rrule: `CADENCE=BIWEEKLY;BYDAY=${d}`,
      confidence: "LOW" as const,
      notes: "Biweekly without anchor — phase alignment unknown, cannot project specific dates",
    }));
  }

  // Monthly without a specific ordinal: the recurrence engine resolves
  // BYDAY without nth to the *first* matching weekday of the month, which
  // is materially misleading when the actual week is unknown (Codex review
  // finding #2). → Store as non-parseable CADENCE sentinel at LOW.
  if (rrulePrefix === "FREQ=MONTHLY") {
    return days.map((d) => ({
      rrule: `CADENCE=MONTHLY;BYDAY=${d}`,
      confidence: "LOW" as const,
      notes: "Monthly schedule — specific week unknown, cannot project specific dates",
    }));
  }

  // "Biweekly (1st & 3rd Saturdays)" → two MONTHLY nth rules.
  // These HAVE explicit ordinals, so they ARE parseable and MEDIUM confidence.
  if (rrulePrefix === "FREQ=MONTHLY;BYDAY=1&3") {
    return days.flatMap((d) => [
      { rrule: `FREQ=MONTHLY;BYDAY=1${d}`, confidence: "MEDIUM" as const },
      { rrule: `FREQ=MONTHLY;BYDAY=3${d}`, confidence: "MEDIUM" as const },
    ]);
  }

  return [];
}

/**
 * Convert scheduleDayOfWeek display strings to RRULE BYDAY tokens.
 * Also inspects scheduleFrequency prose for secondary days
 * like "Every Wednesday and Saturday".
 */
/** Parse the scheduleDayOfWeek display field — "Saturday", "Sunday / Monday", or "Varies". */
function parseDayOfWeekField(dayOfWeek: string | null | undefined): string[] {
  if (!dayOfWeek) return [];
  const normalized = dayOfWeek.trim();
  if (normalized.toLowerCase() === "varies") return [];
  const segments = normalized.includes("/") ? normalized.split("/") : [normalized];
  const tokens: string[] = [];
  for (const seg of segments) {
    const token = DAY_MAP[seg.trim()];
    if (token) tokens.push(token);
  }
  return tokens;
}

/** Scan freeform frequency prose for day-name mentions (e.g. "Every Wednesday and Saturday"). */
function extractDaysFromFrequencyProse(frequency: string): string[] {
  const tokens: string[] = [];
  for (const { token, re } of DAY_REGEXES) {
    if (re.test(frequency)) tokens.push(token);
  }
  return tokens;
}

function parseDays(
  dayOfWeek: string | null | undefined,
  frequency: string,
): string[] {
  const days = new Set<string>();
  for (const t of parseDayOfWeekField(dayOfWeek)) days.add(t);
  for (const t of extractDaysFromFrequencyProse(frequency)) days.add(t);
  return [...days].sort((a, b) => a.localeCompare(b));
}

/**
 * Convert a scheduleFrequency display string to an RRULE prefix.
 * Returns null for unparseable / unsupported frequencies.
 *
 * The prefix omits BYDAY — the caller appends it per-day.
 *
 * Special sentinel `FREQ=MONTHLY;BYDAY=1&3` is used for "1st & 3rd" patterns;
 * the caller expands this into two rules per day.
 */
function frequencyToRRulePrefix(frequency: string): string | null {
  const f = frequency.toLowerCase().trim();

  // Explicitly unsupported patterns — check these first so they can't fall through
  // into the looser "weekly" / "monthly" matchers below.
  if (/\btwice\s+monthly\b/.test(f)) return null;
  if (/\bbimonthly\b/.test(f)) return null;
  if (/\bquarterly\b/.test(f)) return null;
  if (/\bannual(ly)?\b/.test(f)) return null;
  if (/\birregular\b/.test(f)) return null;
  if (/\bmultiple\b/.test(f)) return null;

  // "1st & 3rd" patterns — used by "Biweekly (1st & 3rd Saturdays)"
  if (/1st.*3rd|first.*third/.test(f)) return "FREQ=MONTHLY;BYDAY=1&3";

  // Biweekly — "Biweekly", "Bi-weekly", "Alternating", "Every other Saturday",
  // "Every 2 weeks". Must run before the looser /^every/ branch below or
  // "every other" gets misclassified as plain WEEKLY.
  if (
    /\bbi[- ]?weekly\b/.test(f) ||
    /\balternating\b/.test(f) ||
    /\bevery[- ]other\b/.test(f) ||
    /\bevery\s+2\s+weeks?\b/.test(f)
  ) {
    return "FREQ=WEEKLY;INTERVAL=2";
  }

  // Weekly — covers "Weekly", "Weekly (April-October)", "Every Wednesday..."
  if (/\bweekly\b/.test(f) || /^every\b/.test(f)) {
    return "FREQ=WEEKLY";
  }

  // Monthly (loose — no nth)
  if (/\bmonthly\b/.test(f)) {
    return "FREQ=MONTHLY";
  }

  return null;
}

/**
 * Normalize RFC 5545 RRULE for compatibility with the codebase's `parseRRule`.
 *
 * The existing parser supports `BYDAY=2SA` (nth weekday) but NOT the equivalent
 * `BYDAY=SA;BYSETPOS=2` form. Some STATIC_SCHEDULE configs use the BYSETPOS
 * form. This normalizer converts between them so all stored rules use the form
 * that `parseRRule` understands.
 *
 * Examples:
 *   "FREQ=MONTHLY;BYDAY=SA;BYSETPOS=1" → "FREQ=MONTHLY;BYDAY=1SA"
 *   "FREQ=MONTHLY;BYDAY=FR;BYSETPOS=3" → "FREQ=MONTHLY;BYDAY=3FR"
 *   "FREQ=WEEKLY;BYDAY=SA" → unchanged (no BYSETPOS)
 */
export function normalizeRRule(rrule: string): string {
  const parts: Record<string, string> = {};
  for (const segment of rrule.split(";")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx < 0) continue;
    const key = segment.slice(0, eqIdx).trim().toUpperCase();
    const value = segment.slice(eqIdx + 1).trim().toUpperCase();
    if (key && value) parts[key] = value;
  }

  // Fold BYSETPOS only when BYDAY has a single weekday token. Multi-day
  // BYDAY + BYSETPOS is ambiguous ("3rd of {Sat,Fri}" vs "3rd Sat AND
  // 3rd Fri") — leave it for parseRRule to accept or reject.
  if (parts.BYSETPOS && parts.BYDAY && !parts.BYDAY.includes(",")) {
    const pos = parts.BYSETPOS; // e.g., "1", "3", "-1"
    const day = parts.BYDAY;    // e.g., "SA", "FR"
    parts.BYDAY = `${pos}${day}`;
    delete parts.BYSETPOS;
  }

  // Reconstruct the RRULE in a stable order
  const order = ["FREQ", "INTERVAL", "BYDAY", "BYMONTHDAY"];
  const result: string[] = [];
  for (const key of order) {
    if (parts[key]) result.push(`${key}=${parts[key]}`);
  }
  // Append any remaining keys not in the order list
  for (const [key, value] of Object.entries(parts)) {
    if (!order.includes(key)) result.push(`${key}=${value}`);
  }
  return result.join(";");
}

// ============================================================================
// Main
// ============================================================================

interface PlannedRule {
  kennelId: string;
  kennelDisplay: string;
  rrule: string;
  anchorDate: string | null;
  startTime: string | null;
  confidence: ScheduleConfidence;
  source: ScheduleRuleSource;
  sourceReference: string | null;
  lastValidatedAt: Date | null;
  notes: string | null;
  // Multi-cadence display fields (#1390). Only Pass 3 sets these; passes 1 + 2
  // leave them at null / 0 so existing upserts don't accidentally clobber values
  // written by a later Pass 3 with the same (kennelId, rrule, source) key.
  label: string | null;
  validFrom: string | null;
  validUntil: string | null;
  displayOrder: number;
}

type PrismaClientLike = InstanceType<typeof PrismaClient>;

type StaticScheduleConfig = {
  rrule?: string;
  anchorDate?: string;
  startTime?: string;
  kennelTag?: string;
  /** Lunar mode (XOR with rrule). See src/adapters/static-schedule/lunar.ts. */
  lunar?: {
    phase?: "full" | "new";
    timezone?: string;
    anchorWeekday?: "SU" | "MO" | "TU" | "WE" | "TH" | "FR" | "SA";
    anchorRule?: "nearest" | "on-or-after" | "on-or-before";
  };
};

/**
 * Validate the lunar block matches the adapter's contract — phase, timezone,
 * and the anchorWeekday/anchorRule XOR pair. MUST stay in sync with
 * `validateRruleLunarXor` in `src/adapters/static-schedule/adapter.ts`: if
 * backfill is more permissive than the adapter, Travel Mode would surface a
 * `FREQ=LUNAR` "possible activity" rule for a source that produces zero
 * canonical events, masking the misconfiguration behind a synthetic schedule.
 *
 * Phase + anchor metadata is carried in the rule's `notes` (admin-visible)
 * rather than the rrule string: `src/lib/travel/projections.ts` matches the
 * sentinel via exact equality (`rrule === "FREQ=LUNAR"`), so extending the
 * rrule with `;PHASE=…` segments would silently bypass the existing match.
 */
function isValidLunarConfig(lunar: NonNullable<StaticScheduleConfig["lunar"]>): boolean {
  if (lunar.phase !== "full" && lunar.phase !== "new") return false;
  if (typeof lunar.timezone !== "string" || !isValidTimezone(lunar.timezone)) return false;
  const hasWeekday = lunar.anchorWeekday !== undefined && lunar.anchorWeekday !== null;
  const hasRule = lunar.anchorRule !== undefined && lunar.anchorRule !== null;
  if (hasWeekday !== hasRule) return false;
  if (
    hasWeekday &&
    !ANCHOR_WEEKDAYS.includes(lunar.anchorWeekday as (typeof ANCHOR_WEEKDAYS)[number])
  ) {
    return false;
  }
  if (
    hasRule &&
    !ANCHOR_RULES.includes(lunar.anchorRule as (typeof ANCHOR_RULES)[number])
  ) {
    return false;
  }
  return true;
}

/**
 * Pass 1 of the backfill: collect HIGH-confidence rules from STATIC_SCHEDULE
 * sources. Mutates `planned` in place. Extracted from main() so each pass
 * has a manageable cognitive complexity (SonarCloud cap = 15).
 */
/**
 * Inner-loop helper for runStaticSchedulePass — extracted to keep the
 * outer function under SonarCloud's cognitive-complexity cap of 15.
 * Returns true if a rule was pushed, false if the kennel was skipped.
 */
interface StaticSourceMeta {
  name: string;
  url: string | null;
  lastSuccessAt: Date | null;
  lastScrapeAt: Date | null;
}

interface StaticKennelMeta {
  id: string;
  shortName: string;
  isHidden: boolean;
}

function processSourceKennel(
  src: StaticSourceMeta,
  kennel: StaticKennelMeta,
  config: StaticScheduleConfig,
  rrule: string,
  planned: PlannedRule[],
  options: BackfillOptions,
  overrides?: { confidence?: ScheduleConfidence; notes?: string | null },
): boolean {
  if (kennel.isHidden) {
    if (options.verbose) console.log(`  ⊘ ${src.name} → ${kennel.shortName} — hidden kennel, skipping`);
    return false;
  }
  planned.push({
    kennelId: kennel.id,
    kennelDisplay: kennel.shortName,
    rrule,
    anchorDate: config.anchorDate?.trim() || null,
    startTime: config.startTime?.trim() || null,
    confidence: overrides?.confidence ?? "HIGH",
    source: "STATIC_SCHEDULE",
    sourceReference: src.url || src.name,
    lastValidatedAt: src.lastSuccessAt ?? src.lastScrapeAt ?? null,
    notes: overrides?.notes ?? null,
    label: null,
    validFrom: null,
    validUntil: null,
    displayOrder: 0,
  });
  return true;
}

/**
 * Build the `notes` string for a `FREQ=LUNAR` sentinel rule. `lunar` is
 * pre-validated (`isValidLunarConfig`) so timezone is non-empty here.
 */
function buildLunarNotes(lunar: NonNullable<StaticScheduleConfig["lunar"]>): string {
  const isAnchored = !!(lunar.anchorWeekday && lunar.anchorRule);
  return isAnchored
    ? `Lunar ${lunar.phase} moon, anchored to ${lunar.anchorWeekday} (${lunar.anchorRule})`
    : `Lunar ${lunar.phase} moon, exact phase date in ${lunar.timezone}`;
}

interface PassResult {
  count: number;
  skipped: number;
}

/** Lunar source branch: validate, emit FREQ=LUNAR sentinel per kennel. */
function processLunarSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  src: any,
  config: StaticScheduleConfig,
  planned: PlannedRule[],
  options: BackfillOptions,
): PassResult {
  if (!config.lunar || !isValidLunarConfig(config.lunar)) {
    if (options.verbose) {
      console.log(`  ⊘ ${src.name} — lunar config malformed (missing or invalid phase)`);
    }
    return { count: 0, skipped: 1 };
  }
  const notes = buildLunarNotes(config.lunar);
  let count = 0;
  let skipped = 0;
  for (const { kennel } of src.kennels) {
    const ok = processSourceKennel(src, kennel, config, "FREQ=LUNAR", planned, options, {
      confidence: "LOW",
      notes,
    });
    if (ok) count++;
    else skipped++;
  }
  return { count, skipped };
}

/** RRULE source branch: normalize + emit HIGH-confidence rule per kennel. */
function processRruleSource(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  src: any,
  config: StaticScheduleConfig,
  rawRrule: string,
  planned: PlannedRule[],
  options: BackfillOptions,
): PassResult {
  const rrule = normalizeRRule(rawRrule);
  if (options.verbose && rrule !== rawRrule) {
    console.log(`  ↻ ${src.name} — normalized ${rawRrule} → ${rrule}`);
  }
  let count = 0;
  let skipped = 0;
  for (const { kennel } of src.kennels) {
    const ok = processSourceKennel(src, kennel, config, rrule, planned, options);
    if (ok) count++;
    else skipped++;
  }
  return { count, skipped };
}

export async function runStaticSchedulePass(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
  options: BackfillOptions = {},
): Promise<PassResult> {
  console.log("━━━ Pass 1: STATIC_SCHEDULE sources → HIGH confidence ━━━");

  const staticSources = await prisma.source.findMany({
    where: { type: "STATIC_SCHEDULE", enabled: true },
    include: {
      kennels: {
        include: {
          kennel: { select: { id: true, shortName: true, isHidden: true } },
        },
      },
    },
  });

  let count = 0;
  let skipped = 0;
  for (const src of staticSources) {
    const config = (src.config ?? {}) as StaticScheduleConfig;
    const rawRrule = config.rrule?.trim();

    // XOR enforcement matching `validateRruleLunarXor` in the adapter — dual-
    // config rows are skipped to avoid projecting HIGH-confidence rules for
    // sources whose canonical event generation would later reject the shape.
    if (rawRrule && config.lunar) {
      skipped++;
      if (options.verbose) console.log(`  ⊘ ${src.name} — XOR violation: both rrule and lunar set`);
      continue;
    }

    let result: PassResult;
    if (config.lunar) {
      result = processLunarSource(src, config, planned, options);
    } else if (rawRrule) {
      result = processRruleSource(src, config, rawRrule, planned, options);
    } else {
      if (options.verbose) console.log(`  ⊘ ${src.name} — missing rrule in config`);
      result = { count: 0, skipped: 1 };
    }
    count += result.count;
    skipped += result.skipped;
  }
  console.log(`  ✓ ${count} rules planned (${skipped} sources skipped)\n`);
  return { count, skipped };
}

/**
 * Shared shape for the seed-driven passes. The full `KennelSeed` interface
 * lives in `prisma/seed-data/kennels.ts`; we only need these two fields here.
 */
interface KennelSeedLike {
  kennelCode: string;
  scheduleRules?: KennelScheduleRuleSeed[];
}

/**
 * Pass 2 of the backfill: derive MEDIUM/LOW rules from per-kennel display
 * strings (Kennel.scheduleDayOfWeek/Frequency). Mutates `planned` in place.
 *
 * Pass 2 SKIPS any kennel whose seed declares `scheduleRules` — those kennels
 * are owned by Pass 3 (structured multi-cadence path), and Pass 2's parse would
 * otherwise risk colliding on the (kennelId, rrule, source=SEED_DATA) unique key.
 * On a re-run, a Pass 2 upsert with all-default multi-cadence fields would
 * silently overwrite Pass 3's label/validFrom/validUntil with nulls before
 * Pass 3's later upsert restored them — and if a seed `scheduleRules` entry is
 * later removed, the restoration never happens and the metadata is lost.
 * Making the opt-out structural (declare `scheduleRules` → skip Pass 2) makes
 * the collision impossible regardless of pass ordering or apply order.
 *
 * The `seedKennels` parameter is injectable for testability; defaults to the
 * exported KENNELS array.
 */
interface DisplayKennel {
  id: string;
  kennelCode: string;
  shortName: string;
  scheduleDayOfWeek: string | null;
  scheduleTime: string | null;
  scheduleFrequency: string | null;
  scheduleNotes: string | null;
}

interface DisplayRowResult {
  emitted: number;
  status: "emitted" | "unparseable" | "opted-out";
  reason?: string;
}

/**
 * Process one Pass 2 kennel row. Extracted from `runKennelDisplayPass` to keep
 * the outer function's cognitive complexity under SonarCloud's cap of 15.
 */
function processDisplayKennel(
  k: DisplayKennel,
  optedOutCodes: ReadonlySet<string>,
  planned: PlannedRule[],
  options: BackfillOptions,
): DisplayRowResult {
  if (optedOutCodes.has(k.kennelCode)) {
    if (options.verbose) {
      console.log(`  ⤼ ${k.shortName} — opted out of Pass 2 (declares scheduleRules in seed)`);
    }
    return { emitted: 0, status: "opted-out" };
  }
  const parsed = parseFrequencyDay(k.scheduleFrequency, k.scheduleDayOfWeek);
  if (parsed.length === 0) {
    if (options.verbose) {
      console.log(
        `  ⊘ ${k.shortName} — unparseable: freq=${JSON.stringify(k.scheduleFrequency)} day=${JSON.stringify(k.scheduleDayOfWeek)}`,
      );
    }
    return {
      emitted: 0,
      status: "unparseable",
      reason: `${k.scheduleFrequency} / ${k.scheduleDayOfWeek ?? "null"}`,
    };
  }
  const startTime = parseScheduleTime(k.scheduleTime);
  for (const rule of parsed) {
    planned.push({
      kennelId: k.id,
      kennelDisplay: k.shortName,
      rrule: rule.rrule,
      anchorDate: null,
      startTime,
      confidence: rule.confidence,
      source: "SEED_DATA",
      sourceReference: SOURCE_REF.kennelDisplay,
      lastValidatedAt: null,
      notes: rule.notes ?? null,
      label: null,
      validFrom: null,
      validUntil: null,
      displayOrder: 0,
    });
  }
  return { emitted: parsed.length, status: "emitted" };
}

export async function runKennelDisplayPass(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
  options: BackfillOptions = {},
  seedKennels: ReadonlyArray<KennelSeedLike> = KENNELS,
): Promise<{ count: number; skipped: number; total: number; optedOut: number }> {
  console.log("━━━ Pass 2: Kennel display strings → MEDIUM/LOW ━━━");

  const optedOutCodes = new Set(
    seedKennels
      .filter((k) => Array.isArray(k.scheduleRules) && k.scheduleRules.length > 0)
      .map((k) => k.kennelCode),
  );

  const kennels = await prisma.kennel.findMany({
    where: { scheduleFrequency: { not: null }, isHidden: false },
    select: {
      id: true,
      kennelCode: true,
      shortName: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
      scheduleNotes: true,
    },
  });

  let count = 0;
  let skipped = 0;
  let optedOut = 0;
  const skipReasons = new Map<string, number>();
  for (const k of kennels) {
    const result = processDisplayKennel(k, optedOutCodes, planned, options);
    count += result.emitted;
    if (result.status === "opted-out") optedOut++;
    else if (result.status === "unparseable" && result.reason) {
      skipped++;
      skipReasons.set(result.reason, (skipReasons.get(result.reason) ?? 0) + 1);
    }
  }
  console.log(
    `  ✓ ${count} rules planned from ${kennels.length} kennels ` +
      `(${skipped} unparseable, ${optedOut} opted-out via scheduleRules)`,
  );
  if (skipped > 0) {
    console.log("  Top skip reasons:");
    const sortedReasons = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [reason, occurrences] of sortedReasons) {
      console.log(`    ${occurrences}× ${reason}`);
    }
  }
  console.log("");
  return { count, skipped, total: kennels.length, optedOut };
}

/**
 * Validate a "MM-DD" anchor used in seasonal scheduleRules. Rejects malformed
 * strings ("13-01", "02-30", "summer") so a typo doesn't end up as opaque text
 * in the ScheduleRule row. Returns the trimmed string on success, null otherwise.
 */
function validateMonthDayAnchor(raw: string | undefined): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  const match = /^(\d{2})-(\d{2})$/.exec(s);
  if (!match) return null;
  const month = Number.parseInt(match[1], 10);
  const day = Number.parseInt(match[2], 10);
  if (month < 1 || month > 12) return null;
  // Use a leap year (2024) as the upper-bound calendar so Feb 29 is permitted
  // — seasonal cadences span Feb and we'd rather accept "02-29" than reject it.
  const lastDayOfMonth = new Date(Date.UTC(2024, month, 0)).getUTCDate();
  if (day < 1 || day > lastDayOfMonth) return null;
  return s;
}

/**
 * Pass 3 of the backfill: kennel seed `scheduleRules` → HIGH-confidence rules
 * with multi-cadence display metadata (label / validFrom / validUntil / displayOrder).
 *
 * Pass 3 is the structured-data path that supersedes Pass 2 for migrated kennels:
 * - Pass 1 (STATIC_SCHEDULE source) provides the HIGH-confidence single-RRULE
 *   case for kennels driven by a Source.config.rrule.
 * - Pass 2 (Kennel display strings) provides a best-effort MEDIUM rule for the
 *   ~190 unmigrated kennels.
 * - Pass 3 (this) is the new authoritative path for kennels that explicitly
 *   declare one-or-more cadences in their seed entry. Confidence is HIGH because
 *   the seed author wrote it down explicitly.
 *
 * Collision handling: the upsert is keyed on (kennelId, rrule, source). If Pass 1
 * or Pass 2 emitted the same key earlier, Pass 3's later emission wins on the
 * second upsert pass (same source enum + same rrule string). In practice the
 * keys rarely collide because Pass 3 emits canonical RRULE shapes (e.g.
 * "FREQ=MONTHLY;BYDAY=1SA") while Pass 2 emits CADENCE sentinels for monthly
 * patterns without ordinals.
 */
/**
 * Validate one seed RRULE against the static-schedule adapter's parser. Returns
 * the normalized RRULE string on success, null on failure (already logged).
 * Fail-loud guard: better to skip at backfill time than to persist a value
 * Travel Mode's projection engine silently falls back to "possible activity".
 */
function normalizeAndValidateSeedRrule(
  rawRrule: string,
  kennelCode: string,
): string | null {
  const normalized = normalizeRRule(rawRrule);
  try {
    parseRRule(normalized);
    return normalized;
  } catch (err) {
    console.warn(
      `  ⚠ ${kennelCode} — unparseable rrule ${JSON.stringify(rawRrule)}: ` +
        `${err instanceof Error ? err.message : String(err)}, skipping`,
    );
    return null;
  }
}

/**
 * Validate the MM-DD season anchors on a seed rule, logging warnings for
 * malformed values. Returns the validated anchors (null when missing/invalid).
 */
function resolveSeasonAnchors(
  rule: KennelScheduleRuleSeed,
  kennelCode: string,
): { validFrom: string | null; validUntil: string | null } {
  const validFrom = validateMonthDayAnchor(rule.validFrom);
  const validUntil = validateMonthDayAnchor(rule.validUntil);
  if (rule.validFrom && !validFrom) {
    console.warn(`  ⚠ ${kennelCode} — invalid validFrom ${JSON.stringify(rule.validFrom)}, dropping`);
  }
  if (rule.validUntil && !validUntil) {
    console.warn(`  ⚠ ${kennelCode} — invalid validUntil ${JSON.stringify(rule.validUntil)}, dropping`);
  }
  return { validFrom, validUntil };
}

type SeedRuleResult = "emitted" | "skipped-empty" | "skipped-unparseable";

interface SeedKennelMeta {
  id: string;
  kennelCode: string;
  shortName: string;
}

/**
 * Plan one Pass 3 rule. Extracted to keep `runKennelSeedPass` under SonarCloud's
 * cognitive-complexity cap.
 */
function planSeedRule(
  rule: KennelScheduleRuleSeed,
  dbKennel: SeedKennelMeta,
  kennelCode: string,
  planned: PlannedRule[],
  options: BackfillOptions,
): SeedRuleResult {
  const rrule = rule.rrule?.trim();
  if (!rrule) {
    if (options.verbose) {
      console.log(`  ⊘ ${kennelCode} — empty rrule, skipping rule`);
    }
    return "skipped-empty";
  }
  const normalizedRrule = normalizeAndValidateSeedRrule(rrule, kennelCode);
  if (!normalizedRrule) return "skipped-unparseable";
  const { validFrom, validUntil } = resolveSeasonAnchors(rule, kennelCode);
  planned.push({
    kennelId: dbKennel.id,
    kennelDisplay: dbKennel.shortName,
    rrule: normalizedRrule,
    anchorDate: rule.anchorDate?.trim() || null,
    startTime: rule.startTime?.trim() || null,
    confidence: "HIGH",
    source: "SEED_DATA",
    sourceReference: SOURCE_REF.kennelSeed(kennelCode),
    // First-create timestamp. applyUpserts excludes lastValidatedAt from
    // the UPDATE clause for SEED_DATA rules, so this `new Date()` is only
    // written when the row is first created — re-runs preserve the
    // original first-seen value (and admin re-validations stick).
    lastValidatedAt: new Date(),
    notes: rule.notes ?? null,
    label: rule.label?.trim() || null,
    validFrom,
    validUntil,
    displayOrder: typeof rule.displayOrder === "number" ? rule.displayOrder : 0,
  });
  return "emitted";
}

export async function runKennelSeedPass(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
  options: BackfillOptions = {},
  seedKennels: ReadonlyArray<KennelSeedLike> = KENNELS,
): Promise<{ count: number; skippedKennels: number; skippedRules: number }> {
  console.log("━━━ Pass 3: Kennel seed scheduleRules → HIGH confidence ━━━");

  const seedsWithRules = seedKennels.filter(
    (k) => Array.isArray(k.scheduleRules) && k.scheduleRules.length > 0,
  );
  if (seedsWithRules.length === 0) {
    console.log("  ✓ 0 kennels carry scheduleRules in the seed — nothing to plan\n");
    return { count: 0, skippedKennels: 0, skippedRules: 0 };
  }

  const codes = seedsWithRules.map((k) => k.kennelCode);
  const dbKennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: codes }, isHidden: false },
    select: { id: true, kennelCode: true, shortName: true },
  });
  const byCode = new Map(dbKennels.map((k) => [k.kennelCode, k]));

  let count = 0;
  let skippedKennels = 0;
  let skippedRules = 0;

  for (const seed of seedsWithRules) {
    const dbKennel = byCode.get(seed.kennelCode);
    if (!dbKennel) {
      skippedKennels++;
      if (options.verbose) {
        console.log(`  ⊘ ${seed.kennelCode} — not found in DB (or hidden)`);
      }
      continue;
    }
    for (const rule of seed.scheduleRules ?? []) {
      const result = planSeedRule(rule, dbKennel, seed.kennelCode, planned, options);
      if (result === "emitted") count++;
      else skippedRules++;
    }
  }

  console.log(`  ✓ ${count} rules planned from ${seedsWithRules.length} kennel(s) with scheduleRules`);
  if (skippedKennels > 0) console.log(`  ⊘ ${skippedKennels} kennel(s) skipped (not in DB / hidden)`);
  if (skippedRules > 0) {
    console.warn(`  ⊘ ${skippedRules} rule(s) skipped (empty or unparseable rrule)`);
  }
  console.log("");
  return { count, skippedKennels, skippedRules };
}

/**
 * Print the dry-run plan summary (counts by confidence + source). Pure
 * function over the `planned` array.
 */
function printPlanSummary(planned: PlannedRule[], options: BackfillOptions = {}): void {
  console.log("━━━ Plan summary ━━━");
  console.log(`  Total rules to upsert: ${planned.length}`);
  const byConfidence = planned.reduce<Record<string, number>>((acc, r) => {
    acc[r.confidence] = (acc[r.confidence] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  By confidence: ${JSON.stringify(byConfidence)}`);
  const bySource = planned.reduce<Record<string, number>>((acc, r) => {
    acc[r.source] = (acc[r.source] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`  By source: ${JSON.stringify(bySource)}\n`);

  if (options.verbose) {
    console.log("━━━ First 20 planned rules ━━━");
    for (const r of planned.slice(0, 20)) {
      console.log(
        `  ${r.kennelDisplay.padEnd(20)} ${r.rrule.padEnd(35)} ${r.confidence.padEnd(6)} ${r.source.padEnd(16)} time=${r.startTime ?? "-"}`,
      );
    }
    console.log("");
  }
}

/**
 * Apply the planned rules via upserts on the natural key (kennelId, rrule,
 * source). Returns counts for the run summary; main() keys off `errored`
 * for the cleanup gate.
 */
export async function applyUpserts(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
): Promise<{ created: number; updated: number; errored: number }> {
  console.log("━━━ Applying upserts ━━━");
  const preExistingIds = new Set(
    (await prisma.scheduleRule.findMany({ select: { id: true } })).map((r) => r.id),
  );
  let created = 0;
  let updated = 0;
  let errored = 0;
  for (const r of planned) {
    try {
      const result = await prisma.scheduleRule.upsert({
        where: {
          ScheduleRule_kennel_rrule_source_key: {
            kennelId: r.kennelId,
            rrule: r.rrule,
            source: r.source,
          },
        },
        create: {
          kennelId: r.kennelId,
          rrule: r.rrule,
          anchorDate: r.anchorDate,
          startTime: r.startTime,
          confidence: r.confidence,
          source: r.source,
          sourceReference: r.sourceReference,
          lastValidatedAt: r.lastValidatedAt,
          notes: r.notes,
          label: r.label,
          validFrom: r.validFrom,
          validUntil: r.validUntil,
          displayOrder: r.displayOrder,
        },
        update: {
          anchorDate: r.anchorDate,
          startTime: r.startTime,
          confidence: r.confidence,
          sourceReference: r.sourceReference,
          notes: r.notes,
          label: r.label,
          validFrom: r.validFrom,
          validUntil: r.validUntil,
          displayOrder: r.displayOrder,
          isActive: true,
          // Only STATIC_SCHEDULE rules bump lastValidatedAt on every run —
          // the scrape's lastSuccessAt IS the validation moment. SEED_DATA
          // (Pass 2 display strings + Pass 3 scheduleRules) preserves the
          // first-create timestamp so admin re-validations and seed-author
          // moments aren't clobbered by routine re-runs. (Codex P2 + Gemini
          // + Claude review on PR #1405.)
          ...(r.source === "STATIC_SCHEDULE" ? { lastValidatedAt: r.lastValidatedAt } : {}),
        },
      });
      if (preExistingIds.has(result.id)) {
        updated++;
      } else {
        created++;
        preExistingIds.add(result.id);
      }
    } catch (err) {
      errored++;
      console.error(`  ✗ ${r.kennelDisplay} ${r.rrule} (${r.source}): ${err instanceof Error ? err.message : err}`);
    }
  }
  console.log(`  ✓ Created: ${created}`);
  console.log(`  ✓ Updated: ${updated}`);
  if (errored > 0) console.log(`  ✗ Errored: ${errored}`);
  return { created, updated, errored };
}

/**
 * Mark autogenerated rules whose natural key isn't in the current plan
 * as inactive. Skips when `errored > 0` so a partial-failure run can't
 * silently deactivate the last known-good rule for a kennel.
 */
async function deactivateStaleRules(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
  errored: number,
): Promise<void> {
  if (errored > 0) {
    console.log(`\n⚠ Skipping stale-rule deactivation — ${errored} upsert error(s) occurred.`);
    console.log("  Fix the errors and re-run to enable cleanup.\n");
    return;
  }

  console.log("\n━━━ Deactivating stale autogenerated rules ━━━");

  const currentKeys = new Set(
    planned.map((r) => `${r.kennelId}::${r.rrule}::${r.source}`),
  );

  const allAutogenRules = await prisma.scheduleRule.findMany({
    where: {
      source: { in: ["STATIC_SCHEDULE", "SEED_DATA"] },
      isActive: true,
    },
    select: { id: true, kennelId: true, rrule: true, source: true },
  });

  const staleIds: string[] = [];
  for (const rule of allAutogenRules) {
    const key = `${rule.kennelId}::${rule.rrule}::${rule.source}`;
    if (!currentKeys.has(key)) {
      staleIds.push(rule.id);
    }
  }

  if (staleIds.length > 0) {
    const { count } = await prisma.scheduleRule.updateMany({
      where: { id: { in: staleIds } },
      data: { isActive: false },
    });
    console.log(`  ✓ Deactivated ${count} stale rule(s)`);
  } else {
    console.log(`  ✓ No stale rules found`);
  }
  console.log("");
}

/**
 * Seed-friendly entrypoint. Runs both passes, applies upserts, and (when
 * no upserts errored) deactivates stale autogenerated rules so a re-seed
 * after dropping a kennel.scheduleFrequency leaves no zombie isActive rules.
 * Skips printPlanSummary — too chatty for seed console.
 */
export async function runScheduleRuleBackfill(
  prisma: PrismaClientLike,
  options: BackfillOptions = {},
): Promise<{ created: number; updated: number; errored: number }> {
  const planned: PlannedRule[] = [];
  await runStaticSchedulePass(prisma, planned, options);
  await runKennelDisplayPass(prisma, planned, options);
  await runKennelSeedPass(prisma, planned, options);
  const result = await applyUpserts(prisma, planned);
  await deactivateStaleRules(prisma, planned, result.errored);
  return result;
}

async function main() {
  const dryRun = !process.argv.includes("--apply");
  const options: BackfillOptions = {
    verbose: process.argv.includes("--verbose"),
  };

  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never) as PrismaClientLike;

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const planned: PlannedRule[] = [];
  await runStaticSchedulePass(prisma, planned, options);
  await runKennelDisplayPass(prisma, planned, options);
  await runKennelSeedPass(prisma, planned, options);
  printPlanSummary(planned, options);

  if (dryRun) {
    console.log("Dry run complete. Re-run with --apply to upsert rules.");
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const { errored } = await applyUpserts(prisma, planned);
  await deactivateStaleRules(prisma, planned, errored);

  await prisma.$disconnect();
  await pool.end();

  // Fail closed if any upsert errored — earlier behavior exited with 1
  // after the deactivation skip log.
  if (errored > 0) process.exit(1);
}

// Only run main() when this file is executed directly (not when imported by
// tests). Tsx sets process.argv[1] to the absolute path of the invoked script.
const entryPoint = process.argv[1] ?? "";
if (entryPoint.endsWith("backfill-schedule-rules.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
