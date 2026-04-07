/**
 * The Events Calendar (tribe) REST API utility.
 *
 * "The Events Calendar" by StellarWP is an extremely popular WordPress
 * events plugin. Sites that use it expose a clean JSON endpoint at:
 *
 *   /wp-json/tribe/events/v1/events
 *
 * This utility paginates through upcoming events and returns a lightly
 * normalized shape that adapters can map directly into RawEventData.
 *
 * Plugin docs: https://docs.theeventscalendar.com/reference/classes/rest-api/
 */

import { safeFetch } from "./safe-fetch";
import { decodeEntities, stripHtmlTags } from "./utils";

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

/** Raw event shape returned by /wp-json/tribe/events/v1/events (only the fields we use). */
interface TribeEventCategoryRaw {
  name?: string;
  slug?: string;
}

interface TribeEventVenueRaw {
  venue?: string;
  address?: string;
  city?: string;
  country?: string;
}

interface TribeEventRaw {
  id?: number;
  title?: string;
  description?: string;
  url?: string;
  start_date?: string; // "YYYY-MM-DD HH:MM:SS" in site timezone
  start_date_details?: {
    year: string;
    month: string;
    day: string;
    hour: string;
    minutes: string;
  };
  timezone?: string;
  categories?: TribeEventCategoryRaw[];
  venue?: TribeEventVenueRaw | TribeEventVenueRaw[];
  cost?: string;
  all_day?: boolean;
}

interface TribeEventsResponse {
  events?: TribeEventRaw[];
  total?: number;
  total_pages?: number;
}

/** Normalized event shape emitted by `fetchTribeEvents`. */
export interface TribeEvent {
  id?: number;
  title: string;
  description?: string;
  url?: string;
  date: string; // "YYYY-MM-DD"
  startTime?: string; // "HH:MM" (24h)
  timezone?: string;
  categorySlugs: string[];
  venue?: string;
  location?: string;
  cost?: string;
  allDay: boolean;
}

export interface FetchTribeEventsOptions {
  /** Max results per API page (tribe default is 10, max is 50). */
  perPage?: number;
  /** Max total events to return (defensive cap). */
  maxEvents?: number;
  /** Filter to events whose category slugs intersect this list. */
  categorySlugs?: string[];
}

export interface FetchTribeEventsResult {
  events: TribeEvent[];
  error?: { message: string; status?: number };
  fetchDurationMs?: number;
  /** Count of raw events that failed to normalize (missing title or date). */
  skippedCount: number;
  /** Count of raw events fetched from the API before normalization + filtering. */
  rawCount: number;
}

/** Normalize a single raw tribe event into our shape. Returns null if required fields are missing. */
export function normalizeTribeEvent(raw: TribeEventRaw): TribeEvent | null {
  const details = raw.start_date_details;
  let date: string | undefined;
  let startTime: string | undefined;
  if (details?.year && details.month && details.day) {
    date = `${details.year}-${details.month.padStart(2, "0")}-${details.day.padStart(2, "0")}`;
    if (details.hour && details.minutes) {
      startTime = `${details.hour.padStart(2, "0")}:${details.minutes.padStart(2, "0")}`;
    }
  } else if (raw.start_date) {
    const m = /^(\d{4})-(\d{2})-(\d{2})(?:\s+(\d{2}):(\d{2}))?/.exec(raw.start_date);
    if (m) {
      date = `${m[1]}-${m[2]}-${m[3]}`;
      if (m[4] && m[5]) startTime = `${m[4]}:${m[5]}`;
    }
  }
  if (!date) return null;

  const title = decodeEntities(raw.title ?? "").trim();
  if (!title) return null;

  const categorySlugs = (raw.categories ?? [])
    .map((c) => c.slug)
    .filter((s): s is string => Boolean(s));

  const venueRaw = Array.isArray(raw.venue) ? raw.venue[0] : raw.venue;
  const venue = venueRaw?.venue?.trim() || undefined;
  const addressParts = [venueRaw?.address, venueRaw?.city].filter(Boolean);
  const location = addressParts.length ? addressParts.join(", ") : undefined;

  return {
    id: raw.id,
    title,
    description: raw.description ? stripHtmlTags(decodeEntities(raw.description)) : undefined,
    url: raw.url,
    date,
    startTime,
    timezone: raw.timezone,
    categorySlugs,
    venue,
    location,
    cost: raw.cost?.trim() || undefined,
    allDay: Boolean(raw.all_day),
  };
}

/**
 * Fetch all upcoming events from a site's Tribe Events REST API, following
 * pagination until exhausted or `maxEvents` is reached.
 *
 * @param siteUrl - Base site URL (e.g. "https://choochooh3.com")
 */
export async function fetchTribeEvents(
  siteUrl: string,
  options: FetchTribeEventsOptions = {},
): Promise<FetchTribeEventsResult> {
  const fetchStart = Date.now();
  const base = siteUrl.replace(/\/+$/, "");
  const perPage = Math.min(options.perPage ?? 50, 50);
  const maxEvents = options.maxEvents ?? 200;
  const categoryFilter = options.categorySlugs?.length
    ? new Set(options.categorySlugs.map((s) => s.toLowerCase()))
    : undefined;

  const collected: TribeEvent[] = [];
  let rawCount = 0;
  let skippedCount = 0;
  let page = 1;

  while (true) {
    const url = `${base}/wp-json/tribe/events/v1/events?per_page=${perPage}&page=${page}`;
    let res: Response;
    try {
      res = await safeFetch(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json" },
      });
    } catch (err) {
      return {
        events: collected,
        rawCount,
        skippedCount,
        error: { message: `Fetch error: ${err instanceof Error ? err.message : String(err)}` },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }

    if (!res.ok) {
      // A 404 on an extra page is the plugin's signal that pagination has ended.
      if (res.status === 404 && page > 1) break;
      return {
        events: collected,
        rawCount,
        skippedCount,
        error: { message: `HTTP ${res.status} from ${url}`, status: res.status },
        fetchDurationMs: Date.now() - fetchStart,
      };
    }

    const json = (await res.json()) as TribeEventsResponse;
    const rawEvents = json.events ?? [];
    if (rawEvents.length === 0) break;
    rawCount += rawEvents.length;

    let reachedCap = false;
    for (const raw of rawEvents) {
      const normalized = normalizeTribeEvent(raw);
      if (!normalized) {
        skippedCount++;
        continue;
      }
      if (categoryFilter && !normalized.categorySlugs.some((s) => categoryFilter.has(s.toLowerCase()))) {
        continue;
      }
      collected.push(normalized);
      if (collected.length >= maxEvents) {
        reachedCap = true;
        break;
      }
    }
    if (reachedCap) break;

    // Keep paging until we get a short/empty response or a 404 — don't trust
    // total_pages to bound us (some plugin versions omit it).
    if (rawEvents.length < perPage) break;
    page++;
  }

  return { events: collected, rawCount, skippedCount, fetchDurationMs: Date.now() - fetchStart };
}
