"use client";

import { useRouter } from "next/navigation";
import { Calendar } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface EventOption {
  id: string;
  date: string;
  title: string | null;
  runNumber: number | null;
  kennelShortName: string;
}

interface EventSelectorProps {
  events: EventOption[];
  selectedEventId: string | null;
  onSelect: (eventId: string) => void;
  kennelSlug: string;
}

function formatEventDate(isoDate: string): string {
  const date = new Date(isoDate);
  return date.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatEventLabel(event: EventOption): string {
  const runPart = event.runNumber ? `#${event.runNumber}` : "";
  const titlePart = event.title || "";
  const parts = [runPart, titlePart].filter(Boolean);
  return parts.join(" — ");
}

export function EventSelector({
  events,
  selectedEventId,
  onSelect,
  kennelSlug,
}: EventSelectorProps) {
  const router = useRouter();
  const selectedEvent = events.find((e) => e.id === selectedEventId);

  function handleChange(eventId: string) {
    onSelect(eventId);
    router.replace(`/misman/${kennelSlug}/attendance/${eventId}`, {
      scroll: false,
    });
  }

  return (
    <div className="rounded-xl border border-border/50 bg-card p-4">
      <div className="flex items-center gap-2 mb-2">
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Event
        </span>
      </div>
      {selectedEvent && (
        <div className="mb-3">
          <div className="text-xl font-bold">{formatEventDate(selectedEvent.date)}</div>
          {(selectedEvent.runNumber || selectedEvent.title) && (
            <div className="text-sm text-muted-foreground">
              {formatEventLabel(selectedEvent)}
            </div>
          )}
        </div>
      )}
      <Select value={selectedEventId ?? undefined} onValueChange={handleChange}>
        <SelectTrigger className="w-full">
          <SelectValue placeholder="Select an event..." />
        </SelectTrigger>
        <SelectContent>
          {events.map((event) => (
            <SelectItem key={event.id} value={event.id}>
              <span className="font-medium">{event.kennelShortName}</span>
              {" "}
              <span className="text-muted-foreground">
                {formatEventDate(event.date)}
                {event.runNumber ? ` — #${event.runNumber}` : ""}
                {event.title ? ` — ${event.title}` : ""}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
