/**
 * Get today's date at UTC noon as a timestamp (milliseconds).
 * Used for attendance date comparisons — events are stored as UTC noon
 * to avoid DST issues (PRD Appendix F.4).
 */
export function getTodayUtcNoon(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    12, 0, 0,
  );
}

/**
 * Parse a "YYYY-MM-DD" string into a UTC noon Date.
 * Used when creating Event records from scraped date strings.
 */
export function parseUtcNoonDate(dateStr: string): Date {
  const [yearStr, monthStr, dayStr] = dateStr.split("-");
  return new Date(
    Date.UTC(
      parseInt(yearStr, 10),
      parseInt(monthStr, 10) - 1,
      parseInt(dayStr, 10),
      12, 0, 0,
    ),
  );
}

// Fast path: canonical zero-padded YYYY-MM-DD with in-range components (month
// 01-12, day 01-28) can't overflow or be reinterpreted, so skip the round-trip.
const SAFE_YMD_RE = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|1\d|2[0-8])$/;

/**
 * Normalize a date-ish input to "YYYY-MM-DD" using the same semantics merge
 * uses to construct the canonical `Event.date`. Throws on malformed input —
 * silent mismatch between scraped-side and DB-side slot keys is the failure
 * mode this helper exists to prevent (GH #863 / #864).
 *
 * Strings that don't hit the fast path delegate to `parseUtcNoonDate`, which
 * is exactly what merge uses. That means every shape merge accepts (loose
 * forms like "2026-4-1", space-separated timestamps like "2026-02-14 15:00:00",
 * offset timestamps like "...T23:30-05:00", overflow dates like "2026-02-31"
 * → "2026-03-03") produces the same key merge would write. Deviating here
 * would re-introduce the GH #864 asymmetry: reconcile keying differently from
 * merge's canonical. Inputs where `parseUtcNoonDate` yields Invalid Date throw.
 */
export function toIsoDateString(input: string | Date): string {
  if (input instanceof Date) {
    if (Number.isNaN(input.getTime())) {
      throw new Error(`Invalid date format: ${input}`);
    }
    return input.toISOString().split("T")[0];
  }
  if (SAFE_YMD_RE.test(input)) return input;
  const d = parseUtcNoonDate(input);
  if (!Number.isNaN(d.getTime())) return d.toISOString().split("T")[0];
  throw new Error(`Invalid date format: ${input}`);
}
