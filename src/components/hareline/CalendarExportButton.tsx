"use client";

import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { buildGoogleCalendarUrl, buildIcsContent } from "@/lib/calendar";

interface CalendarEvent {
  title?: string | null;
  date: string;
  startTime?: string | null;
  description?: string | null;
  haresText?: string | null;
  locationName?: string | null;
  sourceUrl?: string | null;
  kennel: { shortName: string };
  runNumber?: number | null;
}

interface CalendarExportButtonProps {
  event: CalendarEvent;
}

export function CalendarExportButton({ event }: CalendarExportButtonProps) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [open]);

  function handleDownloadIcs() {
    const content = buildIcsContent(event);
    const blob = new Blob([content], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "event.ics";
    a.click();
    URL.revokeObjectURL(url);
    setOpen(false);
  }

  const googleUrl = buildGoogleCalendarUrl(event);

  return (
    <div className="relative" ref={menuRef}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(!open)}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="mr-1.5"><path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/></svg>
        Add to Calendar
      </Button>

      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-md border bg-popover p-1 shadow-md">
          <a
            href={googleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
            onClick={() => setOpen(false)}
          >
            Google Calendar
          </a>
          <button
            onClick={handleDownloadIcs}
            className="flex w-full items-center rounded-sm px-2 py-1.5 text-sm hover:bg-accent"
          >
            Download .ics
          </button>
        </div>
      )}
    </div>
  );
}
