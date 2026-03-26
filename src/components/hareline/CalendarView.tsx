"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Badge } from "@/components/ui/badge";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { EventCard, type HarelineEvent } from "./EventCard";
import { regionColorClasses, regionBgClass, regionAbbrev, formatTimeCompact, formatTime } from "@/lib/format";
import { getRegionColor } from "@/lib/region";
import { getTimezoneAbbreviation, getBrowserTimezone, formatTimeInZone } from "@/lib/timezone";
import { useTimePreference } from "@/components/providers/time-preference-provider";
import { type TimeFilter, WEEKS_DAYS } from "./HarelineView";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTH_ABBREV = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

const DAY_HEADERS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isRollingFilter(tf: TimeFilter): boolean {
  return tf in WEEKS_DAYS;
}

interface CalendarViewProps {
  readonly events: HarelineEvent[];
  readonly timeFilter: TimeFilter;
}

/** Compute the initial focus day for roving tabindex. */
function computeFocusDay(
  selectedDay: string | null,
  year: number,
  month: number,
  todayKey: string,
  todayDate: Date,
  daysInMonth: number,
): number {
  if (selectedDay) {
    return Math.min(Number(selectedDay.split("-")[2]), daysInMonth);
  }
  if (todayKey.startsWith(`${year}-${String(month + 1).padStart(2, "0")}`)) {
    return Math.min(todayDate.getUTCDate(), daysInMonth);
  }
  return 1;
}

/** Build accessible label for a calendar day cell. */
function buildCellLabel(fullDateLabel: string, eventCount: number): string {
  if (eventCount > 0) {
    return `${fullDateLabel}, ${eventCount} event${eventCount > 1 ? "s" : ""}`;
  }
  return fullDateLabel;
}

/** Overflow popover content shown when a day has more than 2 events. */
function OverflowPopover({ dayEvents, cellDate, onNavigate }: Readonly<{
  dayEvents: HarelineEvent[];
  cellDate: Date;
  onNavigate: (eventId: string) => void;
}>) {
  return (
    <PopoverContent side="bottom" align="start" className="w-56 p-2" onClick={(ev) => ev.stopPropagation()}>
      <p className="mb-1.5 text-xs font-medium text-muted-foreground">
        {cellDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })}
      </p>
      <div className="space-y-1">
        {dayEvents.map((ev) => (
          <button
            key={ev.id}
            onClick={() => onNavigate(ev.id)}
            className="flex w-full flex-col rounded border-l-2 px-2 py-1 text-left text-xs hover:bg-muted"
            style={{ borderLeftColor: ev.kennel?.region ? getRegionColor(ev.kennel.region) : "#6b7280" }}
          >
            <div className="flex items-center gap-1.5">
              <span className="truncate font-medium" title={ev.kennel?.fullName}>{ev.kennel?.shortName}</span>
              {ev.startTime && <span className="ml-auto shrink-0 text-muted-foreground">{formatTimeCompact(ev.startTime)}</span>}
            </div>
            {ev.title && <span className="truncate text-[11px] text-muted-foreground">{ev.title}</span>}
          </button>
        ))}
      </div>
    </PopoverContent>
  );
}

function getDateKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function dateKeyFromParts(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

type CalendarMode = "month" | "weeks";

export function CalendarView({ events, timeFilter }: CalendarViewProps) {
  const router = useRouter();
  const { preference: timePref } = useTimePreference();
  const today = useMemo(() => new Date(), []);
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Calendar mode: auto-switch to weeks when a rolling filter is active
  const [calendarMode, setCalendarModeState] = useState<CalendarMode>(
    isRollingFilter(timeFilter) ? "weeks" : "month",
  );

  // Sync calendarMode when timeFilter changes from parent
  useEffect(() => {
    if (isRollingFilter(timeFilter)) {
      setCalendarModeState("weeks");
    } else if (timeFilter === "past") {
      setCalendarModeState("month");
    }
    // When timeFilter is "upcoming", keep user's choice (don't auto-switch)
  }, [timeFilter]);

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

  const todayKey = getDateKey(today.toISOString());
  const todayDate = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()));

  // Reuse a single DateTimeFormat for ARIA labels (avoids 30+ instantiations per render)
  const ariaDateFormatter = useMemo(
    () => new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }),
    [],
  );

  const gridRef = useRef<HTMLDivElement>(null);

  // ---- MONTH MODE GRID ----
  const firstDay = new Date(Date.UTC(year, month, 1));
  const startDow = firstDay.getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

  const monthCells: (number | null)[] = [];
  for (let i = 0; i < startDow; i++) monthCells.push(null);
  for (let d = 1; d <= daysInMonth; d++) monthCells.push(d);
  while (monthCells.length % 7 !== 0) monthCells.push(null);

  const monthWeeks: (number | null)[][] = [];
  for (let i = 0; i < monthCells.length; i += 7) {
    monthWeeks.push(monthCells.slice(i, i + 7));
  }

  const focusDay = computeFocusDay(selectedDay, year, month, todayKey, today, daysInMonth);

  // ---- WEEKS MODE GRID ----
  // Start from Sunday of the current week (stable across renders for the same calendar day)
  const todayYear = today.getUTCFullYear();
  const todayMonth = today.getUTCMonth();
  const todayDay = today.getUTCDate();

  const weekStart = useMemo(() => {
    const d = new Date(Date.UTC(todayYear, todayMonth, todayDay));
    d.setUTCDate(d.getUTCDate() - d.getUTCDay()); // back to Sunday
    return d;
  }, [todayYear, todayMonth, todayDay]);

  const totalWeeksDays = WEEKS_DAYS[timeFilter] ?? 28;
  const numWeeksRows = totalWeeksDays / 7;

  // Build weeks grid: array of rows, each row is 7 Date objects
  const weeksGrid = useMemo(() => {
    const rows: Date[][] = [];
    const start = new Date(weekStart);
    for (let w = 0; w < numWeeksRows; w++) {
      const row: Date[] = [];
      for (let d = 0; d < 7; d++) {
        row.push(new Date(start));
        start.setUTCDate(start.getUTCDate() + 1);
      }
      rows.push(row);
    }
    return rows;
  }, [weekStart, numWeeksRows]);

  // Weeks mode date range for header
  const weeksRangeLabel = useMemo(() => {
    if (weeksGrid.length === 0) return "";
    const first = weeksGrid[0][0];
    const last = weeksGrid[weeksGrid.length - 1][6];
    const fmt = (d: Date) => {
      const m = MONTH_ABBREV[d.getUTCMonth()];
      return `${m} ${d.getUTCDate()}`;
    };
    const firstYear = first.getUTCFullYear();
    const lastYear = last.getUTCFullYear();
    if (firstYear !== lastYear) {
      return `${fmt(first)}, ${firstYear} – ${fmt(last)}, ${lastYear}`;
    }
    return `${fmt(first)} – ${fmt(last)}, ${lastYear}`;
  }, [weeksGrid]);

  // Arrow key navigation between day cells
  const handleGridKeyDown = useCallback((e: React.KeyboardEvent) => {
    const dayCell = (e.target as HTMLElement).closest<HTMLElement>("[data-day]");
    if (!dayCell) return;
    const dayAttr = dayCell.dataset.day;
    if (!dayAttr) return;

    if (calendarMode === "month") {
      const currentDay = Number(dayAttr);
      let nextDay: number | null = null;

      if (e.key === "ArrowRight") nextDay = currentDay + 1;
      else if (e.key === "ArrowLeft") nextDay = currentDay - 1;
      else if (e.key === "ArrowDown") nextDay = currentDay + 7;
      else if (e.key === "ArrowUp") nextDay = currentDay - 7;
      else return;

      if (nextDay == null || nextDay < 1 || nextDay > daysInMonth) return;

      e.preventDefault();
      const nextCell = gridRef.current?.querySelector(`[data-day="${nextDay}"]`) as HTMLElement | null;
      nextCell?.focus();
    } else {
      // Weeks mode: arrow keys navigate by finding adjacent cells
      let delta = 0;
      if (e.key === "ArrowRight") delta = 1;
      else if (e.key === "ArrowLeft") delta = -1;
      else if (e.key === "ArrowDown") delta = 7;
      else if (e.key === "ArrowUp") delta = -7;
      else return;

      e.preventDefault();
      const allCells = Array.from(gridRef.current?.querySelectorAll<HTMLElement>("[data-day]") ?? []);
      const idx = allCells.indexOf(dayCell);
      const nextIdx = idx + delta;
      if (nextIdx >= 0 && nextIdx < allCells.length) {
        allCells[nextIdx].focus();
      }
    }
  }, [calendarMode, daysInMonth]);

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

  // Compute visible regions + event count for the displayed range
  const { visibleRegions, rangeEventCount } = useMemo(() => {
    const seen = new Map<string, { region: string; abbrev: string; colorClasses: string }>();
    let count = 0;

    function accumulate(dayEvents: HarelineEvent[]) {
      count += dayEvents.length;
      for (const e of dayEvents) {
        const region = e.kennel?.region ?? "";
        if (!seen.has(region)) {
          seen.set(region, {
            region,
            abbrev: regionAbbrev(region),
            colorClasses: regionColorClasses(region),
          });
        }
      }
    }

    if (calendarMode === "month") {
      for (const [key, dayEvents] of eventsByDate) {
        const [y, m] = key.split("-").map(Number);
        if (y !== year || m !== month + 1) continue;
        accumulate(dayEvents);
      }
    } else {
      // Weeks mode: scan all dates in the rolling range
      const startKey = getDateKey(weeksGrid[0]?.[0]?.toISOString() ?? today.toISOString());
      const endDate = weeksGrid[weeksGrid.length - 1]?.[6];
      const endKey = endDate ? getDateKey(endDate.toISOString()) : startKey;

      for (const [key, dayEvents] of eventsByDate) {
        if (key >= startKey && key <= endKey) {
          accumulate(dayEvents);
        }
      }
    }

    return {
      visibleRegions: Array.from(seen.values()).sort((a, b) => a.region.localeCompare(b.region)),
      rangeEventCount: count,
    };
  }, [eventsByDate, year, month, calendarMode, weeksGrid, today]);

  // Shared day cell renderer
  function renderDayCell(
    cellDate: Date,
    dateKey: string,
    opts: { focusable?: boolean; showMonthLabel?: boolean; isFirstCell?: boolean },
  ) {
    const dayEvents = eventsByDate.get(dateKey) || [];
    const isToday = dateKey === todayKey;
    const isSelected = dateKey === selectedDay;
    const isPast = cellDate < todayDate && !isToday;
    const day = cellDate.getUTCDate();

    const fullDateLabel = ariaDateFormatter.format(cellDate);
    const cellAriaLabel = buildCellLabel(fullDateLabel, dayEvents.length);

    // Show month abbreviation on the 1st of each month, or the first cell of a weeks grid
    const showMonth = opts.showMonthLabel && (day === 1 || opts.isFirstCell);
    const dayLabel = showMonth
      ? `${MONTH_ABBREV[cellDate.getUTCMonth()]} ${day}`
      : String(day);

    return (
      <div
        key={dateKey}
        role="gridcell"
        tabIndex={opts.focusable ? 0 : -1}
        data-day={calendarMode === "month" ? day : dateKey}
        onClick={() => setSelectedDay(isSelected ? null : dateKey)}
        onKeyDown={(ev) => { if (ev.target !== ev.currentTarget) return; if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); setSelectedDay(isSelected ? null : dateKey); } }}
        aria-label={cellAriaLabel}
        aria-selected={isSelected}
        className={`min-h-20 bg-background p-1 text-left text-sm transition-colors cursor-pointer outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring ${
          isSelected
            ? "ring-2 ring-inset ring-primary bg-primary/5"
            : isToday
              ? "ring-2 ring-inset ring-primary/40 bg-primary/5"
              : isPast
                ? "opacity-50"
                : "hover:bg-muted/50"
        }`}
      >
        <span
          className={`inline-flex items-center gap-1 text-xs ${
            isToday ? "font-bold text-primary" : showMonth ? "font-semibold text-foreground" : "text-muted-foreground"
          }`}
        >
          {dayLabel}
          {isToday && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden="true" />}
        </span>
        {dayEvents.length > 0 && (
          <div className="mt-0.5 flex flex-col gap-1">
            {dayEvents.slice(0, 2).map((e) => (
              <Tooltip key={e.id}>
                <TooltipTrigger asChild>
                  <span
                    className={`inline-flex h-5 w-fit max-w-full items-center truncate rounded-full px-1.5 text-[10px] font-bold leading-5 ring-1 ring-inset ring-foreground/10 ${regionColorClasses(e.kennel?.region ?? "")}`}
                    title={e.kennel?.fullName}
                  >
                    {e.startTime && (
                      <span className="font-normal opacity-70">
                        {formatTimeCompact(e.startTime)}
                      </span>
                    )}
                    {e.startTime && <span className="mx-0.5 opacity-50">·</span>}
                    {e.kennel?.shortName}
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  <div className="space-y-0.5">
                    <p className="font-semibold">{e.kennel?.fullName}</p>
                    <p className="text-xs text-muted-foreground">{e.kennel?.region}</p>
                    {e.runNumber && <p className="text-xs">Run #{e.runNumber}</p>}
                    {e.title && <p className="text-xs">{e.title}</p>}
                    {e.startTime && (() => {
                      const displayTz = timePref === "USER_LOCAL" ? getBrowserTimezone() : (e.timezone ?? "America/New_York");
                      const timeStr = e.dateUtc ? formatTimeInZone(e.dateUtc, displayTz) : formatTime(e.startTime);
                      const tzAbbrev = e.dateUtc ? getTimezoneAbbreviation(e.dateUtc, displayTz) : "";
                      return (
                        <p className="text-xs">
                          {timeStr}
                          {tzAbbrev && (
                            <span className="ml-1 text-muted-foreground">{tzAbbrev}</span>
                          )}
                        </p>
                      );
                    })()}
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
                <OverflowPopover dayEvents={dayEvents} cellDate={cellDate} onNavigate={(id) => router.push(`/hareline/${id}`)} />
              </Popover>
            )}
          </div>
        )}
      </div>
    );
  }

  // Determine if mode toggle should be shown (only when user has a choice)
  const showModeToggle = timeFilter === "upcoming";

  return (
    <div className="space-y-4">
      {/* Header: navigation (month) or date range (weeks) */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {calendarMode === "month" ? (
            <>
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
            </>
          ) : (
            <div className="inline-flex items-center gap-2 rounded-md border px-3 py-1">
              <span className="h-2 w-2 rounded-full bg-primary" aria-hidden="true" />
              <h2 className="text-lg font-bold">{weeksRangeLabel}</h2>
            </div>
          )}

          {/* Month / Weeks toggle — only shown when user can choose (timeFilter = upcoming) */}
          {showModeToggle && (
            <ToggleGroup
              type="single"
              value={calendarMode}
              onValueChange={(v) => v && setCalendarModeState(v as CalendarMode)}
              variant="outline"
              size="sm"
              aria-label="Calendar mode"
            >
              <ToggleGroupItem value="month">Month</ToggleGroupItem>
              <ToggleGroupItem value="weeks">Weeks</ToggleGroupItem>
            </ToggleGroup>
          )}
        </div>

        <Badge variant="secondary" className="text-xs font-normal">
          {rangeEventCount} {rangeEventCount === 1 ? "event" : "events"}
          {calendarMode === "month" ? " this month" : ""}
        </Badge>
      </div>

      {/* Responsive layout: calendar + side panel on desktop */}
      <div className="flex flex-col lg:flex-row lg:gap-6">
        {/* Calendar grid section */}
        <div className="min-w-0 flex-1">
          <div
            ref={gridRef}
            role="grid"
            tabIndex={-1}
            aria-label={calendarMode === "month"
              ? `${MONTH_NAMES[month]} ${year} calendar`
              : `Next ${totalWeeksDays / 7} weeks calendar`
            }
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

            {/* Grid rows */}
            {calendarMode === "month" ? (
              // Month mode: existing behavior
              monthWeeks.map((week, wi) => (
                <div key={`week-${year}-${month}-${wi}`} role="row" className="grid grid-cols-7 gap-px">
                  {week.map((day, di) => {
                    if (day === null) {
                      return <div key={`empty-${wi}-${di}`} role="gridcell" className="min-h-20 bg-background" />;
                    }
                    const dateKey = dateKeyFromParts(year, month, day);
                    const cellDate = new Date(Date.UTC(year, month, day));
                    return renderDayCell(cellDate, dateKey, {
                      focusable: day === focusDay,
                      showMonthLabel: false,
                    });
                  })}
                </div>
              ))
            ) : (
              // Weeks mode: rolling weeks from today
              weeksGrid.map((week, wi) => (
                <div key={getDateKey(week[0].toISOString())} role="row" className="grid grid-cols-7 gap-px">
                  {week.map((cellDate, di) => {
                    const dateKey = getDateKey(cellDate.toISOString());
                    return renderDayCell(cellDate, dateKey, {
                      focusable: dateKey === todayKey,
                      showMonthLabel: true,
                      isFirstCell: wi === 0 && di === 0,
                    });
                  })}
                </div>
              ))
            )}
          </div>

          {/* Color legend */}
          {visibleRegions.length > 0 && (() => {
            // Detect abbreviation collisions — show full name when ambiguous
            const abbrevCounts = new Map<string, number>();
            for (const r of visibleRegions) {
              abbrevCounts.set(r.abbrev, (abbrevCounts.get(r.abbrev) ?? 0) + 1);
            }
            return (
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-xs text-muted-foreground">
                {visibleRegions.map((r) => (
                  <span key={r.region} className="inline-flex items-center gap-1">
                    <span className={`inline-block h-3 w-3 rounded-full ${regionBgClass(r.region)}`} />
                    <span>{(abbrevCounts.get(r.abbrev) ?? 0) > 1 ? r.region : r.abbrev}</span>
                  </span>
                ))}
              </div>
            );
          })()}
        </div>

        {/* Detail panel: sidebar on desktop, below on mobile */}
        {selectedDay && (
          <div className="mt-4 lg:mt-0 lg:w-80 lg:shrink-0">
            <div
              className="space-y-2 rounded-md border border-t-[3px] p-4 lg:sticky lg:top-8 lg:max-h-[calc(100vh-8rem)] lg:overflow-y-auto"
              style={{ borderTopColor: selectedEvents.length > 0 && selectedEvents.every((e) => e.kennel?.region === selectedEvents[0]?.kennel?.region) ? getRegionColor(selectedEvents[0]?.kennel?.region ?? "") : undefined }}
            >
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
                    <EventCard key={event.id} event={event} density="medium" hideDate />
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
