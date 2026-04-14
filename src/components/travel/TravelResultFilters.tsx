"use client";

import { Switch } from "@/components/ui/switch";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatDateCompact } from "@/lib/travel/format";
import type { DayCode } from "@/lib/travel/filters";

interface TravelResultFiltersProps {
  includePossible: boolean;
  onIncludePossibleChange: (next: boolean) => void;
  selectedDays: Set<DayCode>;
  onToggleDay: (day: DayCode) => void;
  onClearDays: () => void;
  /** Days that have at least one result — only these chips are rendered */
  availableDays: Set<DayCode>;
  /** Counts per day (for chip badge) */
  dayCounts: Partial<Record<DayCode, number>>;
  /** ISO date strings per day, ascending — used for chip tooltip content */
  datesByDay: Partial<Record<DayCode, string[]>>;
  possibleCount: number;
}

export function TravelResultFilters({
  includePossible,
  onIncludePossibleChange,
  selectedDays,
  onToggleDay,
  onClearDays,
  availableDays,
  dayCounts,
  datesByDay,
  possibleCount,
}: TravelResultFiltersProps) {
  // Sort chips by trip chronology (first matching date ascending), not
  // by calendar weekday. For a Tue→Mon trip, the chips read left-to-right
  // as the trip unfolds: Tue 4/14, Wed 4/15, ..., Mon 4/20. Calendar order
  // (Sun first) would put the trip's last two days at the front of the row.
  // ISO YYYY-MM-DD strings lex-sort chronologically, so no Date allocation.
  const dayChips = [...availableDays].sort((a, b) => {
    const aFirst = datesByDay[a]?.[0] ?? "";
    const bFirst = datesByDay[b]?.[0] ?? "";
    return aFirst.localeCompare(bFirst);
  });
  const hasActiveDayFilter = selectedDays.size > 0;

  if (dayChips.length === 0 && possibleCount === 0) return null;

  return (
    <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border/60 pb-4">
      {possibleCount > 0 && (
        <label className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Switch
            checked={includePossible}
            onCheckedChange={onIncludePossibleChange}
            aria-label="Include possible activity with results"
          />
          <span>
            Include possible
            <span className="ml-1.5 font-mono text-[11px] text-muted-foreground/60">
              ({possibleCount})
            </span>
          </span>
        </label>
      )}

      {dayChips.length > 1 && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60">
            Days
          </span>
          {dayChips.map((day) => {
            const selected = selectedDays.has(day);
            const count = dayCounts[day] ?? 0;
            const dates = datesByDay[day] ?? [];
            // Show the first matching date on the chip itself ("Tue 4/14");
            // tooltip lists every date so multi-week trips still surface all
            // occurrences. Falls back to count when no date is available.
            const firstDateLabel = dates.length > 0 ? shortMonthDay(dates[0]) : null;
            const tooltipLabel =
              dates.length > 0
                ? dates.map((d) => formatDateCompact(d)).join(", ")
                : null;

            const chip = (
              <button
                key={day}
                type="button"
                onClick={() => onToggleDay(day)}
                aria-pressed={selected}
                aria-label={
                  tooltipLabel
                    ? `${day} — ${count} result${count !== 1 ? "s" : ""} on ${tooltipLabel}`
                    : `${day} — ${count} result${count !== 1 ? "s" : ""}`
                }
                className={`
                  inline-flex items-center gap-1 rounded-full border px-2.5 py-1
                  text-xs font-medium transition-all
                  focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
                  ${
                    selected
                      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : "border-border bg-transparent text-muted-foreground hover:border-muted-foreground/50 hover:text-foreground"
                  }
                `}
              >
                {day}
                {firstDateLabel ? (
                  <span className="font-mono text-[10px] opacity-60 tabular-nums">
                    {firstDateLabel}
                  </span>
                ) : (
                  <span className="font-mono text-[10px] opacity-60">{count}</span>
                )}
              </button>
            );

            return tooltipLabel ? (
              <Tooltip key={day}>
                <TooltipTrigger asChild>{chip}</TooltipTrigger>
                <TooltipContent>{tooltipLabel}</TooltipContent>
              </Tooltip>
            ) : (
              chip
            );
          })}
          {hasActiveDayFilter && (
            <button
              type="button"
              onClick={onClearDays}
              className="ml-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:rounded-sm"
            >
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "M/D" format for chip date hints — slash-separated like the user thinks. */
function shortMonthDay(isoDate: string): string {
  const d = new Date(isoDate.slice(0, 10) + "T12:00:00Z");
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
