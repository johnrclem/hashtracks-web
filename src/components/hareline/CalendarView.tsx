"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EventCard, type HarelineEvent } from "./EventCard";
import { regionColorClasses, regionBgClass, regionAbbrev, formatTimeCompact } from "@/lib/format";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface CalendarViewProps {
  events: HarelineEvent[];
}

function getDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

export function CalendarView({ events }: CalendarViewProps) {
  const router = useRouter();
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Group events by date key, sorted chronologically within each day
  const eventsByDate = useMemo(() => {
    const map = new Map<string, HarelineEvent[]>();
    for (const event of events) {
      const key = getDateKey(event.date);
      const existing = map.get(key) || [];
      existing.push(event);
      map.set(key, existing);
    }
    for (const dayEvents of map.values()) {
      dayEvents.sort((a, b) => {
        if (!a.startTime && !b.startTime) return 0;
        if (!a.startTime) return 1;
        if (!b.startTime) return -1;
        return a.startTime.localeCompare(b.startTime);
      });
    }
    return map;
  }, [events]);

  // Build calendar grid
  const firstDay = new Date(Date.UTC(year, month, 1));
  const startDow = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const cells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);

  // Group cells into weeks (rows of 7) for ARIA grid semantics
  const weeks: (number | null)[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }

  const todayKey = getDateKey(today.toISOString());
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  // Reuse a single DateTimeFormat for ARIA labels (avoids 30+ instantiations per render)
  const ariaDateFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    [],
  );

  const gridRef = useRef<HTMLDivElement>(null);

  // Determine which day should receive tabIndex={0} (roving tabindex)
  const focusDay = selectedDay
    ? Number(selectedDay.split("-")[2])
    : todayKey.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)
      ? today.getUTCDate()
      : 1;

  // Arrow key navigation between day cells
  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    const dayAttr = target.getAttribute("data-day");
    if (!dayAttr) return;

    const currentDay = Number(dayAttr);
    let nextDay: number | null = null;

    if (e.key === "ArrowRight") nextDay = currentDay + 1;
    else if (e.key === "ArrowLeft") nextDay = currentDay - 1;
    else if (e.key === "ArrowDown") nextDay = currentDay + 7;
    else if (e.key === "ArrowUp") nextDay = currentDay - 7;
    else return;

    // Stay within current month boundaries
    if (nextDay == null || nextDay < 1 || nextDay > daysInMonth) return;

    e.preventDefault();
    const nextCell = gridRef.current?.querySelector(`[data-day="${nextDay}"]`) as HTMLElement | null;
    nextCell?.focus();
  }, [daysInMonth]);

  function prevMonth() {
    if (month === 0) {
      setMonth(11);
      setYear(year - 1);
    } else {
      setMonth(month - 1);
    }
    setSelectedDay(null);
  }

  function nextMonth() {
    if (month === 11) {
      setMonth(0);
      setYear(year + 1);
    } else {
      setMonth(month + 1);
    }
    setSelectedDay(null);
  }

  function goToday() {
    setYear(today.getUTCFullYear());
    setMonth(today.getUTCMonth());
    setSelectedDay(null);
  }

  const selectedEvents = selectedDay ? eventsByDate.get(selectedDay) || [] : [];

  // Compute visible regions + event count for the displayed month (single pass)
  const { visibleRegions, monthEventCount } = useMemo(() => {
    const seen = new Map<string, { region: string; abbrev: string; colorClasses: string }>();
    let count = 0;
    for (const [key, dayEvents] of eventsByDate) {
      const [y, m] = key.split("-").map(Number);
      if (y !== year || m !== month + 1) continue;
      count += dayEvents.length;
      for (const e of dayEvents) {
        if (!seen.has(e.kennel.region)) {
          seen.set(e.kennel.region, {
            region: e.kennel.region,
            abbrev: regionAbbrev(e.kennel.region),
            colorClasses: regionColorClasses(e.kennel.region),
          });
        }
      }
    }
    return {
      visibleRegions: Array.from(seen.values()).sort((a, b) => a.region.localeCompare(b.region)),
      monthEventCount: count,
    };
  }, [eventsByDate, year, month]);

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="inline-flex items-center rounded-md border">
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-r-none" onClick={prevMonth} aria-label="Previous month">
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <h2 className="min-w-[160px] text-center text-lg font-bold">
              {MONTH_NAMES[month]} {year}
            </h2>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-l-none" onClick={nextMonth} aria-label="Next month">
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          {(year !== today.getUTCFullYear() || month !== today.getUTCMonth()) && (
            <Button variant="outline" size="sm" onClick={goToday} aria-label="Go to today">
              Today
            </Button>
          )}
        </div>
        <span className="text-sm text-muted-foreground">
          {monthEventCount} {monthEventCount === 1 ? "event" : "events"} this month
        </span>
      </div>

      {/* Responsive layout: calendar + side panel on desktop */}
      <div className="flex flex-col lg:flex-row lg:gap-6">
        {/* Calendar grid section */}
        <div className="min-w-0 flex-1">
          {/* Calendar grid with ARIA grid semantics */}
          <div
            ref={gridRef}
            role="grid"
            aria-label={`${MONTH_NAMES[month]} ${year} calendar`}
            onKeyDown={handleGridKeyDown}
            className="overflow-hidden rounded-md bg-border/30"
          >
            {/* Day headers */}
            <div role="row" className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground">
              {DAY_HEADERS.map((d) => (
                <div key={d} role="columnheader" className="bg-background py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Week rows */}
            {weeks.map((week, wi) => (
              <div key={wi} role="row" className="grid grid-cols-7 gap-px">
                {week.map((day, di) => {
                  if (day === null) {
                    return <div key={`empty-${wi}-${di}`} role="gridcell" className="min-h-20 bg-background" />;
                  }

                  const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const dayEvents = eventsByDate.get(dateKey) || [];
                  const isToday = dateKey === todayKey;
                  const isSelected = dateKey === selectedDay;
                  const cellDate = new Date(Date.UTC(year, month, day));
                  const isPast = cellDate < todayDate && !isToday;

                  const fullDateLabel = ariaDateFormatter.format(cellDate);
                  const cellAriaLabel = dayEvents.length > 0
                    ? `${fullDateLabel}, ${dayEvents.length} event${dayEvents.length > 1 ? "s" : ""}`
                    : fullDateLabel;

                  return (
                    <div
                      key={dateKey}
                      role="gridcell"
                      tabIndex={day === focusDay ? 0 : -1}
                      data-day={day}
                      onClick={() => setSelectedDay(isSelected ? null : dateKey)}
                      onKeyDown={(ev) => { if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSelectedDay(isSelected ? null : dateKey); } }}
                      aria-label={cellAriaLabel}
                      aria-selected={isSelected}
                      className={`min-h-20 bg-background p-1 text-left text-sm transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
                        isSelected
                          ? "ring-2 ring-inset ring-primary bg-primary/5"
                          : isToday
                            ? "border border-primary/50 bg-primary/10"
                            : isPast
                              ? "opacity-50"
                              : "hover:bg-muted/50"
                      }`}
                    >
                      <span
                        className={`text-xs ${
                          isToday ? "font-bold text-primary" : "text-muted-foreground"
                        }`}
                      >
                        {day}
                      </span>
                      {dayEvents.length > 0 && (
                        <div className="mt-0.5 flex flex-col gap-1">
                          {dayEvents.slice(0, 2).map((e) => (
                            <Tooltip key={e.id}>
                              <TooltipTrigger asChild>
                                <span
                                  className={`inline-flex h-5 w-fit max-w-full items-center truncate rounded-full px-1.5 text-[10px] font-bold leading-5 ring-1 ring-inset ring-foreground/10 ${regionColorClasses(e.kennel.region)}`}
                                >
                                  {e.startTime && (
                                    <span className="font-normal opacity-70">
                                      {formatTimeCompact(e.startTime)}
                                    </span>
                                  )}
                                  {e.startTime && <span className="mx-0.5 opacity-50">·</span>}
                                  {e.kennel.shortName}
                                </span>
                              </TooltipTrigger>
                              <TooltipContent>
                                <div className="space-y-0.5">
                                  <p className="font-semibold">{e.kennel.fullName}</p>
                                  {e.runNumber && <p className="text-xs">Run #{e.runNumber}</p>}
                                  {e.title && <p className="text-xs">{e.title}</p>}
                                  {e.startTime && <p className="text-xs">{formatTimeCompact(e.startTime)}</p>}
                                </div>
                              </TooltipContent>
                            </Tooltip>
                          ))}
                          {dayEvents.length > 2 && (
                            <Popover>
                              <PopoverTrigger asChild>
                                <button
                                  onClick={(ev) => ev.stopPropagation()}
                                  className="text-left text-[9px] text-muted-foreground hover:text-foreground"
                                >
                                  +{dayEvents.length - 2} more
                                </button>
                              </PopoverTrigger>
                              <PopoverContent side="bottom" align="start" className="w-56 p-2" onClick={(ev) => ev.stopPropagation()}>
                                <p className="mb-1.5 text-xs font-medium text-muted-foreground">
                                  {cellDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
                                </p>
                                <div className="space-y-1">
                                  {dayEvents.map((ev) => (
                                    <button
                                      key={ev.id}
                                      onClick={() => router.push(`/hareline/${ev.id}`)}
                                      className="flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left text-xs hover:bg-muted"
                                    >
                                      <span className={`h-2 w-2 shrink-0 rounded-full ${regionBgClass(ev.kennel.region)}`} />
                                      <span className="truncate font-medium">{ev.kennel.shortName}</span>
                                      {ev.startTime && <span className="shrink-0 text-muted-foreground">{formatTimeCompact(ev.startTime)}</span>}
                                    </button>
                                  ))}
                                </div>
                              </PopoverContent>
                            </Popover>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
          </div>

          {/* Color legend */}
          {visibleRegions.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-xs text-muted-foreground">
              {visibleRegions.map((r) => (
                <span key={r.region} className="inline-flex items-center gap-1">
                  <span className={`inline-block h-3 w-3 rounded-full ${regionBgClass(r.region)}`} />
                  <span>{r.abbrev}</span>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Detail panel: sidebar on desktop, below on mobile */}
        {selectedDay && (
          <div className="mt-4 lg:mt-0 lg:w-80 lg:shrink-0">
            <div className="space-y-2 rounded-md border p-4 lg:sticky lg:top-8 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto">
              <h3 className="text-sm font-medium">
                {new Date(selectedDay + "T12:00:00Z").toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                  year: "numeric",
                  timeZone: "UTC",
                })}
              </h3>
              {selectedEvents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No events this day.</p>
              ) : (
                <div className="space-y-2">
                  {selectedEvents.map((event) => (
                    <EventCard key={event.id} event={event} density="medium" />
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
