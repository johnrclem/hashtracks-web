"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { X } from "lucide-react";
import { EventCard, type HarelineEvent } from "./EventCard";
import { getDayOfWeek, formatDateLong, parseList, parseRegionParam } from "@/lib/format";
import { FilterBar } from "@/components/shared/FilterBar";
import { resolveCountryName } from "@/lib/region";
import { EmptyState } from "./EmptyState";
import { RegionQuickChips } from "./RegionQuickChips";
import { CalendarView } from "./CalendarView";
import { EventDetailPanel } from "./EventDetailPanel";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { useGeolocation } from "@/hooks/useGeolocation";
import { haversineDistance, getEventCoords } from "@/lib/geo";
import { groupRegionsByState, expandRegionSelections, regionAbbrev } from "@/lib/region";
import { LocationPrompt } from "./LocationPrompt";
import { getLocationPref, resolveLocationDefault, clearLocationPref, FILTER_PARAMS } from "@/lib/location-pref";
import { loadEventsForTimeMode, getEventDetail, type EventDetailFields, type TimeMode } from "@/app/hareline/actions";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="relative h-[calc(100vh-16rem)] min-h-[400px] overflow-hidden rounded-md border bg-muted/30">
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground/20 border-t-muted-foreground/60" />
        <span className="text-sm text-muted-foreground">Loading map…</span>
      </div>
      <div className="absolute top-3 right-3 flex flex-col gap-1">
        <div className="h-8 w-8 rounded bg-muted animate-pulse" />
        <div className="h-8 w-8 rounded bg-muted animate-pulse" />
      </div>
    </div>
  ),
});

export type TimeFilter = "2w" | "4w" | "8w" | "12w" | "upcoming" | "past";

export const WEEKS_DAYS: Partial<Record<TimeFilter, number>> = {
  "2w": 14,
  "4w": 28,
  "8w": 56,
  "12w": 84,
};

const TIME_LABELS: Record<TimeFilter, string> = {
  "2w": "in next 2 weeks",
  "4w": "in next 4 weeks",
  "8w": "in next 8 weeks",
  "12w": "in next 12 weeks",
  upcoming: "upcoming",
  past: "past",
};

const VALID_TIME_FILTERS = new Set<string>(["2w", "4w", "8w", "12w", "upcoming", "past"]);

function isValidTimeFilter(v: string): v is TimeFilter {
  return VALID_TIME_FILTERS.has(v);
}

interface HarelineViewProps {
  events: HarelineEvent[];
  /**
   * Whether the server's initial `events` array contains upcoming or past
   * events. Drives the "is this cached" check when the user toggles the
   * time filter — if the server already sent past events, we don't need
   * to re-fetch them when the user stays on the "past" tab.
   */
  initialTimeMode?: TimeMode;
  /**
   * Server's `Date.now()` at render time. Used to seed the client's
   * upcoming/past bucket boundary so SSR and initial client render agree
   * on which events belong in which bucket. Without this the client
   * recomputes the boundary from its own clock and the two can disagree
   * across a UTC-midnight boundary, producing hydration mismatch. If
   * omitted (e.g. in tests) we fall back to the client clock.
   */
  serverNowMs?: number;
  subscribedKennelIds: string[];
  isAuthenticated: boolean;
  attendanceMap?: Record<string, AttendanceData>;
  weatherMap?: Record<string, import("@/lib/weather").DailyWeather>;
}

interface FilterCriteria {
  timeFilter: TimeFilter | "all";
  scope: "my" | "all";
  subscribedKennelIds: string[];
  selectedRegions: string[];
  expandedRegions: Set<string>;
  selectedKennels: string[];
  selectedDays: string[];
  searchText: string;
  /** Anchor for rolling-window filters (`2w`/`4w`/`8w`/`12w`). Today noon UTC. */
  todayUtc: number;
  /**
   * Boundary for the upcoming/past bucket split. Pre-hydration this matches
   * the server's lenient yesterday-00:00-UTC floor (so SSR HTML and the
   * first client render agree); post-hydration it narrows to the viewer's
   * local "today midnight" expressed as UTC ms, which correctly drops
   * yesterday-UTC events from "upcoming" once the local clock has moved
   * past midnight. See `computeBucketBoundary`. Kept separate from
   * `todayUtc` so the rolling "next N weeks" anchor stays at true today.
   */
  bucketBoundaryUtc: number;
  nearMeDistance: number | null;
  userLat: number | null;
  userLng: number | null;
}

/**
 * Check whether an event matches a free-text search query. Runs only over
 * the fields present in the slim list payload — `description` is a heavy
 * on-demand field and is not searched.
 */
function matchesSearchText(event: HarelineEvent, query: string): boolean {
  if (!query.trim()) return true;
  const lower = query.toLowerCase();
  return !!(
    event.title?.toLowerCase().includes(lower) ||
    event.kennel?.shortName.toLowerCase().includes(lower) ||
    event.kennel?.fullName.toLowerCase().includes(lower) ||
    event.haresText?.toLowerCase().includes(lower) ||
    event.locationName?.toLowerCase().includes(lower) ||
    event.locationCity?.toLowerCase().includes(lower)
  );
}

/**
 * Compute the upcoming/past bucket boundary in UTC ms.
 *
 * Pre-hydration (server-rendered first paint), the boundary matches the
 * server's UTC-yesterday-midnight floor so the SSR HTML and the first
 * client render agree byte-for-byte (no hydration warning). Post-hydration,
 * the boundary is the user's local "today midnight" expressed as UTC ms —
 * which correctly drops yesterday-UTC-noon events out of "All upcoming"
 * once the viewer's local clock has actually moved past their own
 * midnight, while still preserving the run for westward-timezone users
 * (e.g. an SF user at Sunday 23:00 PDT whose local "today" is still
 * Sunday — UTC noon falls *after* their local midnight, so the event
 * passes).
 */
export function computeBucketBoundary(nowMs: number, hasHydrated: boolean): number {
  const now = new Date(nowMs);
  if (hasHydrated) {
    return new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      0, 0, 0, 0,
    ).getTime();
  }
  const startOfTodayUtc = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    0, 0, 0,
  );
  return startOfTodayUtc - 24 * 60 * 60 * 1000;
}

/**
 * Check whether an event passes the time filter.
 *
 * `todayUtc` anchors the user-facing rolling windows ("next N weeks") at true
 * today, while `bucketBoundaryUtc` is the upcoming/past bucket split. See
 * `computeBucketBoundary` for the two-phase derivation that keeps SSR
 * hydration clean while delivering a per-user-timezone split post-mount.
 */
export function passesTimeFilter(
  eventDate: number,
  timeFilter: FilterCriteria["timeFilter"],
  todayUtc: number,
  bucketBoundaryUtc: number,
): boolean {
  if (timeFilter === "all") return true;
  if (timeFilter === "upcoming") return eventDate >= bucketBoundaryUtc;
  if (timeFilter === "past") return eventDate < bucketBoundaryUtc;

  // Rolling weeks: must be >= today AND <= today + N days
  const days = WEEKS_DAYS[timeFilter];
  if (days == null) return true;
  const ceiling = todayUtc + days * 24 * 60 * 60 * 1000;
  return eventDate >= todayUtc && eventDate <= ceiling;
}

/** Check whether a single event passes all active filters. */
function passesAllFilters(event: HarelineEvent, f: FilterCriteria): boolean {
  const eventDate = new Date(event.date).getTime();

  if (!passesTimeFilter(eventDate, f.timeFilter, f.todayUtc, f.bucketBoundaryUtc)) return false;
  if (f.scope === "my" && !f.subscribedKennelIds.includes(event.kennelId)) return false;
  if (f.selectedRegions.length > 0 && !f.expandedRegions.has(event.kennel?.region ?? "")) return false;
  if (f.selectedKennels.length > 0 && !f.selectedKennels.includes(event.kennel?.id ?? "")) return false;
  if (f.selectedDays.length > 0 && !f.selectedDays.includes(getDayOfWeek(event.date))) return false;
  if (f.searchText && !matchesSearchText(event, f.searchText)) return false;

  // Near-me distance filter — only applies when geolocation is granted
  if (f.nearMeDistance != null && f.userLat != null && f.userLng != null) {
    const coords = getEventCoords(event.latitude ?? null, event.longitude ?? null, event.kennel?.region ?? "");
    if (!coords) return false; // no coords + no region centroid — exclude
    if (haversineDistance(f.userLat, f.userLng, coords.lat, coords.lng) > f.nearMeDistance) return false;
  }

  return true;
}

/** Sort events by date (direction depends on timeFilter) then by startTime. */
function sortEvents(events: HarelineEvent[], timeFilter: TimeFilter): HarelineEvent[] {
  const descending = timeFilter === "past";
  const sorted = [...events];
  sorted.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    const dateDiff = descending ? dateB - dateA : dateA - dateB;
    if (dateDiff !== 0) return dateDiff;
    if (!a.startTime && !b.startTime) return 0;
    if (!a.startTime) return 1;
    if (!b.startTime) return -1;
    return a.startTime.localeCompare(b.startTime);
  });
  return sorted;
}

const PAGE_SIZE = 25;

/** Group sorted events by calendar date for sticky date headers. */
function groupEventsByDate(events: HarelineEvent[]): { dateKey: string; dateLabel: string; events: HarelineEvent[] }[] {
  const groups: { dateKey: string; dateLabel: string; events: HarelineEvent[] }[] = [];
  let current: (typeof groups)[number] | null = null;
  for (const event of events) {
    const dateKey = event.date.slice(0, 10); // ISO YYYY-MM-DD
    if (!current || current.dateKey !== dateKey) {
      current = { dateKey, dateLabel: formatDateLong(event.date), events: [] };
      groups.push(current);
    }
    current.events.push(event);
  }
  return groups;
}

function getDefaultTimeFilter(v: ViewMode): TimeFilter {
  return v === "map" ? "4w" : "upcoming";
}

type ViewMode = "list" | "calendar" | "map";

/**
 * When a region filter is pre-applied (from the URL), default to "all" so the
 * user sees every kennel in that region, not just ones they're subscribed to.
 * An explicit ?scope= param always wins.
 */
export function computeInitialScope(
  scopeParam: string | null,
  regionsParam: string | null,
  defaultScope: "my" | "all",
): "my" | "all" {
  if (scopeParam === "my" || scopeParam === "all") return scopeParam;
  if (regionsParam && regionsParam.length > 0) return "all";
  return defaultScope;
}

export function HarelineView({
  events,
  initialTimeMode = "upcoming",
  serverNowMs,
  subscribedKennelIds,
  isAuthenticated,
  attendanceMap = {},
  weatherMap = {},
}: HarelineViewProps) {
  const searchParams = useSearchParams();
  const hasSubscriptions = subscribedKennelIds.length > 0;

  // Cache upcoming + past event lists separately. The server sends one of
  // them as `events`; the other is fetched via `loadEventsForTimeMode`
  // when the user toggles to that tab. Cached across toggles so repeated
  // flipping doesn't re-hit the server.
  const [upcomingEvents, setUpcomingEvents] = useState<HarelineEvent[] | null>(
    initialTimeMode === "upcoming" ? events : null,
  );
  const [pastEvents, setPastEvents] = useState<HarelineEvent[] | null>(
    initialTimeMode === "past" ? events : null,
  );
  const [upcomingLoading, setUpcomingLoading] = useState(false);
  const [upcomingError, setUpcomingError] = useState<string | null>(null);
  const [pastLoading, setPastLoading] = useState(false);
  const [pastError, setPastError] = useState<string | null>(null);

  // Live clock for bucket boundaries. Seeded with the server's render-time
  // `Date.now()` so the first client render matches SSR (no hydration
  // mismatch), then advanced to the real client clock on mount and rolled
  // forward at each UTC midnight so long-lived tabs don't freeze their
  // upcoming/past split to yesterday.
  const [nowMs, setNowMs] = useState<number>(serverNowMs ?? Date.now());
  // Gates the local-timezone bucket boundary in `computeBucketBoundary`.
  // SSR (Node, UTC) and the first client render both compute the boundary
  // with `hasHydrated=false` so they produce identical HTML; the post-mount
  // effect flips this to `true` so the boundary narrows to the viewer's
  // actual local midnight. Without this the SSR-rendered list and the
  // hydrated list would differ for any non-UTC viewer (yesterday-UTC-noon
  // events would hydrate-mismatch in EDT users).
  const [hasHydrated, setHasHydrated] = useState(false);
  useEffect(() => {
    // Helper: which UTC day does this instant belong to? Used to detect
    // crossings of 00:00 UTC between server render and client hydration,
    // and between scheduled midnight ticks.
    const utcDay = (ms: number) => Math.floor(ms / 86400000);

    // Mark hydration complete so subsequent renders use the local-TZ
    // bucket boundary. Triggers a one-tick re-render of the filtered
    // list — yesterday-UTC events drop out of "upcoming" for viewers
    // whose local clock is past their own midnight.
    setHasHydrated(true);

    // Transition from SSR seed to client clock once (post-hydration).
    // If hydration straddled 00:00 UTC the cached event lists were
    // fetched under the *old* day's boundary — an event that just rolled
    // from upcoming into past (or vice versa) is in the wrong bucket.
    // Drop both caches so the lazy-fetch effect re-pulls the active mode
    // against the fresh boundary.
    const clientNow = Date.now();
    setNowMs(clientNow);
    if (serverNowMs !== undefined && utcDay(serverNowMs) !== utcDay(clientNow)) {
      setUpcomingEvents(null);
      setPastEvents(null);
    }

    // Schedule a one-shot update at the next UTC midnight, then
    // re-schedule. Using a chained timeout (not setInterval) keeps the
    // trigger aligned to midnight even if the tab is backgrounded.
    // Invalidating both caches on rollover is required — otherwise the
    // client starts filtering with a new boundary while the server-
    // cached events were fetched under the old one, so an event that
    // just crossed midnight between upcoming and past would be visible
    // in neither bucket until a full reload.
    let timer: ReturnType<typeof setTimeout> | null = null;
    function scheduleNext() {
      const now = Date.now();
      const d = new Date(now);
      const nextMidnightUtc = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 1);
      timer = setTimeout(() => {
        setNowMs(Date.now());
        setUpcomingEvents(null);
        setPastEvents(null);
        scheduleNext();
      }, Math.max(1000, nextMidnightUtc - now));
    }
    scheduleNext();
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [serverNowMs]);

  // Default scope depends on auth state
  const defaultScope = isAuthenticated && hasSubscriptions ? "my" : "all";

  // Initialize state from URL search params
  const rawView = searchParams.get("view");
  const initialView: ViewMode =
    rawView === "list" || rawView === "calendar" || rawView === "map" ? rawView : "list";
  const [view, setViewState] = useState<ViewMode>(initialView);

  const [density, setDensityState] = useState<"medium" | "compact">(
    (searchParams.get("density") as "medium" | "compact") || "medium",
  );

  const rawTime = searchParams.get("time");
  const [timeFilter, setTimeFilterState] = useState<TimeFilter>(() => {
    if (rawTime && isValidTimeFilter(rawTime)) return rawTime;
    return getDefaultTimeFilter(initialView);
  });

  const [scope, setScopeState] = useState<"my" | "all">(
    computeInitialScope(searchParams.get("scope"), searchParams.get("regions"), defaultScope),
  );
  const [selectedRegions, setSelectedRegionsState] = useState<string[]>(
    parseRegionParam(searchParams.get("regions")),
  );
  const [selectedKennels, setSelectedKennelsState] = useState<string[]>(
    parseList(searchParams.get("kennels")),
  );
  const [selectedDays, setSelectedDaysState] = useState<string[]>(
    parseList(searchParams.get("days")),
  );
  const [searchText, setSearchTextState] = useState<string>(
    searchParams.get("q") ?? "",
  );
  const [nearMeDistance, setNearMeDistanceState] = useState<number | null>(() => {
    const d = searchParams.get("dist");
    const n = d ? Number(d) : null;
    return n != null && !Number.isNaN(n) ? n : null;
  });

  // Geolocation hook — only activates on user action
  const [geoState, requestLocation] = useGeolocation();

  // Pagination for list view
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  // Accessible live region for filter result count
  const liveRegionRef = useRef<HTMLDivElement>(null);
  const announceTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Map bounds filter state — only active when map view is shown
  const [mapBounds, setMapBounds] = useState<{ south: number; north: number; west: number; east: number } | null>(null);

  // Selected event for detail panel (desktop only)
  const [selectedEvent, setSelectedEvent] = useState<HarelineEvent | null>(null);
  // Per-event cache of heavy detail fields, populated on detail-panel
  // expand via getEventDetail so the initial list payload stays small.
  const [detailCache, setDetailCache] = useState<Record<string, EventDetailFields>>({});

  // Escape key dismisses detail panel
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && selectedEvent) {
        setSelectedEvent(null);
      }
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedEvent]);

  // When an event is selected, fetch its heavy detail fields (once). The
  // panel renders immediately with slim data; heavy fields fill in when
  // the fetch resolves.
  useEffect(() => {
    if (!selectedEvent) return;
    if (detailCache[selectedEvent.id]) return;
    let cancelled = false;
    getEventDetail(selectedEvent.id)
      .then((detail) => {
        if (cancelled || !detail) return;
        setDetailCache((prev) => ({ ...prev, [selectedEvent.id]: detail }));
      })
      .catch(() => {
        // Swallow — detail panel continues to render from slim fields.
      });
    return () => {
      cancelled = true;
    };
  }, [selectedEvent, detailCache]);

  // Selected event enriched with its cached heavy fields (if loaded).
  const enrichedSelectedEvent = useMemo(() => {
    if (!selectedEvent) return null;
    const detail = detailCache[selectedEvent.id];
    return detail ? { ...selectedEvent, ...detail } : selectedEvent;
  }, [selectedEvent, detailCache]);

  // Clear near-me filter when geolocation permission is denied
  useEffect(() => {
    if (geoState.status === "denied" && nearMeDistance != null) {
      setNearMeDistanceState(null);
    }
  }, [geoState.status, nearMeDistance]);

  // Sync state to URL via replaceState (no re-render, no history entry)
  const syncUrl = useCallback(
    (overrides: Record<string, string | string[]>) => {
      const params = new URLSearchParams();
      const currentView = (overrides.view as ViewMode) ?? view;

      const state: Record<string, string | string[]> = {
        time: timeFilter,
        view,
        density,
        scope,
        regions: selectedRegions,
        kennels: selectedKennels,
        days: selectedDays,
        q: searchText,
        dist: nearMeDistance != null ? String(nearMeDistance) : "",
        ...overrides,
      };

      // When regions are active, the effective default scope is "all" (see computeInitialScope).
      // We must persist an explicit scope=my to the URL so a page refresh doesn't
      // re-promote it back to "all".
      const effectiveRegions = state.regions as string[];
      const effectiveDefaultScope = effectiveRegions.length > 0 ? "all" : defaultScope;

      for (const [key, val] of Object.entries(state)) {
        const str = Array.isArray(val) ? val.join("|") : val;
        // Only add non-default values to keep URL clean
        const isDefault =
          (key === "time" && str === getDefaultTimeFilter(currentView)) ||
          (key === "view" && str === "list") ||
          (key === "density" && str === "medium") ||
          (key === "scope" && str === effectiveDefaultScope) ||
          str === "";
        if (!isDefault) {
          params.set(key, str);
        }
      }

      const qs = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    },
    [timeFilter, view, density, scope, selectedRegions, selectedKennels, selectedDays, searchText, nearMeDistance, defaultScope],
  );

  // Wrapper setters that sync to URL
  function setView(v: ViewMode) {
    setViewState(v);
    // Clear map bounds filter when switching away from map
    if (v !== "map") setMapBounds(null);
    // When switching to map and current filter is "upcoming", auto-narrow to "4w"
    if (v === "map" && timeFilter === "upcoming") {
      setTimeFilterState("4w");
      syncUrl({ view: v, time: "4w" });
    } else {
      syncUrl({ view: v });
    }
  }
  function setDensity(v: "medium" | "compact") {
    setDensityState(v);
    syncUrl({ density: v });
  }
  function resetListState() {
    setSelectedEvent(null);
    setVisibleCount(PAGE_SIZE);
  }
  function setTimeFilter(v: TimeFilter) {
    setTimeFilterState(v);
    resetListState();
    // Switching between upcoming and past mode crosses the lazy-fetch
    // boundary — the new tab's data may not be cached yet. A selection
    // made against the old dataset can't meaningfully carry over: if we
    // don't drop it here, the detail panel and map marker highlight
    // continue pointing at an event that isn't in the new currentEvents,
    // and focus/keyboard state can interact with the wrong row once the
    // lazy fetch resolves.
    if ((v === "past") !== (timeFilter === "past")) {
      setSelectedEvent(null);
    }
    // Clear prior error when re-entering a tab so the fetch effect can
    // retry. No-op when already clear.
    if (v === "past" && pastError) setPastError(null);
    if (v !== "past" && upcomingError) setUpcomingError(null);
    syncUrl({ time: v });
  }

  // Fetch the non-initial time-mode list lazily when the user toggles
  // into it. Cached afterward — subsequent toggles are instant. On error
  // we surface an inline message and stop; the user triggers a retry by
  // re-selecting the tab (which clears the error above).
  //
  // IMPORTANT: we track loading + error per-mode symmetrically. Earlier
  // iterations shared a single fetch path keyed off `timeFilter === "past"`
  // and caused infinite retry loops on upcoming errors.
  useEffect(() => {
    const mode: TimeMode = timeFilter === "past" ? "past" : "upcoming";
    const isPast = mode === "past";
    const cachedEvents = isPast ? pastEvents : upcomingEvents;
    const loading = isPast ? pastLoading : upcomingLoading;
    const error = isPast ? pastError : upcomingError;
    if (cachedEvents !== null || loading || error) return;

    const setEvents = isPast ? setPastEvents : setUpcomingEvents;
    const setLoading = isPast ? setPastLoading : setUpcomingLoading;
    const setError = isPast ? setPastError : setUpcomingError;

    let cancelled = false;
    setLoading(true);
    setError(null);
    loadEventsForTimeMode(mode)
      .then((fetched) => { if (!cancelled) setEvents(fetched); })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load events");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [timeFilter, pastEvents, upcomingEvents, pastLoading, pastError, upcomingLoading, upcomingError]);

  // Active event list for the current time mode. Returns an empty array
  // when the cache for the current mode hasn't resolved — DO NOT fall
  // back to the opposite mode's cache. Doing so makes downstream
  // derivations (region/kennel filter options, `scope=my` filtering,
  // empty-state UI) reference events from the wrong bucket and can
  // produce false empty states or hide subscribed events during the
  // brief window before the lazy fetch resolves.
  const currentEvents = useMemo((): HarelineEvent[] => {
    if (timeFilter === "past") return pastEvents ?? [];
    return upcomingEvents ?? [];
  }, [timeFilter, pastEvents, upcomingEvents]);

  // True while the current mode's list is being fetched for the first
  // time (pre-cache). Used to gate loading/error UI + suppress the
  // "0 events" count that would otherwise show before data arrives.
  const currentLoading = timeFilter === "past" ? pastLoading : upcomingLoading;
  const currentError = timeFilter === "past" ? pastError : upcomingError;

  // Events to feed the hidden-during-load subtree. We never want to hand
  // `[]` to MapView / CalendarView during a tab-switch lazy fetch: even
  // though the wrapper is `hidden`, MapView renders a "No events"
  // placeholder when its events list is empty, which unmounts the
  // internal <Map> and destroys camera / viewport / search-area state —
  // the exact state preservation this loading path is meant to protect.
  // Fall back to whichever side of the cache has already resolved (or
  // the original server payload on first render) so the subtree keeps
  // its mount across an uncached toggle.
  const subtreeEvents = useMemo((): HarelineEvent[] => {
    if (currentEvents.length > 0) return currentEvents;
    return pastEvents ?? upcomingEvents ?? events;
  }, [currentEvents, pastEvents, upcomingEvents, events]);

  // Drop a selected event once it's no longer in the active dataset.
  // `setTimeFilter` already clears across past/upcoming swaps, but a
  // direct URL-driven time change or a rogue event-id collision would
  // bypass that; this effect is the belt-and-suspenders guard.
  useEffect(() => {
    if (!selectedEvent) return;
    if (currentLoading || currentError) return; // trust stale selection while the new list is still arriving
    if (!currentEvents.some((e) => e.id === selectedEvent.id)) {
      setSelectedEvent(null);
    }
  }, [selectedEvent, currentEvents, currentLoading, currentError]);
  function setScope(v: "my" | "all") {
    setScopeState(v);
    resetListState();
    syncUrl({ scope: v });
  }
  function setSelectedRegions(v: string[]) {
    setSelectedRegionsState(v);
    setPrefApplied(null);
    resetListState();
    if (v.length > 0 && scope === "my") {
      setScopeState("all");
      syncUrl({ regions: v, scope: "all" });
    } else {
      syncUrl({ regions: v });
    }
  }
  function setSelectedKennels(v: string[]) {
    setSelectedKennelsState(v);
    resetListState();
    syncUrl({ kennels: v });
  }
  function setSelectedDays(v: string[]) {
    setSelectedDaysState(v);
    resetListState();
    syncUrl({ days: v });
  }
  function setNearMeDistance(v: number | null) {
    setNearMeDistanceState(v);
    resetListState();
    syncUrl({ dist: v != null ? String(v) : "" });
  }
  function setSearchText(v: string) {
    setSearchTextState(v);
    resetListState();
    syncUrl({ q: v });
  }

  // Shared filter context (recomputed once per render).
  //
  // `todayUtc` (today noon UTC) anchors the rolling-window filters
  // ("next 2/4/8/12 weeks"), which start at true today.
  //
  // `bucketBoundaryUtc` is the upcoming/past split. Pre-hydration it
  // matches the server's lenient yesterday-00:00-UTC floor (so SSR HTML
  // hydrates without warnings); post-hydration it narrows to the
  // viewer's local midnight today, which correctly drops yesterday-UTC
  // events from "upcoming" once the local clock has moved past midnight.
  // The lenient server floor still surfaces today's runs for westward
  // viewers (e.g. SF at Sunday 23:00 PDT — UTC noon ≥ Sunday 00:00 PDT,
  // so Sunday-noon-UTC events stay upcoming). See `computeBucketBoundary`
  // for the derivation.
  const filterContext = useMemo(() => {
    const now = new Date(nowMs);
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
    const bucketBoundaryUtc = computeBucketBoundary(nowMs, hasHydrated);
    const userLat = geoState.status === "granted" ? geoState.lat : null;
    const userLng = geoState.status === "granted" ? geoState.lng : null;
    return { todayUtc, bucketBoundaryUtc, userLat, userLng };
  }, [geoState, nowMs, hasHydrated]);

  // Expand state-level region selections to metro names (stable ref via useMemo)
  const regionsByState = useMemo(
    () => groupRegionsByState(currentEvents.map((e) => e.kennel?.region).filter(Boolean) as string[]),
    [currentEvents],
  );
  const expandedRegions = useMemo(
    () => expandRegionSelections(selectedRegions, regionsByState),
    [selectedRegions, regionsByState],
  );

  // Time-filtered events — applies ONLY the time filter so region chip counts
  // reflect the visible time range (e.g. "next 4 weeks") without being skewed
  // by region/kennel/search selections.
  const timeFilteredEvents = useMemo(() => {
    return currentEvents.filter((event) => {
      const eventDate = new Date(event.date).getTime();
      return passesTimeFilter(eventDate, timeFilter, filterContext.todayUtc, filterContext.bucketBoundaryUtc);
    });
  }, [currentEvents, timeFilter, filterContext.todayUtc, filterContext.bucketBoundaryUtc]);

  // Calendar events — all filters EXCEPT time (calendar has its own month navigation / weeks mode)
  const calendarEvents = useMemo(() => {
    return currentEvents.filter((event) => {
      return passesAllFilters(event, {
        timeFilter: "all", scope, subscribedKennelIds,
        selectedRegions, expandedRegions, selectedKennels, selectedDays, searchText,
        todayUtc: filterContext.todayUtc, bucketBoundaryUtc: filterContext.bucketBoundaryUtc,
        nearMeDistance,
        userLat: filterContext.userLat, userLng: filterContext.userLng,
      });
    });
  }, [currentEvents, scope, subscribedKennelIds, selectedRegions, expandedRegions, selectedKennels, selectedDays, searchText, nearMeDistance, filterContext]);

  // List/map events — derived from calendarEvents by applying time filter + optional map bounds
  const filteredEvents = useMemo(() => {
    return calendarEvents.filter((event) => {
      if (!passesTimeFilter(new Date(event.date).getTime(), timeFilter, filterContext.todayUtc, filterContext.bucketBoundaryUtc)) return false;
      // Map bounds filter — only when active (map view with "Search this area")
      if (mapBounds) {
        const coords = getEventCoords(event.latitude ?? null, event.longitude ?? null, event.kennel?.region ?? "");
        if (!coords) return false;
        if (coords.lat < mapBounds.south || coords.lat > mapBounds.north) return false;
        if (coords.lng < mapBounds.west || coords.lng > mapBounds.east) return false;
      }
      return true;
    });
  }, [calendarEvents, timeFilter, filterContext.todayUtc, filterContext.bucketBoundaryUtc, mapBounds]);

  const sortedEvents = useMemo(() => {
    return sortEvents(filteredEvents, timeFilter);
  }, [filteredEvents, timeFilter]);

  // Debounced screen-reader announcement when filtered count changes.
  // Suppressed while the current-mode list is loading/failed so we don't
  // speak "0 upcoming events" before data arrives.
  useEffect(() => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    if (currentLoading || currentError) return;
    announceTimerRef.current = setTimeout(() => {
      if (liveRegionRef.current) {
        const label = TIME_LABELS[timeFilter];
        liveRegionRef.current.textContent = `${filteredEvents.length} ${label} ${filteredEvents.length === 1 ? "event" : "events"}`;
      }
    }, 500);
    return () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, [filteredEvents.length, timeFilter, currentLoading, currentError]);

  // Paginated events for list view
  const visibleEvents = useMemo(() => {
    return sortedEvents.slice(0, visibleCount);
  }, [sortedEvents, visibleCount]);

  const dateGroups = useMemo(() => {
    return groupEventsByDate(visibleEvents);
  }, [visibleEvents]);

  const hasMore = visibleCount < sortedEvents.length;
  const remaining = sortedEvents.length - visibleCount;

  function clearAllFilters() {
    setSelectedRegionsState([]);
    setSelectedKennelsState([]);
    setSelectedDaysState([]);
    setNearMeDistanceState(null);
    setSearchTextState("");
    setMapBounds(null);
    resetListState();
    syncUrl({ regions: [], kennels: [], days: [], dist: "", q: "" });
  }

  // Handle region filter from map cluster click — does NOT clear prefApplied
  // (only user-initiated filter changes should clear the return-visitor state)
  const handleRegionFilter = useCallback(
    (region: string) => {
      setSelectedRegionsState([region]);
      resetListState();
      if (scope === "my") {
        setScopeState("all");
        syncUrl({ regions: [region], scope: "all" });
      } else {
        syncUrl({ regions: [region] });
      }
    },
    [syncUrl, scope],
  );

  // Track when a stored preference was auto-applied (for return-visitor banner)
  const [prefApplied, setPrefApplied] = useState<{ region?: string } | null>(null);

  // On mount: apply stored location preference if no URL filters are present
  // Also handle backwards compat for ?country= URL param
  const locationPrefApplied = useRef(false);
  useEffect(() => {
    if (locationPrefApplied.current) return;
    locationPrefApplied.current = true;

    // Backwards compat: convert ?country=UK to region selection
    const countryParam = searchParams.get("country");
    if (countryParam) {
      const countryName = resolveCountryName(countryParam);
      if (countryName) {
        setSelectedRegions([`country:${countryName}`]);
        return;
      }
    }

    const pref = getLocationPref();
    const result = resolveLocationDefault(searchParams, pref);
    if (!result) return;

    if (result.regions) {
      setSelectedRegions(result.regions);
      setPrefApplied({ region: result.regions[0] });
    } else if (result.nearMeDistance) {
      setNearMeDistance(result.nearMeDistance);
      requestLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine if URL has any filter params (for LocationPrompt)
  const hasUrlFilters = useMemo(() => {
    return FILTER_PARAMS.some((p) => searchParams.has(p));
  }, [searchParams]);

  // Unique metro region names from events (for LocationPrompt picker)
  const uniqueRegionNames = useMemo(() => {
    const set = new Set<string>();
    for (const e of currentEvents) {
      if (e.kennel?.region) set.add(e.kennel.region);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [currentEvents]);

  // Derive kennel options for FilterBar (filtered by selected regions)
  const kennelOptions = useMemo(() => {
    const kennelMap = new Map<string, { id: string; shortName: string; fullName: string; region: string }>();
    for (const e of currentEvents) {
      if (e.kennel && !kennelMap.has(e.kennel.id)) {
        kennelMap.set(e.kennel.id, {
          id: e.kennel.id,
          shortName: e.kennel.shortName,
          fullName: e.kennel.fullName,
          region: e.kennel.region,
        });
      }
    }
    const all = Array.from(kennelMap.values());
    if (selectedRegions.length > 0) {
      return all.filter((k) => expandedRegions.has(k.region));
    }
    return all.sort((a, b) => a.shortName.localeCompare(b.shortName));
  }, [currentEvents, selectedRegions, expandedRegions]);

  // Build items array for FilterBar (derives available filter options)
  const filterBarItems = useMemo(() => {
    return currentEvents.map((e) => ({
      id: e.id,
      region: e.kennel?.region ?? "",
    }));
  }, [currentEvents]);

  // Persist location preference when user manually changes Near Me or region filters
  const handleSetNearMeFromPrompt = useCallback(
    (distance: number) => {
      setNearMeDistance(distance);
      requestLocation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncUrl],
  );

  const handleSetRegionFromPrompt = useCallback(
    (region: string) => {
      setSelectedRegions([region]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncUrl],
  );

  // Dynamic page title based on selected regions
  useEffect(() => {
    if (selectedRegions.length === 1) {
      document.title = `${regionAbbrev(selectedRegions[0])} Runs | HashTracks`;
    } else {
      document.title = "Hareline | HashTracks";
    }
  }, [selectedRegions]);

  const detailPanel = enrichedSelectedEvent ? (
    <div className="hidden lg:block">
      <div className="sticky top-8 max-h-[calc(100vh-4rem)]">
        <EventDetailPanel
          event={enrichedSelectedEvent}
          attendance={attendanceMap[enrichedSelectedEvent.id] ?? null}
          isAuthenticated={isAuthenticated}
          onDismiss={() => setSelectedEvent(null)}
        />
      </div>
    </div>
  ) : null;

  const emptyContext = ((): "near_me" | "region" | "kennel" | "search" | "my_kennels" | "general" => {
    if (nearMeDistance != null && geoState.status === "granted") return "near_me";
    if (selectedRegions.length > 0) return "region";
    if (selectedKennels.length > 0) return "kennel";
    if (searchText) return "search";
    if (scope === "my") return "my_kennels";
    return "general";
  })();

  const emptyState = (
    <EmptyState
      context={emptyContext}
      regionName={selectedRegions.length === 1 ? selectedRegions[0] : undefined}
      query={searchText || undefined}
      onClearFilters={clearAllFilters}
      onSwitchToAll={scope === "my" ? () => { setScope("all"); } : undefined}
    />
  );

  const listContent = (
    <>
      {sortedEvents.length === 0 ? (
        emptyState
      ) : (
        <div>
          {dateGroups.map((group) => (
            <div key={group.dateKey}>
              <div className="sticky top-0 z-10 border-b bg-background/95 px-1 py-1.5 backdrop-blur-sm">
                <h3 className="text-sm font-semibold">{group.dateLabel}</h3>
              </div>
              <div className={`${density === "compact" ? "space-y-1" : "space-y-2"} py-2`}>
                {group.events.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    density={density}
                    onSelect={setSelectedEvent}
                    isSelected={selectedEvent?.id === event.id}
                    attendance={attendanceMap[event.id] ?? null}
                    hideDate
                    weather={weatherMap[event.id] ?? null}
                  />
                ))}
              </div>
            </div>
          ))}
          {hasMore && (
            <div className="flex justify-center py-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setVisibleCount((c) => c + PAGE_SIZE)}
              >
                Show {Math.min(PAGE_SIZE, remaining)} more ({remaining} remaining)
              </Button>
            </div>
          )}
        </div>
      )}
    </>
  );

  const timeLabel = TIME_LABELS[timeFilter];

  return (
    <div className="mt-3 space-y-4">
      {/* Location prompt for first-time / return visitors */}
      <LocationPrompt
        hasUrlFilters={hasUrlFilters}
        onSetNearMe={handleSetNearMeFromPrompt}
        onSetRegion={handleSetRegionFromPrompt}
        regionNames={uniqueRegionNames}
        page="hareline"
        prefApplied={!!prefApplied}
        appliedRegionName={prefApplied?.region}
        onClearRegion={() => {
          setSelectedRegions([]);
          clearLocationPref();
          setPrefApplied(null);
          syncUrl({ regions: [] });
        }}
      />

      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: time range select */}
        <div className="flex items-center gap-2">
          <Select value={timeFilter} onValueChange={(v) => setTimeFilter(v as TimeFilter)}>
            <SelectTrigger size="sm" aria-label="Time range">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Upcoming</SelectLabel>
                <SelectItem value="2w">Next 2 weeks</SelectItem>
                <SelectItem value="4w">Next 4 weeks</SelectItem>
                <SelectItem value="8w">Next 8 weeks</SelectItem>
                <SelectItem value="12w">Next 12 weeks</SelectItem>
                <SelectItem value="upcoming">All upcoming</SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <SelectGroup>
                <SelectItem value="past">Past events</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>

        {/* Right: view toggle + optional density */}
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">View:</span>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as ViewMode)}
            variant="outline"
            size="sm"
            aria-label="View mode"
          >
            <ToggleGroupItem value="list">List</ToggleGroupItem>
            <ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
            <ToggleGroupItem value="map">Map</ToggleGroupItem>
          </ToggleGroup>

          {view === "list" && (
            <>
            <Separator orientation="vertical" className="mx-1 h-6" />
            <ToggleGroup
              type="single"
              value={density}
              onValueChange={(v) => v && setDensity(v as "medium" | "compact")}
              variant="outline"
              size="sm"
              aria-label="Display density"
            >
              <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
              <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
            </ToggleGroup>
            </>
          )}
        </div>
      </div>

      <Separator className="my-1" />

      {/* Loading / error state for async tab fetches — rendered outside
       * the event-derived block below so it's visible while the
       * current-mode list is unresolved. */}
      {currentLoading && (
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {timeFilter === "past" ? "Loading past events…" : "Loading upcoming events…"}
        </p>
      )}
      {currentError && !currentLoading && (
        <p className="text-sm text-destructive" role="alert">
          {timeFilter === "past"
            ? "Past events failed to load."
            : "Upcoming events failed to load."}{" "}
          <button
            type="button"
            onClick={() => {
              // Clearing the error lets the fetch effect fire again —
              // it gates on `!pastError` / `!upcomingError`. Flipping
              // tabs is no longer required to recover.
              if (timeFilter === "past") setPastError(null);
              else setUpcomingError(null);
            }}
            className="underline hover:no-underline font-medium"
          >
            Retry
          </button>
        </p>
      )}

      {/*
       * While the current-mode list is still being fetched (or just
       * errored), hide the event-derived UI — RegionQuickChips,
       * FilterBar, results count, list/calendar/map view. They all
       * compute from `currentEvents`, which is an empty array until the
       * server action resolves; showing them would flash zero counts,
       * blank calendars, and empty filter option lists. The loading /
       * error banner above stands in for the whole stack until data
       * arrives.
       *
       * We use `hidden` instead of conditional-unmount so that internal
       * state in children (CalendarView's month navigation, MapView's
       * camera / bounds, FilterBar dropdown state) survives a lazy tab
       * load round-trip. Unmounting reset all of that on every past /
       * upcoming toggle.
       */}
      <div hidden={currentLoading || !!currentError} className="space-y-4">
      {/* Region quick-chips */}
      <RegionQuickChips
        events={timeFilteredEvents}
        selectedRegions={selectedRegions}
        onRegionsChange={setSelectedRegions}
      />

      {/* Scope toggle (My Kennels / All) */}
      {isAuthenticated && hasSubscriptions && (
        <fieldset className="flex rounded-md border w-fit" aria-label="Kennel scope">
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === "my"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            } rounded-l-md`}
            onClick={() => setScope("my")}
            aria-pressed={scope === "my"}
          >
            My Kennels
          </button>
          <button
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              scope === "all"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            } rounded-r-md`}
            onClick={() => setScope("all")}
            aria-pressed={scope === "all"}
          >
            All Kennels
          </button>
        </fieldset>
      )}

      {/* Unified filter bar */}
      <FilterBar
        items={filterBarItems}
        search={searchText}
        onSearchChange={setSearchText}
        selectedRegions={selectedRegions}
        onRegionsChange={setSelectedRegions}
        selectedDays={selectedDays}
        onDaysChange={setSelectedDays}
        nearMeDistance={nearMeDistance}
        onNearMeDistanceChange={setNearMeDistance}
        geoState={geoState}
        onRequestLocation={requestLocation}
        selectedKennels={selectedKennels}
        onKennelsChange={setSelectedKennels}
        kennelOptions={kennelOptions}
        onClearAll={clearAllFilters}
        searchPlaceholder="Search events..."
      />

      {/* Dynamic scoping header when a single region is selected */}
      {selectedRegions.length === 1 && (
        <h2 className="text-lg font-semibold">Runs in {selectedRegions[0]}</h2>
      )}

      {/* Results count (hidden for calendar — it shows its own count) */}
      {(view === "list" || view === "map") && (
        <p className="text-sm text-muted-foreground" aria-hidden="true">
          {view === "list" && hasMore
            ? `Showing ${visibleCount} of ${sortedEvents.length} `
            : `${filteredEvents.length} `}
          {timeLabel} {filteredEvents.length === 1 ? "event" : "events"}
          {scope === "my" ? " from your kennels" : ""}
          {nearMeDistance != null && geoState.status === "granted" ? ` within ${nearMeDistance} km` : ""}
          {mapBounds ? " in this area" : ""}
          {view === "map" && timeFilter === "4w" && !mapBounds && (
            <span className="ml-2 text-xs text-muted-foreground/70">Map shows next 4 weeks</span>
          )}
          {mapBounds && (
            <button
              onClick={() => setMapBounds(null)}
              className="ml-2 inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-xs font-medium text-primary hover:bg-accent transition-colors"
            >
              <X className="h-3 w-3" />
              Clear area filter
            </button>
          )}
        </p>
      )}

      {/* Cross-link to kennel directory when a single region is selected */}
      {selectedRegions.length === 1 && (
        <Link
          href={`/kennels?regions=${encodeURIComponent(selectedRegions[0])}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View {selectedRegions[0]} kennels &rarr;
        </Link>
      )}

      {/* Screen-reader live region for filter count (debounced) */}
      <div ref={liveRegionRef} className="sr-only" aria-live="polite" aria-atomic="true" />

      {/* Content: master-detail on desktop (panel appears on selection), single column on mobile */}
      {view === "list" ? (
        <div className={selectedEvent ? "lg:grid lg:grid-cols-[1fr_380px] lg:gap-6" : ""}>
          {/* Left: event list */}
          <div className="min-w-0">{listContent}</div>
          {detailPanel}
        </div>
      ) : view === "calendar" ? (
        // During an uncached tab load the normal derivations (calendarEvents /
        // sortedEvents) collapse to [] — which would make CalendarView/MapView
        // swap to empty-state placeholders and unmount their internal <Map> /
        // month-navigation state. Feed them `subtreeEvents` (last resolved
        // snapshot) so they stay mounted; the wrapping `<div hidden>` keeps
        // the stale content out of view.
        <CalendarView
          events={currentLoading || currentError ? subtreeEvents : calendarEvents}
          timeFilter={timeFilter}
        />
      ) : (
        <div className={selectedEvent ? "lg:grid lg:grid-cols-[1fr_380px] lg:gap-6" : ""}>
          {/* Left: map */}
          <div className="min-w-0">
            <MapView
              events={currentLoading || currentError ? subtreeEvents : sortedEvents}
              selectedEventId={selectedEvent?.id}
              onSelectEvent={setSelectedEvent}
              onRegionFilter={handleRegionFilter}
              onBoundsFilter={setMapBounds}
            />
          </div>
          {detailPanel}
        </div>
      )}
      </div>
    </div>
  );
}
