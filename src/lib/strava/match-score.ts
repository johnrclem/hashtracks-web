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
}

export interface ScoreBreakdown {
  total: number;
  nameScore: number;
  geoScore: number;
  geoKm: number | null; // actual distance in km, null if coords missing
  timeScore: number;
  sportBonus: number;
}

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

/** Zero breakdown returned on early-exit (e.g. generic activity names). */
const ZERO_BREAKDOWN: ScoreBreakdown = {
  total: 0,
  nameScore: 0,
  geoScore: 0,
  geoKm: null,
  timeScore: 0,
  sportBonus: 0,
};

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
): ScoreBreakdown {
  // 1. Name match (0–1, weighted 3x)
  const nameScore = fuzzyNameMatch(activity.activityName, kennelShortName);

  // Low name scores get scored but won't pass the suggestion threshold (2.0).
  // We still compute the full breakdown so findBestMatchIndex can rank by time/geo
  // even when all candidates have generic names like "Afternoon Run".

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
  } else if (activityHasCoords && !eventHasCoords) {
    // Activity has GPS but event lacks coords — penalize to prevent cross-continent matches
    geoScore = -0.5;
  }

  // 3. Time proximity (0–1): how close is the activity time to the event start time?
  let timeScore = 0.3; // default when no times available
  if (eventStartTime && activity.stravaTimeLocal) {
    const eventMins = timeToMinutes(eventStartTime);
    const activityMins = timeToMinutes(activity.stravaTimeLocal);
    if (eventMins !== null && activityMins !== null) {
      const diffMins = Math.abs(eventMins - activityMins);
      // 0 diff = 1.0, 120+ min diff = 0.0
      timeScore = Math.max(0, 1 - diffMins / 120);
    }
  }

  // 4. Sport type bonus (0.0 or 0.2): prefer runs over walks/rides
  const sportBonus = RUN_TYPES.has(activity.stravaSportType) ? 0.2 : 0;

  // Weighted combination: name×3 + geo×2 + time×1 + sport×0.2
  const total = nameScore * 3 + geoScore * 2 + timeScore + sportBonus;

  return { total, nameScore, geoScore, geoKm, timeScore, sportBonus };
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
): number {
  if (activities.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < activities.length; i++) {
    const s = scoreMatch(activities[i], kennelShortName, eventStartTime, eventLat, eventLng);
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
