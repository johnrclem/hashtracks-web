"use client";

import { MapPin, Calendar, Compass, Pencil } from "lucide-react";
import { formatDateCompact } from "@/lib/travel/format";
import type { LegState } from "./types";

export function CompactPill({
  legs,
  onExpand,
}: Readonly<{ legs: LegState[]; onExpand: () => void }>) {
  const isMulti = legs.length > 1;
  const firstStart = legs[0].startDate;
  const lastEnd = legs.at(-1)!.endDate;
  const summary =
    firstStart && lastEnd
      ? `${formatDateCompact(firstStart, { withWeekday: true })} → ${formatDateCompact(lastEnd, { withWeekday: true })}`
      : "Dates";

  return (
    <button
      type="button"
      onClick={onExpand}
      className="
        flex w-full items-center gap-3 rounded-full border border-border
        bg-card px-6 py-3 text-left transition-colors hover:bg-accent
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
      "
      aria-label="Edit travel search"
    >
      <MapPin className="h-4 w-4 text-muted-foreground" />
      <span className="font-medium">
        {isMulti ? `${legs.length} legs` : legs[0].destination || "Search"}
      </span>
      <span className="text-muted-foreground">·</span>
      <Calendar className="h-4 w-4 text-muted-foreground" />
      <span className="font-mono text-sm text-muted-foreground">{summary}</span>
      {!isMulti && (
        <>
          <span className="text-muted-foreground">·</span>
          <Compass className="h-4 w-4 text-muted-foreground" />
          <span className="font-mono text-sm text-muted-foreground">{legs[0].radiusKm} km</span>
        </>
      )}
      <span className="ml-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
        <Pencil className="h-3 w-3" />
        Edit
      </span>
    </button>
  );
}
