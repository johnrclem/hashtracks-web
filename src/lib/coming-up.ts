/**
 * Picks the runs for the homepage "Coming up" section: runs near the visitor
 * when their area is known, otherwise the next runs anywhere. Only runs that
 * haven't started yet in their kennel's own time zone are shown.
 */

import { toIsoDateString } from "@/lib/date";
import { haversineDistance } from "@/lib/geo";
import { formatYmdInTimezone } from "@/lib/timezone";

export interface ComingUpCandidate {
  /** The run's local date, stored as UTC noon. */
  date: Date;
  /** Exact start in UTC (set by the merge pipeline); UTC noon of `date` when the start time is unknown. */
  dateUtc: Date | null;
  /** Local start time "HH:MM", or null when the source didn't give one. */
  startTime: string | null;
  /** The run's IANA time zone. */
  timezone: string | null;
  /** Where the run is (event, else kennel, else region center). */
  latitude: number | null;
  longitude: number | null;
}

/** Search radii tried in order; the first with at least three runs wins. */
const NEARBY_RADII_KM = [50, 150] as const;
export const MAX_NEARBY_RADIUS_KM = NEARBY_RADII_KM[NEARBY_RADII_KM.length - 1];
const MIN_NEARBY_RESULTS = 3;

/** True when the run hasn't started yet. Runs with no start time count until their local day ends. */
export function isStillAhead(c: ComingUpCandidate, now: Date): boolean {
  if (c.startTime && c.dateUtc) return c.dateUtc.getTime() > now.getTime();
  return toIsoDateString(c.date) >= formatYmdInTimezone(now, c.timezone);
}

function byStart(a: ComingUpCandidate, b: ComingUpCandidate): number {
  return (a.dateUtc ?? a.date).getTime() - (b.dateUtc ?? b.date).getTime();
}

export interface NearbyPick<T> {
  events: T[];
  radiusKm: number;
}

/**
 * Runs near the visitor: the first radius with at least three runs, else the
 * widest radius if it has any. Null when nothing is close enough.
 */
export function pickNearby<T extends ComingUpCandidate>(
  candidates: T[],
  area: { latitude: number; longitude: number },
  now: Date,
  limit: number,
): NearbyPick<T> | null {
  const withDistance = candidates
    .filter((c) => c.latitude !== null && c.longitude !== null && isStillAhead(c, now))
    .map((c) => ({ c, km: haversineDistance(area.latitude, area.longitude, c.latitude!, c.longitude!) }));

  let widest: T[] = [];
  for (const radiusKm of NEARBY_RADII_KM) {
    widest = withDistance.filter((x) => x.km <= radiusKm).map((x) => x.c);
    if (widest.length >= MIN_NEARBY_RESULTS) return { events: widest.sort(byStart).slice(0, limit), radiusKm };
  }
  return widest.length > 0
    ? { events: widest.sort(byStart).slice(0, limit), radiusKm: MAX_NEARBY_RADIUS_KM }
    : null;
}

/** The next runs anywhere that haven't started yet, soonest first. */
export function pickWorld<T extends ComingUpCandidate>(candidates: T[], now: Date, limit: number): T[] {
  return candidates.filter((c) => isStillAhead(c, now)).sort(byStart).slice(0, limit);
}
