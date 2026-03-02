"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import { SearchX } from "lucide-react";
import { EventCard, type HarelineEvent } from "./EventCard";
import { getDayOfWeek, formatDateLong, parseList } from "@/lib/format";
import { EventFilters } from "./EventFilters";
import { CalendarView } from "./CalendarView";
import { EventDetailPanel } from "./EventDetailPanel";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { useGeolocation } from "@/hooks/useGeolocation";
import { haversineDistance, getEventCoords } from "@/lib/geo";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100vh-16rem)] min-h-[400px] items-center justify-center rounded-md border text-sm text-muted-foreground">
      Loading map…
    </div>
  ),
});

interface HarelineViewProps {
  events: HarelineEvent[];
  subscribedKennelIds: string[];
  isAuthenticated: boolean;
  attendanceMap?: Record<string, AttendanceData>;
}

interface FilterCriteria {
  timeFilter: "upcoming" | "past" | "all";
  scope: "my" | "all";
  subscribedKennelIds: string[];
  selectedRegions: string[];
  selectedKennels: string[];
  selectedDays: string[];
  selectedCountry: string;
  todayUtc: number;
  nearMeDistance: number | null;
  userLat: number | null;
  userLng: number | null;
}

/** Check whether an event passes the time filter (upcoming/past/all). */
function passesTimeFilter(eventDate: number, timeFilter: FilterCriteria["timeFilter"], todayUtc: number): boolean {
  if (timeFilter === "all") return true;
  if (timeFilter === "upcoming" && eventDate < todayUtc) return false;
  if (timeFilter === "past" && eventDate >= todayUtc) return false;
  return true;
}

/** Check whether a single event passes all active filters. */
function passesAllFilters(event: HarelineEvent, f: FilterCriteria): boolean {
  const eventDate = new Date(event.date).getTime();

  if (!passesTimeFilter(eventDate, f.timeFilter, f.todayUtc)) return false;
  if (f.scope === "my" && !f.subscribedKennelIds.includes(event.kennelId)) return false;
  if (f.selectedRegions.length > 0 && !f.selectedRegions.includes(event.kennel.region)) return false;
  if (f.selectedKennels.length > 0 && !f.selectedKennels.includes(event.kennel.id)) return false;
  if (f.selectedDays.length > 0 && !f.selectedDays.includes(getDayOfWeek(event.date))) return false;
  if (f.selectedCountry && event.kennel.country !== f.selectedCountry) return false;

  // Near-me distance filter — only applies when geolocation is granted
  if (f.nearMeDistance != null && f.userLat != null && f.userLng != null) {
    const coords = getEventCoords(event.latitude ?? null, event.longitude ?? null, event.kennel.region);
    if (!coords) return false; // no coords + no region centroid — exclude
    if (haversineDistance(f.userLat, f.userLng, coords.lat, coords.lng) > f.nearMeDistance) return false;
  }

  return true;
}

/** Sort events by date (direction depends on timeFilter) then by startTime. */
function sortEvents(events: HarelineEvent[], timeFilter: "upcoming" | "past"): HarelineEvent[] {
  const sorted = [...events];
  sorted.sort((a, b) => {
    const dateA = new Date(a.date).getTime();
    const dateB = new Date(b.date).getTime();
    const dateDiff = timeFilter === "upcoming" ? dateA - dateB : dateB - dateA;
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

export function HarelineView({
  events,
  subscribedKennelIds,
  isAuthenticated,
  attendanceMap = {},
}: HarelineViewProps) {
  const searchParams = useSearchParams();
  const hasSubscriptions = subscribedKennelIds.length > 0;

  // Default scope depends on auth state
  const defaultScope = isAuthenticated && hasSubscriptions ? "my" : "all";

  // Initialize state from URL search params
  const rawView = searchParams.get("view");
  const [view, setViewState] = useState<"list" | "calendar" | "map">(
    rawView === "list" || rawView === "calendar" || rawView === "map" ? rawView : "list",
  );
  const [density, setDensityState] = useState<"medium" | "compact">(
    (searchParams.get("density") as "medium" | "compact") || "medium",
  );
  const [timeFilter, setTimeFilterState] = useState<"upcoming" | "past">(
    (searchParams.get("time") as "upcoming" | "past") || "upcoming",
  );
  const [scope, setScopeState] = useState<"my" | "all">(
    (searchParams.get("scope") as "my" | "all") || defaultScope,
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
  const [selectedCountry, setSelectedCountryState] = useState<string>(
    searchParams.get("country") ?? "",
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
      setNearMeDistance(null);
    }
  }, [geoState.status]); // eslint-disable-line react-hooks/exhaustive-deps

  // Sync state to URL via replaceState (no re-render, no history entry)
  const syncUrl = useCallback(
    (overrides: Record<string, string | string[]>) => {
      const params = new URLSearchParams();
      const state: Record<string, string | string[]> = {
        time: timeFilter,
        view,
        density,
        scope,
        regions: selectedRegions,
        kennels: selectedKennels,
        days: selectedDays,
        country: selectedCountry,
        dist: nearMeDistance != null ? String(nearMeDistance) : "",
        ...overrides,
      };

      for (const [key, val] of Object.entries(state)) {
        const str = Array.isArray(val) ? val.join(",") : val;
        // Only add non-default values to keep URL clean
        const isDefault =
          (key === "time" && str === "upcoming") ||
          (key === "view" && str === "list") ||
          (key === "density" && str === "medium") ||
          (key === "scope" && str === defaultScope) ||
          (key === "country" && str === "") ||
          str === "";
        if (!isDefault) {
          params.set(key, str);
        }
      }

      const qs = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    },
    [timeFilter, view, density, scope, selectedRegions, selectedKennels, selectedDays, selectedCountry, nearMeDistance, defaultScope],
  );

  // Wrapper setters that sync to URL
  function setView(v: "list" | "calendar" | "map") {
    setViewState(v);
    syncUrl({ view: v });
  }
  function setDensity(v: "medium" | "compact") {
    setDensityState(v);
    syncUrl({ density: v });
  }
  function resetListState() {
    setSelectedEvent(null);
    setVisibleCount(PAGE_SIZE);
  }
  function setTimeFilter(v: "upcoming" | "past") {
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
    resetListState();
    syncUrl({ regions: v });
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
  function setSelectedCountry(v: string) {
    setSelectedCountryState(v);
    resetListState();
    syncUrl({ country: v });
  }
  function setNearMeDistance(v: number | null) {
    setNearMeDistanceState(v);
    resetListState();
    syncUrl({ dist: v != null ? String(v) : "" });
  }

  // Shared filter context (recomputed once per render)
  const filterContext = useMemo(() => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);
    const userLat = geoState.status === "granted" ? geoState.lat : null;
    const userLng = geoState.status === "granted" ? geoState.lng : null;
    return { todayUtc, userLat, userLng };
  }, [geoState]);

  // Calendar events — all filters EXCEPT time (calendar has its own month navigation)
  const calendarEvents = useMemo(() => {
    return events.filter((event) => {
      return passesAllFilters(event, {
        timeFilter: "all", scope, subscribedKennelIds,
        selectedRegions, selectedKennels, selectedDays, selectedCountry,
        todayUtc: filterContext.todayUtc, nearMeDistance,
        userLat: filterContext.userLat, userLng: filterContext.userLng,
      });
    });
  }, [events, scope, subscribedKennelIds, selectedRegions, selectedKennels, selectedDays, selectedCountry, nearMeDistance, filterContext]);

  // List/map events — derived from calendarEvents by applying time filter on the smaller set
  const filteredEvents = useMemo(() => {
    return calendarEvents.filter((event) =>
      passesTimeFilter(new Date(event.date).getTime(), timeFilter, filterContext.todayUtc),
    );
  }, [calendarEvents, timeFilter, filterContext.todayUtc]);

  const sortedEvents = useMemo(() => {
    return sortEvents(filteredEvents, timeFilter);
  }, [filteredEvents, timeFilter]);

  // Debounced screen-reader announcement when filtered count changes
  useEffect(() => {
    if (announceTimerRef.current) clearTimeout(announceTimerRef.current);
    announceTimerRef.current = setTimeout(() => {
      if (liveRegionRef.current) {
        const timeLabel = timeFilter === "upcoming" ? "upcoming " : "past ";
        liveRegionRef.current.textContent = `${filteredEvents.length} ${timeLabel}${filteredEvents.length === 1 ? "event" : "events"}`;
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

  const activeFilterCount =
    selectedRegions.length + selectedKennels.length + selectedDays.length + (selectedCountry ? 1 : 0) + (nearMeDistance != null ? 1 : 0);

  function clearAllFilters() {
    setSelectedRegions([]);
    setSelectedKennels([]);
    setSelectedDays([]);
    setSelectedCountry("");
    setNearMeDistance(null);
  }

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

  const emptyState = (
    <div className="flex flex-col items-center gap-3 py-16 text-center">
      <SearchX className="h-10 w-10 text-muted-foreground/50" />
      <div>
        <p className="text-base font-medium text-foreground">No events found</p>
        <p className="mt-0.5 text-sm text-muted-foreground">
          {scope === "my"
            ? "No events from your subscribed kennels match these filters."
            : "No events match your current filters."}
        </p>
      </div>
      <div className="flex gap-2">
        {activeFilterCount > 0 && (
          <Button variant="outline" size="sm" onClick={clearAllFilters}>
            Clear all filters
          </Button>
        )}
        {scope === "my" && (
          <Button variant="outline" size="sm" onClick={() => setScope("all")}>
            Switch to All Kennels
          </Button>
        )}
      </div>
    </div>
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

  return (
    <div className="mt-3 space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: time toggle */}
        <div className="flex items-center gap-2">
          <span className="sr-only">Time range</span>
          <ToggleGroup
            type="single"
            value={timeFilter}
            onValueChange={(v) => v && setTimeFilter(v as "upcoming" | "past")}
            variant="outline"
            size="sm"
            aria-label="Time range"
          >
            <ToggleGroupItem value="upcoming">Upcoming</ToggleGroupItem>
            <ToggleGroupItem value="past">Past</ToggleGroupItem>
          </ToggleGroup>
        </div>

        {/* Right: view toggle + optional density */}
        <div className="flex items-center gap-2">
          <span className="hidden text-xs text-muted-foreground sm:inline">View:</span>
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as "list" | "calendar" | "map")}
            variant="outline"
            size="sm"
            aria-label="View mode"
          >
            <ToggleGroupItem value="list">List</ToggleGroupItem>
            <ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
            <ToggleGroupItem value="map">Map</ToggleGroupItem>
          </ToggleGroup>

          {view === "list" && (
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
          )}
        </div>
      </div>

      <Separator className="my-1" />

      {/* Filters */}
      <EventFilters
        events={events}
        isAuthenticated={isAuthenticated}
        hasSubscriptions={hasSubscriptions}
        scope={scope}
        onScopeChange={setScope}
        selectedRegions={selectedRegions}
        onRegionsChange={setSelectedRegions}
        selectedKennels={selectedKennels}
        onKennelsChange={setSelectedKennels}
        selectedDays={selectedDays}
        onDaysChange={setSelectedDays}
        selectedCountry={selectedCountry}
        onCountryChange={setSelectedCountry}
        nearMeDistance={nearMeDistance}
        onNearMeDistanceChange={setNearMeDistance}
        geoState={geoState}
        onRequestLocation={requestLocation}
        activeFilterCount={activeFilterCount}
        onClearAll={clearAllFilters}
      />

      {/* Results count (hidden for calendar — it shows its own month count) */}
      {view !== "calendar" && (
        <p className="text-sm text-muted-foreground" aria-hidden="true">
          {view === "list" && hasMore
            ? `Showing ${visibleCount} of ${sortedEvents.length} `
            : `${filteredEvents.length} `}
          {timeFilter === "upcoming" ? "upcoming " : "past "}
          {filteredEvents.length === 1 ? "event" : "events"}
          {scope === "my" ? " from your kennels" : ""}
          {nearMeDistance != null && geoState.status === "granted" ? ` within ${nearMeDistance} km` : ""}
        </p>
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
        <CalendarView events={calendarEvents} />
      ) : (
        <div className={selectedEvent ? "lg:grid lg:grid-cols-[1fr_380px] lg:gap-6" : ""}>
          {/* Left: map */}
          <div className="min-w-0">
            <MapView
              events={sortedEvents}
              selectedEventId={selectedEvent?.id}
              onSelectEvent={setSelectedEvent}
            />
          </div>
          {detailPanel}
        </div>
      )}
    </div>
  );
}
