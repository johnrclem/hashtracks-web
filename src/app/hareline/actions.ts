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
// Tag constant lives in a plain module — a `"use server"` file can only
// export async functions, so any non-function export (even a string)
// makes Next strip all exports and fail the build at import sites.
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";

/** Matches the slim shape rendered by EventCard's list view. */
interface HarelineKennelLite {
  id: string;
  shortName: string;
  fullName: string;
  slug: string;
  region: string;
  country: string;
}

export interface HarelineListEvent {
  id: string;
  date: string; // ISO string
  dateUtc: Date | null;
  timezone: string | null;
  kennelId: string;
  kennel: HarelineKennelLite | null;
  /** Co-host kennels (#1023 step 5). Empty when the event has only a primary. */
  coHosts: HarelineKennelLite[];
  runNumber: number | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  locationName: string | null;
  locationCity: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
  /** #890 — verbatim source string ("3-5 Miles", "2.69 (miles)") for in-card display. */
  trailLengthText: string | null;
  /** #890 — parsed lower bound; equal to max for fixed values. */
  trailLengthMinMiles: number | null;
  /** #890 — parsed upper bound; only distinct from min for ranges. */
  trailLengthMaxMiles: number | null;
  /** #890 — Shiggy Level (1–5). UI-facing label is "Shiggy Level". */
  difficulty: number | null;
  /** #1316 — trail layout description, verbatim ("A to A", "A to B", "Live Hare"). */
  trailType: string | null;
  /** #1316 — dogs welcome? null = unknown / source didn't say. */
  dogFriendly: boolean | null;
  /** #1316 — pre-event meetup venue/time, free-form. */
  prelube: string | null;
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
    // Reconstruct UTC boundaries from the date string so the cached function
    // is a pure function of its args. (No reading Date.now() here —
    // that would invalidate the cache contract.)
    //
    // Both payloads use lenient bounds that overlap on
    // `[yesterday 00:00 UTC, tomorrow 00:00 UTC)` so the client's
    // local-midnight bucket boundary (see `computeBucketBoundary` in
    // HarelineView.tsx) can correctly route events stored at yesterday-
    // or today-UTC-noon for any viewer's timezone:
    //   - upcoming floor `>= yesterday 00:00 UTC` covers westward viewers
    //     whose local-today-midnight is later than yesterday-UTC-midnight.
    //   - past ceiling `< tomorrow 00:00 UTC` covers eastward viewers
    //     whose local-today-midnight is later than today-UTC-midnight, so
    //     events that just rolled into "yesterday locally" (stored at
    //     today-UTC-noon for a JST viewer 9 hours ahead of UTC) are still
    //     in the past payload. The client filter then narrows.
    const startOfTodayUtc = new Date(`${todayDateStr}T00:00:00.000Z`);
    const yesterdayUtc = new Date(startOfTodayUtc.getTime() - 24 * 60 * 60 * 1000);
    const tomorrowUtc = new Date(startOfTodayUtc.getTime() + 24 * 60 * 60 * 1000);
    const isPast = mode === "past";

    const where = {
      ...DISPLAY_EVENT_WHERE,
      date: isPast ? { lt: tomorrowUtc } : { gte: yesterdayUtc },
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
        trailLengthText: true,
        trailLengthMinMiles: true,
        trailLengthMaxMiles: true,
        difficulty: true,
        trailType: true,
        dogFriendly: true,
        prelube: true,
        kennel: {
          select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
        },
        // Co-hosts (#1023 step 5) — drives the EventCard conjunction
        // ("Cherry City × OH3"). Empty array for single-kennel events,
        // which is the common case.
        eventKennels: {
          where: { isPrimary: false },
          select: {
            kennel: { select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true } },
          },
          orderBy: { kennel: { shortName: "asc" } },
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
      coHosts: e.eventKennels.map((ek) => ek.kennel),
      runNumber: e.runNumber,
      title: e.title,
      haresText: e.haresText,
      startTime: e.startTime,
      locationName: e.locationName,
      locationCity: e.locationCity,
      status: e.status,
      latitude: e.latitude ?? null,
      longitude: e.longitude ?? null,
      trailLengthText: e.trailLengthText,
      trailLengthMinMiles: e.trailLengthMinMiles,
      trailLengthMaxMiles: e.trailLengthMaxMiles,
      difficulty: e.difficulty,
      trailType: e.trailType,
      dogFriendly: e.dogFriendly,
      prelube: e.prelube,
    }));
  },
  ["hareline:events"],
  { tags: [HARELINE_EVENTS_TAG], revalidate: 3600 },
);

/**
 * Events are stored at UTC noon. Each payload uses a lenient bound that
 * covers all viewer timezones; the client then refines the upcoming/past
 * split using the viewer's local midnight (see `computeBucketBoundary` in
 * `HarelineView.tsx`):
 *   - upcoming floor `>= yesterday 00:00 UTC` (covers westward viewers).
 *   - past ceiling `< tomorrow 00:00 UTC` (covers eastward viewers, whose
 *     local "today" rolls before the server's UTC midnight does — without
 *     this widening, events at today-UTC-noon would be missing from the
 *     past payload yet filtered out of upcoming by the client).
 *
 * The two payloads now overlap on `[yesterday 00:00 UTC, tomorrow 00:00 UTC)`,
 * but each tab fetches one payload at a time so the overlap doesn't cause
 * double-rendering — it just gives the client enough events to disambiguate
 * for any timezone.
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
