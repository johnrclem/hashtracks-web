/**
 * Smart suggestion scoring for attendance forms.
 * Pure function — no DB or auth dependencies.
 *
 * Weights: 50% frequency (this kennel), 30% recency (roster group), 20% streak (this kennel).
 * Returns hashers sorted by score descending, filtered above threshold.
 */

export const FREQUENCY_WEIGHT = 0.5;
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
  frequency: number;
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

  // Not enough data to produce meaningful suggestions
  if (kennelEvents.length < MIN_EVENTS_FOR_SUGGESTIONS) {
    return [];
  }

  // Sort kennel events by date descending for streak calculation
  const sortedKennelEvents = [...kennelEvents].sort(
    (a, b) => b.date.getTime() - a.date.getTime(),
  );
  const kennelEventIds = new Set(kennelEvents.map((e) => e.id));

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

      // --- Frequency: attendance at THIS kennel's events / total kennel events ---
      const thisKennelCount = records.filter((r) =>
        kennelEventIds.has(r.eventId),
      ).length;
      const frequency = thisKennelCount / kennelEvents.length;

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
        FREQUENCY_WEIGHT * frequency +
        RECENCY_WEIGHT * recency +
        STREAK_WEIGHT * normalizedStreak;

      return {
        kennelHasherId: hasherId,
        score: Math.round(score * 1000) / 1000, // 3 decimal places
        frequency: Math.round(frequency * 1000) / 1000,
        recency: Math.round(recency * 1000) / 1000,
        streak: normalizedStreak,
      };
    })
    .filter((s) => s.score >= SUGGESTION_THRESHOLD)
    .sort((a, b) => b.score - a.score);
}
