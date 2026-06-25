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
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DISPLAY_EVENT_WHERE, DISPLAYABLE_EVENT_NO_PARENT_WHERE } from "@/lib/event-filters";
// Tag constant lives in a plain module — a `"use server"` file can only
// export async functions, so any non-function export (even a string)
// makes Next strip all exports and fail the build at import sites.
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";
// PAST_EVENTS_LIMIT lives in a plain module for the same reason — both this
// `"use server"` file and the client component import it.
import { PAST_EVENTS_LIMIT } from "./constants";

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
  /** #2135 — local end time "HH:MM" (same convention as startTime); null when
   *  the source has no DTEND or the run wraps past midnight. */
  endTime: string | null;
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
  /** Sub-kennel label extracted from multi-kennel calendars (e.g. "Bayern Nash Hash"). */
  eventLabel: string | null;
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

// PAST_EVENTS_LIMIT (the server-side cap on the first past payload and the
// cursor page size for `loadMorePastEvents`) is imported from `./constants`
// so the client component can share the exact value.

/**
 * Global (unfiltered) upcoming events cap. The full upcoming set exceeds
 * Next.js's 2MB `unstable_cache` limit (~5 k events × ~906 bytes = ~4.8 MB),
 * silently bypassing the data cache on every request. 1 500 events ≈ 1.3 MB —
 * roughly 30 % below the 2 MB ceiling. Series-parent rows carry inline
 * `childEvents` that inflate their size beyond the per-event average, so the
 * true margin is smaller for series-heavy periods; monitor if the warning
 * reappears. Side-effect: kennels/regions beyond the 1 500 boundary are absent
 * from the FilterBar kennel dropdown and RegionQuickChips counts, which derive
 * from the returned payload rather than a separate metadata query.
 */
const UPCOMING_GLOBAL_LIMIT = 1500;

/**
 * Kennel-filtered upcoming events cap. At MAX_KENNEL_FILTER_IDS=50, a busy
 * regional filter (e.g. all 13 SF Bay kennels) can return 1 000–2 000 events.
 * 2 000 × ~906 bytes ≈ 1.8 MB — safely under the 2 MB `unstable_cache` limit.
 * Higher than the global cap because filtered views serve subscribers who
 * expect their kennel's full upcoming schedule.
 */
const UPCOMING_KENNEL_LIMIT = 2000;

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
 * Slim field set rendered by EventCard's list view. Extracted to a module
 * const (typed via `satisfies`) so the cached first-page query and the
 * cursor-paginated `loadMorePastEvents` query share an identical projection —
 * the two paths can't drift, and `mapRowToCachedEvent` types its input off
 * this exact shape.
 */
const HARELINE_EVENT_SELECT = {
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
  endTime: true,
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
} satisfies Prisma.EventSelect;

/** Row type produced by `HARELINE_EVENT_SELECT`. */
type HarelineEventRow = Prisma.EventGetPayload<{ select: typeof HARELINE_EVENT_SELECT }>;

/**
 * Normalize a kennel-filter list into the stable, bounded form used both for
 * cache keys and Prisma `IN` clauses (#1560 PR F):
 *  - trim each ID (URL decoders leave stray whitespace)
 *  - drop empties (`?kennels=a,,b`) and dedupe (`?kennels=a&kennels=a`)
 *  - sort with `localeCompare` so `[a,b]` and `[b,a]` canonicalize equal
 *  - cap at `MAX_KENNEL_FILTER_IDS` (sort BEFORE slice so the dropped tail is
 *    deterministic regardless of input order)
 */
function normalizeKennelIds(kennelIds?: ReadonlyArray<string>): string[] {
  return [
    ...new Set((kennelIds ?? []).map((id) => id.trim()).filter(Boolean)),
  ]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_KENNEL_FILTER_IDS);
}

/**
 * Build the Hareline visibility `where` for a given date bound + kennel filter.
 *
 * #1560 PR F — kennel-scoped fetches must include series children whose primary
 * kennel matches the filter (e.g. GGFM Friday Strawberry Moon, a child of
 * NYCH3's 5-Boro umbrella). When unfiltered, the `parentEventId: null`
 * exclusion (baked into `DISPLAY_EVENT_WHERE`) keeps children inside their
 * parent's expanded timeline only. When filtered, swap to the predicate set
 * without that exclusion (`DISPLAYABLE_EVENT_NO_PARENT_WHERE`) and OR-match on
 * kennel so parents AND children whose own kennel matches both surface.
 */
function buildHarelineWhere(
  dateFilter: Prisma.EventWhereInput["date"],
  kennelIds: string[],
): Prisma.EventWhereInput {
  if (kennelIds.length === 0) {
    return { ...DISPLAY_EVENT_WHERE, date: dateFilter };
  }
  return {
    ...DISPLAYABLE_EVENT_NO_PARENT_WHERE,
    date: dateFilter,
    OR: [
      { kennelId: { in: kennelIds } },
      { eventKennels: { some: { kennelId: { in: kennelIds } } } },
    ],
  };
}

/**
 * #1560 PR F — when both a series parent AND its children land in the result
 * (kennel-filtered query where the umbrella's host kennel matches, e.g. NYCH3
 * viewing `/hareline?kennels=nych3-id` sees the 5-Boro umbrella + its Sat/Sun
 * children), drop the children from the top-level list. They still appear in
 * the parent's expanded timeline via `childEvents`; without this the same
 * trail renders twice on one scroll page (Gemini PR #1712 review). When the
 * parent is NOT in the result (GGFM viewing `?kennels=ggfm-id` sees only
 * Friday's child of the NYCH3-hosted umbrella), the child correctly stays at
 * the top level since the set doesn't contain its parentEventId.
 */
function dedupeSeriesChildren(events: HarelineEventRow[]): HarelineEventRow[] {
  const idsInResult = new Set(events.map((e) => e.id));
  return events.filter((e) => !e.parentEventId || !idsInResult.has(e.parentEventId));
}

/** Map a Prisma row into the JSON-safe cache shape (dates → ISO strings). */
function mapRowToCachedEvent(e: HarelineEventRow): CachedHarelineEvent {
  return {
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
    endTime: e.endTime,
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
  };
}

/**
 * Rehydrate `dateUtc` from ISO string back to `Date` at the cache boundary.
 * Keeps `HarelineListEvent` stable across the project so consumers
 * (EventCard/EventDetailPanel/CalendarView/kennel page) don't learn about the
 * cache shape. Used by both the cached path and the uncached load-more path.
 */
function rehydrateCachedEvent(e: CachedHarelineEvent): HarelineListEvent {
  return {
    ...e,
    dateUtc: e.dateUtc ? new Date(e.dateUtc) : null,
    childEvents: e.childEvents.map((c) => ({
      ...c,
      dateUtc: c.dateUtc ? new Date(c.dateUtc) : null,
    })),
  };
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
  ): Promise<{ events: CachedHarelineEvent[]; hasMore: boolean }> => {
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

    // The kennel filter is already normalized into the cache key, so split it
    // back into an array here. `buildHarelineWhere` handles the unfiltered vs
    // kennel-scoped visibility predicates (#1560 PR F).
    const kennelIds = kennelIdsKey ? kennelIdsKey.split(",") : [];
    const dateFilter = isPast ? { lt: tomorrowUtc } : { gte: yesterdayUtc };
    const where = buildHarelineWhere(dateFilter, kennelIds);

    let queryLimit: number;
    if (isPast) {
      queryLimit = PAST_EVENTS_LIMIT;
    } else if (kennelIds.length === 0) {
      queryLimit = UPCOMING_GLOBAL_LIMIT;
    } else {
      queryLimit = UPCOMING_KENNEL_LIMIT;
    }

    // Past mode paginates backward by cursor (`loadMorePastEvents`), which
    // requires a deterministic, unique tiebreak so "everything after this id"
    // is well-defined. Add `id desc` for past; upcoming keeps `date asc`.
    const rows = await prisma.event.findMany({
      where,
      select: HARELINE_EVENT_SELECT,
      orderBy: isPast ? [{ date: "desc" }, { id: "desc" }] : { date: "asc" },
      take: queryLimit,
    });

    // `hasMore` is derived from the RAW page size (before series-child dedup) so
    // a full DB page that dedup shrinks below the limit — possible only in the
    // kennel-filtered branch, where children can be fetched — still signals that
    // older events remain. Without this, the client's first-page "Load older"
    // affordance could be hidden mid-archive (Codex review). The flag is only
    // consumed for past mode; for upcoming it just reflects cap saturation.
    const hasMore = rows.length >= queryLimit;
    return { events: dedupeSeriesChildren(rows).map(mapRowToCachedEvent), hasMore };
  },
  // Include ALL limit values + a payload-shape version in the static key so any
  // limit change (incl. the past page size) OR a return-shape change
  // (array → { events, hasMore }) auto-busts stale cache entries rather than
  // serving an incompatible/old-sized payload (CodeRabbit review).
  [`hareline:events:v2:g${UPCOMING_GLOBAL_LIMIT}k${UPCOMING_KENNEL_LIMIT}p${PAST_EVENTS_LIMIT}`],
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
 *
 * Returns `{ events, hasMore }`. `hasMore` reflects raw page fullness (see
 * `fetchSlimEventsCached`); the client uses it to seed past-tab back-pagination
 * so the "Load older events" affordance survives series-child dedup shrinkage.
 * It is meaningless for upcoming (no back-pagination there).
 */
export async function loadEventsForTimeMode(
  mode: TimeMode,
  nowMs?: number,
  kennelIds?: ReadonlyArray<string>,
): Promise<{ events: HarelineListEvent[]; hasMore: boolean }> {
  // YYYY-MM-DD in UTC — the cache key that rotates at UTC midnight.
  const todayDateStr = new Date(nowMs ?? Date.now()).toISOString().slice(0, 10);

  // #1560 PR F — normalize the kennel filter into a stable cache key
  // (trim / drop-empty / dedupe / sort / cap). See `normalizeKennelIds`.
  const kennelIdsKey = normalizeKennelIds(kennelIds).join(",");

  const { events, hasMore } = await fetchSlimEventsCached(mode, todayDateStr, kennelIdsKey);

  // Rehydrate `dateUtc` from ISO string back to `Date` at the cache boundary.
  return { events: events.map(rehydrateCachedEvent), hasMore };
}

/**
 * Cursor-paginated "load older past events" — lets the Hareline past tab scroll
 * back beyond the first `PAST_EVENTS_LIMIT` page.
 *
 * The first past page is served (and cached) by `loadEventsForTimeMode("past")`,
 * newest-first. To look further back, the client passes the id of the oldest
 * event it currently holds (`cursorId`); this returns the next
 * `PAST_EVENTS_LIMIT` older events strictly after that cursor.
 *
 * Uncached on purpose: deep-history pages are cold, and a per-cursor cache key
 * would explode the key space for no hit-rate benefit. The hot first page stays
 * cached. Ordering MUST match the first page (`[date desc, id desc]`) so the
 * cursor boundary lines up exactly with where the buffer ends.
 *
 * `kennelIds` MUST match the scoping that produced the client's buffer — the
 * URL `?kennels=` filter for an SSR-loaded past buffer, or empty for a buffer
 * loaded by the lazy tab-toggle (which fetches unfiltered). The client tracks
 * which one applies and passes it through so the cursor and the appended page
 * share a single ordering.
 *
 * Returns `{ events, hasMore }`. `hasMore` is derived from the **raw** page
 * size (before series-child dedup) so a full DB page that dedup shrinks below
 * `PAST_EVENTS_LIMIT` (a parent + child collapsing to one, possible only in the
 * kennel-filtered branch) doesn't prematurely report end-of-list.
 *
 * Error handling is deliberately narrow. Prisma's `cursor` does a lookup on the
 * cursor row and throws `P2025` when it is missing OR filtered out by `where` —
 * the latter is routine here, since `reconcile` flips a removed event to
 * CANCELLED (excluded by `DISPLAY_EVENT_WHERE`) and the cursor is the client's
 * oldest-held event. Both cases mean "no defined position to continue from", so
 * they resolve to `{ events: [], hasMore: false }` (a clean archive boundary;
 * the user can refresh for a fresh buffer). Every OTHER error (DB timeout,
 * connectivity, schema drift) propagates so the client's `pastServerError`
 * retry UI engages instead of disguising a dependency failure as end-of-list
 * (Gemini / Codex review).
 */
export async function loadMorePastEvents(
  cursorId: string,
  kennelIds?: ReadonlyArray<string>,
): Promise<{ events: HarelineListEvent[]; hasMore: boolean }> {
  if (!cursorId) return { events: [], hasMore: false };

  // Past ceiling `< tomorrow 00:00 UTC` mirrors the first-page bound. The
  // cursor already restricts results to events older than it, so this is a
  // belt-and-suspenders ceiling that keeps the `where` identical to page one.
  const todayDateStr = new Date().toISOString().slice(0, 10);
  const startOfTodayUtc = new Date(`${todayDateStr}T00:00:00.000Z`);
  const tomorrowUtc = new Date(startOfTodayUtc.getTime() + 24 * 60 * 60 * 1000);

  const normalizedKennelIds = normalizeKennelIds(kennelIds);
  const where = buildHarelineWhere({ lt: tomorrowUtc }, normalizedKennelIds);

  let rows: HarelineEventRow[];
  try {
    rows = await prisma.event.findMany({
      where,
      select: HARELINE_EVENT_SELECT,
      orderBy: [{ date: "desc" }, { id: "desc" }],
      cursor: { id: cursorId },
      skip: 1, // exclude the cursor row itself (already shown by the client)
      take: PAST_EVENTS_LIMIT,
    });
  } catch (err) {
    // Cursor row missing or filtered out of `where` (e.g. it became CANCELLED
    // between fetches) → P2025. Treat as a clean end-of-list, not an error.
    if (err && typeof err === "object" && "code" in err && err.code === "P2025") {
      return { events: [], hasMore: false };
    }
    throw err; // genuine DB failures still surface to the retry UI
  }
  // `hasMore` off the raw count — a full page implies older events remain,
  // even if dedup trims this page's returned length.
  const hasMore = rows.length >= PAST_EVENTS_LIMIT;
  const events = dedupeSeriesChildren(rows).map(mapRowToCachedEvent).map(rehydrateCachedEvent);
  return { events, hasMore };
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
