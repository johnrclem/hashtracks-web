"use client";

import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EventCard, getDayOfWeek, type HarelineEvent } from "./EventCard";
import { EventFilters } from "./EventFilters";
import { CalendarView } from "./CalendarView";
import { EventDetailPanel } from "./EventDetailPanel";

interface HarelineViewProps {
  events: HarelineEvent[];
  subscribedKennelIds: string[];
  isAuthenticated: boolean;
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

export function HarelineView({
  events,
  subscribedKennelIds,
  isAuthenticated,
}: HarelineViewProps) {
  const searchParams = useSearchParams();
  const hasSubscriptions = subscribedKennelIds.length > 0;

  // Default scope depends on auth state
  const defaultScope = isAuthenticated && hasSubscriptions ? "my" : "all";

  // Initialize state from URL search params
  const [view, setViewState] = useState<"list" | "calendar">(
    (searchParams.get("view") as "list" | "calendar") || "list",
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

  // Selected event for detail panel (desktop only)
  const [selectedEvent, setSelectedEvent] = useState<HarelineEvent | null>(null);

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
          str === "";
        if (!isDefault) {
          params.set(key, str);
        }
      }

      const qs = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    },
    [timeFilter, view, density, scope, selectedRegions, selectedKennels, selectedDays, defaultScope],
  );

  // Wrapper setters that sync to URL
  function setView(v: "list" | "calendar") {
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

  // Filter events
  const filteredEvents = useMemo(() => {
    const now = new Date();
    const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0);

    return events.filter((event) => {
      const eventDate = new Date(event.date).getTime();

      // Time filter
      if (timeFilter === "upcoming" && eventDate < todayUtc) return false;
      if (timeFilter === "past" && eventDate >= todayUtc) return false;

      // Scope filter (My Kennels)
      if (scope === "my" && !subscribedKennelIds.includes(event.kennelId)) {
        return false;
      }

      // Region filter
      if (selectedRegions.length > 0 && !selectedRegions.includes(event.kennel.region)) {
        return false;
      }

      // Kennel filter
      if (selectedKennels.length > 0 && !selectedKennels.includes(event.kennel.id)) {
        return false;
      }

      // Day of week filter
      if (selectedDays.length > 0 && !selectedDays.includes(getDayOfWeek(event.date))) {
        return false;
      }

      return true;
    });
  }, [events, timeFilter, scope, subscribedKennelIds, selectedRegions, selectedKennels, selectedDays]);

  // Sort: upcoming = ascending (nearest first), past = descending (most recent first)
  const sortedEvents = useMemo(() => {
    const sorted = [...filteredEvents];
    if (timeFilter === "upcoming") {
      sorted.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    } else {
      sorted.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    }
    return sorted;
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
        {/* Time toggle */}
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

        <div className="flex items-center gap-2">
          {/* View toggle */}
          <ToggleGroup
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as "list" | "calendar")}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="list">List</ToggleGroupItem>
            <ToggleGroupItem value="calendar">Calendar</ToggleGroupItem>
          </ToggleGroup>

          {/* Density toggle (only in list view) */}
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
      />

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {sortedEvents.length} {sortedEvents.length === 1 ? "event" : "events"}
        {scope === "my" ? " from your kennels" : ""}
      </p>

      {/* Content: master-detail on desktop, single column on mobile */}
      {view === "list" ? (
        <div className="lg:grid lg:grid-cols-[1fr_380px] lg:gap-6">
          {/* Left: event list */}
          <div>{listContent}</div>

          {/* Right: detail panel (desktop only) */}
          <div className="hidden lg:block">
            <div className="sticky top-8">
              <EventDetailPanel event={selectedEvent} />
            </div>
          </div>
        </div>
      ) : (
        <CalendarView events={filteredEvents} />
      )}
    </div>
  );
}
