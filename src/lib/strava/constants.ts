/** A Strava activity cache older than this is re-fetched before it is read. */
export const STALE_HOURS = 6;

/**
 * Cached activities not re-fetched within this window are purged by the daily
 * /api/cron/strava-cache-purge run. With a daily cron a row lives under 48h,
 * inside Strava API Policy §6.2 (7-day cache) and §6.3 (deletions within 48h).
 * Must stay well above STALE_HOURS so a fresh sync's rows are never purged.
 */
export const STRAVA_CACHE_TTL_HOURS = 24;

/** True when a cache last synced at `lastSyncAt` is due for a refresh. */
export function isStravaCacheStale(lastSyncAt: Date | string | null | undefined, now = Date.now()): boolean {
  if (!lastSyncAt) return true;
  return now - new Date(lastSyncAt).getTime() >= STALE_HOURS * 60 * 60 * 1000;
}
