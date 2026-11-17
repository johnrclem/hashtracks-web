/**
 * Backfill archive manifest (docs/onboarding-backfill-automation-design.md 6.1, 6.2).
 *
 * One shared function computes every field that can be derived from the
 * archive file; the curator declares the rest. CI and the server recompute the
 * derived fields from the committed archive and require them to equal the
 * committed manifest (G2), so the counts the owner approves are the archive's.
 */
import type { RawEventData } from "@/adapters/types";
import { addDays, canonicalJson, daysBetween, sha256 } from "./canonical";
import { PII_SCANNER_VERSION, scanArchiveForPii } from "./pii";

export const MANIFEST_VERSION = 1;
/** Rows a run may write (G13, decision 8). */
export const BACKFILL_MAX_ROWS = 2000;
/** Strict run order (section 3): at most this many exception rows… */
export const RUN_EXCEPTION_MAX_ROWS = 5;
/** …and at most this share of all rows. */
export const RUN_EXCEPTION_MAX_SHARE = 0.01;
/** At most this share of rows may lack a run number (section 3). */
export const UNNUMBERED_MAX_SHARE = 0.05;
/** A declared gap is at most this long (6.1). */
export const GAP_MAX_DAYS = 120;
/** Fields whose fill counts the manifest reports. */
const FILL_FIELDS = ["title", "hares", "location", "startTime", "runNumber", "description", "sourceUrl"] as const;

export type Binding = "archive-source" | "adopt-only";

export interface ExpectedGap {
  /** First day with no run, `YYYY-MM-DD`. */
  start: string;
  /** Last day with no run, `YYYY-MM-DD`. */
  end: string;
  reason: string;
}

export interface CuratedCorrection {
  /** Index of the row in the archive file. */
  row: number;
  reason: string;
}

export interface PerKennelStats {
  rows: number;
  uniqueDates: number;
  firstDate: string;
  lastDate: string;
  rowsWithoutRunNumber: number;
  fill: Record<string, number>;
  /** Three sample titles (oldest, middle, newest); not part of approvalHash. */
  sampleTitles: string[];
}

export interface BackfillManifest {
  version: number;
  archivePath: string;
  archiveSha256: string;
  sourceName: string;
  originSourceName: string;
  binding: Binding;
  kennelTimezone: string;
  /** `YYYY-MM-DD` in kennelTimezone; every row is dated before it. */
  frozenAt: string;
  expectedKennelCodes: string[];
  perKennel: Record<string, PerKennelStats>;
  sameDateGroups: Array<{ kennel: string; date: string; runNumbers: Array<number | null> }>;
  runNumberExceptions: Array<{ row: number; date: string; runNumber: number }>;
  /** Informational, outside approvalHash (6.1). */
  scheduleOnlyEstimate: number;
  expectedGaps: ExpectedGap[];
  curatedCorrections: CuratedCorrection[];
  piiScan: { version: number; residual: number };
  approvalHash: string;
}

/** The fields the curator declares; everything else is derived from the archive. */
export type ManifestDeclaration = Pick<
  BackfillManifest,
  | "archivePath"
  | "sourceName"
  | "originSourceName"
  | "binding"
  | "kennelTimezone"
  | "frozenAt"
  | "expectedKennelCodes"
  | "expectedGaps"
  | "curatedCorrections"
>;

export function parseArchive(bytes: string): RawEventData[] {
  const parsed: unknown = JSON.parse(bytes);
  if (!Array.isArray(parsed)) throw new Error("Archive must be a JSON array of rows");
  for (const [i, row] of parsed.entries()) {
    if (!row || typeof row !== "object" || typeof (row as RawEventData).date !== "string" || !Array.isArray((row as RawEventData).kennelTags)) {
      throw new Error(`Archive row ${i} needs a string date and a kennelTags array`);
    }
  }
  return parsed as RawEventData[];
}

/** Rows in (date, run number) order, unnumbered rows last within a date, then by file index. */
export function orderedIndexes(rows: readonly RawEventData[]): number[] {
  return rows
    .map((_, i) => i)
    .sort((a, b) => {
      const ra = rows[a];
      const rb = rows[b];
      if (ra.date !== rb.date) return ra.date < rb.date ? -1 : 1;
      const na = ra.runNumber ?? Number.POSITIVE_INFINITY;
      const nb = rb.runNumber ?? Number.POSITIVE_INFINITY;
      return na === nb ? a - b : na - nb;
    });
}

/**
 * Rows that break the strict run order: walking numbered rows in (date, run)
 * order, a row whose run number is not above every earlier one.
 */
export function findRunNumberExceptions(rows: readonly RawEventData[]): Array<{ row: number; date: string; runNumber: number }> {
  const out: Array<{ row: number; date: string; runNumber: number }> = [];
  let max = Number.NEGATIVE_INFINITY;
  for (const i of orderedIndexes(rows)) {
    const n = rows[i].runNumber;
    if (n == null) continue;
    if (n <= max) out.push({ row: i, date: rows[i].date, runNumber: n });
    else max = n;
  }
  return out;
}

function isScheduleShaped(row: RawEventData): boolean {
  const hares = (row.hares ?? "").trim();
  return row.recurringSeriesId != null && row.recurringSeriesId !== "" && row.runNumber == null && hares === "";
}

function perKennelStats(rows: readonly RawEventData[]): PerKennelStats {
  const dates = rows.map((r) => r.date).sort();
  const fill: Record<string, number> = {};
  for (const f of FILL_FIELDS) fill[f] = rows.filter((r) => r[f] != null && r[f] !== "").length;
  const ordered = [...rows].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const sampleAt = [0, Math.floor(ordered.length / 2), ordered.length - 1];
  return {
    rows: rows.length,
    uniqueDates: new Set(dates).size,
    firstDate: dates[0] ?? "",
    lastDate: dates.at(-1) ?? "",
    rowsWithoutRunNumber: rows.filter((r) => r.runNumber == null).length,
    fill,
    sampleTitles: rows.length ? sampleAt.map((i) => ordered[i]?.title ?? "") : [],
  };
}

/** Every field derivable from the archive bytes plus the declaration, with the approval hash. */
export function buildManifest(archiveBytes: string, declaration: ManifestDeclaration): BackfillManifest {
  const rows = parseArchive(archiveBytes);
  const byKennel = new Map<string, RawEventData[]>();
  for (const r of rows) {
    const tag = r.kennelTags[0] ?? "";
    byKennel.set(tag, [...(byKennel.get(tag) ?? []), r]);
  }
  const perKennel: Record<string, PerKennelStats> = {};
  for (const [tag, list] of [...byKennel].sort(([a], [b]) => a.localeCompare(b))) perKennel[tag] = perKennelStats(list);

  const groups = new Map<string, Array<number | null>>();
  for (const i of orderedIndexes(rows)) {
    const key = `${rows[i].kennelTags[0] ?? ""}|${rows[i].date}`;
    groups.set(key, [...(groups.get(key) ?? []), rows[i].runNumber ?? null]);
  }
  const sameDateGroups = [...groups]
    .filter(([, runs]) => runs.length > 1)
    .map(([key, runNumbers]) => {
      const [kennel, date] = key.split("|");
      return { kennel, date, runNumbers };
    });

  const manifest: Omit<BackfillManifest, "approvalHash"> = {
    version: MANIFEST_VERSION,
    archivePath: declaration.archivePath,
    archiveSha256: sha256(archiveBytes),
    sourceName: declaration.sourceName,
    originSourceName: declaration.originSourceName,
    binding: declaration.binding,
    kennelTimezone: declaration.kennelTimezone,
    frozenAt: declaration.frozenAt,
    expectedKennelCodes: [...declaration.expectedKennelCodes].sort(),
    perKennel,
    sameDateGroups,
    runNumberExceptions: findRunNumberExceptions(rows).slice(0, 50),
    scheduleOnlyEstimate: rows.filter(isScheduleShaped).length,
    expectedGaps: declaration.expectedGaps,
    curatedCorrections: declaration.curatedCorrections,
    piiScan: { version: PII_SCANNER_VERSION, residual: scanArchiveForPii(rows).length },
  };
  return { ...manifest, approvalHash: computeApprovalHash(manifest) };
}

/** SHA-256 over every field except sample titles, the schedule-only estimate and the hash itself (6.1). */
export function computeApprovalHash(manifest: Omit<BackfillManifest, "approvalHash"> | BackfillManifest): string {
  const { scheduleOnlyEstimate: _estimate, ...rest } = manifest as BackfillManifest;
  const { approvalHash: _hash, ...hashed } = rest as BackfillManifest;
  const perKennel: Record<string, Omit<PerKennelStats, "sampleTitles">> = {};
  for (const [k, { sampleTitles: _titles, ...stats }] of Object.entries(hashed.perKennel)) perKennel[k] = stats;
  return sha256(canonicalJson({ ...hashed, perKennel }));
}

export interface ManifestProblem {
  code: string;
  detail: string;
}

/**
 * G2: the committed manifest equals the recomputed one in every approvalHash
 * field, and its own approvalHash is right. Declared fields are taken from
 * the committed manifest, so only the derived ones can differ.
 */
export function compareManifest(committed: BackfillManifest, archiveBytes: string): ManifestProblem[] {
  const recomputed = buildManifest(archiveBytes, committed);
  const problems: ManifestProblem[] = [];
  if (computeApprovalHash(committed) !== committed.approvalHash) {
    problems.push({ code: "approval-hash-stale", detail: "approvalHash doesn't match the manifest's own fields" });
  }
  if (recomputed.approvalHash !== committed.approvalHash) {
    for (const key of Object.keys(recomputed) as Array<keyof BackfillManifest>) {
      if (key === "approvalHash" || key === "scheduleOnlyEstimate") continue;
      const a = key === "perKennel" ? stripTitles(recomputed.perKennel) : recomputed[key];
      const b = key === "perKennel" ? stripTitles(committed.perKennel) : committed[key];
      if (canonicalJson(a) !== canonicalJson(b)) problems.push({ code: "manifest-drift", detail: `${key} differs from the archive` });
    }
    if (problems.length === 0) problems.push({ code: "manifest-drift", detail: "approvalHash differs from the archive" });
  }
  return problems;
}

function stripTitles(perKennel: Record<string, PerKennelStats>): unknown {
  return Object.fromEntries(Object.entries(perKennel ?? {}).map(([k, { sampleTitles: _t, ...s }]) => [k, s]));
}

const YMD = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The declared fields' shape and caps (6.1, 6.2): every correction names a real
 * row, within max(20, 2% of rows); every gap is well formed, at most 120 days,
 * contains no row and lies inside the archive's span, except at most one
 * trailing gap after the last row, which must recur in the archive's history.
 */
export function checkDeclaredFields(manifest: ManifestDeclaration, rows: readonly RawEventData[]): ManifestProblem[] {
  const problems: ManifestProblem[] = [];
  const cap = Math.max(20, Math.floor(rows.length * 0.02));
  if (manifest.curatedCorrections.length > cap) {
    problems.push({ code: "corrections-cap", detail: `${manifest.curatedCorrections.length} curated corrections, cap ${cap}` });
  }
  const seenRows = new Set<number>();
  for (const c of manifest.curatedCorrections) {
    if (!Number.isInteger(c.row) || c.row < 0 || c.row >= rows.length || seenRows.has(c.row)) {
      problems.push({ code: "correction-row", detail: `curated correction names row ${c.row}` });
    }
    seenRows.add(c.row);
  }

  const dates = rows.map((r) => r.date).sort();
  const first = dates[0];
  const last = dates.at(-1);
  let trailing = 0;
  for (const g of manifest.expectedGaps) {
    if (!YMD.test(g.start) || !YMD.test(g.end) || g.end < g.start || !g.reason?.trim()) {
      problems.push({ code: "gap-shape", detail: `gap ${g.start}..${g.end} is malformed` });
      continue;
    }
    if (daysBetween(g.start, g.end) + 1 > GAP_MAX_DAYS) problems.push({ code: "gap-length", detail: `gap ${g.start}..${g.end} is over ${GAP_MAX_DAYS} days` });
    if (dates.some((d) => d >= g.start && d <= g.end)) problems.push({ code: "gap-has-row", detail: `gap ${g.start}..${g.end} contains a row` });
    if (last && g.start > last) {
      trailing++;
      if (!trailingGapRecurs(g, dates)) problems.push({ code: "trailing-gap-unproven", detail: `trailing gap ${g.start}..${g.end} doesn't recur in the archive` });
    } else if (!first || g.start < first || g.end > (last ?? "")) {
      problems.push({ code: "gap-outside-span", detail: `gap ${g.start}..${g.end} is outside the archive's span` });
    }
  }
  if (trailing > 1) problems.push({ code: "trailing-gaps", detail: `${trailing} trailing gaps; at most one is allowed` });
  return problems;
}

/** The calendar window of `gap` placed in year `year` (a window that wraps the new year starts in `year`). */
function windowInYear(gap: ExpectedGap, year: number): { start: string; end: string } {
  const wraps = gap.end.slice(0, 4) !== gap.start.slice(0, 4);
  return {
    start: `${year}${gap.start.slice(4)}`,
    end: `${wraps ? year + 1 : year}${gap.end.slice(4)}`,
  };
}

/**
 * 6.1: in at least 2 of the 3 most recent full calendar years before the last
 * row (2020 and 2021 don't count), the archive has a stretch with no runs that
 * covers at least 80% of the gap's calendar days and is at most 1.5 times its length.
 */
export function trailingGapRecurs(gap: ExpectedGap, sortedDates: readonly string[]): boolean {
  const last = sortedDates.at(-1);
  if (!last) return false;
  const length = daysBetween(gap.start, gap.end) + 1;
  const years: number[] = [];
  for (let y = Number(last.slice(0, 4)) - 1; years.length < 3 && y > 1900; y--) {
    if (y !== 2020 && y !== 2021) years.push(y);
  }
  let hits = 0;
  for (const y of years) {
    const w = windowInYear(gap, y);
    const wDays = daysBetween(w.start, w.end) + 1;
    // Each no-run stretch lies strictly between two consecutive run dates.
    for (let i = 0; i + 1 < sortedDates.length; i++) {
      const a = addDays(sortedDates[i], 1);
      const b = addDays(sortedDates[i + 1], -1);
      if (b < a) continue;
      const stretch = daysBetween(a, b) + 1;
      if (stretch > 1.5 * length) continue;
      const lo = a > w.start ? a : w.start;
      const hi = b < w.end ? b : w.end;
      const overlap = hi >= lo ? daysBetween(lo, hi) + 1 : 0;
      if (overlap >= 0.8 * wDays) {
        hits++;
        break;
      }
    }
  }
  return hits >= 2;
}
