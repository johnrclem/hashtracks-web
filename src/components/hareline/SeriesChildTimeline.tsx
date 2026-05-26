"use client";

import Link from "next/link";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { getBrowserTimezone } from "@/lib/timezone";
import { computeChildTime, type HarelineSeriesChild } from "./EventCard";

/**
 * "Weekend at a glance" mini-timeline shown on series-parent surfaces
 * (#1560 — extracted from `EventDetailPanel.tsx` in PR E.4 so it can be
 * reused by both the right-drawer panel AND the full umbrella detail page
 * at `/hareline/[eventId]`).
 *
 * Renders a region-colored vertical rail on the left with one filled dot
 * per child date. Each row links to `/hareline/{child.id}`. Cancelled
 * children render at 50% opacity with a strikethrough title + muted dot.
 *
 * Time formatting routes through `computeChildTime` (CodeRabbit PR #1697
 * review) so it matches the top-level card's #1654 anchor logic:
 *   1. `composeUtcStart(date, startTime, timezone)` when both startTime
 *      and timezone are present (the canonical anchor — guards against
 *      stale `dateUtc` after lower-trust startTime enrichment)
 *   2. Stored `dateUtc` paired with `startTime` (pre-#1654 fallback)
 *   3. Raw `HH:MM` (defensive — when timezone + dateUtc are both null)
 *
 * `displayTz` honors the user's "Local vs Kennel" time preference so the
 * timeline matches both the EventCard row above it AND the child's own
 * detail page on click.
 */
export function SeriesChildTimeline({
  childEvents,
  parentRegionColor,
}: Readonly<{
  childEvents: HarelineSeriesChild[];
  parentRegionColor: string;
}>) {
  const { preference } = useTimePreference();
  if (childEvents.length === 0) return null;
  return (
    <div>
      <h4 className="mb-1.5 text-xs font-mono uppercase tracking-wider text-muted-foreground/70">
        Weekend at a glance
      </h4>
      <ol
        className="flex flex-col border-l-2 ml-1 pl-3 space-y-1.5"
        style={{ borderColor: parentRegionColor }}
      >
        {childEvents.map((child) => {
          const childDate = new Date(child.date);
          const dayChip = childDate.toLocaleDateString("en-US", {
            weekday: "short",
            day: "numeric",
            timeZone: "UTC",
          });
          // #1654 — per-child timezone preference. USER_LOCAL renders in the
          // viewer's browser TZ; KENNEL_LOCAL renders in the child's stored
          // timezone (falls back to America/New_York if the child has none,
          // matching EventCard's defaulting).
          const displayTz =
            preference === "USER_LOCAL"
              ? getBrowserTimezone()
              : (child.timezone ?? "America/New_York");
          const childTime = computeChildTime(child, displayTz);
          const isChildCancelled = child.status === "CANCELLED";
          return (
            <li key={child.id} className="relative">
              <span
                aria-hidden="true"
                className="absolute -left-[14px] top-1.5 size-2 rounded-full"
                style={{
                  backgroundColor: isChildCancelled ? "#9ca3af" : parentRegionColor,
                }}
              />
              <Link
                href={`/hareline/${child.id}`}
                className={`flex items-baseline gap-2 text-sm hover:text-primary transition-colors ${
                  isChildCancelled ? "opacity-50" : ""
                }`}
              >
                <span className="font-mono text-[10px] uppercase tracking-wide text-muted-foreground/80 w-14 shrink-0">
                  {dayChip}
                </span>
                {childTime && (
                  <span
                    className="font-mono tabular-nums text-muted-foreground/70 w-14 shrink-0"
                    suppressHydrationWarning
                  >
                    {childTime}
                  </span>
                )}
                <span
                  className={`truncate font-medium ${
                    isChildCancelled ? "line-through" : ""
                  }`}
                >
                  {child.title ?? "Trail"}
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
