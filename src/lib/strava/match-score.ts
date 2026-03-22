/**
 * Best-match scoring for Strava activities against hash events.
 * Used by StravaSuggestions to rank activity-event pairs.
 *
 * Score formula: nameScore×3 + geoScore×2 + timeScore×1 + sportBonus(0.2)
 * Range: 0–6.2
 */
import { fuzzyNameMatch } from "@/lib/fuzzy";
import { haversineDistance } from "@/lib/geo";

export interface ScoredActivity {
  activityName: string;
  stravaSportType: string;
  stravaTimeLocal: string | null;
  startLat?: number | null;
  startLng?: number | null;
  timezone?: string | null;
}

export interface ScoreBreakdown {
  total: number;
  nameScore: number;
  geoScore: number;
  geoKm: number | null; // actual distance in km, null if coords missing
  hasGeoSignal: boolean; // true if either side had coordinates
  timeScore: number;
  sportBonus: number;
}

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

/** Generic activity names that carry no kennel-identity signal. */
const GENERIC_NAME = /^(morning|afternoon|evening|lunch|night|daily)?\s*(run|walk|ride|hike|workout|jog|yoga|swim)s?$/i;

/**
 * Score a Strava activity against an event for match quality.
 * Higher is better. Range: 0–6.2 (name×3 + geo×2 + time×1 + sport×0.2).
 * Returns a full breakdown so callers can build match-reason labels
 * without re-computing distances/fuzzy scores.
 */
export function scoreMatch(
  activity: ScoredActivity,
  kennelShortName: string,
  eventStartTime: string | null,
  eventLat?: number | null,
  eventLng?: number | null,
  eventTimezone?: string | null,
): ScoreBreakdown {
  // 1. Name match (0–1, weighted 3x)
  // Generic names like "Afternoon Run" carry zero kennel-identity signal
  const nameScore = GENERIC_NAME.test(activity.activityName.trim())
    ? 0
    : fuzzyNameMatch(activity.activityName, kennelShortName);

  // 2. Geo proximity (weighted 2x)
  // When activity has GPS but event doesn't, penalize to prevent cross-continent matches
  let geoScore = 0;
  let geoKm: number | null = null;
  const activityHasCoords = activity.startLat != null && activity.startLng != null;
  const eventHasCoords = eventLat != null && eventLng != null;

  if (activityHasCoords && eventHasCoords) {
    geoKm = haversineDistance(activity.startLat!, activity.startLng!, eventLat!, eventLng!);
    if (geoKm <= 5) geoScore = 1.0;
    else if (geoKm <= 25) geoScore = 0.5;
    else geoScore = 0;
  } else if (activityHasCoords !== eventHasCoords) {
    // One side has GPS, the other doesn't — cannot verify proximity.
    // Penalty discourages cross-continent matches while preserving local events
    // that don't publish coordinates (or activities from privacy zones).
    geoScore = -0.25;
  }

  // 3. Time proximity (0–1): how close is the activity time to the event start time?
  // When both timezones are known and differ, normalize to UTC before comparing.
  let timeScore = 0.3; // default when no times available
  if (eventStartTime && activity.stravaTimeLocal) {
    let eventMins = timeToMinutes(eventStartTime);
    let activityMins = timeToMinutes(activity.stravaTimeLocal);
    if (eventMins !== null && activityMins !== null) {
      // Normalize to UTC if both timezones are available and different
      const actTz = parseStravaTimezone(activity.timezone);
      if (actTz && eventTimezone && actTz !== eventTimezone) {
        const actOffset = getTimezoneOffsetMinutes(actTz);
        const evtOffset = getTimezoneOffsetMinutes(eventTimezone);
        activityMins = ((activityMins - actOffset) % 1440 + 1440) % 1440;
        eventMins = ((eventMins - evtOffset) % 1440 + 1440) % 1440;
      }
      const diffMins = Math.abs(eventMins - activityMins);
      // 0 diff = 1.0, 120+ min diff = 0.0
      timeScore = Math.max(0, 1 - diffMins / 120);
    }
  }

  // 4. Sport type bonus (0.0 or 0.2): prefer runs over walks/rides
  const sportBonus = RUN_TYPES.has(activity.stravaSportType) ? 0.2 : 0;

  // Weighted combination: name×3 + geo×2 + time×1 + sport×0.2
  const total = nameScore * 3 + geoScore * 2 + timeScore + sportBonus;

  const hasGeoSignal = activityHasCoords || eventHasCoords;
  return { total, nameScore, geoScore, geoKm, hasGeoSignal, timeScore, sportBonus };
}

/**
 * Find the index of the best-matching activity in a list.
 */
export function findBestMatchIndex(
  activities: ScoredActivity[],
  kennelShortName: string,
  eventStartTime: string | null,
  eventLat?: number | null,
  eventLng?: number | null,
  eventTimezone?: string | null,
): number {
  if (activities.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < activities.length; i++) {
    const s = scoreMatch(activities[i], kennelShortName, eventStartTime, eventLat, eventLng, eventTimezone);
    if (s.total > bestScore) {
      bestScore = s.total;
      bestIdx = i;
    }
  }
  return bestIdx;
}

/** Parse "HH:MM" into minutes since midnight. Returns null if unparseable. */
export function timeToMinutes(time: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(time);
  if (!match) return null;
  return Number.parseInt(match[1], 10) * 60 + Number.parseInt(match[2], 10);
}

/**
 * Extract IANA timezone from Strava's format: "(GMT-05:00) America/New_York"
 * Returns null if the string doesn't match the expected format.
 */
export function parseStravaTimezone(raw?: string | null): string | null {
  if (!raw) return null;
  const match = raw.match(/\)\s*(.+)$/);
  return match?.[1]?.trim() ?? null;
}

/**
 * Get the UTC offset in minutes for a given IANA timezone.
 * Positive means ahead of UTC (e.g., +60 for CET), negative means behind (e.g., -300 for EST).
 * Uses a fixed reference date to get a consistent offset.
 */
export function getTimezoneOffsetMinutes(tz: string): number {
  try {
    // Use a fixed reference point to get consistent offset
    const refDate = new Date("2026-06-15T12:00:00Z");
    const utcStr = refDate.toLocaleString("en-US", { timeZone: "UTC" });
    const localStr = refDate.toLocaleString("en-US", { timeZone: tz });
    const utcTime = new Date(utcStr).getTime();
    const localTime = new Date(localStr).getTime();
    return Math.round((localTime - utcTime) / 60000);
  } catch {
    return 0; // Fallback: treat as UTC if timezone is invalid
  }
}
