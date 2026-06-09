/**
 * Shared test date helpers.
 *
 * Adapter `fetch()` tests must NOT pin absolute fixture dates when the adapter
 * applies a relative date-window filter (`buildDateWindow` / `applyDateWindow`,
 * ±`days`): once the wall clock passes the pinned date by more than the window,
 * the events age out and inclusion assertions go red, redlighting CI for every
 * PR. (This is the time-bomb that hit atlanta-hash-board on 2026-06-08.)
 *
 * `relativeDate(daysFromNow)` returns a date offset from "now", anchored at UTC
 * noon to match the project's date-storage convention. It returns composable
 * parts rather than one fixed display string, since sources format dates
 * differently (e.g. "16 March 2099" vs "Friday, March 20, 2026 6:00pm"). See
 * the broader sweep tracked in issue #2066.
 */

const WEEKDAY_NAMES = [
  "Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday",
];
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface RelativeDate {
  /** ISO date, "YYYY-MM-DD" — matches the date a UTC-noon parser emits. */
  iso: string;
  /** Compact date, "YYYYMMDD" — for sources that encode the date in URLs/ids. */
  compact: string;
  /** Full weekday name, e.g. "Friday". */
  weekday: string;
  /** Full month name, e.g. "March". */
  monthName: string;
  /** Day of month (1–31), unpadded. */
  day: number;
  /** Full year. */
  year: number;
}

export function relativeDate(daysFromNow: number): RelativeDate {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + daysFromNow);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const mm = String(month + 1).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return {
    iso: `${year}-${mm}-${dd}`,
    compact: `${year}${mm}${dd}`,
    weekday: WEEKDAY_NAMES[d.getUTCDay()],
    monthName: MONTH_NAMES[month],
    day,
    year,
  };
}
