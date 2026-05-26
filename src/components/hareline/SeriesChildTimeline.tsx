"use client";

import Link from "next/link";
import { formatTime } from "@/lib/format";
import type { HarelineSeriesChild } from "./EventCard";

/**
 * "Weekend at a glance" mini-timeline shown on series-parent surfaces
 * (#1560 — extracted from `EventDetailPanel.tsx` in PR E.4 so it can be
 * reused by both the right-drawer panel AND the full umbrella detail page
 * at `/hareline/[eventId]`).
 *
 * Renders a region-colored vertical rail on the left with one filled dot
 * per child date. Each row links to `/hareline/{child.id}`. Cancelled
 * children render at 50% opacity with a strikethrough title + muted dot.
 */
export function SeriesChildTimeline({
  childEvents,
  parentRegionColor,
}: {
  childEvents: HarelineSeriesChild[];
  parentRegionColor: string;
}) {
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
          const childTime = child.startTime ? formatTime(child.startTime) : null;
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
