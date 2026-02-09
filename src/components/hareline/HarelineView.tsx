"use client";

import { useState, useMemo } from "react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { EventCard, getDayOfWeek, type HarelineEvent } from "./EventCard";
import { EventFilters } from "./EventFilters";
import { CalendarView } from "./CalendarView";

interface HarelineViewProps {
  events: HarelineEvent[];
  subscribedKennelIds: string[];
  isAuthenticated: boolean;
}

export function HarelineView({
  events,
  subscribedKennelIds,
  isAuthenticated,
}: HarelineViewProps) {
  const hasSubscriptions = subscribedKennelIds.length > 0;

  // View state
  const [view, setView] = useState<"list" | "calendar">("list");
  const [density, setDensity] = useState<"medium" | "compact">("medium");
  const [timeFilter, setTimeFilter] = useState<"upcoming" | "past">("upcoming");

  // Filter state
  const [scope, setScope] = useState<"my" | "all">(
    isAuthenticated && hasSubscriptions ? "my" : "all",
  );
  const [selectedRegions, setSelectedRegions] = useState<string[]>([]);
  const [selectedKennels, setSelectedKennels] = useState<string[]>([]);
  const [selectedDays, setSelectedDays] = useState<string[]>([]);

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

      {/* Content */}
      {view === "list" ? (
        sortedEvents.length === 0 ? (
          <div className="py-12 text-center">
            <p className="text-muted-foreground">
              {scope === "my"
                ? "No events from your subscribed kennels. Try switching to \"All Kennels\"."
                : "No events match your filters."}
            </p>
          </div>
        ) : (
          <div className={density === "compact" ? "space-y-1" : "space-y-3"}>
            {sortedEvents.map((event) => (
              <EventCard key={event.id} event={event} density={density} />
            ))}
          </div>
        )
      ) : (
        <CalendarView events={filteredEvents} />
      )}
    </div>
  );
}
