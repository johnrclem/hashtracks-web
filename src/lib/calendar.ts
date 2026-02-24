/**
 * Calendar export utilities — Google Calendar URL + .ics file generation.
 * Both work client-side from event data already in the page.
 */

/** Minimal event shape consumed by the calendar export builders. */
export interface CalendarEvent {
  title?: string | null;
  /** ISO date string (UTC noon, e.g. "2026-02-14T12:00:00.000Z"). */
  date: string;
  /** Optional start time as "HH:MM" (24-hour). */
  startTime?: string | null;
  /** IANA timezone for time-aware calendar entries (e.g. "America/New_York"). */
  timezone?: string | null;
  description?: string | null;
  haresText?: string | null;
  locationName?: string | null;
  sourceUrl?: string | null;
  kennel: { shortName: string };
  runNumber?: number | null;
}

/** Build a calendar event title: "KennelName — Run #N — Title". */
export function buildTitle(event: CalendarEvent): string {
  const parts = [event.kennel.shortName];
  if (event.runNumber) parts.push(`Run #${event.runNumber}`);
  if (event.title) parts.push(event.title);
  return parts.join(" — ");
}

/** Build the calendar event description body (hares, description, source URL). */
export function buildDetails(event: CalendarEvent): string {
  const lines: string[] = [];
  if (event.haresText) lines.push(`Hares: ${event.haresText}`);
  if (event.description) lines.push(event.description);
  if (event.sourceUrl) lines.push(`Source: ${event.sourceUrl}`);
  return lines.join("\n\n");
}

/** Parse ISO date + optional "HH:MM" into YYYYMMDD and HHMMSS strings */
export function parseDateParts(date: string, startTime?: string | null) {
  // date is ISO like "2026-02-14T12:00:00.000Z" — extract YYYY-MM-DD
  const ymd = date.slice(0, 10).replace(/-/g, "");

  if (!startTime) return { ymd, allDay: true, start: "", end: "" };

  const [hh, mm] = startTime.split(":");
  const startHHMMSS = `${hh}${mm}00`;

  // End = start + 2 hours
  let endHour = parseInt(hh, 10) + 2;
  if (endHour >= 24) endHour = 23;
  const endHHMMSS = `${String(endHour).padStart(2, "0")}${mm}00`;

  return { ymd, allDay: false, start: startHHMMSS, end: endHHMMSS };
}

/** Generate a Google Calendar "Add Event" URL with pre-filled fields. */
export function buildGoogleCalendarUrl(event: CalendarEvent): string {
  const title = buildTitle(event);
  const details = buildDetails(event);
  const { ymd, allDay, start, end } = parseDateParts(event.date, event.startTime);

  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: title,
    details,
  });

  if (allDay) {
    // All-day: dates=YYYYMMDD/YYYYMMDD (next day)
    const nextDay = incrementDate(ymd);
    params.set("dates", `${ymd}/${nextDay}`);
  } else {
    params.set("dates", `${ymd}T${start}/${ymd}T${end}`);
    if (event.timezone) {
      params.set("ctz", event.timezone);
    }
  }

  if (event.locationName) {
    params.set("location", event.locationName);
  }

  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

/** Generate an iCalendar (.ics) file string for downloading/importing into calendar apps. */
export function buildIcsContent(event: CalendarEvent): string {
  const title = buildTitle(event);
  const details = buildDetails(event);
  const { ymd, allDay, start, end } = parseDateParts(event.date, event.startTime);

  const now = new Date();
  const stamp = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//HashTracks//Event Export//EN",
    "BEGIN:VEVENT",
    `DTSTAMP:${stamp}`,
    `UID:${ymd}-${Date.now()}@hashtracks`,
    `SUMMARY:${escapeIcs(title)}`,
  ];

  if (allDay) {
    lines.push(`DTSTART;VALUE=DATE:${ymd}`);
    lines.push(`DTEND;VALUE=DATE:${incrementDate(ymd)}`);
  } else {
    if (event.timezone) {
      lines.push(`DTSTART;TZID=${event.timezone}:${ymd}T${start}`);
      lines.push(`DTEND;TZID=${event.timezone}:${ymd}T${end}`);
    } else {
      lines.push(`DTSTART:${ymd}T${start}`);
      lines.push(`DTEND:${ymd}T${end}`);
    }
  }

  if (event.locationName) {
    lines.push(`LOCATION:${escapeIcs(event.locationName)}`);
  }
  if (details) {
    lines.push(`DESCRIPTION:${escapeIcs(details)}`);
  }

  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/** Escape special characters per the iCalendar (RFC 5545) spec. */
export function escapeIcs(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** Add one day to a "YYYYMMDD" date string. Used for all-day calendar event end dates. */
export function incrementDate(ymd: string): string {
  // ymd = "YYYYMMDD"
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(4, 6), 10) - 1;
  const d = parseInt(ymd.slice(6, 8), 10);
  const next = new Date(y, m, d + 1);
  return `${next.getFullYear()}${String(next.getMonth() + 1).padStart(2, "0")}${String(next.getDate()).padStart(2, "0")}`;
}
