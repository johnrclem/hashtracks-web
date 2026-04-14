"use client";

import { Switch } from "@/components/ui/switch";
import { SCHEDULE_DAYS } from "@/lib/days";
import type { DayCode } from "@/lib/travel/filters";

interface TravelResultFiltersProps {
  includePossible: boolean;
  onIncludePossibleChange: (next: boolean) => void;
  selectedDays: Set<DayCode>;
  onToggleDay: (day: DayCode) => void;
  onClearDays: () => void;
  /** Days that have at least one result — only these chips are rendered */
  availableDays: Set<DayCode>;
  /** Counts per day (only confirmed+likely, for chip badge) */
  dayCounts: Partial<Record<DayCode, number>>;
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
  possibleCount,
}: TravelResultFiltersProps) {
  const dayChips = SCHEDULE_DAYS.filter((d) => availableDays.has(d));
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
            return (
              <button
                key={day}
                type="button"
                onClick={() => onToggleDay(day)}
                aria-pressed={selected}
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
                <span className="font-mono text-[10px] opacity-60">{count}</span>
              </button>
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
