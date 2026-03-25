"use client";

import { X } from "lucide-react";
import { formatTime } from "@/lib/format";
import type { EventWithCoords } from "./ClusteredMarkers";
import type { HarelineEvent } from "./EventCard";

interface ColocatedEventListProps {
  events: EventWithCoords[];
  onSelectEvent: (event: HarelineEvent) => void;
  onClose: () => void;
}

/** Format an ISO date to a compact "Mar 25" style. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Event picker shown when a user clicks a stacked pin (multiple events at the
 * same coordinates) or a co-located cluster on the hareline map.
 */
export function ColocatedEventList({ events, onSelectEvent, onClose }: ColocatedEventListProps) {
  return (
    <div className="bg-background border rounded-lg shadow-lg p-2 max-w-xs w-full">
      {/* Header */}
      <div className="flex items-center justify-between px-1 pb-1.5">
        <span className="text-xs font-medium text-muted-foreground">
          {events.length} events at this location
        </span>
        <button
          onClick={onClose}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close event list"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* Event rows */}
      <div className="max-h-[264px] overflow-y-auto">
        {events.map(({ event, color }) => (
          <button
            key={event.id}
            onClick={() => onSelectEvent(event)}
            className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left hover:bg-accent transition-colors"
            style={{ minHeight: 44 }}
          >
            {/* Region color dot */}
            <span
              className="shrink-0 rounded-full"
              style={{
                width: 8,
                height: 8,
                backgroundColor: color,
              }}
            />

            {/* Date */}
            <span className="shrink-0 text-xs text-muted-foreground w-12">
              {shortDate(event.date)}
            </span>

            {/* Kennel name */}
            <span className="shrink-0 text-sm font-medium truncate max-w-[80px]">
              {event.kennel?.shortName ?? "Unknown"}
            </span>

            {/* Title (truncated) */}
            {event.title && (
              <span className="text-xs text-muted-foreground truncate flex-1 min-w-0">
                {event.title}
              </span>
            )}

            {/* Start time */}
            {event.startTime && (
              <span className="shrink-0 text-xs text-muted-foreground">
                {formatTime(event.startTime)}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
