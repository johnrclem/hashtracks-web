"use client";

import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { EventCard, type HarelineEvent } from "./EventCard";

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
  const today = new Date();
  const [year, setYear] = useState(today.getUTCFullYear());
  const [month, setMonth] = useState(today.getUTCMonth());
  const [selectedDay, setSelectedDay] = useState<string | null>(null);

  // Group events by date key
  const eventsByDate = useMemo(() => {
    const map = new Map<string, HarelineEvent[]>();
    for (const event of events) {
      const key = getDateKey(event.date);
      const existing = map.get(key) || [];
      existing.push(event);
      map.set(key, existing);
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

  const todayKey = getDateKey(today.toISOString());

  const selectedEvents = selectedDay ? eventsByDate.get(selectedDay) || [] : [];

  return (
    <div className="space-y-4">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <Button variant="outline" size="sm" onClick={prevMonth}>
          &larr;
        </Button>
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">
            {MONTH_NAMES[month]} {year}
          </h2>
          <Button variant="ghost" size="sm" className="text-xs" onClick={goToday}>
            Today
          </Button>
        </div>
        <Button variant="outline" size="sm" onClick={nextMonth}>
          &rarr;
        </Button>
      </div>

      {/* Day headers */}
      <div className="grid grid-cols-7 gap-px text-center text-xs font-medium text-muted-foreground">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="py-1">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {cells.map((day, i) => {
          if (day === null) {
            return <div key={`empty-${i}`} className="min-h-16" />;
          }

          const dateKey = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const dayEvents = eventsByDate.get(dateKey) || [];
          const isToday = dateKey === todayKey;
          const isSelected = dateKey === selectedDay;

          return (
            <button
              key={dateKey}
              onClick={() => setSelectedDay(isSelected ? null : dateKey)}
              className={`min-h-16 rounded-md border p-1 text-left text-sm transition-colors ${
                isSelected
                  ? "border-primary bg-primary/5"
                  : isToday
                    ? "border-primary/50 bg-primary/5"
                    : "border-transparent hover:bg-muted/50"
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
                <div className="mt-0.5 flex flex-wrap gap-0.5">
                  {dayEvents.length <= 3 ? (
                    dayEvents.map((e) => (
                      <Badge
                        key={e.id}
                        variant="secondary"
                        className="max-w-full truncate px-1 text-[10px] leading-tight"
                      >
                        {e.kennel.shortName}
                      </Badge>
                    ))
                  ) : (
                    <Badge variant="secondary" className="text-[10px]">
                      {dayEvents.length} events
                    </Badge>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Expanded day events */}
      {selectedDay && (
        <div className="space-y-2 rounded-md border p-4">
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
      )}
    </div>
  );
}
