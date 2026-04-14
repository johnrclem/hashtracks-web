/**
 * URL builder for the /travel page. Mirrors the param names that
 * `src/app/travel/page.tsx` parses via `getParam`. Centralized so callers
 * (NearMeShortcut, SavedTripCard, future entry points) round-trip cleanly.
 */
export interface TravelSearchUrlParams {
  latitude: number;
  longitude: number;
  /** YYYY-MM-DD (or ISO timestamp; sliced internally). */
  startDate: string | Date;
  /** YYYY-MM-DD (or ISO timestamp; sliced internally). */
  endDate: string | Date;
  /** Display label shown in the destination input ("Boston, MA, USA", "Near me"). */
  label: string;
  radiusKm?: number;
  timezone?: string | null;
}

export function buildTravelSearchUrl(p: TravelSearchUrlParams): string {
  const params = new URLSearchParams({
    lat: p.latitude.toString(),
    lng: p.longitude.toString(),
    from: toYmd(p.startDate),
    to: toYmd(p.endDate),
    q: p.label,
  });
  if (p.radiusKm != null) params.set("r", p.radiusKm.toString());
  if (p.timezone) params.set("tz", p.timezone);
  return `/travel?${params.toString()}`;
}

function toYmd(d: string | Date): string {
  return (d instanceof Date ? d.toISOString() : d).slice(0, 10);
}

/**
 * Run `fn` over `items` with at most `limit` calls in flight at once.
 * Used by the saved-trips dashboard to bound the weather-API fan-out:
 * each `executeTravelSearch` can fire up to MAX_WEATHER_API_CALLS=15
 * upstream Google Weather requests, so 10 unbounded saved-trip searches
 * could fire 150 API calls. Capping concurrency at 3 keeps the worst case
 * to ~45 in flight while the page remains responsive (5 trips × 1 batch
 * collapses to ~one search latency anyway).
 */
export async function withConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}
