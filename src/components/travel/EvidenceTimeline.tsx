import type { EvidenceTimeline as EvidenceTimelineData } from "@/lib/travel/projections";

interface EvidenceTimelineProps {
  timeline: EvidenceTimelineData;
  accentClass?: string;
}

/**
 * 12-week dot rhythm showing when a kennel has actually run.
 * Grouped in sets of 4 with a baseline rule and current-week bracket.
 * Server component — pure SVG, no client state.
 */
export function EvidenceTimeline({ timeline, accentClass }: EvidenceTimelineProps) {
  const { weeks, totalEvents } = timeline;

  return (
    <div
      role="img"
      aria-label={`${totalEvents} confirmed events in the last 12 weeks. Activity in weeks ${weeks
        .map((w, i) => (w ? i + 1 : null))
        .filter(Boolean)
        .join(", ")}.`}
      className={`rounded-lg border-l-2 bg-muted/50 p-3 ${accentClass ?? "border-sky-500"}`}
    >
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">
        Evidence · last 12 weeks
      </div>

      {/* Dot rhythm: 3 groups of 4 */}
      <div className="relative flex items-center gap-0 pb-2">
        {[0, 1, 2].map((groupIdx) => (
          <div key={groupIdx} className="flex gap-1.5 px-2 relative">
            {weeks.slice(groupIdx * 4, groupIdx * 4 + 4).map((active, dotIdx) => {
              const weekNum = groupIdx * 4 + dotIdx;
              const isCurrent = weekNum === 11;

              return (
                <div
                  key={dotIdx}
                  className={`
                    h-2 w-2 rounded-full transition-all
                    ${active
                      ? `bg-[var(--tier-accent,oklch(0.56_0.165_235))] opacity-90`
                      : "border border-border bg-transparent"
                    }
                    ${isCurrent ? "h-2.5 w-2.5 ring-1 ring-[var(--tier-accent,oklch(0.56_0.165_235))] ring-offset-1 ring-offset-background" : ""}
                  `}
                />
              );
            })}
            {/* Group divider */}
            {groupIdx < 2 && (
              <span className="absolute right-0 top-1/2 h-2 w-px -translate-y-1/2 bg-border" />
            )}
          </div>
        ))}
      </div>

      {/* Baseline rule */}
      <div className="h-px w-full bg-border" />

      {/* Caption */}
      <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
        {totalEvents} run{totalEvents !== 1 ? "s" : ""} in the last 12 weeks
      </div>
    </div>
  );
}
