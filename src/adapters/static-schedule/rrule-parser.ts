/**
 * Pure RRULE parser for the calendar-rule subset the static-schedule adapter
 * generates events from. Lives in a leaf module (no server-only imports) so it
 * can be safely consumed by client components — `formatSchedule` rendering and
 * the KennelDirectory/FilterBar filter derivation paths import from here.
 *
 * The static-schedule adapter re-exports `parseRRule` from this module to keep
 * existing import paths working. Travel Mode projection (`src/lib/travel/
 * projections.ts`) also re-imports via the adapter shim.
 *
 * Supports the RFC 5545 subset: FREQ (WEEKLY | MONTHLY), BYDAY (with optional
 * nth prefix), INTERVAL, BYMONTHDAY, BYMONTH (comma list of 1–12). Rejects
 * BYSETPOS (#1390 — silent-ignore bit Hebe H3 once already).
 */

const SUPPORTED_FREQS = new Set(["WEEKLY", "MONTHLY"]);

/**
 * Weekday RFC 5545 abbreviation → JS `Date.getUTCDay()` number. Inlined here
 * (rather than imported from `src/adapters/utils.ts`) so this leaf module has
 * no server-only transitive deps — utils.ts pulls in safe-fetch → ssrf-dns
 * → `node:dns/promises`, which Turbopack rejects from client bundles.
 */
const RRULE_WEEKDAY_TO_NUM: Record<string, number> = {
  SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6,
};

/** Parsed RRULE shape returned by `parseRRule`. */
export interface ParsedRRule {
  freq: string;
  interval: number;
  byDay?: { day: number; nth?: number };
  byMonthDay?: number;
  byMonth?: number[];
}

/**
 * Parse INTERVAL from RRULE parts. Returns 1 if not specified.
 * @throws {Error} If INTERVAL is not a finite positive integer.
 */
function parseInterval(parts: Record<string, string>): number {
  if (!parts.INTERVAL) return 1;
  const interval = Number.parseInt(parts.INTERVAL, 10);
  if (!Number.isFinite(interval) || interval < 1) {
    throw new Error(`Invalid INTERVAL: ${parts.INTERVAL} (must be >= 1)`);
  }
  return interval;
}

/**
 * Parse BYDAY from RRULE parts. Supports formats like "SA", "2SA" (2nd Saturday),
 * "-1FR" (last Friday). Returns undefined if BYDAY is not present.
 * @throws {Error} If BYDAY format is invalid, day abbreviation is unknown, or nth is 0.
 */
function parseByDay(parts: Record<string, string>): { day: number; nth?: number } | undefined {
  if (!parts.BYDAY) return undefined;
  const match = /^(-?\d+)?([A-Z]{2})$/.exec(parts.BYDAY);
  if (!match) throw new Error(`Invalid BYDAY: ${parts.BYDAY}`);
  const dayNum = RRULE_WEEKDAY_TO_NUM[match[2]];
  if (dayNum === undefined) throw new Error(`Unknown day: ${match[2]}`);
  if (match[1]) {
    const nth = Number.parseInt(match[1], 10);
    if (nth === 0) throw new Error("BYDAY nth position cannot be 0");
    return { day: dayNum, nth };
  }
  return { day: dayNum };
}

/**
 * Parse BYMONTHDAY from RRULE parts. Returns undefined if not present.
 * @throws {Error} If BYMONTHDAY is not a valid day of month (1-31).
 */
function parseByMonthDay(parts: Record<string, string>): number | undefined {
  if (!parts.BYMONTHDAY) return undefined;
  const byMonthDay = Number.parseInt(parts.BYMONTHDAY, 10);
  if (!Number.isFinite(byMonthDay) || byMonthDay < 1 || byMonthDay > 31) {
    throw new Error(`Invalid BYMONTHDAY: ${parts.BYMONTHDAY} (must be 1-31)`);
  }
  return byMonthDay;
}

/**
 * Parse BYMONTH from RRULE parts. Comma-separated list of month numbers (1-12)
 * per RFC 5545 §3.3.10. Returns a deduplicated, sorted list, or undefined if not present.
 * @throws {Error} If the list is empty or contains values outside 1-12.
 */
function parseByMonth(parts: Record<string, string>): number[] | undefined {
  if (!parts.BYMONTH) return undefined;
  const tokens = parts.BYMONTH.split(",").map((t) => t.trim());
  if (tokens.length === 0 || tokens.some((t) => t.length === 0)) {
    throw new Error(`Invalid BYMONTH: ${parts.BYMONTH} (must be a comma-separated list of months 1-12)`);
  }
  const months = new Set<number>();
  for (const token of tokens) {
    if (!/^\d{1,2}$/.test(token)) {
      throw new Error(`Invalid BYMONTH: ${parts.BYMONTH} (each value must be an integer 1-12)`);
    }
    const month = Number.parseInt(token, 10);
    if (month < 1 || month > 12) {
      throw new Error(`Invalid BYMONTH: ${parts.BYMONTH} (each value must be an integer 1-12)`);
    }
    months.add(month);
  }
  return [...months].sort((a, b) => a - b);
}

/**
 * Parse an RRULE string into structured parts.
 * Supports: FREQ (WEEKLY|MONTHLY), BYDAY (with optional nth prefix), INTERVAL,
 * BYMONTHDAY, BYMONTH (comma-separated 1–12). Whitespace around semicolons +
 * equals signs is trimmed.
 *
 * @throws {Error} On missing FREQ, unsupported FREQ, invalid INTERVAL /
 *   BYMONTHDAY / BYMONTH / BYDAY values, or use of BYSETPOS (#1390 silent-
 *   ignore guard).
 */
export function parseRRule(rrule: string): ParsedRRule {
  const parts: Record<string, string> = {};
  for (const segment of rrule.split(";")) {
    const eqIdx = segment.indexOf("=");
    if (eqIdx < 0) continue;
    const key = segment.slice(0, eqIdx).trim().toUpperCase();
    const value = segment.slice(eqIdx + 1).trim().toUpperCase();
    if (key && value) parts[key] = value;
  }

  if (!parts.FREQ) throw new Error("RRULE missing FREQ");
  const freq = parts.FREQ;
  if (!SUPPORTED_FREQS.has(freq)) {
    throw new Error(`Unsupported FREQ: ${freq} (supported: WEEKLY, MONTHLY)`);
  }

  // #1390: BYSETPOS is RFC 5545 valid but THIS parser doesn't honor it — and
  // silently ignoring it caused Hebe H3 to ship "3rd Saturday" RRULEs that
  // generated 1st-Saturday events instead. Fail loud so admins can't introduce
  // the same drift again. The fix is BYDAY nth-prefix (e.g. BYDAY=1SA).
  if (parts.BYSETPOS !== undefined) {
    throw new Error(
      "BYSETPOS is not supported (parser silently ignores it). " +
        'Use BYDAY nth-prefix instead: BYDAY=1SA for "1st Saturday", BYDAY=-1FR for "last Friday".',
    );
  }

  const interval = parseInterval(parts);
  const byDay = parseByDay(parts);
  const byMonthDay = parseByMonthDay(parts);
  const byMonth = parseByMonth(parts);

  if (freq === "WEEKLY" && !byDay) {
    throw new Error("WEEKLY RRULE requires BYDAY");
  }

  return { freq, interval, byDay, byMonthDay, byMonth };
}
