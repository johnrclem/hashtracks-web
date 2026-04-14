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
import { getDayOfWeek, formatDateLong, parseList } from "@/lib/format";
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
  todayUtc: number;
  nearMeDistance: number | null;
  userLat: number | null;
  userLng: number | null;
}

/** Check whether an event matches a free-text search query. */
function matchesSearchText(event: HarelineEvent, query: string): boolean {
  if (!query.trim()) return true;
  const lower = query.toLowerCase();
  return !!(
    event.title?.toLowerCase().includes(lower) ||
    event.kennel?.shortName.toLowerCase().includes(lower) ||
    event.kennel?.fullName.toLowerCase().includes(lower) ||
    event.haresText?.toLowerCase().includes(lower) ||
    event.locationName?.toLowerCase().includes(lower) ||
    event.locationCity?.toLowerCase().includes(lower) ||
    event.description?.toLowerCase().includes(lower)
  );
}

/** Check whether an event passes the time filter. */
function passesTimeFilter(eventDate: number, timeFilter: FilterCriteria["timeFilter"], todayUtc: number): boolean {
  if (timeFilter === "all") return true;
  if (timeFilter === "upcoming") return eventDate >= todayUtc;
  if (timeFilter === "past") return eventDate < todayUtc;

  // Rolling weeks: must be >= today AND <= today + N days
  const days = WEEKS_DAYS[timeFilter];
  if (days == null) return true;
  const ceiling = todayUtc + days * 24 * 60 * 60 * 1000;
  return eventDate >= todayUtc && eventDate <= ceiling;
}

/** Check whether a single event passes all active filters. */
function passesAllFilters(event: HarelineEvent, f: FilterCriteria): boolean {
  const eventDate = new Date(event.date).getTime();

  if (!passesTimeFilter(eventDate, f.timeFilter, f.todayUtc)) return false;
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
  subscribedKennelIds,
  isAuthenticated,
  attendanceMap = {},
  weatherMap = {},
}: HarelineViewProps) {
  const searchParams = useSearchParams();
  const hasSubscriptions = subscribedKennelIds.length > 0;

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
    parseList(searchParams.get("regions")),
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
    syncUrl({ time: v });
  }
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

  // Shared filter context (recomputed once per render)
  const filterContext = useMemo(() => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
    const userLat = geoState.status === "granted" ? geoState.lat : null;
    const userLng = geoState.status === "granted" ? geoState.lng : null;
    return { todayUtc, userLat, userLng };
  }, [geoState]);

  // Expand state-level region selections to metro names (stable ref via useMemo)
  const regionsByState = useMemo(
    () => groupRegionsByState(events.map((e) => e.kennel?.region).filter(Boolean) as string[]),
    [events],
  );
  const expandedRegions = useMemo(
    () => expandRegionSelections(selectedRegions, regionsByState),
    [selectedRegions, regionsByState],
  );

  // Time-filtered events — applies ONLY the time filter so region chip counts
  // reflect the visible time range (e.g. "next 4 weeks") without being skewed
  // by region/kennel/search selections.
  const timeFilteredEvents = useMemo(() => {
    return events.filter((event) => {
      const eventDate = new Date(event.date).getTime();
      return passesTimeFilter(eventDate, timeFilter, filterContext.todayUtc);
    });
  }, [events, timeFilter, filterContext.todayUtc]);

  // Calendar events — all filters EXCEPT time (calendar has its own month navigation / weeks mode)
  const calendarEvents = useMemo(() => {
    return events.filter((event) => {
      return passesAllFilters(event, {
        timeFilter: "all", scope, subscribedKennelIds,
        selectedRegions, expandedRegions, selectedKennels, selectedDays, searchText,
        todayUtc: filterContext.todayUtc, nearMeDistance,
        userLat: filterContext.userLat, userLng: filterContext.userLng,
      });
    });
  }, [events, scope, subscribedKennelIds, selectedRegions, expandedRegions, selectedKennels, selectedDays, searchText, nearMeDistance, filterContext]);

  // List/map events — derived from calendarEvents by applying time filter + optional map bounds
  const filteredEvents = useMemo(() => {
    return calendarEvents.filter((event) => {
      if (!passesTimeFilter(new Date(event.date).getTime(), timeFilter, filterContext.todayUtc)) return false;
      // Map bounds filter — only when active (map view with "Search this area")
      if (mapBounds) {
        const coords = getEventCoords(event.latitude ?? null, event.longitude ?? null, event.kennel?.region ?? "");
        if (!coords) return false;
        if (coords.lat < mapBounds.south || coords.lat > mapBounds.north) return false;
        if (coords.lng < mapBounds.west || coords.lng > mapBounds.east) return false;
      }
      return true;
    });
  }, [calendarEvents, timeFilter, filterContext.todayUtc, mapBounds]);

  const sortedEvents = useMemo(() => {
    return sortEvents(filteredEvents, timeFilter);
  }, [filteredEvents, timeFilter]);

  // Debounced screen-reader announcement when filtered count changes
  useEffect(() => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => {
      if (liveRegionRef.current) {
        const label = TIME_LABELS[timeFilter];
        liveRegionRef.current.textContent = `${filteredEvents.length} ${label} ${filteredEvents.length === 1 ? "event" : "events"}`;
      }
    }, 500);
    return () => {
      if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    };
  }, [filteredEvents.length, timeFilter]);

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
    for (const e of events) {
      if (e.kennel?.region) set.add(e.kennel.region);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [events]);

  // Derive kennel options for FilterBar (filtered by selected regions)
  const kennelOptions = useMemo(() => {
    const kennelMap = new Map<string, { id: string; shortName: string; fullName: string; region: string }>();
    for (const e of events) {
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
  }, [events, selectedRegions, expandedRegions]);

  // Build items array for FilterBar (derives available filter options)
  const filterBarItems = useMemo(() => {
    return events.map((e) => ({
      id: e.id,
      region: e.kennel?.region ?? "",
    }));
  }, [events]);

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

  const detailPanel = selectedEvent ? (
    <div className="hidden lg:block">
      <div className="sticky top-8 max-h-[calc(100vh-4rem)]">
        <EventDetailPanel
          event={selectedEvent}
          attendance={attendanceMap[selectedEvent.id] ?? null}
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
        <CalendarView events={calendarEvents} timeFilter={timeFilter} />
      ) : (
        <div className={selectedEvent ? "lg:grid lg:grid-cols-[1fr_380px] lg:gap-6" : ""}>
          {/* Left: map */}
          <div className="min-w-0">
            <MapView
              events={sortedEvents}
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
  );
}
