"use client";

import { useState, useMemo, useCallback, useEffect } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EventCard, getDayOfWeek, type HarelineEvent } from "./EventCard";
import { EventFilters } from "./EventFilters";
import { CalendarView } from "./CalendarView";
import { EventDetailPanel } from "./EventDetailPanel";
import type { AttendanceData } from "@/components/logbook/CheckInButton";
import { useGeolocation } from "@/hooks/useGeolocation";
import { haversineDistance, getEventCoords } from "@/lib/geo";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-96 items-center justify-center rounded-md border text-sm text-muted-foreground">
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

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

interface FilterCriteria {
  view: "list" | "calendar" | "map";
  timeFilter: "upcoming" | "past";
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

/** Check whether an event passes the time filter (upcoming/past). */
function passesTimeFilter(eventDate: number, view: FilterCriteria["view"], timeFilter: FilterCriteria["timeFilter"], todayUtc: number): boolean {
  if (view === "calendar") return true; // calendar has its own month navigation
  if (timeFilter === "upcoming" && eventDate < todayUtc) return false;
  if (timeFilter === "past" && eventDate >= todayUtc) return false;
  return true;
}

/** Check whether a single event passes all active filters. */
function passesAllFilters(event: HarelineEvent, f: FilterCriteria): boolean {
  const eventDate = new Date(event.date).getTime();

  if (!passesTimeFilter(eventDate, f.view, f.timeFilter, f.todayUtc)) return false;
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
  function setTimeFilter(v: "upcoming" | "past") {
    setTimeFilterState(v);
    setSelectedEvent(null);
    syncUrl({ time: v });
  }
  function setScope(v: "my" | "all") {
    setScopeState(v);
    setSelectedEvent(null);
    syncUrl({ scope: v });
  }
  function setSelectedRegions(v: string[]) {
    setSelectedRegionsState(v);
    setSelectedEvent(null);
    syncUrl({ regions: v });
  }
  function setSelectedKennels(v: string[]) {
    setSelectedKennelsState(v);
    setSelectedEvent(null);
    syncUrl({ kennels: v });
  }
  function setSelectedDays(v: string[]) {
    setSelectedDaysState(v);
    setSelectedEvent(null);
    syncUrl({ days: v });
  }
  function setSelectedCountry(v: string) {
    setSelectedCountryState(v);
    setSelectedEvent(null);
    syncUrl({ country: v });
  }
  function setNearMeDistance(v: number | null) {
    setNearMeDistanceState(v);
    setSelectedEvent(null);
    syncUrl({ dist: v != null ? String(v) : "" });
  }

  // Filter events
  const filteredEvents = useMemo(() => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);

    const userLat = geoState.status === "granted" ? geoState.lat : null;
    const userLng = geoState.status === "granted" ? geoState.lng : null;

    return events.filter((event) => {
      return passesAllFilters(event, {
        view, timeFilter, scope, subscribedKennelIds,
        selectedRegions, selectedKennels, selectedDays, selectedCountry, todayUtc,
        nearMeDistance, userLat, userLng,
      });
    });
  }, [events, view, timeFilter, scope, subscribedKennelIds, selectedRegions, selectedKennels, selectedDays, selectedCountry, nearMeDistance, geoState]);

  const sortedEvents = useMemo(() => {
    return sortEvents(filteredEvents, timeFilter);
  }, [filteredEvents, timeFilter]);

  const listContent = (
    <>
      {sortedEvents.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">
            {scope === "my"
              ? "No events from your subscribed kennels. Try switching to \"All Kennels\"."
              : "No events match your filters."}
          </p>
        </div>
      ) : (
        <div className={density === "compact" ? "space-y-1" : "space-y-2"}>
          {sortedEvents.map((event) => (
            <EventCard
              key={event.id}
              event={event}
              density={density}
              onSelect={setSelectedEvent}
              isSelected={selectedEvent?.id === event.id}
              attendance={attendanceMap[event.id] ?? null}
            />
          ))}
        </div>
      )}
    </>
  );

  return (
    <div className="mt-6 space-y-4">
      {/* Controls bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Left: time toggle (visible for list + map; spacer for calendar to keep layout stable) */}
        <div className="flex items-center">
          {view !== "calendar" ? (
            <ToggleGroup
              type="single"
              value={timeFilter}
              onValueChange={(v) => v && setTimeFilter(v as "upcoming" | "past")}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="upcoming">Upcoming</ToggleGroupItem>
              <ToggleGroupItem value="past">Past</ToggleGroupItem>
            </ToggleGroup>
          ) : (
            <div className="h-8" />
          )}
        </div>

        {/* Right: view toggle + optional density */}
        <div className="flex items-center gap-2">
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as "list" | "calendar" | "map")}
            variant="outline"
            size="sm"
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
            >
              <ToggleGroupItem value="medium">Medium</ToggleGroupItem>
              <ToggleGroupItem value="compact">Compact</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>
      </div>

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
      />

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {filteredEvents.length}{" "}
        {view !== "calendar" ? (timeFilter === "upcoming" ? "upcoming " : "past ") : ""}
        {filteredEvents.length === 1 ? "event" : "events"}
        {scope === "my" ? " from your kennels" : ""}
        {nearMeDistance != null ? ` within ${nearMeDistance} km` : ""}
      </p>

      {/* Content: master-detail on desktop (panel appears on selection), single column on mobile */}
      {view === "list" ? (
        <div className={selectedEvent ? "lg:grid lg:grid-cols-[1fr_380px] lg:gap-6" : ""}>
          {/* Left: event list */}
          <div className="min-w-0">{listContent}</div>

          {/* Right: detail panel (desktop only, visible when event selected) */}
          {selectedEvent && (
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
          )}
        </div>
      ) : view === "calendar" ? (
        <CalendarView events={filteredEvents} />
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

          {/* Right: detail panel (desktop only, visible when event selected) */}
          {selectedEvent && (
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
          )}
        </div>
      )}
    </div>
  );
}
