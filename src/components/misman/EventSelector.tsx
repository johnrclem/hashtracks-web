"use client";

import { useRouter } from "next/navigation";
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
  const datePart = formatEventDate(event.date);
  const runPart = event.runNumber ? `#${event.runNumber}` : "";
  const titlePart = event.title || "";
  const parts = [datePart, runPart, titlePart].filter(Boolean);
  return parts.join(" — ");
}

export function EventSelector({
  events,
  selectedEventId,
  onSelect,
  kennelSlug,
}: EventSelectorProps) {
  const router = useRouter();

  function handleChange(eventId: string) {
    onSelect(eventId);
    // Update URL to reflect selected event
    router.replace(`/misman/${kennelSlug}/attendance/${eventId}`, {
      scroll: false,
    });
  }

  return (
    <div className="space-y-1">
      <label className="text-sm font-medium">Event</label>
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
                {formatEventLabel(event)}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
