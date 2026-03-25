"use client";

import { useEffect } from "react";
import { Clock, X } from "lucide-react";
import { track } from "@vercel/analytics";
import { formatTime, formatDateShort } from "@/lib/format";
import { useIsMobile } from "@/hooks/useIsMobile";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import type { EventWithCoords } from "./ClusteredMarkers";
import type { HarelineEvent } from "./EventCard";

interface ColocatedEventListProps {
  events: EventWithCoords[];
  onSelectEvent: (event: HarelineEvent) => void;
  onClose: () => void;
}

/** Shared event rows rendered inside both mobile sheet and desktop card. */
function EventRows({
  events,
  onSelectEvent,
}: {
  events: EventWithCoords[];
  onSelectEvent: (event: HarelineEvent) => void;
}) {
  return (
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
            style={{ backgroundColor: color }}
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

            {/* Meta row: date + time + hares */}
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground/80">
                {formatDateShort(event.date)}
              </span>
              {event.startTime && (
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  {formatTime(event.startTime)}
                </span>
              )}
              {event.haresText && (
                <span className="truncate max-w-[120px]">
                  {event.haresText}
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
  );
}

/**
 * Event picker shown when a user clicks a stacked pin (multiple events at the
 * same coordinates) or a co-located cluster on the hareline map.
 *
 * Mobile (<1024px): renders as a bottom Sheet.
 * Desktop: renders as an inline card overlay.
 */
export function ColocatedEventList({
  events,
  onSelectEvent,
  onClose,
}: ColocatedEventListProps) {
  const isMobile = useIsMobile();

  // Analytics: track popover open
  useEffect(() => {
    track("map_colocated_popover", { eventCount: events.length });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Derive location label from the first event that has one
  const locationHint =
    events[0]?.event.locationCity ||
    events[0]?.event.locationName?.slice(0, 40);

  if (isMobile) {
    return (
      <Sheet open={true} onOpenChange={(open) => { if (!open) onClose(); }}>
        <SheetContent side="bottom" className="px-0 pb-0 max-h-[70vh]" showCloseButton={false}>
          <SheetHeader className="px-4 pb-2">
            <SheetTitle className="text-sm">
              {events.length} events at this location
            </SheetTitle>
            {locationHint && (
              <p className="text-xs text-muted-foreground truncate">
                {locationHint}
              </p>
            )}
          </SheetHeader>
          <EventRows events={events} onSelectEvent={onSelectEvent} />
        </SheetContent>
      </Sheet>
    );
  }

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

      <EventRows events={events} onSelectEvent={onSelectEvent} />
    </div>
  );
}
