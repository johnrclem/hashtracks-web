"use client";

import { useState } from "react";
import { EventCard, type HarelineEvent } from "@/components/hareline/EventCard";
import { Button } from "@/components/ui/button";

interface CollapsibleEventListProps {
  events: HarelineEvent[];
  defaultLimit: number;
  label: string; // e.g. "upcoming" or "past"
}

export function CollapsibleEventList({
  events,
  defaultLimit,
  label,
}: CollapsibleEventListProps) {
  const [expanded, setExpanded] = useState(false);
  const hasMore = events.length > defaultLimit;
  const visible = expanded ? events : events.slice(0, defaultLimit);

  return (
    <div className="space-y-3">
      {visible.map((event) => (
        <EventCard key={event.id} event={event} density="medium" />
      ))}
      {hasMore && (
        <Button
          variant="ghost"
          size="sm"
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded
            ? "Show less"
            : `Show ${events.length - defaultLimit} more ${label} events`}
        </Button>
      )}
    </div>
  );
}
