import { describe, it, expect } from "vitest";
import {
  buildTitle,
  buildDetails,
  parseDateParts,
  escapeIcs,
  incrementDate,
  buildGoogleCalendarUrl,
  buildIcsContent,
} from "./calendar";
import { buildCalendarEvent } from "@/test/factories";

describe("buildTitle", () => {
  it("returns kennel only when no runNumber or title", () => {
    const e = buildCalendarEvent({ runNumber: null, title: null });
    expect(buildTitle(e)).toBe("NYCH3");
  });

  it("includes run number", () => {
    const e = buildCalendarEvent({ title: null });
    expect(buildTitle(e)).toBe("NYCH3 — Run #2100");
  });

  it("includes title", () => {
    const e = buildCalendarEvent({ runNumber: null });
    expect(buildTitle(e)).toBe("NYCH3 — Valentine's Day Trail");
  });

  it("includes all parts", () => {
    const e = buildCalendarEvent();
    expect(buildTitle(e)).toBe("NYCH3 — Run #2100 — Valentine's Day Trail");
  });
});

describe("buildDetails", () => {
  it("includes all fields", () => {
    const e = buildCalendarEvent();
    const details = buildDetails(e);
    expect(details).toContain("Hares: Mudflap");
    expect(details).toContain("A lovely trail");
    expect(details).toContain("Source: https://hashnyc.com");
  });

  it("returns empty string when no fields", () => {
    const e = buildCalendarEvent({ haresText: null, description: null, sourceUrl: null });
    expect(buildDetails(e)).toBe("");
  });

  it("includes only present fields", () => {
    const e = buildCalendarEvent({ description: null, sourceUrl: null });
    expect(buildDetails(e)).toBe("Hares: Mudflap");
  });
});

describe("parseDateParts", () => {
  it("returns all-day when no startTime", () => {
    const result = parseDateParts("2026-02-14T12:00:00.000Z");
    expect(result).toEqual({ ymd: "20260214", allDay: true, start: "", end: "" });
  });

  it("returns timed event with correct start and end", () => {
    const result = parseDateParts("2026-02-14T12:00:00.000Z", "14:30");
    expect(result).toEqual({ ymd: "20260214", allDay: false, start: "143000", end: "163000" });
  });

  it("clamps end hour at 23 for late start times", () => {
    const result = parseDateParts("2026-02-14T12:00:00.000Z", "22:30");
    expect(result).toEqual({ ymd: "20260214", allDay: false, start: "223000", end: "233000" });
  });

  it("treats null startTime as all-day", () => {
    const result = parseDateParts("2026-02-14T12:00:00.000Z", null);
    expect(result.allDay).toBe(true);
  });
});

describe("escapeIcs", () => {
  it("escapes backslash", () => {
    expect(escapeIcs("a\\b")).toBe("a\\\\b");
  });

  it("escapes semicolon", () => {
    expect(escapeIcs("a;b")).toBe("a\\;b");
  });

  it("escapes comma", () => {
    expect(escapeIcs("a,b")).toBe("a\\,b");
  });

  it("escapes newline", () => {
    expect(escapeIcs("a\nb")).toBe("a\\nb");
  });

  it("escapes all at once", () => {
    expect(escapeIcs("a\\b;c,d\ne")).toBe("a\\\\b\\;c\\,d\\ne");
  });
});

describe("incrementDate", () => {
  it("increments a normal day", () => {
    expect(incrementDate("20260214")).toBe("20260215");
  });

  it("handles month boundary", () => {
    expect(incrementDate("20260228")).toBe("20260301");
  });

  it("handles year boundary", () => {
    expect(incrementDate("20261231")).toBe("20270101");
  });

  it("handles leap year Feb 29", () => {
    expect(incrementDate("20240229")).toBe("20240301");
  });
});

describe("buildGoogleCalendarUrl", () => {
  it("builds all-day URL", () => {
    const e = buildCalendarEvent({ startTime: null });
    const url = buildGoogleCalendarUrl(e);
    expect(url).toContain("calendar.google.com/calendar/render");
    expect(url).toContain("dates=20260214%2F20260215");
    expect(url).toContain("action=TEMPLATE");
  });

  it("builds timed URL", () => {
    const e = buildCalendarEvent();
    const url = buildGoogleCalendarUrl(e);
    expect(url).toContain("dates=20260214T140000%2F20260214T160000");
  });

  it("includes location when present", () => {
    const e = buildCalendarEvent();
    const url = buildGoogleCalendarUrl(e);
    expect(url).toContain("location=Central+Park");
  });

  it("omits location when absent", () => {
    const e = buildCalendarEvent({ locationName: null });
    const url = buildGoogleCalendarUrl(e);
    expect(url).not.toContain("location=");
  });
});

describe("buildIcsContent", () => {
  it("includes VCALENDAR/VEVENT envelope", () => {
    const ics = buildIcsContent(buildCalendarEvent());
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("BEGIN:VEVENT");
    expect(ics).toContain("END:VEVENT");
    expect(ics).toContain("END:VCALENDAR");
  });

  it("uses VALUE=DATE for all-day events", () => {
    const ics = buildIcsContent(buildCalendarEvent({ startTime: null }));
    expect(ics).toContain("DTSTART;VALUE=DATE:20260214");
    expect(ics).toContain("DTEND;VALUE=DATE:20260215");
  });

  it("uses DTSTART/DTEND for timed events", () => {
    const ics = buildIcsContent(buildCalendarEvent());
    expect(ics).toContain("DTSTART:20260214T140000");
    expect(ics).toContain("DTEND:20260214T160000");
  });

  it("uses CRLF line endings", () => {
    const ics = buildIcsContent(buildCalendarEvent());
    expect(ics).toContain("\r\n");
    // Each line should end with \r\n
    const lines = ics.split("\r\n");
    expect(lines.length).toBeGreaterThan(5);
  });

  it("includes DTSTAMP and UID", () => {
    const ics = buildIcsContent(buildCalendarEvent());
    expect(ics).toMatch(/DTSTAMP:\d{8}T\d{6}Z/);
    expect(ics).toMatch(/UID:20260214-\d+@hashtracks/);
  });

  it("escapes special chars in SUMMARY", () => {
    const e = buildCalendarEvent({ title: "Trail; fun, times" });
    const ics = buildIcsContent(e);
    expect(ics).toContain("Trail\\; fun\\, times");
  });
});
