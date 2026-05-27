/**
 * Venue-weekend campout end-date heuristic — shared across the merge
 * pipeline and individual adapters (refs #1560).
 *
 * Originally lived in `src/adapters/hashrego/parser.ts` (PR #1637) where
 * it ran during Hash Rego parse-time. Lifted here in PR H so:
 *   1. It runs on every canonical Event description in `mergePipeline`,
 *      regardless of source adapter. The audit (#1718) found 4 non-Hash-
 *      Rego events (Hollyweird HapPy Hour, RIH3 Analversary, KWH3 1993,
 *      Oregon HHH Spring) with Friday:/Saturday:/Sunday: section labels
 *      that the adapter never knew to interpret as a date range.
 *   2. The Hash Rego adapter continues to call it directly so its
 *      RawEventData.endDate reflects the same value the merge pipeline
 *      would compute — keeping the existing per-day kennel-attribution
 *      branch in `splitToRawEvents` informed when the heuristic fires.
 *
 * Trigger criteria (ALL required):
 *   1. The title OR description contains `camp(out)|weekend|retreat|rendezvous`.
 *   2. The description mentions ≥ 2 DISTINCT weekday names.
 *   3. Counting forward from `startDateStr`'s weekday, the latest
 *      mentioned weekday is ≤ MAX_FORWARD_OFFSET days ahead AND not
 *      collapsed onto the start day.
 *
 * Returns the inclusive last day (`YYYY-MM-DD`). Returns `null` when
 * criteria aren't met.
 */

const VENUE_WEEKEND_TRIGGER_RE = /\b(?:camp\s?out|weekend|retreat|rendezvous)\b/i;

/**
 * Broad 3–9 letter token matcher. We then filter against the explicit
 * weekday allow-list `WEEKDAY_NAMES_SET` below. The split (broad regex
 * + Set lookup) keeps regex complexity under Sonar's S5843 threshold —
 * the alternation-heavy original form scored ~24.
 */
const WEEKDAY_NAME_RE = /\b([A-Za-z]{3,9})\b/g;

/**
 * Allow-list of every form `detectVenueWeekendEndDate` accepts. Lowercase
 * for case-insensitive matching without a global `i` flag. "Tues" and
 * "Thurs" are common 4–5 letter abbreviations in hashing descriptions.
 */
const WEEKDAY_NAMES_SET: ReadonlySet<string> = new Set([
  "sun", "sunday",
  "mon", "monday",
  "tue", "tues", "tuesday",
  "wed", "wednesday",
  "thu", "thurs", "thursday",
  "fri", "friday",
  "sat", "saturday",
]);

/** Indexed 0=Sun, 6=Sat — matches `Date.getUTCDay()`. */
const WEEKDAY_PREFIXES: ReadonlyArray<string> = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

/**
 * Cap the forward-wrap on each mentioned weekday's offset. Without this,
 * a description naming a "Thursday prelube" on a Friday-start campout
 * (`(Thu - Fri + 7) % 7 = 6`) would inflate endDate to NEXT Thursday
 * instead of the actual Sunday (Codex P1 on PR #1637). 4 days is the
 * practical ceiling for hashing-weekend lengths — Thu→Mon, Fri→Tue.
 * Anything beyond is treated as a backward reference, not an end-of-
 * range signal. Multi-week events need the explicit
 * `MM/DD ... to MM/DD` format (Strategy 1 in the Hash Rego parser).
 */
const MAX_FORWARD_OFFSET = 4;

export function detectVenueWeekendEndDate(
  description: string,
  title: string,
  startDateStr: string,
): string | null {
  if (!VENUE_WEEKEND_TRIGGER_RE.test(title) && !VENUE_WEEKEND_TRIGGER_RE.test(description)) {
    return null;
  }
  const mentioned = new Set<number>();
  for (const m of description.matchAll(WEEKDAY_NAME_RE)) {
    const lc = m[1].toLowerCase();
    if (!WEEKDAY_NAMES_SET.has(lc)) continue;
    const prefix = lc.slice(0, 3);
    const dow = WEEKDAY_PREFIXES.indexOf(prefix);
    if (dow >= 0) mentioned.add(dow);
  }
  if (mentioned.size < 2) return null;

  // Anchor in UTC noon so the offset arithmetic doesn't slip across a
  // DST boundary (matches the project's UTC-noon date convention from
  // CLAUDE.md §F.4).
  const startDate = new Date(`${startDateStr}T12:00:00Z`);
  if (Number.isNaN(startDate.getTime())) return null;
  const startDow = startDate.getUTCDay();

  let maxOffset = 0;
  for (const dow of mentioned) {
    const offset = (dow - startDow + 7) % 7;
    if (offset > MAX_FORWARD_OFFSET) continue;
    if (offset > maxOffset) maxOffset = offset;
  }
  if (maxOffset === 0) return null;

  const end = new Date(startDate);
  end.setUTCDate(end.getUTCDate() + maxOffset);
  return end.toISOString().split("T")[0];
}
