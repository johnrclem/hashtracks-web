/**
 * Best-match scoring for Strava activities against hash events.
 * Used by StravaNudgeBanner to pick the most likely match for collapsed headers.
 */
import { fuzzyNameMatch } from "@/lib/fuzzy";

interface ScoredActivity {
  activityName: string;
  stravaSportType: string;
  stravaTimeLocal: string | null;
}

const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

/**
 * Score a Strava activity against an event for match quality.
 * Higher is better. Range: 0–4.2 (name×3 + time×1 + sport×0.2).
 */
export function scoreMatch(
  activity: ScoredActivity,
  kennelShortName: string,
  eventStartTime: string | null,
): number {
  // 1. Name match (0–1, weighted 3x)
  const nameScore = fuzzyNameMatch(activity.activityName, kennelShortName);

  // 2. Time proximity (0–1): how close is the activity time to the event start time?
  let timeScore = 0.5; // default when no times available
  if (eventStartTime && activity.stravaTimeLocal) {
    const eventMins = timeToMinutes(eventStartTime);
    const activityMins = timeToMinutes(activity.stravaTimeLocal);
    if (eventMins !== null && activityMins !== null) {
      const diffMins = Math.abs(eventMins - activityMins);
      // 0 diff = 1.0, 120+ min diff = 0.0
      timeScore = Math.max(0, 1 - diffMins / 120);
    }
  }

  // 3. Sport type bonus (0.0 or 0.2): prefer runs over walks/rides
  const sportBonus = RUN_TYPES.has(activity.stravaSportType) ? 0.2 : 0;

  // Weighted combination: name×3 + time×1 + sport×0.2
  return nameScore * 3 + timeScore + sportBonus;
}

/**
 * Find the index of the best-matching activity in a list.
 */
export function findBestMatchIndex(
  activities: ScoredActivity[],
  kennelShortName: string,
  eventStartTime: string | null,
): number {
  if (activities.length === 0) return 0;
  let bestIdx = 0;
  let bestScore = -1;
  for (let i = 0; i < activities.length; i++) {
    const s = scoreMatch(activities[i], kennelShortName, eventStartTime);
    if (s > bestScore) {
      bestScore = s;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function timeToMinutes(time: string): number | null {
  const match = time.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  return parseInt(match[1], 10) * 60 + parseInt(match[2], 10);
}
