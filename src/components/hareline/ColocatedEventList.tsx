"use client";

import { Clock, MapPin, X } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { EventWithCoords } from "./ClusteredMarkers";
import type { HarelineEvent } from "./EventCard";

interface ColocatedEventListProps {
  events: EventWithCoords[];
  onSelectEvent: (event: HarelineEvent) => void;
  onClose: () => void;
}

/** Format an ISO date to "Wed, Mar 25" style. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Event picker shown when a user clicks a stacked pin (multiple events at the
 * same coordinates) or a co-located cluster on the hareline map.
 */
export function ColocatedEventList({
  events,
  onSelectEvent,
  onClose,
}: ColocatedEventListProps) {
  // Derive location label from the first event that has one
  const locationHint =
    events[0]?.event.locationCity ||
    events[0]?.event.locationName?.slice(0, 40);

  return (
    <div className="bg-background/95 backdrop-blur-sm border rounded-xl shadow-xl w-[380px] max-w-[calc(100vw-2rem)] overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2.5 border-b bg-muted/30">
        <div className="min-w-0">
          <span className="text-sm font-semibold">
            {events.length} events at this location
          </span>
          {locationHint && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {locationHint}
            </p>
          )}
        </div>
        <button
          onClick={onClose}
          className="shrink-0 rounded-md p-1 text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          aria-label="Close event list"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Event rows */}
      <div className="max-h-[320px] overflow-y-auto divide-y divide-border/50">
        {events.map(({ event, color }) => (
          <button
            key={event.id}
            onClick={() => onSelectEvent(event)}
            className="group flex w-full items-start gap-3 px-3 py-2.5 text-left transition-colors hover:bg-accent/50"
            style={{ minHeight: 52 }}
          >
            {/* Region color accent bar */}
            <span
              className="shrink-0 mt-1 rounded-full w-2 h-2 ring-2 ring-offset-1 ring-offset-background"
              style={{ backgroundColor: color, ringColor: color }}
            />

            {/* Main content */}
            <div className="flex-1 min-w-0 space-y-0.5">
              {/* Top line: kennel + run # */}
              <div className="flex items-baseline gap-1.5">
                <span className="text-sm font-semibold truncate">
                  {event.kennel?.shortName ?? "Unknown"}
                </span>
                {event.runNumber && (
                  <span className="shrink-0 text-xs text-muted-foreground font-mono">
                    #{event.runNumber}
                  </span>
                )}
              </div>

              {/* Title */}
              {event.title && (
                <p className="text-xs text-muted-foreground truncate leading-snug">
                  {event.title}
                </p>
              )}

              {/* Meta row: date + time + location */}
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground/80">
                  {shortDate(event.date)}
                </span>
                {event.startTime && (
                  <span className="flex items-center gap-0.5">
                    <Clock className="h-3 w-3" />
                    {formatTime(event.startTime)}
                  </span>
                )}
                {event.hares && (
                  <span className="truncate max-w-[120px]">
                    {event.hares}
                  </span>
                )}
              </div>
            </div>

            {/* Hover chevron */}
            <span className="shrink-0 mt-2 text-muted-foreground/0 group-hover:text-muted-foreground transition-colors">
              ›
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
