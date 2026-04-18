/**
 * Shared formatting helpers for Travel Mode components.
 */

/**
 * Format a YYYY-MM-DD string as "Apr 14" by default, or "Mon, Apr 14" with
 * `withWeekday: true`. UTC tz keeps the DOW consistent with the UTC-noon
 * convention used throughout Travel Mode — travelers should see the
 * destination's day, not their client's localized day.
 *
 * The leading .slice(0, 10) is defensive: some callers (TravelResultFilters
 * chip tooltips) pass ISO-8601 timestamps like "2026-04-14T12:00:00.000Z".
 * Without the slice, the helper appends "T12:00:00Z" again and produces
 * Invalid Date. Slicing is idempotent for plain YYYY-MM-DD input.
 */
export function formatDateCompact(
  dateStr: string,
  opts: { withWeekday?: boolean } = {},
): string {
  return new Date(dateStr.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    ...(opts.withWeekday ? { weekday: "short" } : {}),
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * UTC start-of-day. Used by trip-window date math (e.g. "is the trip past?",
 * "does the trip start within 7 days?") so noon-stored dates compare cleanly
 * against today regardless of the server's local clock.
 */
export function startOfUtcDay(date: Date = new Date()): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

/** Count days between two YYYY-MM-DD strings. Returns at least 1. */
export function daysBetween(start: string, end: string): number {
  const s = new Date(start + "T12:00:00Z");
  const e = new Date(end + "T12:00:00Z");
  return Math.max(1, Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000)));
}

/**
 * Signed day delta between two YYYY-MM-DD strings: `(end - start)` in days.
 * Returns 0 for same day, positive for end-after-start, negative otherwise.
 * Distinct from `daysBetween` which clamps to 1+ for trip-duration use.
 */
export function daysBetweenIsoDates(start: string, end: string): number {
  const s = new Date(start + "T00:00:00Z").getTime();
  const e = new Date(end + "T00:00:00Z").getTime();
  return Math.round((e - s) / (24 * 60 * 60 * 1000));
}

/**
 * Long-form day header used as a divider inside distance-tier sections:
 * "Tuesday, April 14". Input is an ISO YYYY-MM-DD or ISO timestamp;
 * defensive .slice(0, 10) accepts both. Rendered in UTC to match the
 * UTC-noon date convention travel uses throughout.
 *
 * Deliberately omits the year (cf. `formatDateLong` in `src/lib/format.ts`,
 * which renders "Tuesday, April 14, 2026"). Trip-bounded views always have
 * a year established in the trip-summary stripe above; repeating it on
 * every day header is noise.
 */
export function formatDayHeader(dateStr: string): string {
  return new Date(dateStr.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Humanize a distance with a walking- or driving-time approximation.
 * Uses 5 km/h for the pedestrian leg and 80 km/h for the driving leg —
 * no routing service required, so the estimate is deterministic and
 * offline-safe.
 *
 *   walkMin ≤ 30                   → "X km · ~Y min walk"
 *   walkMin ≤ 90 (≤7.5 km)         → "X km · ~Z h walk"
 *   distanceKm < 25                → "X km · short drive"
 *   distanceKm ≥ 25                → "X km · ~Y min drive" or "~Nh Mm drive"
 */
/** "<1 km" below 1, otherwise "X.X km". Terser than formatDistanceWithWalk. */
export function formatDistanceShort(distanceKm: number): string {
  return distanceKm < 1 ? "<1 km" : `${distanceKm.toFixed(1)} km`;
}

export function formatDistanceWithWalk(distanceKm: number): string {
  const kmLabel = formatDistanceShort(distanceKm);
  const walkMin = Math.round((distanceKm / 5) * 60);
  if (walkMin <= 30) return `${kmLabel} · ~${Math.max(1, walkMin)} min walk`;
  if (walkMin <= 90) {
    const h = Math.round(walkMin / 60);
    return `${kmLabel} · ~${h} h walk`;
  }
  if (distanceKm < 25) return `${kmLabel} · short drive`;
  return `${kmLabel} · ${formatDriveTime(distanceKm)}`;
}

/**
 * Render an estimated drive-time from a distance in km. Assumes 80 km/h
 * average, rounded to the nearest 5 min so the output feels like an
 * estimate rather than false precision. <60 min → "~X min drive",
 * ≥60 min → "~Nh Mm drive" (minute component omitted when it's 0).
 *
 * Caller is responsible for deciding whether the distance warrants a
 * drive-time label at all — see `formatDistanceWithWalk` for the
 * walk/short-drive/drive ladder.
 */
export function formatDriveTime(distanceKm: number): string {
  const rawMin = (distanceKm / 80) * 60;
  const totalMin = Math.max(5, Math.round(rawMin / 5) * 5);
  if (totalMin < 60) return `~${totalMin} min drive`;
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return m === 0 ? `~${h}h drive` : `~${h}h ${m}m drive`;
}

/** Extract 1-2 character initials from a kennel name for the insignia badge. */
export function getKennelInitials(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}
