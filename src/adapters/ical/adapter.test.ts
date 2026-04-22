import { describe, it, expect, vi, beforeEach } from "vitest";
import { ICalAdapter, parseICalSummary, extractHaresFromDescription, extractRunNumberFromDescription, extractLocationFromDescription, extractOnOnVenueFromDescription, extractCostFromDescription, extractMapsUrlFromDescription, paramValue } from "./adapter";
import type { Source } from "@/generated/prisma/client";
import type { ParameterValue } from "node-ical";

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
BEGIN:VEVENT
UID:com.test.run-8
DTSTART;TZID=America/New_York:20260308T140000
DTEND;TZID=America/New_York:20260308T170000
SUMMARY:SFH3 #2301: Location In Desc
DESCRIPTION:Where: The Brass Tap\\nhttps://www.google.com/maps/place/The+Brass+Tap\\nHare: Test Runner
DTSTAMP:20260201T000000Z
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
    expect(paramValue(null as unknown as ParameterValue)).toBeUndefined();
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

  // Custom hare patterns (configurable via source config)
  it("uses custom patterns when provided", () => {
    expect(
      extractHaresFromDescription("WHO ARE THE HARES:  Used Rubber & Leeroy", [
        String.raw`(?:^|\n)\s*WHO ARE THE HARES:\s*(.+)`,
      ]),
    ).toBe("Used Rubber & Leeroy");
  });

  it("falls back to defaults when customPatterns is empty", () => {
    expect(extractHaresFromDescription("Hare: Trail Blazer", [])).toBe("Trail Blazer");
  });

  it("custom patterns replace defaults", () => {
    expect(
      extractHaresFromDescription("Hare: Mudflap", [String.raw`(?:^|\n)\s*Laid by:\s*(.+)`]),
    ).toBeUndefined();
  });

  it("skips malformed custom patterns gracefully", () => {
    expect(
      extractHaresFromDescription("Laid by: Speedy", ["[invalid(", String.raw`(?:^|\n)\s*Laid by:\s*(.+)`]),
    ).toBe("Speedy");
  });

  it("extracts Berlin H3 'Who: Trail laid by X' hares with custom pattern (#838)", () => {
    // Berlin H3 iCal descriptions have a multi-line Location/When/Who block.
    // Runs #2331 and #2332 verbatim shape:
    const desc2331 =
      "Location: Bellevueallee 1\nWhen: 15:30\nWho: Trail laid by Silent P\nWhat to bring: beer";
    const desc2332 =
      "Location: Invalidenpark\nWhen: 15:30\nWho: Trail laid by Love Balls\nWhat to bring: headtorch";
    const berlinPattern = [
      String.raw`(?:^|\n)\s*Who:\s*Trail\s+laid\s+by\s+([^,\n]+)`,
    ];
    expect(extractHaresFromDescription(desc2331, berlinPattern)).toBe("Silent P");
    expect(extractHaresFromDescription(desc2332, berlinPattern)).toBe("Love Balls");
  });
});

describe("extractRunNumberFromDescription", () => {
  it("extracts run number with custom pattern", () => {
    expect(
      extractRunNumberFromDescription("Hash # 2658\nSome details", [
        /Hash\s*#\s*(\d+)/i,
      ]),
    ).toBe(2658);
  });

  it("returns first match from multiple patterns", () => {
    expect(
      extractRunNumberFromDescription("Run #42\nHash # 100", [
        /Run\s*#\s*(\d+)/i,
        /Hash\s*#\s*(\d+)/i,
      ]),
    ).toBe(42);
  });

  it("returns undefined when no pattern matches", () => {
    expect(
      extractRunNumberFromDescription("No numbers here", [/Hash\s*#\s*(\d+)/i]),
    ).toBeUndefined();
  });

  it("returns undefined for empty pattern list", () => {
    expect(
      extractRunNumberFromDescription("Hash # 2658", []),
    ).toBeUndefined();
  });

  it("skips non-positive numbers", () => {
    expect(
      extractRunNumberFromDescription("Hash # 0", [/Hash\s*#\s*(\d+)/i]),
    ).toBeUndefined();
  });
});

describe("extractLocationFromDescription", () => {
  it("extracts 'Where:' pattern", () => {
    expect(extractLocationFromDescription("Where: The Brass Tap")).toBe("The Brass Tap");
  });

  it("extracts 'Location:' pattern", () => {
    expect(extractLocationFromDescription("Location: Central Park")).toBe("Central Park");
  });

  it("extracts 'Start:' pattern", () => {
    expect(extractLocationFromDescription("Start: Brooklyn Bridge Park")).toBe("Brooklyn Bridge Park");
  });

  it("extracts 'Starting Location:' pattern", () => {
    expect(extractLocationFromDescription("Starting Location: Union Square")).toBe("Union Square");
  });

  it("handles ICS escaped newlines", () => {
    expect(
      extractLocationFromDescription(String.raw`Where: The Brass Tap\nMore info here`),
    ).toBe("The Brass Tap");
  });

  it("strips embedded Maps URLs from location text", () => {
    expect(
      extractLocationFromDescription("Where: The Brass Tap https://www.google.com/maps/place/The+Brass+Tap"),
    ).toBe("The Brass Tap");
  });

  it("handles ICS escaped commas", () => {
    expect(
      extractLocationFromDescription(String.raw`Where: 123 Main St\, Suite 4`),
    ).toBe("123 Main St, Suite 4");
  });

  it("returns undefined when no location pattern found", () => {
    expect(extractLocationFromDescription(String.raw`Hare: Trail Blazer\nOn On On: Cozy Car`)).toBeUndefined();
  });

  it("handles multiline description with location in the middle", () => {
    const desc = String.raw`Hare: Captain Hash\n\nWhere: Fells Point\n\nBring $5`;
    expect(extractLocationFromDescription(desc)).toBe("Fells Point");
  });
});

describe("extractOnOnVenueFromDescription (#801 Reading H3)", () => {
  it("captures venue after 'On On: {time} …' before 'Hares:'", () => {
    // Fixture from Reading H3 Localendar feed (#801 issue body).
    const desc = "Run #1234 On On: 6:15p Lower Access lot at Monocacy Hill Hares: Cowboy";
    expect(extractOnOnVenueFromDescription(desc)).toBe("Lower Access lot at Monocacy Hill");
  });

  it("handles ICS-escaped commas and semicolons", () => {
    const desc = String.raw`Run #1234 On On: 6:15pm 404 New London Road\, Newark\, DE Hares: Cowboy`;
    expect(extractOnOnVenueFromDescription(desc)).toBe("404 New London Road, Newark, DE");
  });

  it("stops at 'Hash Cash:' sibling label", () => {
    const desc = String.raw`On On: Main Park Hash Cash: $5`;
    expect(extractOnOnVenueFromDescription(desc)).toBe("Main Park");
  });

  it("returns undefined when no 'On On:' label", () => {
    expect(extractOnOnVenueFromDescription("Hares: Cowboy")).toBeUndefined();
  });

  it("rejects captures that are just a time fragment", () => {
    const desc = "On On: 6:15p";
    expect(extractOnOnVenueFromDescription(desc)).toBeUndefined();
  });

  it("rejects captures shorter than 3 chars", () => {
    const desc = "On On: X";
    expect(extractOnOnVenueFromDescription(desc)).toBeUndefined();
  });

  it("stops at 'Hares:' even when no whitespace precedes it", () => {
    // Guards against typo'd feeds where 'Hares:' is adjacent to the venue.
    const desc = "On On: Lower Access lotHares: Cowboy";
    expect(extractOnOnVenueFromDescription(desc)).toBe("Lower Access lot");
  });

  it("ignores 'On On On:' after-run shorthand", () => {
    // "On On On:" names the *after-run* pub, not the trail start — skip it.
    const desc = "Hares: Cowboy On On On: Cozy Car";
    expect(extractOnOnVenueFromDescription(desc)).toBeUndefined();
  });

  it("strips 24-hour leading time too", () => {
    const desc = "On On: 18:30 Main Park Hares: Cowboy";
    expect(extractOnOnVenueFromDescription(desc)).toBe("Main Park");
  });
});

describe("extractCostFromDescription", () => {
  it("extracts 'Hash Cash: 5€' (wordpress-hash-event-api format)", () => {
    expect(extractCostFromDescription("Hash Cash: 5€")).toBe("5€");
  });

  it("extracts from multi-line description with ICS newlines", () => {
    const desc = String.raw`Bring a torch\n\nHash Cash: 5€\n\nOn On On: Pub`;
    expect(extractCostFromDescription(desc)).toBe("5€");
  });

  it("handles dollar-sign costs", () => {
    expect(extractCostFromDescription("Hash Cash: $7")).toBe("$7");
  });

  it("returns undefined when no cost pattern", () => {
    expect(extractCostFromDescription("Hares: Symphomaniac")).toBeUndefined();
  });

  it("allows custom patterns to replace defaults", () => {
    expect(
      extractCostFromDescription("Cost: £4", [/Cost:\s*(.+)/i]),
    ).toBe("£4");
  });

  it("drops matches exceeding maxLength (100 chars)", () => {
    const longValue = "a".repeat(150);
    expect(extractCostFromDescription(`Hash Cash: ${longValue}`)).toBeUndefined();
  });
});

describe("extractMapsUrlFromDescription", () => {
  it("extracts google.com/maps URL", () => {
    expect(
      extractMapsUrlFromDescription("Meet here: https://www.google.com/maps/place/The+Brass+Tap"),
    ).toBe("https://www.google.com/maps/place/The+Brass+Tap");
  });

  it("extracts maps.google.com URL", () => {
    expect(
      extractMapsUrlFromDescription("Start: https://maps.google.com/maps?q=Central+Park"),
    ).toBe("https://maps.google.com/maps?q=Central+Park");
  });

  it("extracts goo.gl/maps short URL", () => {
    expect(
      extractMapsUrlFromDescription("Location: https://goo.gl/maps/abc123"),
    ).toBe("https://goo.gl/maps/abc123");
  });

  it("returns undefined when no Maps URL", () => {
    expect(extractMapsUrlFromDescription("Where: The Brass Tap")).toBeUndefined();
  });

  it("handles iCal escaping in URLs", () => {
    expect(
      extractMapsUrlFromDescription(String.raw`https://www.google.com/maps/place/Foo\;Bar`),
    ).toBe("https://www.google.com/maps/place/FooBar");
  });

  it("strips trailing punctuation", () => {
    expect(
      extractMapsUrlFromDescription("https://www.google.com/maps/place/Foo)"),
    ).toBe("https://www.google.com/maps/place/Foo");
  });

  it("handles ICS escaped newlines before URL", () => {
    expect(
      extractMapsUrlFromDescription(String.raw`Where: The Brass Tap\nhttps://www.google.com/maps/place/The+Brass+Tap`),
    ).toBe("https://www.google.com/maps/place/The+Brass+Tap");
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
    // SFH3 #2300
    const sfh3 = result.events.find((e) => e.kennelTag === "SFH3" && e.runNumber === 2300);
    expect(sfh3).toBeDefined();
    expect(sfh3!.title).toBe("Test Trail");
    expect(sfh3!.date).toBe("2026-03-01");
    expect(sfh3!.startTime).toBe("18:15");
    expect(sfh3!.endTime).toBe("21:15");
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

    // Event with location in description (no LOCATION field)
    const descLoc = result.events.find((e) => e.title === "Location In Desc");
    expect(descLoc).toBeDefined();
    expect(descLoc!.location).toBe("The Brass Tap");
    expect(descLoc!.locationUrl).toBe("https://www.google.com/maps/place/The+Brass+Tap");
    expect(descLoc!.hares).toBe("Test Runner");
  });

  it("returns diagnostic context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, { status: 200 }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.totalVEvents).toBe(8); // 8 VEVENTs in sample
    expect(result.diagnosticContext!.skippedPattern).toBe(1); // Hand Pump
    expect(result.diagnosticContext!.icsBytes).toBeGreaterThan(0);
    expect(result.diagnosticContext!.fetchDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles fetch errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", {
        status: 404,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("404");
    expect(result.errorDetails?.fetch).toHaveLength(1);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.url).toBe(source.url);
    expect(result.diagnosticContext!.totalVEvents).toBe(0);
    expect(result.diagnosticContext!.icsBytes).toBe(0);
    expect(result.diagnosticContext!.contentType).toBe("text/html");
    expect(result.diagnosticContext!.fetchDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("handles network errors gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("ECONNREFUSED");
    expect(result.errorDetails?.fetch).toHaveLength(1);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.url).toBe(source.url);
    expect(result.diagnosticContext!.totalVEvents).toBe(0);
    expect(result.diagnosticContext!.icsBytes).toBe(0);
    expect(result.diagnosticContext!.fetchDurationMs).toBeGreaterThanOrEqual(0);
    expect(result.diagnosticContext!.contentType).toBeUndefined();
  });

  it("includes diagnosticContext on ICS parse error", async () => {
    // Valid-looking ICS header but corrupt content that triggers a parse error
    const corruptIcs = "BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n";
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(corruptIcs, {
        status: 200,
        headers: { "Content-Type": "text/calendar" },
      }),
    );

    // Force parseICS to throw
    const ical = await import("node-ical");
    vi.spyOn(ical.sync, "parseICS").mockImplementationOnce(() => {
      throw new Error("Unexpected end of input");
    });

    const source = buildMockSource();
    const result = await adapter.fetch(source);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("iCal parse error");
    expect(result.errorDetails?.parse).toHaveLength(1);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.url).toBe(source.url);
    expect(result.diagnosticContext!.totalVEvents).toBe(0);
    expect(result.diagnosticContext!.icsBytes).toBe(corruptIcs.length);
    expect(result.diagnosticContext!.contentType).toBe("text/calendar");
    expect(result.diagnosticContext!.fetchDurationMs).toBeGreaterThanOrEqual(0);
  });

  it("filters events by date range", async () => {
    // Create ICS with events far in the past and far in the future (outside any window)
    const farPastFutureIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:far-past
DTSTART:20200101T190000Z
SUMMARY:Ancient Trail
END:VEVENT
BEGIN:VEVENT
UID:far-future
DTSTART:20290101T190000Z
SUMMARY:Far Future Trail
END:VEVENT
END:VCALENDAR`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(farPastFutureIcs, { status: 200 }),
    );

    const source = buildMockSource({ scrapeDays: 90 });
    const result = await adapter.fetch(source);

    // Both events should be filtered out (2020 is >90 days back, 2029 is >90 days forward)
    expect(result.events).toHaveLength(0);
    expect(result.diagnosticContext!.skippedDateRange).toBe(2);
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

  it("extracts hares from title via titleHarePattern when description has none", async () => {
    const icsWithTitleHares = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:com.test.cch3-1
DTSTART;TZID=America/New_York:20260314T140000
DTEND;TZID=America/New_York:20260314T170000
SUMMARY:CCH3 #TBD ~ Captain Hash
LOCATION:Federal Hill
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(icsWithTitleHares, { status: 200 }),
    );

    const source = buildMockSource({
      config: {
        kennelPatterns: [["^CCH3", "CCH3"]],
        defaultKennelTag: "CCH3",
        titleHarePattern: "~\\s*(.+)$",
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].hares).toBe("Captain Hash");
    expect(result.events[0].kennelTag).toBe("CCH3");
  });

  it("suppresses endTime when DTEND is on a different calendar day (overnight run)", async () => {
    const icsOvernight = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:com.test.overnight-1
DTSTART;TZID=America/New_York:20260314T220000
DTEND;TZID=America/New_York:20260315T020000
SUMMARY:OVNH3 Full Moon Trail
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(icsOvernight, { status: 200 }),
    );

    const source = buildMockSource({
      config: { defaultKennelTag: "OVNH3" },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].startTime).toBe("22:00");
    expect(result.events[0].endTime).toBeUndefined();
  });

  it("treats literal 'None' location as empty and falls back to description", async () => {
    const icsWithNoneLocation = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:com.test.bh3fm-1
DTSTART;TZID=Europe/Berlin:20260403T184500
DTEND;TZID=Europe/Berlin:20260403T214500
SUMMARY:BH3FM Full Moon Run 148
DESCRIPTION:Hares: Symphomaniac\\nStart: S Julius Leber Brücke
LOCATION:None
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(icsWithNoneLocation, { status: 200 }),
    );

    const source = buildMockSource({
      config: {
        kennelPatterns: [["Full Moon Run", "bh3fm"]],
        defaultKennelTag: "berlinh3",
        locationPatterns: ["Start:\\s*(.+)"],
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.events).toHaveLength(1);
    // "None" should be filtered out, falling back to description extraction
    expect(result.events[0].location).not.toBe("None");
    expect(result.events[0].location).toBe("S Julius Leber Brücke");
    expect(result.events[0].date).toBe("2026-04-03");
  });

  it("populates cost from 'Hash Cash:' in description (Berlin H3 format)", async () => {
    const icsWithCost = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:com.test.bh3-1
DTSTART;TZID=Europe/Berlin:20260321T145000
DTEND;TZID=Europe/Berlin:20260321T174500
SUMMARY:Berlin H3 Run 2329
DESCRIPTION:Hash Cash: 5€\\nOn On On: The Pub
LOCATION:S Schönhauser Allee
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(icsWithCost, { status: 200 }),
    );

    const source = buildMockSource({
      config: {
        kennelPatterns: [["Full Moon Run", "bh3fm"]],
        defaultKennelTag: "berlinh3",
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].cost).toBe("5€");
    expect(result.events[0].kennelTag).toBe("berlinh3");
  });

  it("enriches Berlin H3 events with Hares from wp-event-manager detail page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-01T00:00:00Z"));
    const icsBerlin = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:com.test.bh3fm-enrich
DTSTART;TZID=Europe/Berlin:20260403T184500
DTEND;TZID=Europe/Berlin:20260403T214500
SUMMARY:Full Moon Run 148
DESCRIPTION:Hash Cash: 5€
LOCATION:None
URL:https://www.berlin-h3.eu/event/full-moon-run-148/
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    const detailHtml = `<html><body>
      <p class="wpem-additional-info-block-title"><strong>Hares -</strong> Symphomaniac</p>
      <p class="wpem-additional-info-block-title"><strong>Cost -</strong> 5 EUR</p>
    </body></html>`;

    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/event/full-moon-run-148")) {
        return new Response(detailHtml, { status: 200 });
      }
      return new Response(icsBerlin, { status: 200 });
    });

    const source = buildMockSource({
      config: {
        kennelPatterns: [["Full Moon Run", "bh3fm"]],
        defaultKennelTag: "berlinh3",
        enrichBerlinH3Details: true,
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].kennelTag).toBe("bh3fm");
    expect(result.events[0].hares).toBe("Symphomaniac");
    expect(result.events[0].cost).toBe("5€");
    expect(result.diagnosticContext!.enrichmentEnriched).toBe(1);
    vi.useRealTimers();
  });

  it("skips Berlin H3 enrichment when flag is off", async () => {
    const icsBerlin = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:com.test.bh3fm-off
DTSTART;TZID=Europe/Berlin:20260403T184500
SUMMARY:Full Moon Run 148
URL:https://www.berlin-h3.eu/event/full-moon-run-148/
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(icsBerlin, { status: 200 }),
    );

    const source = buildMockSource({
      config: {
        kennelPatterns: [["Full Moon Run", "bh3fm"]],
        defaultKennelTag: "berlinh3",
      },
    });
    await adapter.fetch(source, { days: 9999 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("enriches SFH3 events: preserves descriptive titles, appends Comment when enrichSFH3Details=true", async () => {
    // Pin before SAMPLE_ICS event dates so the enrichment "future-only" filter
    // doesn't drop them.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-01T00:00:00Z"));
    const detailHtml = `
      <html><head>
        <title>SFH3 - SFH3 Run #2300</title>
        <script type="application/ld+json">
          {"@context":"https://schema.org","@type":"Event","name":"SFH3 Run #2300","startDate":"2026-03-01T18:15:00-08:00"}
        </script>
      </head><body>
        <div class="run-key run_label"><label for="run_comment">Comment</label>:</div>
        <div class="run_content">You do not want to miss this event.</div>
      </body></html>
    `;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/\/runs\/\d+/.test(url)) {
        return new Response(detailHtml, { status: 200 });
      }
      return new Response(SAMPLE_ICS, { status: 200 });
    });

    const source = buildMockSource({
      config: {
        kennelPatterns: [
          ["^SFH3", "SFH3"],
          ["^GPH3", "GPH3"],
          ["^FHAC-U", "FHAC-U"],
          ["^Marin H3", "MARINH3"],
        ],
        defaultKennelTag: "SFH3",
        skipPatterns: ["^Hand Pump"],
        enrichSFH3Details: true,
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    const sfh3 = result.events.find((e) => e.sourceUrl === "https://www.sfh3.com/runs/1");
    expect(sfh3).toBeDefined();
    // The descriptive iCal-extracted title "Test Trail" must NOT be overridden
    // by the detail page's generic "SFH3 Run #2300" — see #545.
    expect(sfh3!.title).toBe("Test Trail");
    // …but the Comment field still gets appended to description regardless.
    expect(sfh3!.description).toContain("Comment: You do not want to miss this event.");
    vi.useRealTimers();
  });

  it("skips SFH3 enrichment when flag is off", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_ICS, { status: 200 }),
    );

    const source = buildMockSource();
    await adapter.fetch(source, { days: 9999 });

    // Only the initial .ics fetch — no detail-page enrichment requests
    expect(fetchSpy).toHaveBeenCalledTimes(1);
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
