import { describe, it, expect, vi, beforeEach } from "vitest";
import { ICalAdapter, parseICalSummary, extractHaresFromDescription, paramValue } from "./adapter";
import type { Source } from "@/generated/prisma/client";

// Minimal ICS content for testing
const SAMPLE_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
CALSCALE:GREGORIAN
X-WR-CALNAME:Test Calendar
BEGIN:VEVENT
UID:com.test.run-1
DTSTART;TZID=America/Los_Angeles:20260301T181500
DTEND;TZID=America/Los_Angeles:20260301T211500
SUMMARY:SFH3 #2300: Test Trail
DESCRIPTION:Hare: Test Hasher\\n\\nOn On On: Test Bar
LOCATION:Golden Gate Park
GEO:37.7694;-122.4862
URL:https://www.sfh3.com/runs/1
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:com.test.run-2
DTSTART;TZID=America/Los_Angeles:20260305T181500
DTEND;TZID=America/Los_Angeles:20260305T211500
SUMMARY:GPH3 #1700
LOCATION:Alamo Square
URL:https://www.sfh3.com/runs/2
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:com.test.run-3
DTSTART;TZID=America/Los_Angeles:20260310T183000
DTEND;TZID=America/Los_Angeles:20260310T213000
SUMMARY:FHAC-U: BAWC 5
DESCRIPTION:Hares: Alpha & Omega\\n\\nDirections: Take 101 South
LOCATION:San Jose
URL:https://www.sfh3.com/runs/3
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:com.test.run-4
DTSTART;TZID=America/Los_Angeles:20260315T140000
DTEND;TZID=America/Los_Angeles:20260315T170000
SUMMARY:Marin H3 #290
DESCRIPTION:Hare: Trail Blazer
LOCATION:Mill Valley
URL:https://www.sfh3.com/runs/4
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:com.test.run-5
DTSTART;TZID=America/Los_Angeles:20260307T093000
DTEND;TZID=America/Los_Angeles:20260307T123000
SUMMARY:Hand Pump Workday
LOCATION:McLaren Park
URL:https://www.sfh3.com/runs/5
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:com.test.run-6
DTSTART;VALUE=DATE:20260620
DTEND;VALUE=DATE:20260622
SUMMARY:Bay 2 Blackout 2026
LOCATION:Somewhere in NorCal
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:com.test.run-7
DTSTART;TZID=America/Los_Angeles:20260312T183000
DTEND;TZID=America/Los_Angeles:20260312T213000
SUMMARY:Agnews #1510
LOCATION:Sunnyvale
DTSTAMP:20260201T000000Z
STATUS:CANCELLED
END:VEVENT
END:VCALENDAR`;

function buildMockSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "test-source-id",
    name: "SFH3 iCal Feed",
    url: "https://www.sfh3.com/calendar.ics?kennels=all",
    type: "ICAL_FEED",
    trustLevel: 8,
    scrapeFreq: "daily",
    scrapeDays: 90,
    isActive: true,
    config: {
      kennelPatterns: [
        ["^SFH3", "SFH3"],
        ["^GPH3", "GPH3"],
        ["^EBH3", "EBH3"],
        ["^SVH3", "SVH3"],
        ["^FHAC-U", "FHAC-U"],
        ["^Agnews", "AGNEWS"],
        ["^Marin H3", "MARINH3"],
        ["^FCH3", "FCH3"],
        ["^FMH3", "FMH3"],
        ["^BARH3", "BARH3"],
        ["^VMH3", "VMH3"],
      ],
      defaultKennelTag: "SFH3",
      skipPatterns: ["^Hand Pump"],
    },
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

// ---------- Unit tests for pure functions ----------

describe("paramValue", () => {
  it("returns string directly", () => {
    expect(paramValue("Hello")).toBe("Hello");
  });

  it("extracts val from ParameterValue object", () => {
    expect(paramValue({ val: "Hello", params: { LANGUAGE: "en" } })).toBe("Hello");
  });

  it("returns undefined for null/undefined", () => {
    expect(paramValue(undefined)).toBeUndefined();
    expect(paramValue(null as any)).toBeUndefined();
  });
});

describe("parseICalSummary", () => {
  const patterns: [string, string][] = [
    ["^SFH3", "SFH3"],
    ["^GPH3", "GPH3"],
    ["^FHAC-U", "FHAC-U"],
    ["^Agnews", "AGNEWS"],
    ["^Marin H3", "MARINH3"],
  ];

  it("parses kennel + run number + title", () => {
    const result = parseICalSummary("SFH3 #2285: A Very Heated Rivalry", patterns);
    expect(result.kennelTag).toBe("SFH3");
    expect(result.runNumber).toBe(2285);
    expect(result.title).toBe("A Very Heated Rivalry");
  });

  it("parses kennel + run number without title", () => {
    const result = parseICalSummary("GPH3 #1696", patterns);
    expect(result.kennelTag).toBe("GPH3");
    expect(result.runNumber).toBe(1696);
    expect(result.title).toBeUndefined();
  });

  it("parses kennel + title without run number", () => {
    const result = parseICalSummary("FHAC-U: BAWC 5", patterns);
    expect(result.kennelTag).toBe("FHAC-U");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBe("BAWC 5");
  });

  it("parses kennel with space in name", () => {
    const result = parseICalSummary("Marin H3 #288", patterns);
    expect(result.kennelTag).toBe("MARINH3");
    expect(result.runNumber).toBe(288);
  });

  it("parses Agnews with case-insensitive match", () => {
    const result = parseICalSummary("Agnews #1508", patterns);
    expect(result.kennelTag).toBe("AGNEWS");
    expect(result.runNumber).toBe(1508);
  });

  it("uses defaultKennelTag for unmatched events", () => {
    const result = parseICalSummary("Bay 2 Blackout 2026", patterns, "SFH3");
    expect(result.kennelTag).toBe("SFH3");
    expect(result.runNumber).toBeUndefined();
  });

  it("returns UNKNOWN when no patterns and no default", () => {
    const result = parseICalSummary("Unknown Event");
    expect(result.kennelTag).toBe("UNKNOWN");
  });

  it("handles decimal run numbers", () => {
    const result = parseICalSummary("SFH3 #2274.69: Nice Trail", patterns);
    expect(result.runNumber).toBe(2274);
    expect(result.title).toBe("Nice Trail");
  });
});

describe("extractHaresFromDescription", () => {
  it("extracts single hare", () => {
    expect(extractHaresFromDescription("Hare: Trail Blazer")).toBe("Trail Blazer");
  });

  it("extracts multiple hares with &", () => {
    expect(extractHaresFromDescription("Hares: Alpha & Omega")).toBe("Alpha & Omega");
  });

  it("handles ICS escaped newlines", () => {
    expect(
      extractHaresFromDescription("Hare: Lost in Fourskin\\n\\nOn On On: Cozy Car"),
    ).toBe("Lost in Fourskin");
  });

  it("handles ICS escaped commas", () => {
    expect(
      extractHaresFromDescription("Hares: Hash\\, Slinger\\, Jr"),
    ).toBe("Hash, Slinger, Jr");
  });

  it("returns undefined when no hare info", () => {
    expect(extractHaresFromDescription("Directions: Take 101 South")).toBeUndefined();
  });

  it("handles multiline description", () => {
    const desc = "Some intro text\\n\\nHare: Captain Hash\\n\\nMore info here";
    expect(extractHaresFromDescription(desc)).toBe("Captain Hash");
  });
});

// ---------- Integration tests for ICalAdapter ----------

describe("ICalAdapter", () => {
  let adapter: ICalAdapter;

  beforeEach(() => {
    adapter = new ICalAdapter();
    vi.restoreAllMocks();
  });

  it("has correct type", () => {
    expect(adapter.type).toBe("ICAL_FEED");
  });

  it("parses ICS content and extracts events", async () => {
    // Mock fetch to return our sample ICS
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, { status: 200 }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source, { days: 9999 });

    // Should not have errors
    expect(result.errors).toHaveLength(0);

    // Should skip Hand Pump Workday (skipPatterns), cancelled Agnews, and filter by date range
    // With days=9999, all non-skipped, non-cancelled events should be included
    const summaries = result.events.map((e) => `${e.kennelTag}: ${e.title}`);

    // SFH3 #2300
    const sfh3 = result.events.find((e) => e.kennelTag === "SFH3" && e.runNumber === 2300);
    expect(sfh3).toBeDefined();
    expect(sfh3!.title).toBe("Test Trail");
    expect(sfh3!.date).toBe("2026-03-01");
    expect(sfh3!.startTime).toBe("18:15");
    expect(sfh3!.hares).toBe("Test Hasher");
    expect(sfh3!.location).toBe("Golden Gate Park");
    expect(sfh3!.locationUrl).toContain("37.7694");
    expect(sfh3!.sourceUrl).toBe("https://www.sfh3.com/runs/1");

    // GPH3 #1700
    const gph3 = result.events.find((e) => e.kennelTag === "GPH3");
    expect(gph3).toBeDefined();
    expect(gph3!.runNumber).toBe(1700);
    expect(gph3!.location).toBe("Alamo Square");

    // FHAC-U: BAWC 5 (no run number, has title)
    const fhacu = result.events.find((e) => e.kennelTag === "FHAC-U");
    expect(fhacu).toBeDefined();
    expect(fhacu!.title).toBe("BAWC 5");
    expect(fhacu!.runNumber).toBeUndefined();
    expect(fhacu!.hares).toBe("Alpha & Omega");

    // Marin H3 #290
    const marin = result.events.find((e) => e.kennelTag === "MARINH3");
    expect(marin).toBeDefined();
    expect(marin!.runNumber).toBe(290);
    expect(marin!.startTime).toBe("14:00");

    // Hand Pump Workday should be skipped
    const handpump = result.events.find((e) =>
      e.title?.includes("Hand Pump"),
    );
    expect(handpump).toBeUndefined();

    // Cancelled Agnews should be skipped
    const agnews = result.events.find((e) => e.kennelTag === "AGNEWS");
    expect(agnews).toBeUndefined();

    // Bay 2 Blackout (all-day event) should use defaultKennelTag
    const b2b = result.events.find((e) => e.title?.includes("Bay 2 Blackout"));
    expect(b2b).toBeDefined();
    expect(b2b!.kennelTag).toBe("SFH3");
    expect(b2b!.date).toBe("2026-06-20");
    expect(b2b!.startTime).toBeUndefined();
  });

  it("returns diagnostic context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, { status: 200 }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.totalVEvents).toBe(7); // 7 VEVENTs in sample
    expect(result.diagnosticContext!.skippedPattern).toBe(1); // Hand Pump
    expect(result.diagnosticContext!.icsBytes).toBeGreaterThan(0);
    expect(result.diagnosticContext!.fetchDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("404");
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });

  it("handles network errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("ECONNREFUSED");
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });

  it("filters events by date range", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, { status: 200 }),
    );

    const source = buildMockSource();
    // Use days=1 to filter out most events (sample events are in March 2026)
    const result = await adapter.fetch(source, { days: 1 });

    // All events should be filtered out by date range
    expect(result.events.length).toBeLessThan(5);
    expect(result.diagnosticContext!.skippedDateRange).toBeGreaterThan(0);
  });

  it("detects HTML response (deactivated calendar plugin)", async () => {
    const html = `<!DOCTYPE html>
<html lang="en-US">
<head><title>BAH3 - Baltimore Annapolis Hash House Harriers</title></head>
<body><h1>Events</h1><p>Check back soon!</p></body>
</html>`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(html, {
        status: 200,
        headers: { "Content-Type": "text/html; charset=UTF-8" },
      }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("not valid ICS");
    expect(result.errors[0]).toContain("text/html");
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.totalVEvents).toBe(0);
    expect(result.diagnosticContext!.contentType).toBe("text/html; charset=UTF-8");
    expect(result.diagnosticContext!.bodyPreview).toBeDefined();
  });

  it("detects non-ICS response with no content-type", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("This is not an ICS file", { status: 200 }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("not valid ICS");
  });

  it("handles BOM prefix in valid ICS", async () => {
    const icsWithBom = "\uFEFF" + SAMPLE_ICS;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(icsWithBom, { status: 200 }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source, { days: 9999 });

    // Should still parse successfully despite BOM
    expect(result.errors).toHaveLength(0);
    expect(result.events.length).toBeGreaterThan(0);
  });

  it("includes contentType in success diagnostics", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, {
        status: 200,
        headers: { "Content-Type": "text/calendar; charset=utf-8" },
      }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.contentType).toBe("text/calendar; charset=utf-8");
  });

  it("works without config (defaultKennelTag fallback)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, { status: 200 }),
    );

    const source = buildMockSource({ config: null });
    const result = await adapter.fetch(source, { days: 9999 });

    // Without patterns, all events get UNKNOWN tag
    expect(result.events.length).toBeGreaterThan(0);
    result.events.forEach((e) => {
      expect(e.kennelTag).toBe("UNKNOWN");
    });
  });
});
