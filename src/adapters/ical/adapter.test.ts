import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ICalAdapter, parseICalSummary, extractHaresFromDescription, extractRunNumberFromDescription, extractLocationFromDescription, extractOnOnVenueFromDescription, extractCostFromDescription, extractMapsUrlFromDescription, coalesceEndpointDuplicates, stripTitleKennelRunPrefix, paramValue } from "./adapter";
import type { RawEventData } from "../types";
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

  // Reading H3 (#1785)
  it("keeps the theme after the run number (Reading #1202)", () => {
    const result = parseICalSummary("RH3 #1202: Clowning Around Hash", [], "rh3");
    expect(result.kennelTag).toBe("rh3");
    expect(result.runNumber).toBe(1202);
    expect(result.title).toBe("Clowning Around Hash");
  });

  it("rejects an unconfirmed-run placeholder and drops the bare marker title", () => {
    const result = parseICalSummary("RH3: #120?", [], "rh3");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBeUndefined();
  });

  it("strips a leading placeholder marker but keeps the theme", () => {
    const result = parseICalSummary("RH3: #120? Kegs & Eggs", [], "rh3");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBe("Kegs & Eggs");
  });

  // #1955: with keepNonKennelTitlePrefix on, an event-type prefix is NOT a
  // kennel prefix — it must not be stripped. "Hash Lunch" matches neither a
  // run marker nor the resolved kennel tag, so parseICalSummary leaves `title`
  // undefined and the caller keeps the full summary (asserted in the
  // ICalAdapter integration test).
  it("keeps an event-type prefix when keepNonKennelTitlePrefix is set (Perth Hash Lunch)", () => {
    const result = parseICalSummary("Hash Lunch: Friday 5th June", [], "perth-h3", true);
    expect(result.kennelTag).toBe("perth-h3");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBeUndefined();
  });

  it("still strips a kennel prefix that matches the default tag when the flag is set", () => {
    // Guard the boundary: a real kennel prefix on a default-tag source must
    // keep stripping. "Perth H3" normalizes to the tag "perth-h3".
    const result = parseICalSummary("Perth H3: Mismanagement Mingle", [], "perth-h3", true);
    expect(result.title).toBe("Mismanagement Mingle");
  });

  it("strips ANY prefix by default (flag off) — preserves legacy multi-kennel feed behavior", () => {
    // The Reading regional Localendar tags everything `rh3` but carries full
    // kennel-name prefixes ("Lehigh Valley HHH: Mayfair Hash"). With the flag
    // off these must keep stripping to a clean event title.
    const result = parseICalSummary("Lehigh Valley HHH: Mayfair Hash", [], "rh3");
    expect(result.title).toBe("Mayfair Hash");
    // And the same summary is KEPT once the flag is on (kennel name ≠ tag).
    const kept = parseICalSummary("Lehigh Valley HHH: Mayfair Hash", [], "rh3", true);
    expect(kept.title).toBeUndefined();
  });
});

describe("stripTitleKennelRunPrefix (#2148 Reading / #2160 ICH3)", () => {
  const READING = ["RH3", "ReadingH3"];

  it("strips a double-colon run marker left after the kennel label (#1203)", () => {
    // parseICalSummary already consumed "RH3:"; the residual "#1203: …" leaks.
    expect(stripTitleKennelRunPrefix("#1203: Deja FuckYou Hash", READING)).toBe("Deja FuckYou Hash");
  });

  it("strips kennel + space-separated run marker (no colon)", () => {
    expect(stripTitleKennelRunPrefix("RH3 #1201 Some Bitches Be Getting Married Hash", READING))
      .toBe("Some Bitches Be Getting Married Hash");
  });

  it("strips a kennel-only prefix (no run number)", () => {
    expect(stripTitleKennelRunPrefix("RH3 Pigs' Head Social", READING)).toBe("Pigs' Head Social");
  });

  it("strips kennel + run + slash connector", () => {
    expect(stripTitleKennelRunPrefix("RH3 #1197 / Rogue North H3 Joint Trail", READING))
      .toBe("Rogue North H3 Joint Trail");
  });

  it("keeps a letter-suffix run marker out of the title (#1191A)", () => {
    expect(stripTitleKennelRunPrefix("RH3 #1191A: Groundhog Day Hash AGAIN", READING))
      .toBe("Groundhog Day Hash AGAIN");
  });

  it("strips the ICH3 spaced '# 60' prefix (#2160)", () => {
    expect(stripTitleKennelRunPrefix("ICH3# 60 Plea Barkin", ["ICH3"])).toBe("Plea Barkin");
  });

  it("leaves a non-matching kennel row untouched (Philadelphia HHH)", () => {
    expect(stripTitleKennelRunPrefix("Philadelphia HHH", READING)).toBe("Philadelphia HHH");
  });

  it("does not eat a sibling code that merely starts with the alias (boundary guard)", () => {
    expect(stripTitleKennelRunPrefix("RH3FM Full Moon", READING)).toBe("RH3FM Full Moon");
  });

  it("returns undefined when nothing real remains", () => {
    expect(stripTitleKennelRunPrefix("RH3 #1203", READING)).toBeUndefined();
  });
});

describe("extractHaresFromDescription", () => {
  it("extracts single hare", () => {
    expect(extractHaresFromDescription("Hare: Trail Blazer")).toBe("Trail Blazer");
  });

  it("extracts multiple hares with &", () => {
    expect(extractHaresFromDescription("Hares: Alpha & Omega")).toBe("Alpha & Omega");
  });

  // Reading H3 (#1785) — clip hares at a standing "More details to cum"
  // notice OR at the next inline field label (On-On / Hash Cash) when the
  // kennel packs everything onto one DESCRIPTION line with no newline.
  it.each<[string, string]>([
    ["Hare: Sex Toys for Everyone More details to cum", "Sex Toys for Everyone"],
    ["Hares: Dances with Whores More details to cum", "Dances with Whores"],
    ["Hares: Decoy & More details to cum", "Decoy"],
    ["Hare: Decoy More to come", "Decoy"],
    // Live #1202: hares run straight into On-On: and Hash Cash: on one line.
    [
      "Hares: Sex Toys & Silence of the Goats On-On: Reading Regional Airport Hash Cash: $5 Note on out at 12pm",
      "Sex Toys & Silence of the Goats",
    ],
  ])("clips the description trailer/fields from %j", (desc, expected) => {
    expect(extractHaresFromDescription(desc)).toBe(expected);
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

  // Safety net: several tests in this describe install fake timers inline
  // (vi.useFakeTimers/setSystemTime) and restore at the end of the test body.
  // Restore here too so a throwing assertion can't leak a frozen clock into
  // subsequent tests (#2066).
  afterEach(() => {
    vi.useRealTimers();
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
    const sfh3 = result.events.find((e) => e.kennelTags[0] === "SFH3" && e.runNumber === 2300);
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
    const gph3 = result.events.find((e) => e.kennelTags[0] === "GPH3");
    expect(gph3).toBeDefined();
    expect(gph3!.runNumber).toBe(1700);
    expect(gph3!.location).toBe("Alamo Square");

    // FHAC-U: BAWC 5 (no run number, has title)
    const fhacu = result.events.find((e) => e.kennelTags[0] === "FHAC-U");
    expect(fhacu).toBeDefined();
    expect(fhacu!.title).toBe("BAWC 5");
    expect(fhacu!.runNumber).toBeUndefined();
    expect(fhacu!.hares).toBe("Alpha & Omega");

    // Marin H3 #290
    const marin = result.events.find((e) => e.kennelTags[0] === "MARINH3");
    expect(marin).toBeDefined();
    expect(marin!.runNumber).toBe(290);
    expect(marin!.startTime).toBe("14:00");

    // Hand Pump Workday should be skipped
    const handpump = result.events.find((e) =>
      e.title?.includes("Hand Pump"),
    );
    expect(handpump).toBeUndefined();

    // Cancelled Agnews should be skipped
    const agnews = result.events.find((e) => e.kennelTags[0] === "AGNEWS");
    expect(agnews).toBeUndefined();

    // Bay 2 Blackout (all-day event) should use defaultKennelTag
    const b2b = result.events.find((e) => e.title?.includes("Bay 2 Blackout"));
    expect(b2b).toBeDefined();
    expect(b2b!.kennelTags[0]).toBe("SFH3");
    expect(b2b!.date).toBe("2026-06-20");
    expect(b2b!.startTime).toBeUndefined();

    // Event with location in description (no LOCATION field)
    const descLoc = result.events.find((e) => e.title === "Location In Desc");
    expect(descLoc).toBeDefined();
    expect(descLoc!.location).toBe("The Brass Tap");
    expect(descLoc!.locationUrl).toBe("https://www.google.com/maps/place/The+Brass+Tap");
    expect(descLoc!.hares).toBe("Test Runner");
  });

  // #1955 — Perth H3 (The Events Calendar iCal). A special event whose
  // SUMMARY is "Hash Lunch: Friday 5th June" must keep its full title; the
  // "Hash Lunch:" prefix is an event type, not a kennel prefix to strip.
  it("keeps an event-type SUMMARY prefix as the full title (Perth Hash Lunch)", async () => {
    const perthIcs = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Test//EN",
      "BEGIN:VEVENT",
      "UID:perth-lunch-1",
      "DTSTART;TZID=Australia/Perth:20260605T123000",
      "DTEND;TZID=Australia/Perth:20260605T143000",
      "SUMMARY:Hash Lunch: Friday 5th June",
      "LOCATION:Quello Cafe, Subiaco",
      "DTSTAMP:20260201T000000Z",
      "END:VEVENT",
      "END:VCALENDAR",
    ].join("\r\n");

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(perthIcs, { status: 200 }),
    );

    const source = buildMockSource({
      name: "Perth H3 Hareline",
      url: "https://www.perthhash.com/?post_type=tribe_events&ical=1&eventDisplay=list",
      config: { defaultKennelTag: "perth-h3", keepNonKennelTitlePrefix: true },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    const lunch = result.events.find((e) => e.date === "2026-06-05");
    expect(lunch).toBeDefined();
    expect(lunch!.kennelTags[0]).toBe("perth-h3");
    expect(lunch!.title).toBe("Hash Lunch: Friday 5th June");
  });

  // #1242 — regression guard for the dedicated "East Bay H3 iCal Feed"
  // (ebh3.com). The aggregator strips trail names from SUMMARY, but the
  // kennel-owned subsite ICS carries LOCATION + a leading "Hares:" line +
  // escaped commas. This is the exact #1164 VEVENT shape; assert the adapter
  // extracts location/hares/description so a regression can't silently empty
  // them again. (The original empty canonical was a transient — the run was
  // scraped before the kennel filled in details; it self-healed on re-scrape.)
  it("extracts location/hares/description from a dedicated EBH3 VEVENT (#1242)", async () => {
    // String.raw so the RFC 5545 escapes (\, and \n) are written as single
    // backslashes without TS double-escaping; node-ical unescapes them.
    const EBH3_ICS = String.raw`BEGIN:VCALENDAR
VERSION:2.0
PRODID:icalendar-ruby
CALSCALE:GREGORIAN
BEGIN:VEVENT
UID:com.sfh3.calendar.run-6493-2
DTSTART;TZID=America/Los_Angeles:20260510T130000
DTEND;TZID=America/Los_Angeles:20260510T160000
DESCRIPTION:Hares: Butt Plug FRED\, Worst Bottom Ever\, Cosmic Pussy\, Litt
 le Johnson\n\nDirections: Use your phone!\n\nPrelube: Triple Rock Brewery
GEO:37.873416;-122.2687553
LOCATION:Triple Rock Brewery
SUMMARY:EBH3 #1164: Motherless Child Hash
URL;VALUE=URI:https://www.ebh3.com/runs/6493
END:VEVENT
END:VCALENDAR`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(EBH3_ICS, { status: 200 }),
    );
    const source = buildMockSource({
      name: "East Bay H3 iCal Feed",
      url: "https://www.ebh3.com/calendar.ics",
      config: { kennelPatterns: [["^EBH3", "ebh3"]], defaultKennelTag: "ebh3" },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    const ebh3 = result.events.find((e) => e.runNumber === 1164);
    expect(ebh3).toBeDefined();
    expect(ebh3!.kennelTags[0]).toBe("ebh3");
    expect(ebh3!.title).toBe("Motherless Child Hash");
    expect(ebh3!.location).toBe("Triple Rock Brewery");
    expect(ebh3!.hares).toBe("Butt Plug FRED, Worst Bottom Ever, Cosmic Pussy, Little Johnson");
    expect(ebh3!.description).toContain("Directions: Use your phone!");
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

  it("honors options.days for fetch window (matches reconcile window)", async () => {
    // Regression: scrapeSource() passes the same `days` to both adapter.fetch
    // and reconcileStaleEvents. If fetch capped narrower than reconcile, the
    // reconciler would cancel everything in the gap as "missing from scrape"
    // — a critical data-loss risk during admin one-shot wide-window scrapes
    // (e.g. #1339 ICH3 historical recovery).
    // Freeze the clock at the fixtures' era (2023 = ~3yr back, 2028 = ~2yr
    // forward) so the ±1500-day window keeps both events inside it forever
    // and the "3 years back" row never ages out of the past edge (#2066).
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T12:00:00Z"));
    const wideWindowIcs = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:past-3-years
DTSTART:20230601T190000Z
SUMMARY:Three Years Back Trail
END:VEVENT
BEGIN:VEVENT
UID:future-2-years
DTSTART:20280601T190000Z
SUMMARY:Two Years Forward Trail
END:VEVENT
END:VCALENDAR`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(wideWindowIcs, { status: 200 }),
    );

    // Source.scrapeDays=90 would filter both events out; admin passes
    // options.days=1500 (~4 years), which must widen the fetch window.
    const source = buildMockSource({ scrapeDays: 90 });
    const result = await adapter.fetch(source, { days: 1500 });

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2);
    expect(result.diagnosticContext!.skippedDateRange).toBe(0);
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

  it("treats an empty 200 body as empty-success when allowEmptyBody is set (#1753 Iron City)", async () => {
    // The Events Calendar's ?ical=1 export returns HTTP 200 + 0-byte body when
    // a kennel has no upcoming events. With allowEmptyBody, that's a clean scrape.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200, headers: { "Content-Type": "text/calendar" } }),
    );

    const source = buildMockSource({
      config: { defaultKennelTag: "ich3", upcomingOnly: true, allowEmptyBody: true },
    });
    const result = await adapter.fetch(source);

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(0);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.totalVEvents).toBe(0);
  });

  it("still rejects an empty body when allowEmptyBody is not set", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("", { status: 200, headers: { "Content-Type": "text/calendar" } }),
    );

    const source = buildMockSource({ config: { defaultKennelTag: "ich3" } });
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
    expect(result.events[0].kennelTags[0]).toBe("CCH3");
  });

  // #2003 / #2004 Perth H3 — "Run NNNN - <Hare>" SUMMARYs carry the run number
  // (no `#`, summary-only) and the hare after the dash. runNumberPatterns now
  // scans the SUMMARY; titleHarePattern captures the hare; a bare event-type
  // theme ("…seasons run") is rejected.
  it("extracts Perth H3 runNumber + hares from 'Run NNNN - Hare' summaries", async () => {
    const perthIcs = String.raw`BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:perth-1
DTSTART;TZID=Australia/Perth:20260608T180000
SUMMARY:Run 2927 - Phantom
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:perth-2
DTSTART;TZID=Australia/Perth:20260615T180000
SUMMARY:Run 2931- Deeply Boring and Notso Boring
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:perth-3
DTSTART;TZID=Australia/Perth:20260622T180000
SUMMARY:Run 2951 - Moses co-hare Prairie Dog @ Breckler Park\, Dianella
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:perth-4
DTSTART;TZID=Australia/Perth:20260629T180000
SUMMARY:Run 2937 - West Coast 4 seasons run
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:perth-5
DTSTART;TZID=Australia/Perth:20260614T100000
SUMMARY:RockyCity HHH- Morning tea and raising money for Ovarian cancer
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(perthIcs, { status: 200 }));

    const source = buildMockSource({
      config: {
        defaultKennelTag: "perth-h3",
        keepNonKennelTitlePrefix: true,
        runNumberPatterns: [String.raw`^Run\s*(?:#\s*)?(\d+)\b`],
        titleHarePattern: String.raw`^Run\s*(?:#\s*)?\d+\s*-\s*([^@]+?)\s*(?:@.*)?$`,
        rejectTitleHareThemeSuffix: true,
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });

    const phantom = result.events.find((e) => e.runNumber === 2927);
    expect(phantom).toBeDefined();
    expect(phantom!.hares).toBe("Phantom");

    const noSpaceDash = result.events.find((e) => e.runNumber === 2931);
    expect(noSpaceDash).toBeDefined();
    expect(noSpaceDash!.hares).toBe("Deeply Boring and Notso Boring");

    const atLocation = result.events.find((e) => e.runNumber === 2951);
    expect(atLocation).toBeDefined();
    expect(atLocation!.hares).toBe("Moses co-hare Prairie Dog");

    // Theme, not a hare — rejected by the event-type suffix guard.
    const theme = result.events.find((e) => e.runNumber === 2937);
    expect(theme).toBeDefined();
    expect(theme!.hares).toBeUndefined();

    // Guest kennel without a "Run NNNN" prefix — no run number, no hares.
    const guest = result.events.find((e) => e.title?.startsWith("RockyCity"));
    expect(guest).toBeDefined();
    expect(guest!.runNumber == null).toBe(true);
    expect(guest!.hares).toBeUndefined();
  });

  // Codex review — a placeholder-shaped summary must clear (null) rather than
  // letting the loose "^Run #?(\d+)" custom pattern parse "20" out of "20xx".
  it("clears runNumber (null) on a placeholder summary despite a loose run pattern", async () => {
    const placeholderIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:perth-placeholder
DTSTART;TZID=Australia/Perth:20260706T180000
SUMMARY:Run #20xx - TBD
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(placeholderIcs, { status: 200 }));
    const source = buildMockSource({
      config: {
        defaultKennelTag: "perth-h3",
        keepNonKennelTitlePrefix: true,
        runNumberPatterns: [String.raw`^Run\s*(?:#\s*)?(\d+)\b`],
      },
    });
    const result = await adapter.fetch(source, { days: 9999 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBeNull();
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
    expect(result.events[0].kennelTags[0]).toBe("berlinh3");
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
    expect(result.events[0].kennelTags[0]).toBe("bh3fm");
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

  it("models SFH3 umbrella + trail as a series with shared seriesId, even with enrichSFH3Details off (#1560)", async () => {
    const dupIcs = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Test//Test//EN
BEGIN:VEVENT
UID:run-9999
DTSTAMP:20260101T000000Z
DTSTART;TZID=America/Los_Angeles:20260515T180000
DTEND;TZID=America/Los_Angeles:20260515T210000
SUMMARY:SFH3 Friday Trail
LOCATION:Trailhead
URL;VALUE=URI:https://www.sfh3.com/runs/9999
END:VEVENT
BEGIN:VEVENT
UID:event-999
DTSTAMP:20260101T000000Z
DTSTART;VALUE=DATE:20260514
DTEND;VALUE=DATE:20260518
SUMMARY:SFH3 Campout Umbrella
DESCRIPTION:Weekend campout — full schedule + registration
LOCATION:San Francisco
URL;VALUE=URI:https://www.sfh3.com/events/999
END:VEVENT
END:VCALENDAR`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(dupIcs, { status: 200 }),
    );
    const source = buildMockSource(); // no enrichSFH3Details
    const result = await adapter.fetch(source, { days: 9999 });

    // Both the umbrella and the trail are preserved — series modeling
    // replaces the pre-#1560 suppression.
    expect(result.events).toHaveLength(2);
    const umbrella = result.events.find((e) => e.sourceUrl === "https://www.sfh3.com/events/999");
    const trail = result.events.find((e) => e.sourceUrl === "https://www.sfh3.com/runs/9999");
    expect(umbrella).toBeDefined();
    expect(trail).toBeDefined();

    // Shared seriesId derived from the umbrella URL's numeric ID.
    expect(umbrella!.seriesId).toBe("sfh3-event-999");
    expect(trail!.seriesId).toBe("sfh3-event-999");

    // Umbrella carries the explicit-parent flag + the inclusive endDate
    // (DTEND May 18 → May 17 inclusive).
    expect(umbrella!.seriesParent).toBe(true);
    expect(umbrella!.endDate).toBe("2026-05-17");

    // Trails do NOT carry seriesParent; they're children.
    expect(trail!.seriesParent).toBeFalsy();
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
      expect(e.kennelTags[0]).toBe("UNKNOWN");
    });
  });
});

const OH3_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//Oslo H3//EN
BEGIN:VEVENT
UID:oh3.run-28368
DTSTART;TZID=Europe/Oslo:20260615T183000
SUMMARY:OH3 #2001: OH3 Run 2001- A Hash Odyssey
DESCRIPTION:Hare: Mismanagement
URL:https://www.oh3.no/runs/28368
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:oh3.event-24
DTSTART;VALUE=DATE:20260615
SUMMARY:OH3 run 2001: A Hash Odyssey
DESCRIPTION:Hares: Altar Boy & Hot Shit\\n\\nMeet at the dock. Cost 250 NOK. Swim stop.
URL:https://www.oh3.no/events/24
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:oh3.run-28409
DTSTART;TZID=Europe/Oslo:20270116T143000
SUMMARY:OH3 #20xx: Vicar Birthday Run
URL:https://www.oh3.no/runs/28409
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:oh3.event-23
DTSTART;VALUE=DATE:20260703
SUMMARY:Hot Fun In The Summertime
URL:https://www.oh3.no/events/23
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

function buildOh3Source(): Source {
  return buildMockSource({
    name: "Oslo H3 iCal Feed",
    url: "https://www.oh3.no/calendar.ics",
    config: {
      defaultKennelTag: "oh3-no",
      coalesceEndpointDuplicates: true,
    },
  });
}

describe("ICalAdapter — Oslo H3 (#1824 placeholder, #1828 endpoint coalesce)", () => {
  let adapter: ICalAdapter;
  beforeEach(() => {
    adapter = new ICalAdapter();
    vi.restoreAllMocks();
  });

  it("collapses the /events/ all-day duplicate into its timed /runs/ twin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(OH3_ICS, { status: 200 }));
    const result = await adapter.fetch(buildOh3Source(), { days: 9999 });

    const jun15 = result.events.filter((e) => e.date === "2026-06-15");
    expect(jun15).toHaveLength(1);
    const run = jun15[0];
    // Time + run number survive from /runs/; hares + description win from /events/.
    expect(run.runNumber).toBe(2001);
    expect(run.startTime).toBe("18:30");
    expect(run.hares).toBe("Altar Boy & Hot Shit");
    expect(run.description).toContain("Swim stop");
    expect(run.sourceUrl).toBe("https://www.oh3.no/runs/28368");
  });

  it("keeps a standalone /events/ entry with no /runs/ twin", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(OH3_ICS, { status: 200 }));
    const result = await adapter.fetch(buildOh3Source(), { days: 9999 });

    const summertime = result.events.find((e) => e.date === "2026-07-03");
    expect(summertime).toBeDefined();
    expect(summertime!.sourceUrl).toBe("https://www.oh3.no/events/23");
  });

  it("clears a stale runNumber for a '#20xx' placeholder (#1824)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(OH3_ICS, { status: 200 }));
    const result = await adapter.fetch(buildOh3Source(), { days: 9999 });

    const vicar = result.events.find((e) => e.date === "2027-01-16");
    expect(vicar).toBeDefined();
    // Explicit null (not undefined) so the merge tri-state wipes the stale 20.
    expect(vicar!.runNumber).toBeNull();
    expect(vicar!.title).toBe("Vicar Birthday Run");
  });
});

describe("coalesceEndpointDuplicates (unit, #1828)", () => {
  const runEvent = (): RawEventData => ({
    date: "2026-06-15",
    kennelTags: ["oh3-no"],
    runNumber: 2001,
    title: "OH3 Run 2001",
    hares: "Mismanagement",
    startTime: "18:30",
    sourceUrl: "https://www.oh3.no/runs/28368",
  });
  const eventsEvent = (): RawEventData => ({
    date: "2026-06-15",
    kennelTags: ["oh3-no"],
    title: "A Hash Odyssey",
    hares: "Altar Boy & Hot Shit",
    description: "Meet at the dock",
    sourceUrl: "https://www.oh3.no/events/24",
  });

  it("merges events/ hares+description into the runs/ twin and drops events/", () => {
    const out = coalesceEndpointDuplicates([runEvent(), eventsEvent()]);
    expect(out).toHaveLength(1);
    expect(out[0].sourceUrl).toContain("/runs/");
    expect(out[0].hares).toBe("Altar Boy & Hot Shit");
    expect(out[0].description).toBe("Meet at the dock");
    expect(out[0].startTime).toBe("18:30");
    expect(out[0].runNumber).toBe(2001);
  });

  it("is a no-op when there is no /runs/ event", () => {
    const only = [eventsEvent()];
    expect(coalesceEndpointDuplicates(only)).toHaveLength(1);
  });
});

// VEVENTs verbatim from the live Reading H3 Localendar feed
// (localendar.com/public/readinghhh?style=X2). The upcoming runs are all the
// "RH3: #120?" placeholder (run number not yet assigned); only past/numbered
// runs carry a real "#NNNN".
const READING_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//iCal4j 1.0//EN
BEGIN:VEVENT
UID:reading-1202@localendar.com
DTSTART;TZID=America/New_York:20260531T120000
SUMMARY:RH3 #1202: Clowning Around Hash
DESCRIPTION:Hares: Sex Toys & Silence of the Goats On-On: Reading Regional Airport Hash Cash: $5 Note on out at 12pm Pre-lube at Klinger's by the Airport
DTSTAMP:20260528T180347Z
END:VEVENT
BEGIN:VEVENT
UID:reading-120a@localendar.com
DTSTART;TZID=America/New_York:20260608T181500
SUMMARY:RH3: #120?
DESCRIPTION:Hare: Sex Toys for Everyone More details to cum
DTSTAMP:20260516T003011Z
END:VEVENT
BEGIN:VEVENT
UID:reading-120b@localendar.com
DTSTART;TZID=America/New_York:20260920T120000
SUMMARY:RH3: #120? Kegs & Eggs
DESCRIPTION:Hares: Foot Fairy & Schmamazon Prime More details to cum
DTSTAMP:20260516T004448Z
END:VEVENT
END:VCALENDAR`;

function buildReadingSource(): Source {
  return buildMockSource({
    name: "Reading H3 Localendar",
    url: "https://localendar.com/public/readinghhh?style=X2",
    config: { defaultKennelTag: "rh3" },
  });
}

describe("ICalAdapter — Reading H3 Localendar (#1883 placeholder run number)", () => {
  let adapter: ICalAdapter;
  beforeEach(() => {
    adapter = new ICalAdapter();
    vi.restoreAllMocks();
  });

  it("clears the run number for the 'RH3: #120?' placeholder (no stale 120)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingSource(), { days: 9999 });

    const jun8 = result.events.find((e) => e.date === "2026-06-08");
    expect(jun8).toBeDefined();
    // Explicit null (not 120, not undefined) so the merge tri-state wipes the
    // stale run number from a prior scrape.
    expect(jun8!.runNumber).toBeNull();
    // No theme + no venue in the source → both left for the merge synthesizer.
    expect(jun8!.title).toBeUndefined();
    expect(jun8!.location).toBeUndefined();
  });

  it("keeps the theme after a placeholder marker while still clearing the number", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingSource(), { days: 9999 });

    const sep20 = result.events.find((e) => e.date === "2026-09-20");
    expect(sep20).toBeDefined();
    expect(sep20!.runNumber).toBeNull();
    expect(sep20!.title).toBe("Kegs & Eggs");
  });

  it("parses a real numbered run with its theme and On-On venue", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingSource(), { days: 9999 });

    const numbered = result.events.find((e) => e.runNumber === 1202);
    expect(numbered).toBeDefined();
    expect(numbered!.title).toBe("Clowning Around Hash");
    expect(numbered!.location).toBe("Reading Regional Airport");
  });
});

// VEVENTs verbatim from the live Reading H3 Localendar feed — the run-number
// prefix shapes the title parser must strip (#2148).
const READING_PREFIX_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//iCal4j 1.0//EN
BEGIN:VEVENT
UID:reading-1203@localendar.com
DTSTART;TZID=America/New_York:20260608T181500
SUMMARY:RH3: #1203: Deja FuckYou Hash
DTSTAMP:20260528T180347Z
END:VEVENT
BEGIN:VEVENT
UID:reading-1201@localendar.com
DTSTART;TZID=America/New_York:20260517T140000
SUMMARY:RH3 #1201 Some Bitches Be Getting Married Hash
DTSTAMP:20260516T003011Z
END:VEVENT
BEGIN:VEVENT
UID:reading-social@localendar.com
DTSTART;TZID=America/New_York:20260601T180000
SUMMARY:RH3 Pigs' Head Social
DTSTAMP:20260516T004448Z
END:VEVENT
BEGIN:VEVENT
UID:reading-phl@localendar.com
DTSTART;TZID=America/New_York:20260615T183000
SUMMARY:Philadelphia HHH
DTSTAMP:20260516T004448Z
END:VEVENT
END:VCALENDAR`;

function buildReadingPrefixSource(): Source {
  return buildMockSource({
    name: "Reading H3 Localendar",
    url: "https://localendar.com/public/readinghhh?style=X2",
    config: { defaultKennelTag: "rh3", titleStripPrefixAliases: ["RH3", "ReadingH3"] },
  });
}

describe("ICalAdapter — Reading H3 title prefix strip (#2148)", () => {
  let adapter: ICalAdapter;
  beforeEach(() => {
    adapter = new ICalAdapter();
    vi.restoreAllMocks();
  });

  it("strips the double-colon 'RH3: #1203:' prefix from the title", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_PREFIX_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingPrefixSource(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 1203);
    expect(e).toBeDefined();
    expect(e!.title).toBe("Deja FuckYou Hash");
  });

  it("strips the no-colon 'RH3 #1201 …' prefix from the title", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_PREFIX_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingPrefixSource(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 1201);
    expect(e).toBeDefined();
    expect(e!.title).toBe("Some Bitches Be Getting Married Hash");
  });

  it("strips a kennel-only prefix (no run number)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_PREFIX_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingPrefixSource(), { days: 9999 });

    const e = result.events.find((x) => x.date === "2026-06-01");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Pigs' Head Social");
  });

  it("leaves a non-RH3 row on the same feed untouched (negative)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(READING_PREFIX_ICS, { status: 200 }));
    const result = await adapter.fetch(buildReadingPrefixSource(), { days: 9999 });

    const e = result.events.find((x) => x.date === "2026-06-15");
    expect(e).toBeDefined();
    expect(e!.title).toBe("Philadelphia HHH");
  });
});

// VEVENTs verbatim from the live Charm City ai1ec WordPress export
// (charmcityh3.com/?plugin=all-in-one-event-calendar…). Hares + venue live in
// the DESCRIPTION body; a #TBD placeholder carries a junk 03:02 DTSTART (#2175).
const CHARM_CITY_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ai1ec//EN
BEGIN:VEVENT
UID:ai1ec-1216@charmcityh3.com
DTSTART;TZID=America/New_York:20260617T160000
DTEND;TZID=America/New_York:20260617T220000
SUMMARY:CCH3 Trail #340 Luau Trail
DESCRIPTION:Hash cash: $11\\nHares: G-Spotify\\, Facial Profiling\\, MoreMen Pukes Tonight\\, and Cum Scene Investigator\\nLocation\\nCanton Waterfront Park\\nhttps://maps.app.goo.gl/xCR6VhwnfNHUJi4h8
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:ai1ec-1542@charmcityh3.com
DTSTART;VALUE=DATE:20260907
DTEND;VALUE=DATE:20260908
SUMMARY:CCH3 Brewery Bike Tour
DESCRIPTION:Bike to your favorite local breweries on Labor Day! Details to cum.\\nHares~ Facial Profiling and Just Mike
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:ai1ec-1205@charmcityh3.com
DTSTART;TZID=America/New_York:20260623T190000
DTEND;TZID=America/New_York:20260624T000000
SUMMARY:CCH3 Trail #341 Pride Prelube
DESCRIPTION:Hare: My Big Fat Greek Orgy\\nStart: Baltimore Eagle (2022 N Charles St\\, Baltimore\\, MD 21218)\\nWhen: June 23rd @ 7pm
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:ai1ec-1504@charmcityh3.com
DTSTART;TZID=America/New_York:20260911T030200
SUMMARY:CCH3 #TBD- A phone Gerbile  and. around the world in 80 lays
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;

function buildCharmCitySource(): Source {
  return buildMockSource({
    name: "Charm City H3 iCal Feed",
    url: "https://charmcityh3.com/?plugin=all-in-one-event-calendar",
    config: {
      kennelPatterns: [["^CCH3", "cch3"], ["^Trail\\s*#", "cch3"]],
      defaultKennelTag: "cch3",
      titleHarePattern: "~\\s*(.+)$",
      harePatterns: ["(?:^|\\n)\\s*Hares?\\s*[:~]\\s*([^\\n]+)"],
      locationPatterns: [
        "(?:^|\\n)\\s*Where:\\s*([^\\n]+)",
        "(?:^|\\n)\\s*Start:\\s*([^\\n]+)",
        "(?:^|\\n)\\s*Location:\\s*([^\\n]+)",
        "(?:^|\\n)\\s*Location\\s*\\n\\s*([^\\n]+)",
      ],
      cleanDescriptionLocation: true,
      dropImprobablePlaceholderTime: true,
    },
  });
}

describe("ICalAdapter — Charm City H3 description parsing (#2159 / #2175)", () => {
  let adapter: ICalAdapter;
  beforeEach(() => {
    adapter = new ICalAdapter();
    vi.restoreAllMocks();
  });

  it("parses hares and the next-line Location heading (#340)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(CHARM_CITY_ICS, { status: 200 }));
    const result = await adapter.fetch(buildCharmCitySource(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 340);
    expect(e).toBeDefined();
    expect(e!.hares).toBe("G-Spotify, Facial Profiling, MoreMen Pukes Tonight, and Cum Scene Investigator");
    // Next-line "Location\n<value>" form, URL on the following line stripped.
    expect(e!.location).toBe("Canton Waterfront Park");
  });

  it("parses the 'Hares~' tilde label", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(CHARM_CITY_ICS, { status: 200 }));
    const result = await adapter.fetch(buildCharmCitySource(), { days: 9999 });

    const e = result.events.find((x) => x.date === "2026-09-07");
    expect(e).toBeDefined();
    expect(e!.hares).toBe("Facial Profiling and Just Mike");
  });

  it("parses 'Hare:' and 'Start:' venue with a parenthetical address", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(CHARM_CITY_ICS, { status: 200 }));
    const result = await adapter.fetch(buildCharmCitySource(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 341);
    expect(e).toBeDefined();
    expect(e!.hares).toBe("My Big Fat Greek Orgy");
    expect(e!.location).toBe("Baltimore Eagle (2022 N Charles St, Baltimore, MD 21218)");
  });

  it("clears the junk 03:02 time + run number on the #TBD placeholder (#2175)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(CHARM_CITY_ICS, { status: 200 }));
    const result = await adapter.fetch(buildCharmCitySource(), { days: 9999 });

    const e = result.events.find((x) => x.date === "2026-09-11");
    expect(e).toBeDefined();
    // null (explicit clear), not undefined — so merge wipes a junk time already
    // persisted on an existing row rather than preserving it.
    expect(e!.startTime).toBeNull();
    expect(e!.endTime).toBeNull();
    expect(e!.runNumber).toBeNull();
  });

  it("keeps a real daytime start time on a confirmed-run event (negative)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(CHARM_CITY_ICS, { status: 200 }));
    const result = await adapter.fetch(buildCharmCitySource(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 340);
    expect(e!.startTime).toBe("16:00");
  });

  it("does NOT clear a placeholder late-night time without the opt-in flag (negative)", async () => {
    // Same TBD/03:02 event, but a source that did not opt into the cleanup must
    // keep the time — guards the #2175 gate against affecting other iCal feeds.
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(CHARM_CITY_ICS, { status: 200 }));
    const source = buildCharmCitySource();
    (source.config as Record<string, unknown>).dropImprobablePlaceholderTime = false;
    const result = await adapter.fetch(source, { days: 9999 });

    const e = result.events.find((x) => x.date === "2026-09-11");
    expect(e!.startTime).toBe("03:02");
  });

  it("emits location: null (explicit clear) when a matched venue cleans to a placeholder", async () => {
    const ics = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//ai1ec//EN
BEGIN:VEVENT
UID:ai1ec-tbd-loc@charmcityh3.com
DTSTART;TZID=America/New_York:20260704T160000
SUMMARY:CCH3 Trail #342 Placeholder Venue
DESCRIPTION:Hares: Just Someone\\nLocation\\nTBD
DTSTAMP:20260201T000000Z
END:VEVENT
END:VCALENDAR`;
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(ics, { status: 200 }));
    const result = await adapter.fetch(buildCharmCitySource(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 342);
    expect(e).toBeDefined();
    // Matched "Location\nTBD" → cleanLocationName rejects it → null clears stale
    // venue (tri-state), NOT undefined (which would preserve a prior venue).
    expect(e!.location).toBeNull();
    expect(e!.hares).toBe("Just Someone");
  });
});

// Verbatim from the live Iron City feed (ironcityh3.com/?post_type=tribe_events).
// The archive shows the SUMMARY remainder is usually a THEME, sometimes a hare —
// so the kennel+run prefix is stripped but the remainder is kept as the title,
// never extracted into haresText (#2160 follow-up: titleHarePattern reverted).
const ICH3_ICS = `BEGIN:VCALENDAR
VERSION:2.0
PRODID:-//The Events Calendar//EN
BEGIN:VEVENT
UID:ich3-60@ironcityh3.com
DTSTART;TZID=America/New_York:20260612T183000
DTEND;TZID=America/New_York:20260612T213000
SUMMARY:ICH3# 60 Plea Barkin
DESCRIPTION: ICH3 #60 Hared by: Plea Barkin\\nGet ready to stretch those legs.
LOCATION:Hitchhiker Brewing\\, 1500 S Canal St #2541\\, Sharpsburg\\, PA\\, 15215\\, United States
URL:https://ironcityh3.com/event/ich3-60-plea-barkin/
DTSTAMP:20260201T000000Z
END:VEVENT
BEGIN:VEVENT
UID:ich3-45@ironcityh3.com
DTSTART;TZID=America/New_York:20250425T183000
SUMMARY:ICH3#45 Dancin' the Night Away
DTSTAMP:20250201T000000Z
END:VEVENT
END:VCALENDAR`;

function buildICH3Source(): Source {
  return buildMockSource({
    name: "Iron City H3 iCal Feed",
    url: "https://ironcityh3.com/?post_type=tribe_events&ical=1&eventDisplay=list",
    config: {
      defaultKennelTag: "ich3",
      upcomingOnly: true,
      allowEmptyBody: true,
      titleStripPrefixAliases: ["ICH3"],
    },
  });
}

describe("ICalAdapter — Iron City (ICH3) title prefix strip (#2160)", () => {
  let adapter: ICalAdapter;
  beforeEach(() => {
    adapter = new ICalAdapter();
    vi.restoreAllMocks();
  });

  it("strips the 'ICH3# 60' prefix, keeps the remainder as the title, extracts no hare", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(ICH3_ICS, { status: 200 }));
    const result = await adapter.fetch(buildICH3Source(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 60);
    expect(e).toBeDefined();
    // Remainder kept as the title (it's the kennel's chosen name), NOT moved to
    // haresText — the archive shows the remainder is usually a theme.
    expect(e!.title).toBe("Plea Barkin");
    expect(e!.hares).toBeUndefined();
    // LOCATION field still wins for the venue.
    expect(e!.location).toContain("Hitchhiker Brewing");
  });

  it("keeps a theme remainder as the title (does not corrupt it into a hare)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(ICH3_ICS, { status: 200 }));
    const result = await adapter.fetch(buildICH3Source(), { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 45);
    expect(e).toBeDefined();
    expect(e!.title).toBe("Dancin' the Night Away");
    expect(e!.hares).toBeUndefined();
  });

  it("does not strip prefixes or blank titles for a source without the new config (negative)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(new Response(ICH3_ICS, { status: 200 }));
    const plainSource = buildMockSource({
      url: "https://ironcityh3.com/?post_type=tribe_events&ical=1&eventDisplay=list",
      config: { defaultKennelTag: "ich3" },
    });
    const result = await adapter.fetch(plainSource, { days: 9999 });

    const e = result.events.find((x) => x.runNumber === 60);
    // No aliases → verbatim summary title, no hare extracted.
    expect(e!.title).toBe("ICH3# 60 Plea Barkin");
    expect(e!.hares).toBeUndefined();
  });
});
