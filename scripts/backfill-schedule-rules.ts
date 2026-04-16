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

const dryRun = !process.argv.includes("--apply");
const verbose = process.argv.includes("--verbose");

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
 */
const DAY_REGEXES: ReadonlyArray<{ token: string; re: RegExp }> = Object.entries(
  DAY_MAP,
).map(([name, token]) => ({ token, re: new RegExp(String.raw`\b${name}\b`, "i") }));

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
function parseDays(
  dayOfWeek: string | null | undefined,
  frequency: string,
): string[] {
  const days = new Set<string>();

  // Primary field: scheduleDayOfWeek
  if (dayOfWeek) {
    const normalized = dayOfWeek.trim();
    if (normalized.toLowerCase() === "varies") {
      // "Varies" → skip
    } else if (normalized.includes("/")) {
      // "Sunday / Monday"
      for (const part of normalized.split("/")) {
        const token = DAY_MAP[part.trim()];
        if (token) days.add(token);
      }
    } else {
      const token = DAY_MAP[normalized];
      if (token) days.add(token);
    }
  }

  // Secondary: check frequency prose for explicit day names (e.g.
  // "Every Wednesday and Saturday"). Uses precompiled DAY_REGEXES to
  // avoid per-iteration RegExp construction (the previous form was a
  // ReDoS scanner trip even though the inputs are hardcoded).
  for (const { token, re } of DAY_REGEXES) {
    if (re.test(frequency)) {
      days.add(token);
    }
  }

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

  // Biweekly patterns — with or without hyphen
  if (/\bbi[- ]?weekly\b/.test(f) || /\balternating\b/.test(f)) {
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

  // If BYSETPOS is present alongside BYDAY, merge them
  if (parts.BYSETPOS && parts.BYDAY) {
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
}

type PrismaClientLike = InstanceType<typeof PrismaClient>;

type StaticScheduleConfig = {
  rrule?: string;
  anchorDate?: string;
  startTime?: string;
  kennelTag?: string;
};

/**
 * Pass 1 of the backfill: collect HIGH-confidence rules from STATIC_SCHEDULE
 * sources. Mutates `planned` in place. Extracted from main() so each pass
 * has a manageable cognitive complexity (SonarCloud cap = 15).
 */
async function runStaticSchedulePass(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
): Promise<{ count: number; skipped: number }> {
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
    if (!rawRrule) {
      skipped++;
      if (verbose) console.log(`  ⊘ ${src.name} — missing rrule in config`);
      continue;
    }
    const rrule = normalizeRRule(rawRrule);
    if (verbose && rrule !== rawRrule) {
      console.log(`  ↻ ${src.name} — normalized ${rawRrule} → ${rrule}`);
    }
    for (const { kennel } of src.kennels) {
      if (kennel.isHidden) {
        if (verbose) console.log(`  ⊘ ${src.name} → ${kennel.shortName} — hidden kennel, skipping`);
        skipped++;
        continue;
      }
      planned.push({
        kennelId: kennel.id,
        kennelDisplay: kennel.shortName,
        rrule,
        anchorDate: config.anchorDate?.trim() || null,
        startTime: config.startTime?.trim() || null,
        confidence: "HIGH",
        source: "STATIC_SCHEDULE",
        sourceReference: src.url || src.name,
        lastValidatedAt: src.lastSuccessAt ?? src.lastScrapeAt ?? null,
        notes: null,
      });
      count++;
    }
  }
  console.log(`  ✓ ${count} rules planned (${skipped} sources skipped)\n`);
  return { count, skipped };
}

/**
 * Pass 2 of the backfill: derive MEDIUM/LOW rules from per-kennel display
 * strings (Kennel.scheduleDayOfWeek/Frequency). Mutates `planned` in place.
 */
async function runKennelDisplayPass(
  prisma: PrismaClientLike,
  planned: PlannedRule[],
): Promise<{ count: number; skipped: number; total: number }> {
  console.log("━━━ Pass 2: Kennel display strings → MEDIUM/LOW ━━━");

  const kennels = await prisma.kennel.findMany({
    where: { scheduleFrequency: { not: null }, isHidden: false },
    select: {
      id: true,
      shortName: true,
      scheduleDayOfWeek: true,
      scheduleTime: true,
      scheduleFrequency: true,
      scheduleNotes: true,
    },
  });

  let count = 0;
  let skipped = 0;
  const skipReasons = new Map<string, number>();
  for (const k of kennels) {
    const parsed = parseFrequencyDay(k.scheduleFrequency, k.scheduleDayOfWeek);
    if (parsed.length === 0) {
      skipped++;
      const reason = `${k.scheduleFrequency} / ${k.scheduleDayOfWeek ?? "null"}`;
      skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
      if (verbose) {
        console.log(
          `  ⊘ ${k.shortName} — unparseable: freq=${JSON.stringify(k.scheduleFrequency)} day=${JSON.stringify(k.scheduleDayOfWeek)}`,
        );
      }
      continue;
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
        sourceReference: "Kennel.scheduleDayOfWeek/Frequency",
        lastValidatedAt: null,
        notes: rule.notes ?? null,
      });
      count++;
    }
  }
  console.log(`  ✓ ${count} rules planned from ${kennels.length} kennels (${skipped} unparseable)`);
  if (skipped > 0) {
    console.log("  Top skip reasons:");
    const sortedReasons = [...skipReasons.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [reason, count] of sortedReasons) {
      console.log(`    ${count}× ${reason}`);
    }
  }
  console.log("");
  return { count, skipped, total: kennels.length };
}

/**
 * Print the dry-run plan summary (counts by confidence + source). Pure
 * function over the `planned` array.
 */
function printPlanSummary(planned: PlannedRule[]): void {
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

  if (verbose) {
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
async function applyUpserts(
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
        },
        update: {
          anchorDate: r.anchorDate,
          startTime: r.startTime,
          confidence: r.confidence,
          sourceReference: r.sourceReference,
          lastValidatedAt: r.lastValidatedAt,
          notes: r.notes,
          isActive: true,
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

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never) as PrismaClientLike;

  console.log(dryRun ? "🔍 DRY RUN — no changes will be made\n" : "✏️  APPLYING changes\n");

  const planned: PlannedRule[] = [];
  await runStaticSchedulePass(prisma, planned);
  await runKennelDisplayPass(prisma, planned);
  printPlanSummary(planned);

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
