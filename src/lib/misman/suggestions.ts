/**
 * Smart suggestion scoring for attendance forms.
 * Pure function — no DB or auth dependencies.
 *
 * Weights: 35% kennel frequency, 15% roster frequency, 30% recency, 20% streak.
 * For single-kennel rosters, kennel + roster frequency collapse to 50% (unchanged).
 * Returns hashers sorted by score descending, filtered above threshold.
 */

export const KENNEL_FREQUENCY_WEIGHT = 0.35;
export const ROSTER_FREQUENCY_WEIGHT = 0.15;
export const RECENCY_WEIGHT = 0.3;
export const STREAK_WEIGHT = 0.2;
export const SUGGESTION_THRESHOLD = 0.3;
export const LOOKBACK_DAYS = 180;
export const MIN_EVENTS_FOR_SUGGESTIONS = 3;
export const MAX_STREAK = 4;

export interface AttendanceRecord {
  kennelHasherId: string;
  eventId: string;
  eventDate: Date;
}

export interface KennelEvent {
  id: string;
  date: Date;
}

export interface SuggestionInput {
  /** The kennel being managed */
  kennelId: string;
  /** All kennel IDs in the roster group (includes kennelId) */
  rosterKennelIds: string[];
  /** Events for THIS kennel only (within lookback window) */
  kennelEvents: KennelEvent[];
  /** Events for ALL kennels in the roster group (within lookback window).
   *  For single-kennel rosters, this equals kennelEvents. */
  rosterEvents: KennelEvent[];
  /** All attendance across the roster group (within lookback window) */
  attendanceRecords: AttendanceRecord[];
  /** All KennelHasher IDs in roster scope */
  rosterHasherIds: string[];
  /** Map of eventId → kennelId for scoping */
  eventKennelMap: Map<string, string>;
}

export interface SuggestionScore {
  kennelHasherId: string;
  score: number;
  /** Attendance rate at THIS kennel's events */
  frequency: number;
  /** Attendance rate across ALL roster-group events (same as frequency for single-kennel rosters) */
  rosterFrequency: number;
  recency: number;
  streak: number;
}

/**
 * Compute suggestion scores for all roster hashers.
 * @param input - Pre-fetched data scoped to lookback window
 * @param referenceDate - For deterministic testing; defaults to now
 */
export function computeSuggestionScores(
  input: SuggestionInput,
  referenceDate: Date = new Date(),
): SuggestionScore[] {
  const { kennelId, kennelEvents, attendanceRecords, rosterHasherIds, eventKennelMap } = input;
  const isMultiKennel = input.rosterKennelIds.length > 1;

  // Not enough data to produce meaningful suggestions
  // For multi-kennel rosters, roster-wide events count toward the minimum
  const eventsForMinCheck = isMultiKennel ? input.rosterEvents : kennelEvents;
  if (eventsForMinCheck.length < MIN_EVENTS_FOR_SUGGESTIONS) {
    return [];
  }

  // Sort kennel events by date descending for streak calculation
  const sortedKennelEvents = [...kennelEvents].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
  const kennelEventIds = new Set(kennelEvents.map((e) => e.id));
  const rosterEventIds = isMultiKennel
    ? new Set(input.rosterEvents.map((e) => e.id))
    : kennelEventIds;

  // Index attendance by hasher
  const attendanceByHasher = new Map<string, AttendanceRecord[]>();
  for (const record of attendanceRecords) {
    const list = attendanceByHasher.get(record.kennelHasherId) ?? [];
    list.push(record);
    attendanceByHasher.set(record.kennelHasherId, list);
  }

  const refTime = referenceDate.getTime();
  const lookbackMs = LOOKBACK_DAYS * 24 * 60 * 60 * 1000;

  return rosterHasherIds
    .map((hasherId) => {
      const records = attendanceByHasher.get(hasherId) ?? [];

      // --- Kennel frequency: attendance at THIS kennel's events ---
      const thisKennelCount = records.filter((r) =>
        kennelEventIds.has(r.eventId),
      ).length;
      const frequency =
        kennelEvents.length > 0 ? thisKennelCount / kennelEvents.length : 0;

      // --- Roster frequency: attendance across ALL roster-group events ---
      let rosterFrequency: number;
      if (isMultiKennel && input.rosterEvents.length > 0) {
        const rosterCount = records.filter((r) =>
          rosterEventIds.has(r.eventId),
        ).length;
        rosterFrequency = rosterCount / input.rosterEvents.length;
      } else {
        rosterFrequency = frequency;
      }

      // --- Recency: most recent attendance at ANY kennel in roster group ---
      let recency = 0;
      if (records.length > 0) {
        const mostRecent = Math.max(...records.map((r) => r.eventDate.getTime()));
        const daysSince = (refTime - mostRecent) / (24 * 60 * 60 * 1000);
        recency = Math.max(0, 1 - daysSince / LOOKBACK_DAYS);
      }

      // --- Streak: consecutive THIS-kennel events attended (most recent first) ---
      let streak = 0;
      const hasherKennelEventIds = new Set(
        records
          .filter((r) => kennelEventIds.has(r.eventId))
          .map((r) => r.eventId),
      );
      for (const event of sortedKennelEvents) {
        if (hasherKennelEventIds.has(event.id)) {
          streak++;
          if (streak >= MAX_STREAK) break;
        } else {
          break;
        }
      }
      const normalizedStreak = Math.min(1, streak / MAX_STREAK);

      const score =
        KENNEL_FREQUENCY_WEIGHT * frequency +
        ROSTER_FREQUENCY_WEIGHT * rosterFrequency +
        RECENCY_WEIGHT * recency +
        STREAK_WEIGHT * normalizedStreak;

      return {
        kennelHasherId: hasherId,
        score: Math.round(score * 1000) / 1000, // 3 decimal places
        frequency: Math.round(frequency * 1000) / 1000,
        rosterFrequency: Math.round(rosterFrequency * 1000) / 1000,
        recency: Math.round(recency * 1000) / 1000,
        streak: normalizedStreak,
      };
    })
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}
