/**
 * The backfill guards that need no database (docs/onboarding-backfill-automation-design.md 8.1).
 * Each returns the problems it finds; an empty list passes. The plan, CI and
 * every batch call the same functions.
 */
import type { RawEventData } from "@/adapters/types";
import { addDays, daysBetween, median } from "./canonical";
import {
  BACKFILL_MAX_ROWS,
  RUN_EXCEPTION_MAX_ROWS,
  RUN_EXCEPTION_MAX_SHARE,
  UNNUMBERED_MAX_SHARE,
  findRunNumberExceptions,
  type ExpectedGap,
} from "./manifest";

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * G21 cut-off: a Google Calendar RawEvent stored before the adapter emitted the
 * repeating-series marker can't be compared. PR #2923 (the marker) merged at
 * 2026-11-13T03:06Z; the first daily dispatch on that code ran at 06:00Z. One
 * hour after that is the constant. It errs late, which only skips a few more
 * rows (8.1 G21). A prod query (earliest calendar RawEvent carrying the key,
 * plus one hour) can tighten it.
 */
export const G21_MARKER_SINCE = new Date("2026-11-13T07:00:00Z");

/** G3: every row has a real `YYYY-MM-DD` date before today in the kennel's timezone and before frozenAt. */
export function checkRowDates(rows: readonly RawEventData[], today: string, frozenAt: string): number[] {
  const bad: number[] = [];
  rows.forEach((r, i) => {
    const valid = YMD.test(r.date) && new Date(`${r.date}T12:00:00Z`).toISOString().slice(0, 10) === r.date;
    if (!valid || r.date >= today || r.date >= frozenAt) bad.push(i);
  });
  return bad;
}

/** G4 (rows): exactly one kennel tag per row, equal to the expected kennel code. */
export function checkRowRouting(rows: readonly RawEventData[], kennelCode: string): number[] {
  const bad: number[] = [];
  rows.forEach((r, i) => {
    if (r.kennelTags.length !== 1 || r.kennelTags[0] !== kennelCode) bad.push(i);
  });
  return bad;
}

/** Section 3: one tag, no series, no external links per row. */
export function checkRowShape(rows: readonly RawEventData[]): number[] {
  const bad: number[] = [];
  rows.forEach((r, i) => {
    if (r.seriesId || r.seriesParent || r.externalLinks?.length) bad.push(i);
  });
  return bad;
}

/** G7 (order) and section 3: strict run order within the caps, and at most 5% of rows unnumbered. */
export function checkRunOrder(rows: readonly RawEventData[]): string[] {
  const problems: string[] = [];
  const exceptions = findRunNumberExceptions(rows);
  const cap = Math.min(RUN_EXCEPTION_MAX_ROWS, Math.floor(rows.length * RUN_EXCEPTION_MAX_SHARE));
  if (exceptions.length > cap) problems.push(`run-order: ${exceptions.length} rows break the strict run order (cap ${cap})`);
  const unnumbered = rows.filter((r) => r.runNumber == null).length;
  if (unnumbered > rows.length * UNNUMBERED_MAX_SHARE) {
    problems.push(`unnumbered: ${unnumbered} of ${rows.length} rows have no run number (cap 5%)`);
  }
  return problems;
}

/** G13 (size): rows ≤ BACKFILL_MAX_ROWS. */
export function checkSize(rowCount: number): string[] {
  return rowCount > BACKFILL_MAX_ROWS ? [`size: ${rowCount} rows, cap ${BACKFILL_MAX_ROWS}`] : [];
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/** Whether `name` occurs in `text` as a whole word (no letter or digit on either side), case-insensitively. */
function containsWord(text: string, name: string): boolean {
  for (let at = text.indexOf(name); at !== -1; at = text.indexOf(name, at + 1)) {
    const before = at > 0 ? text[at - 1] : "";
    const after = text[at + name.length] ?? "";
    if (!WORD_CHAR.test(before) && !WORD_CHAR.test(after)) return true;
  }
  return false;
}

/**
 * G6: no row's title, hares, location or description names another kennel of
 * the same region by its code, short name or alias (whole words, any case).
 * Names shorter than 3 characters are ignored; they'd match ordinary words.
 */
export function checkSiblingMentions(
  rows: readonly RawEventData[],
  siblings: ReadonlyArray<{ kennelCode: string; names: readonly string[] }>,
): Array<{ row: number; kennelCode: string }> {
  const named = siblings.map((s) => ({
    kennelCode: s.kennelCode,
    names: [...new Set(s.names.map((n) => n.trim().toLowerCase()).filter((n) => n.length >= 3))],
  }));
  const hits: Array<{ row: number; kennelCode: string }> = [];
  rows.forEach((r, i) => {
    const text = [r.title, r.hares, r.location, r.description].filter(Boolean).join("\n").toLowerCase();
    for (const s of named) if (s.names.some((n) => containsWord(text, n))) hits.push({ row: i, kennelCode: s.kennelCode });
  });
  return hits;
}

/** G21 (key): every row of the committed file carries `recurringSeriesId`, as the id or an explicit null. */
export function checkSeriesMarkerKeys(rows: readonly unknown[]): number[] {
  const bad: number[] = [];
  rows.forEach((r, i) => {
    if (!r || typeof r !== "object" || !Object.hasOwn(r, "recurringSeriesId")) bad.push(i);
  });
  return bad;
}

/**
 * Paths a PR may not touch for its backfill to be automated (G15): the code
 * that judges the archive. The owner can still apply such a PR by hand.
 */
export const GUARD_PATHS: readonly string[] = [
  "src/lib/backfill/",
  "src/lib/migration-sql/",
  "src/lib/archive-source.ts",
  "src/lib/delete-leaked-event.ts",
  "src/lib/event-write.ts",
  "src/lib/event-filters.ts",
  "src/lib/kennel-page-events.ts",
  "src/pipeline/merge.ts",
  "src/pipeline/kennel-resolver.ts",
  "src/pipeline/fingerprint.ts",
  "src/pipeline/scrape.ts",
  "src/pipeline/reconcile.ts",
  "src/pipeline/kennel-evidence.ts",
  "src/app/admin/sources/actions.ts",
  "src/app/admin/backfills/",
  "src/app/api/agent/backfill/",
  "src/app/api/cron/backfill-watch/",
  "scripts/ci/",
  "prisma/schema.prisma",
  ".github/workflows/",
];

/** The package files whose `libpg-query` entries are guarded (G15: G17's parser). */
const PACKAGE_FILES = new Set(["package.json", "package-lock.json"]);

/**
 * G15: the guard paths among a PR's changed files. `patches` (GitHub's per-file
 * patch) decides whether a package-file change touches `libpg-query`; a
 * package file changed without a patch to read counts as touching it.
 */
export function touchedGuardPaths(changedFiles: readonly string[], patches: Readonly<Record<string, string | undefined>> = {}): string[] {
  return changedFiles.filter((f) => {
    if (PACKAGE_FILES.has(f)) return patches[f] === undefined || patches[f]!.includes("libpg-query");
    return GUARD_PATHS.some((g) => (g.endsWith("/") ? f.startsWith(g) : f === g));
  });
}

/** Days of [a, b] (inclusive) that fall inside any of the gaps. */
function gapDaysWithin(a: string, b: string, gaps: readonly ExpectedGap[]): number {
  let days = 0;
  for (const g of gaps) {
    const lo = g.start > a ? g.start : a;
    const hi = g.end < b ? g.end : b;
    if (hi >= lo) days += daysBetween(lo, hi) + 1;
  }
  return days;
}

/**
 * The median interval between run dates over the archive's last 20 rows,
 * leaving out any interval that a declared gap overlaps (6.5).
 */
export function medianRunInterval(sortedDates: readonly string[], gaps: readonly ExpectedGap[]): number | null {
  const unique = [...new Set(sortedDates)];
  const tail = unique.slice(-20);
  const intervals: number[] = [];
  for (let i = 1; i < tail.length; i++) {
    if (gapDaysWithin(addDays(tail[i - 1], 1), addDays(tail[i], -1), gaps) > 0) continue;
    intervals.push(daysBetween(tail[i - 1], tail[i]));
  }
  return intervals.length ? median(intervals) : null;
}

/**
 * G20 (gap): when the archive ends before C, the distance from its last row to
 * C, less any declared gap days in between, is at most 1.5 median run
 * intervals. A trailing gap must end on or before C.
 */
export function checkStretchGap(sortedDates: readonly string[], splitDate: string, gaps: readonly ExpectedGap[]): string[] {
  const last = sortedDates.at(-1);
  if (!last || last >= splitDate) return [];
  const problems: string[] = [];
  for (const g of gaps) {
    if (g.start > last && g.end > splitDate) problems.push(`trailing-gap-past-split: gap ${g.start}..${g.end} ends after the split point`);
  }
  const interval = medianRunInterval(sortedDates, gaps);
  if (interval === null) return [...problems, "gap: too few rows to measure the run interval"];
  const distance = daysBetween(last, splitDate) - gapDaysWithin(addDays(last, 1), addDays(splitDate, -1), gaps);
  if (distance > 1.5 * interval) {
    problems.push(`gap: ${distance} days between the archive's last row and the live feed's first run, over 1.5 × the ${interval}-day median interval`);
  }
  return problems;
}

/**
 * G20 / V2 (coverage): of the numbered archive rows dated from C to frozenAt,
 * leaving out curated corrections, at least 95% appear in the kennel's
 * displayed events by (date, run number). At least 10 rows, or half the
 * stretch's rows if fewer, must remain to be counted.
 */
export function checkLiveCoverage(
  stretch: ReadonlyArray<{ index: number; date: string; runNumber: number | null | undefined }>,
  corrections: ReadonlySet<number>,
  displayed: ReadonlySet<string>,
): { counted: number; present: number; missing: number[]; problems: string[] } {
  const countable = stretch.filter((r) => r.runNumber != null && !corrections.has(r.index));
  const missing = countable.filter((r) => !displayed.has(`${r.date}#${r.runNumber}`)).map((r) => r.index);
  const present = countable.length - missing.length;
  const problems: string[] = [];
  if (stretch.length > 0) {
    const needed = Math.min(10, Math.ceil(stretch.length / 2));
    if (countable.length < needed) problems.push(`coverage: only ${countable.length} of ${stretch.length} live-owned rows can be counted (need ${needed})`);
    else if (present < 0.95 * countable.length) problems.push(`coverage: the live feed shows ${present} of ${countable.length} live-owned rows (need 95%)`);
  }
  return { counted: countable.length, present, missing, problems };
}
