/**
 * URL builder for the /travel page. Mirrors the param names that
 * `src/app/travel/page.tsx` parses via `getParam`. Centralized so callers
 * (NearMeShortcut, SavedTripCard, future entry points) round-trip cleanly.
 */
export interface TravelSearchUrlParams {
  latitude: number;
  longitude: number;
  /**
   * Pre-formatted YYYY-MM-DD. Callers pick local-vs-UTC semantics
   * upfront via `localYmd()` or `utcYmd()` — passing a raw `Date` was
   * ambiguous (NearMeShortcut wants local "today"; SavedTripCard's
   * persisted UTC-noon dates need UTC-day to roundtrip cleanly in
   * UTC+13/UTC+14 timezones). String type forces the choice.
   */
  startDate: string;
  /** Pre-formatted YYYY-MM-DD; see startDate. */
  endDate: string;
  /** Display label shown in the destination input ("Boston, MA, USA", "Near me"). */
  label: string;
  radiusKm?: number;
  timezone?: string | null;
}

export function buildTravelSearchUrl(p: TravelSearchUrlParams): string {
  const params = new URLSearchParams({
    lat: p.latitude.toString(),
    lng: p.longitude.toString(),
    from: p.startDate.slice(0, 10),
    to: p.endDate.slice(0, 10),
    q: p.label,
  });
  if (p.radiusKm != null) params.set("r", p.radiusKm.toString());
  if (p.timezone) params.set("tz", p.timezone);
  return `/travel?${params.toString()}`;
}

/**
 * Format a `Date` as YYYY-MM-DD using LOCAL calendar accessors.
 * Right for callers that built the Date from `new Date()` and want the
 * user's local "today" — NearMeShortcut + PopularDestinations.
 */
export function localYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Format a `Date` as YYYY-MM-DD using UTC accessors. Right for
 * persisted UTC-noon dates (Prisma's TravelDestination.startDate /
 * .endDate) — preserves the saved calendar day even for users in
 * UTC+13 / UTC+14 where local accessors would shift to next-day.
 */
export function utcYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface TravelContext {
  destination: string;
  startDate: string;
  endDate: string;
  /** True when the redirect_url carries `saved=1` — signals post-auth auto-save. */
  isSave: boolean;
}

/**
 * Parse a Travel Mode `redirect_url` like `/travel?q=Boston,+MA&from=…&to=…`
 * back into a structured context. Used by the contextual sign-in banner
 * to render "Save your trip to Boston, MA" above the Clerk form.
 *
 * Returns null when the URL is malformed, doesn't target `/travel`, or
 * lacks the required q/from/to params. The exact-or-prefix path check
 * keeps `/travellers` and friends from triggering a false match.
 */
export function parseTravelRedirect(redirectUrl: string | null): TravelContext | null {
  if (!redirectUrl) return null;
  try {
    // Relative URL — use a dummy origin; only path + search matter.
    const url = new URL(redirectUrl, "https://hashtracks.local");
    const isTravelPath =
      url.pathname === "/travel" || url.pathname.startsWith("/travel/");
    if (!isTravelPath) return null;
    const destination = url.searchParams.get("q");
    const startDate = url.searchParams.get("from");
    const endDate = url.searchParams.get("to");
    if (!destination || !startDate || !endDate) return null;
    return {
      destination,
      startDate,
      endDate,
      isSave: url.searchParams.get("saved") === "1",
    };
  } catch {
    return null;
  }
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
