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

/**
 * Discriminated union of intents a Travel Mode sign-in redirect can
 * carry. Three variants, one per user-visible entry path:
 *
 *   "save"        — redirect_url is `/travel?q=…&saved=1`: user clicked
 *                   Save Trip while signed out.
 *   "continuing"  — redirect_url is `/travel?q=…` (no saved=1): user
 *                   was browsing a specific destination.
 *   "saved-trips" — redirect_url is `/travel/saved`: user clicked "Your
 *                   saved trips →" from the landing page.
 *
 * null means the redirect isn't Travel-related at all — sign-in renders
 * the generic "Welcome back to HashTracks" header.
 */
export type TravelContext =
  | { kind: "save"; destination: string; startDate: string; endDate: string }
  | { kind: "continuing"; destination: string; startDate: string; endDate: string }
  | { kind: "saved-trips" };

/**
 * Parse a Travel Mode `redirect_url` back into a structured context.
 * Used by the contextual sign-in banner to render destination-specific
 * copy above the Clerk form. Returns null when the URL is malformed,
 * doesn't target a Travel route, or lacks required params.
 *
 * The exact-or-prefix path check keeps `/travellers` and friends from
 * triggering false matches.
 */
export function parseTravelRedirect(redirectUrl: string | null): TravelContext | null {
  if (!redirectUrl) return null;
  try {
    // Relative URL — use a dummy origin; only path + search matter.
    const url = new URL(redirectUrl, "https://hashtracks.local");

    // /travel/saved — saved-trips dashboard. Anyone redirected here is
    // coming from the "Your saved trips →" landing-page flow, NOT from
    // a per-destination Save-Trip flow. No destination context needed.
    if (
      url.pathname === "/travel/saved" ||
      url.pathname.startsWith("/travel/saved/")
    ) {
      return { kind: "saved-trips" };
    }

    // /travel — results/search route. Needs q + from + to to carry
    // meaningful context; without them the banner can't name a
    // destination and we fall through to generic welcome copy.
    const isTravelPath =
      url.pathname === "/travel" || url.pathname.startsWith("/travel/");
    if (!isTravelPath) return null;
    const destination = url.searchParams.get("q");
    const startDate = url.searchParams.get("from");
    const endDate = url.searchParams.get("to");
    if (!destination || !startDate || !endDate) return null;
    const isSave = url.searchParams.get("saved") === "1";
    return {
      kind: isSave ? "save" : "continuing",
      destination,
      startDate,
      endDate,
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
