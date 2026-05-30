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
  /** #1316 — per-event hash cash override (two-tier model, #1571). Null ⇒
   *  inherit the kennel default. Surfaced on the card as a small chip (#1571). */
  cost: string | null;
  /** #1560 — multi-day series + standalone date-range support. */
  isSeriesParent: boolean | null;
  parentEventId: string | null;
  endDate: string | null; // ISO; null = single-day
  /** #1560 — per-trail children for series parents. Empty array for non-parents. */
  childEvents: HarelineChildEvent[];
}

/**
 * Compact child shape included inline on series-parent rows. Only carries the
 * fields the expanded "Weekend at a glance" timeline renders (#1560) — heavy
 * fields stream lazily through `getEventDetail` if the user clicks into a
 * specific child.
 */
export interface HarelineChildEvent {
  id: string;
  date: string;
  dateUtc: Date | null;
  timezone: string | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  status: string;
  locationName: string | null;
  runNumber: number | null;
}

export type TimeMode = "upcoming" | "past";

/**
 * Past events are capped server-side to keep the payload bounded — 200 is
 * enough to fill several scroll pages while staying under ~400 KB wire.
 */
const PAST_EVENTS_LIMIT = 200;

/**
 * Defensive cap on the kennel-filter list (#1560 PR F, CodeRabbit review).
 * Caps cache-key cardinality and bounds the Prisma `IN` clause size against
 * pathological inputs. 50 comfortably covers any realistic regional filter
 * — Chicago has 12 kennels, NYC ~11, SF Bay ~13. Above this, the user is
 * almost certainly browsing globally, not filtering.
 */
const MAX_KENNEL_FILTER_IDS = 50;

/**
 * Cache-shape twin of `HarelineListEvent` with `dateUtc` serialized to ISO
 * string. `unstable_cache` JSON-serializes its return value; keeping this
 * twin explicit means the boundary conversion is visible at the call site.
 */
interface CachedHarelineEvent extends Omit<HarelineListEvent, "dateUtc" | "childEvents"> {
  dateUtc: string | null;
  childEvents: CachedHarelineChildEvent[];
}

interface CachedHarelineChildEvent extends Omit<HarelineChildEvent, "dateUtc"> {
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
    kennelIdsKey: string,
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

    // #1560 PR F — kennel-scoped fetches must include series children whose
    // primary kennel matches the filter (e.g. GGFM Friday Strawberry Moon,
    // a child of NYCH3's 5-Boro umbrella). When unfiltered, the original
    // `parentEventId: null` exclusion stays so children only render inside
    // their parent's expanded timeline. When filtered, swap the exclusion
    // for a kennel OR-match: parents whose own kennel matches AND children
    // whose own kennel matches both surface.
    //
    // Destructure `parentEventId` out of `DISPLAY_EVENT_WHERE` and reuse the
    // remaining visibility predicates verbatim so the two branches can't drift
    // (mirrors `getEventDetail` below). Gemini PR review #1712.
    const kennelIds = kennelIdsKey ? kennelIdsKey.split(",") : [];
    const dateFilter = isPast ? { lt: tomorrowUtc } : { gte: yesterdayUtc };
    const { parentEventId: _excluded, ...visibilityWhere } = DISPLAY_EVENT_WHERE;
    const where = kennelIds.length === 0
      ? { ...DISPLAY_EVENT_WHERE, date: dateFilter }
      : {
          ...visibilityWhere,
          date: dateFilter,
          OR: [
            { kennelId: { in: kennelIds } },
            { eventKennels: { some: { kennelId: { in: kennelIds } } } },
          ],
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
        eventLabel: true,
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
        cost: true,
        // #1560 — multi-day series metadata + inline children list.
        isSeriesParent: true,
        parentEventId: true,
        endDate: true,
        childEvents: {
          where: {
            // Mirror DISPLAY_EVENT_WHERE's visibility predicates on the
            // child set (parentEventId stays unset here — children all have
            // it pointing to this row).
            status: { not: "CANCELLED" },
            isManualEntry: { not: true },
            isCanonical: true,
            kennel: { isHidden: false },
          },
          orderBy: { date: "asc" },
          select: {
            id: true,
            date: true,
            dateUtc: true,
            timezone: true,
            title: true,
            haresText: true,
            startTime: true,
            status: true,
            locationName: true,
            runNumber: true,
          },
        },
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

    // #1560 PR F — when both a series parent AND its children are returned
    // (kennel-filtered query where the umbrella's host kennel matches the
    // filter, e.g. NYCH3 viewing `/hareline?kennels=nych3-id` sees the 5-Boro
    // umbrella + its Sat/Sun children), drop the children from the top-level
    // list. They still appear in the parent's expanded timeline via
    // `childEvents`. Without this dedup, the same trail renders twice on the
    // same scroll page (Gemini PR #1712 review). When the parent is NOT in
    // the result (GGFM viewing /hareline?kennels=ggfm-id sees only Friday's
    // child of the NYCH3-hosted umbrella), the child correctly stays at the
    // top level since `parentIdsInResult` doesn't contain its parentEventId.
    const idsInResult = new Set(events.map((e) => e.id));
    const visibleEvents = events.filter(
      (e) => !e.parentEventId || !idsInResult.has(e.parentEventId),
    );

    return visibleEvents.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      dateUtc: e.dateUtc ? e.dateUtc.toISOString() : null,
      timezone: e.timezone,
      kennelId: e.kennelId,
      kennel: e.kennel,
      coHosts: e.eventKennels.map((ek) => ek.kennel),
      runNumber: e.runNumber,
      title: e.title,
      eventLabel: e.eventLabel,
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
      cost: e.cost,
      isSeriesParent: e.isSeriesParent,
      parentEventId: e.parentEventId,
      endDate: e.endDate ? e.endDate.toISOString() : null,
      childEvents: e.childEvents.map((c) => ({
        id: c.id,
        date: c.date.toISOString(),
        dateUtc: c.dateUtc ? c.dateUtc.toISOString() : null,
        timezone: c.timezone,
        title: c.title,
        haresText: c.haresText,
        startTime: c.startTime,
        status: c.status,
        locationName: c.locationName,
        runNumber: c.runNumber,
      })),
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
  kennelIds?: ReadonlyArray<string>,
): Promise<HarelineListEvent[]> {
  // YYYY-MM-DD in UTC — the cache key that rotates at UTC midnight.
  const todayDateStr = new Date(nowMs ?? Date.now()).toISOString().slice(0, 10);

  // #1560 PR F — normalize the kennel filter into a stable cache key.
  // - Trim each ID (URL decoders sometimes leave stray whitespace)
  // - Drop empties (e.g. `?kennels=a,,b`)
  // - Dedupe (e.g. `?kennels=a&kennels=a`) so the cache key is canonical
  //   regardless of how callers compose the URL
  // - Cap at MAX_KENNEL_FILTER_IDS to bound cache cardinality + Prisma `IN`
  //   list size against pathological inputs (CodeRabbit PR #1712 review)
  // - Sort with `localeCompare` so [a,b] and [b,a] hit the same cache entry
  //   (Sonar S2871). Empty string when no filter — a distinct cache entry
  //   from any kennel-filtered key (the 3-arg signature is new in PR F, so
  //   the unfiltered path cold-starts once on deploy regardless).
  const normalizedKennelIds = Array.from(
    new Set((kennelIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ).slice(0, MAX_KENNEL_FILTER_IDS);
  const kennelIdsKey = normalizedKennelIds.length > 0
    ? [...normalizedKennelIds].sort((a, b) => a.localeCompare(b)).join(",")
    : "";

  const cached = await fetchSlimEventsCached(mode, todayDateStr, kennelIdsKey);

  // Rehydrate `dateUtc` from ISO string back to `Date` at the cache
  // boundary. Keeps `HarelineListEvent` stable across the project so
  // EventCard/EventDetailPanel/CalendarView/kennel page don't need to
  // learn about the cache shape.
  return cached.map((e) => ({
    ...e,
    dateUtc: e.dateUtc ? new Date(e.dateUtc) : null,
    childEvents: e.childEvents.map((c) => ({
      ...c,
      dateUtc: c.dateUtc ? new Date(c.dateUtc) : null,
    })),
  }));
}

export interface EventDetailFields {
  description: string | null;
  sourceUrl: string | null;
  locationStreet: string | null;
  locationAddress: string | null;
  /** #1316 — Hash Cash (per-event override). Also in the slim list payload
   *  (#1571) so the card can show it; kept here for the brief window where the
   *  list cache predates the field, and for detail-panel parity. */
  cost: string | null;
  eventLinks: { id: string; url: string; label: string }[];
  /**
   * Slim parent record for children opened in the detail panel (PR E.5).
   * Powers the parameterized back-link copy `"Part of {parent.title}"` so
   * users know which umbrella weekend a child belongs to. Null for events
   * that aren't part of a series (`parentEventId IS NULL`).
   */
  parentEvent: { id: string; title: string | null } | null;
}

/**
 * Fetch heavy fields for a single event on detail-panel expand. Returns
 * `null` if the event doesn't exist or isn't visible.
 *
 * #1560 — series children (`parentEventId != null`) DO resolve here because
 * the right-side panel can navigate into a child trail from the parent's
 * expanded timeline. We rebuild the where clause without the
 * `parentEventId: null` predicate that DISPLAY_EVENT_WHERE adds for listings.
 */
export async function getEventDetail(eventId: string): Promise<EventDetailFields | null> {
  if (!eventId) return null;
  // Reuse DISPLAY_EVENT_WHERE's visibility predicates but skip the listing-
  // only `parentEventId: null` so child rows can still be inspected.
  const { parentEventId: _excluded, ...visibilityWhere } = DISPLAY_EVENT_WHERE;
  return prisma.event.findFirst({
    where: { id: eventId, ...visibilityWhere },
    select: {
      description: true,
      sourceUrl: true,
      locationStreet: true,
      locationAddress: true,
      cost: true,
      eventLinks: { select: { id: true, url: true, label: true } },
      // PR E.5 — parent title for the back-link copy on child detail panels.
      parentEvent: { select: { id: true, title: true } },
    },
  });
}
