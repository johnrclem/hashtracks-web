"use server";

/**
 * Hareline server actions.
 *
 * - loadEventsForTimeMode: slim event list for a time mode. Called from
 *   both the initial server render (page.tsx) and lazy client tab-switches
 *   (HarelineView), so the two paths always use the same date boundaries,
 *   ordering, and serialization.
 *   Delegates to an `unstable_cache`-wrapped inner so anonymous traffic
 *   is served from the function's in-region cache. The public shape
 *   (`HarelineListEvent`) keeps `dateUtc` as `Date` — the cache internally
 *   round-trips via ISO string (JSON-safe) and we rehydrate at the boundary
 *   so consumers don't need to know it was cached.
 * - getEventDetail: heavy fields (description, source URL, full address,
 *   eventLinks) fetched on detail-panel expand. Keeps the list payload slim.
 */

import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db";
import { DISPLAY_EVENT_WHERE } from "@/lib/event-filters";

/**
 * Shared invalidation tag. Import from here (rather than inlining the
 * string literal at every call site) so the merge pipeline + admin
 * mutation actions stay in sync with the cache wrapper below.
 */
export const HARELINE_EVENTS_TAG = "hareline:events";

/** Matches the slim shape rendered by EventCard's list view. */
export interface HarelineListEvent {
  id: string;
  date: string; // ISO string
  dateUtc: Date | null;
  timezone: string | null;
  kennelId: string;
  kennel: {
    id: string;
    shortName: string;
    fullName: string;
    slug: string;
    region: string;
    country: string;
  } | null;
  runNumber: number | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  locationName: string | null;
  locationCity: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
}

export type TimeMode = "upcoming" | "past";

/**
 * Past events are capped server-side to keep the payload bounded — 200 is
 * enough to fill several scroll pages while staying under ~400 KB wire.
 */
const PAST_EVENTS_LIMIT = 200;

/**
 * Cache-shape twin of `HarelineListEvent` with `dateUtc` serialized to ISO
 * string. `unstable_cache` JSON-serializes its return value; keeping this
 * twin explicit means the boundary conversion is visible at the call site.
 */
interface CachedHarelineEvent extends Omit<HarelineListEvent, "dateUtc"> {
  dateUtc: string | null;
}

/**
 * Cached inner: pure function of `(mode, todayDateStr)`.
 *
 * Cache key parts, chosen so hit/miss behavior matches user intent:
 *  - `mode` — upcoming vs past keep separate entries (different ORDER BY
 *    + separate `take:` budget).
 *  - `todayDateStr` — `YYYY-MM-DD` UTC date, so the key naturally rotates
 *    at UTC midnight without a live timer. **Must not include raw `nowMs`**
 *    or the key would churn every request.
 *
 * No region scoping at the cache/query layer: region filtering is
 * client-side only. Attempting server-side region scoping via URL param
 * introduced two classes of bugs — (1) the client uses `history.replaceState`
 * for region chip changes so a user widening their selection past the
 * original URL scope would stay frozen on the server-scoped subset,
 * and (2) seed-derived region expansion misses metros that admins create
 * at runtime via `src/app/admin/regions/actions.ts`. Keeping the cache
 * key coarse maximizes hit rate and sidesteps both issues.
 *
 * `revalidate: 3600` is a belt-and-suspenders fallback. Tag invalidation
 * from `scrapeSource` / admin mutations is the primary freshness mechanism
 * (see `HARELINE_EVENTS_TAG` consumers). 1-hour max staleness in the
 * absence of scrape activity is acceptable for a community event calendar.
 */
const fetchSlimEventsCached = unstable_cache(
  async (
    mode: TimeMode,
    todayDateStr: string,
  ): Promise<CachedHarelineEvent[]> => {
    // Reconstruct UTC boundary from the date string so the cached function
    // is a pure function of its args. (No reading Date.now() here —
    // that would invalidate the cache contract.)
    const startOfTodayUtc = new Date(`${todayDateStr}T00:00:00.000Z`);
    const yesterdayUtc = new Date(startOfTodayUtc.getTime() - 24 * 60 * 60 * 1000);
    const isPast = mode === "past";

    const where = {
      ...DISPLAY_EVENT_WHERE,
      date: isPast ? { lt: yesterdayUtc } : { gte: yesterdayUtc },
    };

    const events = await prisma.event.findMany({
      where,
      select: {
        id: true,
        date: true,
        dateUtc: true,
        timezone: true,
        kennelId: true,
        runNumber: true,
        title: true,
        haresText: true,
        startTime: true,
        locationName: true,
        locationCity: true,
        status: true,
        latitude: true,
        longitude: true,
        kennel: {
          select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
        },
      },
      orderBy: { date: isPast ? "desc" : "asc" },
      ...(isPast ? { take: PAST_EVENTS_LIMIT } : {}),
    });

    return events.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      dateUtc: e.dateUtc ? e.dateUtc.toISOString() : null,
      timezone: e.timezone,
      kennelId: e.kennelId,
      kennel: e.kennel,
      runNumber: e.runNumber,
      title: e.title,
      haresText: e.haresText,
      startTime: e.startTime,
      locationName: e.locationName,
      locationCity: e.locationCity,
      status: e.status,
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
    }));
  },
  ["hareline:events"],
  { tags: [HARELINE_EVENTS_TAG], revalidate: 3600 },
);

/**
 * Events are stored at UTC noon. The single boundary used for both modes is
 * `yesterday 00:00 UTC`: upcoming is `>= yesterdayUtc` (catches noon-UTC runs
 * that haven't happened yet in any Western-Hemisphere timezone), past is
 * `< yesterdayUtc` (events definitively in the past for every timezone). The
 * client's `bucketBoundaryUtc` uses the same value, so server query and
 * client filter agree — no wasted rows that the client would immediately
 * hide against `take: PAST_EVENTS_LIMIT`.
 *
 * `nowMs` lets the initial-render path in `page.tsx` share a single clock
 * with the `serverNowMs` prop passed to the client. Omit for the lazy
 * client-driven tab switch, which recomputes fresh boundaries each call.
 *
 * Uses `select` (not `include`) so heavy fields (description, sourceUrl,
 * locationStreet, locationAddress, eventLinks) never leave Postgres — they
 * stream lazily via `getEventDetail` when a card is expanded.
 */
export async function loadEventsForTimeMode(
  mode: TimeMode,
  nowMs?: number,
): Promise<HarelineListEvent[]> {
  // YYYY-MM-DD in UTC — the cache key that rotates at UTC midnight.
  const todayDateStr = new Date(nowMs ?? Date.now()).toISOString().slice(0, 10);

  const cached = await fetchSlimEventsCached(mode, todayDateStr);

  // Rehydrate `dateUtc` from ISO string back to `Date` at the cache
  // boundary. Keeps `HarelineListEvent` stable across the project so
  // EventCard/EventDetailPanel/CalendarView/kennel page don't need to
  // learn about the cache shape.
  return cached.map((e) => ({
    ...e,
    dateUtc: e.dateUtc ? new Date(e.dateUtc) : null,
  }));
}

export interface EventDetailFields {
  description: string | null;
  sourceUrl: string | null;
  locationStreet: string | null;
  locationAddress: string | null;
  eventLinks: { id: string; url: string; label: string }[];
}

/**
 * Fetch heavy fields for a single event on detail-panel expand. Returns
 * `null` if the event doesn't exist or isn't visible (same
 * DISPLAY_EVENT_WHERE predicate used everywhere else).
 */
export async function getEventDetail(eventId: string): Promise<EventDetailFields | null> {
  if (!eventId) return null;
  return prisma.event.findFirst({
    where: { id: eventId, ...DISPLAY_EVENT_WHERE },
    select: {
      description: true,
      sourceUrl: true,
      locationStreet: true,
      locationAddress: true,
      eventLinks: { select: { id: true, url: true, label: true } },
    },
  });
}
