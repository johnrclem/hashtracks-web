import { describe, it, expect, vi } from "vitest";
import {
  extractRunNumber,
  extractTitle,
  stripDatePrefix,
  extractHares,
  extractTitleFromDescription,
  extractWhatFieldFromDescription,
  parseInlineHareline,
  applyInlineHarelineBackfill,
  extractLocationFromDescription,
  extractTimeFromDescription,
  extractTimeFromTitle,
  extractCostFromDescription,
  buildRawEventFromGCalItem,
  normalizeGCalDescription,
  GoogleCalendarAdapter,
} from "./adapter";
import type { RawEventData } from "../types";
import { SOURCES } from "../../../prisma/seed-data/sources";

// ── Boston Hash Calendar multi-kennel routing via seed config (#789) ──

describe("Boston Hash Calendar multi-kennel routing (#789)", () => {
  const bostonSource = SOURCES.find((s) => s.name === "Boston Hash Calendar");
  if (!bostonSource?.config) throw new Error("Boston Hash Calendar seed config missing");
  const config = bostonSource.config as { kennelPatterns: [string, string][] };

  it.each([
    // [summary, expected kennelTag, description]
    ["Boston Moom", "bos-moon", "'Boston Moom' typo (not 'Boston Moon')"],
    ["Taco Marathon Pre-Pre-Pre-Prelube", "pink-taco", "'Taco' without 'Pink' prefix"],
    ["Moon Marathon Pre-Pre Lube", "bos-moon", "'Moon' as solo token"],
    ["Beantown #276", "beantown", "Beantown"],
    ["BH3 #2781", "boh3", "plain Boston H3 run"],
    ["Boston Ball Buster #123", "bobbh3", "Ball Buster"],
    ["BoBBH3: Run Name", "bobbh3", "BoBBH3 abbrev"],
    ["B3H4 Run", "bobbh3", "B3H4 abbrev"],
    ["ZigZag #42", "zigzag", "ZigZag (issue #789 — previously absorbed by boh3)"],
    ["Zig Zag Trail", "zigzag", "Zig Zag spaced"],
    ["ZigZag Full Moon Run", "zigzag", "ZigZag wins over Full Moon (ordering before bos-moon)"],
    ["E4B #22", "e4b", "E4B (issue #789 — previously absorbed by boh3)"],
    ["Eager 4 Beaver hash", "e4b", "Eager 4 Beaver full name"],
  ])("routes %j → %s (%s)", (summary, expectedTag) => {
    const result = buildRawEventFromGCalItem(
      { summary, start: { dateTime: "2026-04-15T19:00:00-04:00" }, status: "confirmed" },
      config,
    );
    expect(result?.kennelTag).toBe(expectedTag);
  });

  it("unmatched titles pass summary through as kennelTag (distinct UNMATCHED_TAGS alerts, #789)", () => {
    const result = buildRawEventFromGCalItem(
      { summary: "AGM Planning Meeting", start: { dateTime: "2026-04-15T19:00:00-04:00" }, status: "confirmed" },
      config,
    );
    expect(result?.kennelTag).toBe("AGM Planning Meeting");
  });
});

// ── Colorado H3 Aggregator multi-kennel routing via seed config (#850) ──

describe("Colorado H3 Aggregator multi-kennel routing (#850)", () => {
  const coSource = SOURCES.find((s) => s.name === "Colorado H3 Aggregator Calendar");
  if (!coSource?.config) throw new Error("Colorado H3 Aggregator seed config missing");
  const config = coSource.config as { kennelPatterns: [string, string][] };

  it.each([
    ["Boulder H3 #968", "bh3-co", "Boulder H3 full name"],
    ["BH3 Trail #123", "bh3-co", "BH3 abbrev"],
    ["MiHiHuHa #341", "mihi-huha", "MiHiHuHa"],
    ["MiHiHUHa #598: A Four Blondes Trail", "mihi-huha", "MiHiHUHa case variant"],
    ["Mile High Humpin Hash", "mihi-huha", "full name variant"],
    ["Denver H3 Trail #1109", "dh3-co", "Denver H3 full name"],
    ["DH3 #456", "dh3-co", "DH3 abbrev"],
  ])("routes %j → %s (%s)", (summary, expectedTag) => {
    const result = buildRawEventFromGCalItem(
      { summary, start: { dateTime: "2026-04-15T19:00:00-06:00" }, status: "confirmed" },
      config,
    );
    expect(result?.kennelTag).toBe(expectedTag);
  });

  it.each([
    "CUM presents DUMP",
    "BASH #50",
    "Steamboat Springs Skash 2026",
    "DP #69 at Cerebral Brewing",
  ])("unmatched %j passes summary through (distinct UNMATCHED_TAGS alerts, #850)", (summary) => {
    const result = buildRawEventFromGCalItem(
      { summary, start: { dateTime: "2026-04-15T19:00:00-06:00" }, status: "confirmed" },
      config,
    );
    expect(result?.kennelTag).toBe(summary);
  });
});

// ── GCal adapter with no config returns empty tag (no Boston fallback) ──

describe("resolveKennelTagFromSummary with no config", () => {
  it("passes summary through as kennelTag when source has no config (removed silent boh3 fallback)", () => {
    const result = buildRawEventFromGCalItem(
      { summary: "Some Random Event", start: { dateTime: "2026-04-15T19:00:00-04:00" }, status: "confirmed" },
      null,
    );
    expect(result?.kennelTag).toBe("Some Random Event");
  });
});

// ── extractRunNumber ──

describe("extractRunNumber", () => {
  it("extracts from summary #N", () => {
    expect(extractRunNumber("Beantown #255: Trail")).toBe(255);
  });

  it("extracts BH3 #N from description", () => {
    expect(extractRunNumber("Weekly Run", "BH3 #2784\nDetails")).toBe(2784);
  });

  it("extracts standalone #N from description", () => {
    expect(extractRunNumber("Weekly Run", "Details\n#2792\nMore")).toBe(2792);
  });

  it("returns undefined with no match", () => {
    expect(extractRunNumber("No Number", "No number here")).toBeUndefined();
  });

  it("returns undefined with no description", () => {
    expect(extractRunNumber("No Number Here")).toBeUndefined();
  });

  // Custom run number patterns (configurable via source config)
  it("uses custom patterns when provided", () => {
    expect(
      extractRunNumber("Weekly Run", "Hash # 2658", [
        String.raw`Hash\s*#\s*(\d+)`,
      ]),
    ).toBe(2658);
  });

  it("summary #N still checked first with custom patterns", () => {
    expect(
      extractRunNumber("Run #100", "Hash # 2658", [
        String.raw`Hash\s*#\s*(\d+)`,
      ]),
    ).toBe(100);
  });

  it("falls back to defaults when customPatterns is empty", () => {
    expect(extractRunNumber("Weekly Run", "BH3 #2784", [])).toBe(2784);
  });

  it("custom patterns replace defaults", () => {
    expect(
      extractRunNumber("Weekly Run", "BH3 #2784", [
        String.raw`Hash\s*#\s*(\d+)`,
      ]),
    ).toBeUndefined();
  });

  it("skips malformed custom patterns gracefully", () => {
    expect(
      extractRunNumber("Weekly Run", "Hash # 2658", [
        "[invalid(",
        String.raw`Hash\s*#\s*(\d+)`,
      ]),
    ).toBe(2658);
  });

  // #861 BDH3 — Chicagoland Hashes source config ships this pattern.
  it("extracts BDH3 run number from 'What: Big Dogs HHH No. 258'", () => {
    expect(
      extractRunNumber("Weekly Run", "What: Big Dogs HHH No. 258\nWhere: Park", [
        String.raw`What:\s*4x2\s*H4\s*No\.?\s*(\d+)`,
        String.raw`What:\s*Big\s+Dogs(?:\s+HHH)?\s*No\.?\s*(\d+)`,
      ]),
    ).toBe(258);
  });

  it("extracts BDH3 run number from 'What: Big Dogs No. 259' without HHH suffix", () => {
    expect(
      extractRunNumber("Weekly Run", "What: Big Dogs No. 259", [
        String.raw`What:\s*Big\s+Dogs(?:\s+HHH)?\s*No\.?\s*(\d+)`,
      ]),
    ).toBe(259);
  });
});

// ── extractTitle ──

describe("extractTitle", () => {
  it("strips kennel prefix", () => {
    expect(extractTitle("Beantown #255: The Trail Name")).toBe("The Trail Name");
  });

  it("strips BoH3 prefix", () => {
    expect(extractTitle("BoH3: Run Name")).toBe("Run Name");
  });

  it("returns full summary when no colon", () => {
    expect(extractTitle("No Prefix Event")).toBe("No Prefix Event");
  });
});

// ── extractHares ──

describe("extractHares", () => {
  it("extracts from Hare: line", () => {
    expect(extractHares("Details\nHare: Mudflap\nON-IN: Some Bar")).toBe("Mudflap");
  });

  it("extracts from Hares: line", () => {
    expect(extractHares("Hares: Alice & Bob")).toBe("Alice & Bob");
  });

  it("extracts from 'Hare & Co-Hares:' line (Voodoo H3 format)", () => {
    expect(extractHares("Hare & Co-Hares: Steven with a D\nStart Address: 123 Main")).toBe("Steven with a D");
  });

  it("extracts from 'Hare & Co-Hares:' with multiple names", () => {
    expect(extractHares("Hare & Co-Hares: Whordini & Mudflap")).toBe("Whordini & Mudflap");
  });

  it("extracts from Who: line", () => {
    expect(extractHares("Who: Charlie")).toBe("Charlie");
  });

  it("skips generic Who: answers", () => {
    expect(extractHares("Who: that be you")).toBeUndefined();
  });

  it("skips 'everyone'", () => {
    expect(extractHares("Who: everyone")).toBeUndefined();
  });

  it("returns undefined when no match", () => {
    expect(extractHares("No hare info here")).toBeUndefined();
  });

  it("takes only first line of hare text", () => {
    expect(extractHares("Hare: Alice\nSome other info")).toBe("Alice");
  });

  // Custom hare patterns (configurable via source config)
  it("uses custom patterns when provided", () => {
    expect(
      extractHares("WHO ARE THE HARES:  Used Rubber & Leeroy", [
        String.raw`(?:^|\n)\s*WHO ARE THE HARES:\s*(.+)`,
      ]),
    ).toBe("Used Rubber & Leeroy");
  });

  it("uses custom pattern: Laid by", () => {
    expect(
      extractHares("Laid by: Speedy Gonzalez", [
        String.raw`(?:^|\n)\s*Laid by:\s*(.+)`,
      ]),
    ).toBe("Speedy Gonzalez");
  });

  it("falls back to defaults when customPatterns is undefined", () => {
    expect(extractHares("Hare: DefaultMatch")).toBe("DefaultMatch");
  });

  it("falls back to defaults when customPatterns is empty array", () => {
    expect(extractHares("Hare: DefaultMatch", [])).toBe("DefaultMatch");
  });

  it("truncates hares at embedded What: label when HTML stripping collapses fields", () => {
    expect(
      extractHares("Who: AmazonWhat: A beautiful trail that doesn't start at the Mad Hanna"),
    ).toBe("Amazon");
  });

  it("truncates hares at embedded Where: label", () => {
    expect(extractHares("Hare: John DoeWhere: Some Bar, 123 Main St")).toBe("John Doe");
  });

  it("truncates hares at embedded Hash Cash label", () => {
    expect(extractHares("Hare: AliceHash Cash: $5")).toBe("Alice");
  });

  it("custom patterns replace defaults", () => {
    expect(
      extractHares("Hare: Mudflap", [String.raw`(?:^|\n)\s*Laid by:\s*(.+)`]),
    ).toBeUndefined();
  });

  it("skips malformed custom patterns gracefully", () => {
    expect(
      extractHares("Laid by: Speedy", [
        "[invalid(",
        String.raw`(?:^|\n)\s*Laid by:\s*(.+)`,
      ]),
    ).toBe("Speedy");
  });

  it("still filters generic answers with custom patterns", () => {
    expect(
      extractHares("Laid by: everyone", [String.raw`(?:^|\n)\s*Laid by:\s*(.+)`]),
    ).toBeUndefined();
  });

  // Boilerplate truncation (fixes EPTX, O2H3 hare corruption)
  it("truncates at 'WHAT TIME' boilerplate marker", () => {
    expect(extractHares("Hare: Captain Hash WHAT TIME: 6:30 PM")).toBe("Captain Hash");
  });

  it("truncates at 'WHERE' boilerplate marker", () => {
    expect(extractHares("Hare: Trail Blazer WHERE: The Pub, 123 Main St")).toBe("Trail Blazer");
  });

  it("truncates at 'Location' boilerplate marker", () => {
    expect(extractHares("Hare: Mudflap Location: Central Park")).toBe("Mudflap");
  });

  it("truncates at 'Cost' boilerplate marker", () => {
    expect(extractHares("Hare: Captain Cost: $5")).toBe("Captain");
  });

  it("truncates at 'HASH CASH' boilerplate marker", () => {
    expect(extractHares("Hare: Alice HASH CASH: $7")).toBe("Alice");
  });

  it("truncates at 'Directions' boilerplate marker", () => {
    expect(extractHares("Hare: Trail Blazer Directions: Take I-95 North")).toBe("Trail Blazer");
  });

  it("truncates at 'Meet at' boilerplate marker", () => {
    expect(extractHares("Hare: Mudflap Meet at the park at 6pm")).toBe("Mudflap");
  });

  // Preposition/verb filter (description text, not names)
  it("filters hare string starting with 'at'", () => {
    expect(extractHares("Hare: at the corner of 5th and Main")).toBeUndefined();
  });

  it("filters hare string starting with 'from'", () => {
    expect(extractHares("Hare: from the old pub to the new one")).toBeUndefined();
  });

  it("preserves hare names starting with 'the' (e.g. 'The Pope')", () => {
    expect(extractHares("Hare: The Pope")).toBe("The Pope");
  });

  it("extracts from Hare(s): pattern (jHavelina format)", () => {
    expect(extractHares("Trail info\nHare(s): Splat!\nLocation: Park")).toBe("Splat!");
  });

  it("extracts from 'Hare [Name]' without colon (MH3 format)", () => {
    expect(extractHares("Details\nHare C*ck Swap\nLocation: Park")).toBe("C*ck Swap");
  });

  it("does not false-match 'hare off at' as a hare name", () => {
    expect(extractHares("Pack off at 7:30, hare off at 7:15")).toBeUndefined();
  });

  it("extracts from WHO (hares): pattern (DeMon format)", () => {
    const desc = "WHO (hares): A Girl Named Steve\nWHAT TIME: 7:00 PM\nSome song lyrics\nHare drop another for the prince";
    expect(extractHares(desc)).toBe("A Girl Named Steve");
  });

  it("does not extract song lyric after 'Hare drop' (negative lookahead)", () => {
    const desc = "Some intro\nHare drop another for the prince of this\nMore lyrics";
    expect(extractHares(desc)).toBeUndefined();
  });

  it("extracts WHO (hares): when HTML stripping splits label from colon", () => {
    // GCal API returns HTML like "<b>WHO (hares)</b>: Name" which after
    // stripHtmlTags may produce "WHO (hares)\n: Name" (newline before colon)
    const desc = "WHO (hares)\n: A Girl Named Steve\nWHEN:Monday, March 21st, 2026\nWHAT: song lyrics with Hare drop another";
    expect(extractHares(desc)).toBe("A Girl Named Steve");
  });

  it("truncates at *** separator in hare field", () => {
    expect(extractHares("Hare(s): Denny's Sucks *** could use a co-hare")).toBe("Denny's Sucks");
  });

  it("strips 'could use a co-hare' commentary", () => {
    expect(extractHares("Hare(s): Denny's Sucks could use a co-hare")).toBe("Denny's Sucks");
  });

  it("strips 'need a co-hare' commentary", () => {
    expect(extractHares("Hare: Trail Blazer need a cohare for this one")).toBe("Trail Blazer");
  });

  it("strips trailing phone number (dashed format)", () => {
    expect(extractHares("Hare: Dr Sh!t Yeah! 719-360-3805")).toBe("Dr Sh!t Yeah!");
  });

  it("strips trailing phone number (parenthesized format)", () => {
    expect(extractHares("Hare: Trail Name (555) 123-4567")).toBe("Trail Name");
  });

  it("strips trailing phone number (dotted format)", () => {
    expect(extractHares("Hares: Name1 & Name2 555.123.4567")).toBe("Name1 & Name2");
  });

  it("strips phone from full description context", () => {
    const description =
      "March Madness!\nRilea's Pub 5672 N Union Blvd\nHare: Dr Sh!t Yeah! 719-360-3805\nBring: whistle";
    expect(extractHares(description)).toBe("Dr Sh!t Yeah!");
  });

  // Multi-line hare continuation: some calendars put each hare on its own line
  // beneath the "Hares:" label.

  it("joins continuation lines under 'Hares:' label (two names)", () => {
    const desc = "Hares:\nIvanna Hairy Buttchug\nIndiana Bones and the Temple of Poon";
    expect(extractHares(desc)).toBe("Ivanna Hairy Buttchug, Indiana Bones and the Temple of Poon");
  });

  it("joins continuation lines under 'Hares:' label (three names)", () => {
    const desc = "Hares:\nAlice\nBob\nCarol";
    expect(extractHares(desc)).toBe("Alice, Bob, Carol");
  });

  it("stops multi-line hares at blank line", () => {
    const desc = "Hares:\nAlice\nBob\n\nSome other paragraph";
    expect(extractHares(desc)).toBe("Alice, Bob");
  });

  it("stops multi-line hares at next field label", () => {
    const desc = "Hares:\nAlice\nBob\nWhere: Some Pub";
    expect(extractHares(desc)).toBe("Alice, Bob");
  });

  it("stops multi-line hares at URL continuation", () => {
    const desc = "Hares:\nAlice\nhttps://example.com/trail-map";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("stops multi-line hares at boilerplate marker", () => {
    const desc = "Hares:\nAlice\nHash Cash: $5";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("inline hare on label line does NOT sweep in continuation prose", () => {
    // Continuation only triggers for label-only headers; an inline hare is
    // assumed complete (following prose is description, not co-hares).
    const desc = "Hares: Alice\nBob the Hare did a thing yesterday\nWhere: Park";
    expect(extractHares(desc)).toBe("Alice");
  });

  it("single-line hare behavior unchanged (regression)", () => {
    expect(extractHares("Hare: Mudflap\nON-IN: Some Bar")).toBe("Mudflap");
  });

  it("single-line hare with immediate next-label unchanged", () => {
    expect(extractHares("Hares: Alice & Bob\nWhere: Park")).toBe("Alice & Bob");
  });

  // Adversarial: label-only "Hares:" followed by prose/instructions must not
  // sweep description text into hare names.
  it("does not ingest sentence-like prose after label-only header", () => {
    const desc = "Hares:\nBring a flashlight.\nMeet at the park.";
    expect(extractHares(desc)).toBeUndefined();
  });

  it("does not ingest lines containing colons (unrecognized field labels)", () => {
    const desc = "Hares:\nNote: see FB for details\nDistance: 5k";
    expect(extractHares(desc)).toBeUndefined();
  });

  it("stops at overly long continuation line (prose, not a name)", () => {
    const longLine = "This is a long paragraph describing the trail that goes on for many words in a row";
    const desc = `Hares:\nAlice\n${longLine}`;
    expect(extractHares(desc)).toBe("Alice");
  });
});

// ── Test helper for buildRawEventFromGCalItem ──

/** Build a minimal GCal event for testing, with sensible defaults. */
function testGCalEvent(overrides: Record<string, unknown> = {}) {
  return {
    summary: "Hash Run",
    start: { dateTime: "2026-03-29T14:00:00-04:00" },
    status: "confirmed",
    ...overrides,
  };
}

describe("CTA placeholder event skip", () => {
  it.each([
    "Hares needed!",
    "Hare wanted",
    "Hares Required",
    "Looking for a hare",
    "Need a hare for Friday",
    "Hare volunteers needed",
  ])("skips event with CTA-only title: %s", (summary) => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary }),
      { defaultKennelTag: "ewh3" },
    );
    expect(result).toBeNull();
  });

  it("preserves legitimate run titles that happen to mention hares", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "EWH3 Run #1234 - Hare: Fluffy" }),
      { defaultKennelTag: "ewh3" },
    );
    expect(result).not.toBeNull();
  });
});

describe("Google holiday calendar filter", () => {
  it("skips events from Google's imported US holiday calendar", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Thanksgiving",
        organizer: { email: "en.usa#holiday@group.v.calendar.google.com" },
      }),
      { defaultKennelTag: "bjh3" },
    );
    expect(result).toBeNull();
  });

  it("skips events where organizer.email points at any holiday calendar domain", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Veterans Day",
        organizer: { email: "en.usa.holidays@group.v.calendar.google.com" },
      }),
      { defaultKennelTag: "bjh3" },
    );
    expect(result).toBeNull();
  });

  it("falls back to creator.email when organizer is missing", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Christmas",
        creator: { email: "en.usa#holiday@group.v.calendar.google.com" },
      }),
      { defaultKennelTag: "bjh3" },
    );
    expect(result).toBeNull();
  });

  it("preserves events from the kennel's own calendar", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "BJH3 Run #500",
        organizer: { email: "borderjumpersh3@gmail.com" },
      }),
      { defaultKennelTag: "bjh3" },
    );
    expect(result).not.toBeNull();
  });
});

// ── non-address location fallback ──

describe("non-address location detection", () => {
  it("rejects instruction text in location and falls back to description", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Palm Sunday",
        start: { dateTime: "2026-03-29T14:00:00-06:00" },
        description: "Where: The Rusty Bucket, 123 Main St\nSome details",
        location: "use the link because there's a Lil parking lot",
      }),
      { defaultKennelTag: "dh3-co" },
    );
    expect(result).not.toBeNull();
    expect(result!.location).toBe("The Rusty Bucket, 123 Main St");
  });

  it("rejects 'check the description' location text", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        description: "Where: The Park, Downtown\nDetails here",
        location: "check the description for details",
      }),
      { defaultKennelTag: "test" },
    );
    expect(result).not.toBeNull();
    expect(result!.location).toBe("The Park, Downtown");
  });

  it.each([
    ["When: 5:69", "template-field text"],
    ["Hare: Bob McHash", "field label in location"],
    ["Cost: $5.00", "cost label in location"],
  ])("rejects non-address location %s (%s)", (location) => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ description: "Some description", location }),
      { defaultKennelTag: "test" },
    );
    expect(result).not.toBeNull();
    expect(result!.location).toBeUndefined();
  });

  it("preserves normal address in location field", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        description: "Some description",
        location: "12017 Amherst Dr, Austin, TX 78759",
      }),
      { defaultKennelTag: "test" },
    );
    expect(result).not.toBeNull();
    expect(result!.location).toBe("12017 Amherst Dr, Austin, TX 78759");
  });
});

// ── titleHarePattern (Austin H3 style) ──

describe("titleHarePattern — hare extraction from summary", () => {
  const titleHareRE = /^(.+?)\s+AH3\s+#/i;

  it("extracts hare names from summary when format is '[Hares] AH3 #N'", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Baba Gagush & Crusty Beaver AH3 #2269",
        start: { dateTime: "2026-03-29T14:00:00-05:00" },
        description: "MAP: https://maps.app.goo.gl/bPryrj1CNfrg6kxQ7\nA to B, Dog Friendly",
        location: "12017 Amherst Dr, Austin, TX 78759, USA",
      }),
      { defaultKennelTag: "ah3", titleHarePattern: String.raw`^(.+?)\s+AH3\s+#` },
      undefined, undefined, undefined,
      titleHareRE,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Baba Gagush & Crusty Beaver");
    expect(result!.title).toBe("AH3 #2269");
  });

  it("handles SUFFIX-style titleHarePattern (hares at end of title, not start) (#575)", () => {
    // Aloha H3 titles: "AH3 #1833 - Manoa Valley District Park - International Dicklomat"
    // The prior prefix-only cleanup stripped characters from the WRONG end,
    // producing "y District Park - International Dicklomat". The fix uses
    // startsWith/endsWith to detect suffix captures and strips from the end.
    const suffixRE = /^AH3\s*#\d+.*-\s+(.+)$/i;
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "AH3 #1833 - Manoa Valley District Park - International Dicklomat",
        start: { dateTime: "2026-04-18T14:00:00-10:00" },
      }),
      { defaultKennelTag: "ah3-hi", titleHarePattern: String.raw`^AH3\s*#\d+.*-\s+(.+)$` },
      undefined, undefined, undefined,
      suffixRE,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("International Dicklomat");
    expect(result!.title).toBe("AH3 #1833 - Manoa Valley District Park");
    expect(result!.title).not.toContain("Dicklomat");
  });

  it("handles SUFFIX-style pattern with extra dashes (EARLY START note)", () => {
    const suffixRE = /^AH3\s*#\d+.*-\s+(.+)$/i;
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "AH3 #1828 - **EARLY START** - Kailua District Park - Green Machine",
        start: { dateTime: "2026-03-14T10:00:00-10:00" },
      }),
      { defaultKennelTag: "ah3-hi", titleHarePattern: String.raw`^AH3\s*#\d+.*-\s+(.+)$` },
      undefined, undefined, undefined,
      suffixRE,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Green Machine");
    expect(result!.title).toBe("AH3 #1828 - **EARLY START** - Kailua District Park");
  });

  it("handles prefix capture when hare text appears later in the title too", () => {
    // Regression: "Alice - Event with Alice" — the hare "Alice" appears at
    // both the start and later. startsWith/endsWith correctly identifies this
    // as a prefix capture and strips from the front.
    const prefixRE = /^(.+?)\s+AH3\s+#/i;
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Alice AH3 #2269 - Event with Alice",
        start: { dateTime: "2026-04-18T14:00:00-05:00" },
      }),
      { defaultKennelTag: "ah3", titleHarePattern: String.raw`^(.+?)\s+AH3\s+#` },
      undefined, undefined, undefined,
      prefixRE,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Alice");
    // Title should strip from the front, not the back
    expect(result!.title).toBe("AH3 #2269 - Event with Alice");
  });

  it("handles MID-title titleHarePattern (Stuttgart SH3 style) (#807)", () => {
    // Format: "SH3 #N Hare: {hare}- {neighborhood}". The hare is labeled
    // in the middle; both label and name must be stripped so the title
    // reads "SH3 #N - Neighborhood".
    const midRE = /Hare:\s+(.+?)(?=-\s+\S)/i;
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "SH3 #880 Hare: Kiss Me- Degerloch",
        start: { dateTime: "2026-04-19T12:00:00+02:00" },
      }),
      { defaultKennelTag: "sh3-de", titleHarePattern: String.raw`Hare:\s+(.+?)(?=-\s+\S)` },
      undefined, undefined, undefined,
      midRE,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Kiss Me");
    expect(result!.title).toBe("SH3 #880 - Degerloch");
  });

  it("handles en/em dash neighborhood delimiter in Stuttgart pattern", () => {
    // Production source pattern widened to accept [-–—] — otherwise an
    // em-dash title would capture "Kiss Me — Degerloch" as the hare.
    const pattern = /Hare:?\s+(.+?)(?:(?=[-\u2013\u2014]\s*\S)|\s*$)/i;
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "SH3 #881 Hare: Kiss Me — Degerloch",
        start: { dateTime: "2026-04-26T12:00:00+02:00" },
      }),
      {
        defaultKennelTag: "sh3-de",
        titleHarePattern: String.raw`Hare:?\s+(.+?)(?:(?=[-\u2013\u2014]\s*\S)|\s*$)`,
      },
      undefined, undefined, undefined,
      pattern,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Kiss Me");
    expect(result!.title).toBe("SH3 #881 — Degerloch");
  });

  it("classifies by match position, not hare-text coincidence", () => {
    // Regression: if hareText coincidentally equals a leading substring
    // of the title, content-based startsWith() would misroute to the
    // prefix branch and leave the "Hare:" label behind. Position-based
    // classification (start === 0) routes to the mid-match branch.
    const pattern = /Hare:\s+(.+?)(?:\s*$)/i;
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "AH3 #880 Hare: AH3",
        start: { dateTime: "2026-05-01T12:00:00-10:00" },
      }),
      {
        defaultKennelTag: "ah3-hi",
        titleHarePattern: String.raw`Hare:\s+(.+?)(?:\s*$)`,
      },
      undefined, undefined, undefined,
      pattern,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("AH3");
    expect(result!.title).toBe("AH3 #880");
  });

  it("description hares take priority over title hares", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "Title Name AH3 #2270",
        start: { dateTime: "2026-04-05T14:00:00-05:00" },
        description: "Hare: Actual Hare Name\nDetails here",
      }),
      { defaultKennelTag: "ah3", titleHarePattern: String.raw`^(.+?)\s+AH3\s+#` },
      undefined, undefined, undefined,
      titleHareRE,
    );
    expect(result).not.toBeNull();
    expect(result!.hares).toBe("Actual Hare Name");
    // Title should NOT be stripped when hares came from description
    expect(result!.title).toContain("AH3");
  });
});

// ── mailto artifact stripping ──

describe("mailto stripping in description", () => {
  it("strips mailto: artifacts from description", () => {
    const result = buildRawEventFromGCalItem(
      {
        summary: "MH3 #1974 - Test",
        start: { dateTime: "2026-03-22T15:00:00-05:00" },
        description: "Zelle: test@gmail.com (mailto:test@gmail.com)",
        status: "confirmed",
      },
      null,
    );
    expect(result).not.toBeNull();
    expect(result!.description).not.toContain("mailto:");
    expect(result!.description).toContain("test@gmail.com");
  });
});

// ── HTML entity decoding in titles ──

describe("extractTitle — HTML entities", () => {
  it("handles pre-decoded title (entities decoded before extractTitle)", () => {
    // decodeEntities is applied to summary before extractTitle in buildRawEventFromGCalItem
    // so extractTitle receives already-decoded text
    expect(extractTitle("SHITH3: St. Patricshit's Day")).toBe("St. Patricshit's Day");
  });
});

// ── descriptionSuffix ──

describe("buildRawEventFromGCalItem — descriptionSuffix", () => {
  const baseItem = {
    summary: "Hash Run",
    start: { dateTime: "2026-03-15T14:00:00-04:00" },
    status: "confirmed",
  };

  it("appends suffix to existing description", () => {
    const item = { ...baseItem, description: "Meet at the park." };
    const config = { defaultKennelTag: "TEST", descriptionSuffix: "Check Facebook for details." };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.description).toBe("Meet at the park.\n\nCheck Facebook for details.");
  });

  it("uses suffix as description when event has no description", () => {
    const config = { defaultKennelTag: "TEST", descriptionSuffix: "Check Facebook for details." };
    const event = buildRawEventFromGCalItem(baseItem, config);
    expect(event).not.toBeNull();
    expect(event!.description).toBe("Check Facebook for details.");
  });

  it("does not modify description when no suffix configured", () => {
    const item = { ...baseItem, description: "Meet at the park." };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.description).toBe("Meet at the park.");
  });
});

// ── buildRawEventFromGCalItem — all-day event guard ──

describe("buildRawEventFromGCalItem — all-day events", () => {
  it("skips all-day events (no dateTime, only date)", () => {
    // All-day events like "Travel Hash: Texas Interhash" have start.date but no start.dateTime
    const result = buildRawEventFromGCalItem(
      {
        summary: "Travel Hash: Texas Interhash",
        start: { date: "2026-04-02" },
        end: { date: "2026-04-06" },
        status: "confirmed",
      },
      { defaultKennelTag: "TEST" },
    );
    expect(result).toBeNull();
  });

  it("does not skip timed events (has dateTime)", () => {
    const result = buildRawEventFromGCalItem(
      {
        summary: "Hash Run",
        start: { dateTime: "2026-04-02T18:30:00-05:00" },
        status: "confirmed",
      },
      { defaultKennelTag: "TEST" },
    );
    expect(result).not.toBeNull();
  });

  it("applies defaultStartTime when an all-day event has no recoverable time (#536)", () => {
    // ABQ H3's Tuesday CLiT trails are entered as all-day calendar items
    // with no "Circle up" / "Time:" label in the description, so
    // extractTimeFromDescription returns nothing. defaultStartTime is the
    // final fallback so those events render as 6pm runs rather than
    // all-day/noon blocks downstream.
    const result = buildRawEventFromGCalItem(
      {
        summary: "Celebrate Loudly It's Tuesday",
        start: { date: "2026-04-14" },
        end: { date: "2026-04-15" },
        description: "Hares: DOT\nWhat: CLiT trail",
        status: "confirmed",
      },
      { defaultKennelTag: "abqh3", includeAllDayEvents: true, defaultStartTime: "18:00" },
    );
    expect(result).not.toBeNull();
    expect(result!.startTime).toBe("18:00");
    expect(result!.date).toBe("2026-04-14");
  });

  it("prefers description-extracted time over defaultStartTime when both exist", () => {
    // defaultStartTime is the last fallback — any labeled time in the
    // description body still wins, so Saturday events with "Circle up: 2:00 PM"
    // would not get overwritten by the Tuesday default.
    const result = buildRawEventFromGCalItem(
      {
        summary: "Saturday Trail",
        start: { date: "2026-04-11" },
        description: "Circle up: 2:00 PM\nHares: Blue",
        status: "confirmed",
      },
      { defaultKennelTag: "abqh3", includeAllDayEvents: true, defaultStartTime: "18:00" },
    );
    expect(result!.startTime).toBe("14:00");
  });

  it("prefers dateTime-derived time over defaultStartTime", () => {
    // And timed events (the common case) always win.
    const result = buildRawEventFromGCalItem(
      {
        summary: "Saturday Trail",
        start: { dateTime: "2026-04-11T14:00:00-06:00" },
        status: "confirmed",
      },
      { defaultKennelTag: "abqh3", defaultStartTime: "18:00" },
    );
    expect(result!.startTime).toBe("14:00");
  });

  it("ignores a malformed defaultStartTime rather than injecting garbage", () => {
    // Config typo (e.g. "6pm" or "18h00" instead of "18:00") must NOT silently
    // become the event's startTime — a HH:MM format guard rejects it and the
    // event falls through to undefined.
    const result = buildRawEventFromGCalItem(
      {
        summary: "Celebrate Loudly It's Tuesday",
        start: { date: "2026-04-14" },
        end: { date: "2026-04-15" },
        status: "confirmed",
      },
      { defaultKennelTag: "abqh3", includeAllDayEvents: true, defaultStartTime: "6pm" },
    );
    expect(result).not.toBeNull();
    expect(result!.startTime).toBeUndefined();
  });
});

// ── buildRawEventFromGCalItem — skipPatterns ──

describe("buildRawEventFromGCalItem — skipPatterns", () => {
  const baseItem = {
    summary: "BFM Special Trail",
    start: { dateTime: "2026-04-02T18:30:00-05:00" },
    status: "confirmed" as const,
  };

  it("skips events matching a skipPattern", () => {
    const skipPatterns = [/BFM|Ben Franklin/i];
    const result = buildRawEventFromGCalItem(
      baseItem,
      { defaultKennelTag: "philly-h3" },
      undefined,
      undefined,
      skipPatterns,
    );
    expect(result).toBeNull();
  });

  it("does not skip events that don't match skipPatterns", () => {
    const skipPatterns = [/BFM|Ben Franklin/i];
    const result = buildRawEventFromGCalItem(
      { ...baseItem, summary: "Philly Hash Weekly Run" },
      { defaultKennelTag: "philly-h3" },
      undefined,
      undefined,
      skipPatterns,
    );
    expect(result).not.toBeNull();
    expect(result!.kennelTag).toBe("philly-h3");
  });

  it("works with empty skipPatterns array", () => {
    const result = buildRawEventFromGCalItem(
      baseItem,
      { defaultKennelTag: "TEST" },
      undefined,
      undefined,
      [],
    );
    expect(result).not.toBeNull();
  });

  // Regression tests for #582 / #584 — the production skipPatterns are
  // anchored to start-of-title so a joint/co-host trail whose title mentions
  // the foreign kennel as a secondary token is NOT dropped.
  describe("anchored start-of-title patterns (#582 Philly→BFM, #584 Oregon→N2H3)", () => {
    const PHILLY_SKIP = [/^Ben Franklin Mob H3\b/i, /^BFM\b/i];
    const OREGON_SKIP = [/^NNH3\b/i, /^N2H3\b/i, /^No Name\b/i];

    it("drops a pure BFM-titled event from the Philly calendar", () => {
      const result = buildRawEventFromGCalItem(
        { ...baseItem, summary: "Ben Franklin Mob H3" },
        { defaultKennelTag: "philly-h3" },
        undefined,
        undefined,
        PHILLY_SKIP,
      );
      expect(result).toBeNull();
    });

    it("drops a 'BFM #123' prefixed event from the Philly calendar", () => {
      const result = buildRawEventFromGCalItem(
        { ...baseItem, summary: "BFM #1234: Trail Name" },
        { defaultKennelTag: "philly-h3" },
        undefined,
        undefined,
        PHILLY_SKIP,
      );
      expect(result).toBeNull();
    });

    it("KEEPS a mixed-title joint event under Philly H3 (co-host, not BFM-only)", () => {
      const result = buildRawEventFromGCalItem(
        { ...baseItem, summary: "Philly H3 & BFM joint co-host trail" },
        { defaultKennelTag: "philly-h3" },
        undefined,
        undefined,
        PHILLY_SKIP,
      );
      expect(result).not.toBeNull();
      expect(result!.kennelTag).toBe("philly-h3");
    });

    it("drops a pure N2H3-titled event from the Oregon calendar", () => {
      const result = buildRawEventFromGCalItem(
        { ...baseItem, summary: "N2H3 #769 The Matzo Ball Hash!" },
        { defaultKennelTag: "oh3" },
        undefined,
        undefined,
        OREGON_SKIP,
      );
      expect(result).toBeNull();
    });

    it("drops an NNH3-prefixed event from the Oregon calendar", () => {
      const result = buildRawEventFromGCalItem(
        { ...baseItem, summary: "NNH3 #769 The Matzo Ball Hash!" },
        { defaultKennelTag: "oh3" },
        undefined,
        undefined,
        OREGON_SKIP,
      );
      expect(result).toBeNull();
    });

    it("KEEPS an OH3 event whose description mentions N2H3 (e.g. meetup reference)", () => {
      const result = buildRawEventFromGCalItem(
        { ...baseItem, summary: "OH3 #1500 — meet at the No Name H3 bar" },
        { defaultKennelTag: "oh3" },
        undefined,
        undefined,
        OREGON_SKIP,
      );
      expect(result).not.toBeNull();
      expect(result!.kennelTag).toBe("oh3");
    });
  });
});

// ── extractTitleFromDescription ──

describe("extractTitleFromDescription", () => {
  it("extracts first non-label line as title", () => {
    expect(extractTitleFromDescription("Green Dresses!! 👗\nHare: Ant Farmer!\nWhere: By the fountain"))
      .toBe("Green Dresses!");
  });

  it("returns undefined when first line is a label", () => {
    expect(extractTitleFromDescription("Hare: Someone\nWhere: Place")).toBeUndefined();
  });

  it("returns undefined for empty description", () => {
    expect(extractTitleFromDescription("")).toBeUndefined();
  });

  it("returns undefined for all-label description", () => {
    expect(extractTitleFromDescription("Hare: Bob\nWhere: Park\nTime: 2pm")).toBeUndefined();
  });

  it("skips URL-only lines", () => {
    expect(extractTitleFromDescription("https://example.com\nFun Run")).toBe("Fun Run");
  });

  it("strips trailing emoji from title", () => {
    expect(extractTitleFromDescription("St. Patrick's Day 🍀🍀🍀")).toBe("St. Patrick's Day");
  });

  it("collapses excessive punctuation", () => {
    expect(extractTitleFromDescription("GREEN DRESS RUN!!!!\nHare: Bob")).toBe("GREEN DRESS RUN!");
  });
});

// ── buildRawEventFromGCalItem — title fallback ──

describe("buildRawEventFromGCalItem — title fallback from description", () => {
  it("falls back to description title when summary equals kennel tag", () => {
    const item = {
      summary: "C2H3",
      description: "Green Dresses!! 👗 Hare: Ant Farmer! We are meeting by the fountain!",
      start: { dateTime: "2026-03-14T19:00:00-05:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "C2H3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Green Dresses!");
  });

  it("keeps original title when summary differs from kennel tag", () => {
    const item = {
      summary: "Special Green Dress Run",
      description: "Description text\nHare: Someone",
      start: { dateTime: "2026-03-14T19:00:00-05:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "C2H3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Special Green Dress Run");
  });

  it("keeps kennel tag as title when description has no usable title and no defaultTitle", () => {
    const item = {
      summary: "C2H3",
      description: "Hare: Bob\nWhere: The Park",
      start: { dateTime: "2026-03-14T19:00:00-05:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "C2H3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("C2H3");
  });

  it("uses defaultTitle when summary is just the kennel slug and description has no title", () => {
    const item = {
      summary: "ochump",
      description: "Cost: $5.00\nHare: Howdy Do Me\nDirections: 5 fwy to Tustin Ranch Road East",
      start: { dateTime: "2026-04-01T18:30:00-07:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "ochump", defaultTitle: "OC Hump" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("OC Hump");
  });

  it("falls back to description title when summary is a bare kennel code different from assigned tag", () => {
    const item = {
      summary: "OCHHH",
      description: "OC Hump Trail\nHare: Howdy Do Me\n11385 Pioneer Road, Tustin, CA",
      start: { dateTime: "2026-04-01T18:30:00-07:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "ochump" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("OC Hump Trail");
  });

  it("routes Maps URL from description to locationUrl and clears location", () => {
    const item = {
      summary: "Hash Run",
      description: "Location: https://maps.app.goo.gl/zpyewJa4kXbu2pnd9",
      start: { dateTime: "2026-03-15T14:00:00-04:00" },
      status: "confirmed",
    };
    const event = buildRawEventFromGCalItem(item, { defaultKennelTag: "lah3" });
    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/zpyewJa4kXbu2pnd9");
  });
});

// ── extractLocationFromDescription ──

describe("extractLocationFromDescription", () => {
  it("extracts WHERE: pattern", () => {
    expect(extractLocationFromDescription("WHERE: Portland Saturday Market fountain")).toBe("Portland Saturday Market fountain");
  });

  it("extracts Location: pattern", () => {
    expect(extractLocationFromDescription("Hare: Someone\nLocation: 123 Main St, Portland, OR")).toBe("123 Main St, Portland, OR");
  });

  it("extracts Meet at: pattern", () => {
    expect(extractLocationFromDescription("Meet at: Central Park")).toBe("Central Park");
  });

  it("truncates at next label", () => {
    expect(extractLocationFromDescription("WHERE: The Park\nWhen: 7pm")).toBe("The Park");
  });

  it("returns undefined for placeholder", () => {
    expect(extractLocationFromDescription("WHERE: TBD")).toBeUndefined();
  });

  it("returns undefined when too short", () => {
    expect(extractLocationFromDescription("WHERE: NY")).toBeUndefined();
  });

  it("returns undefined when no pattern matches", () => {
    expect(extractLocationFromDescription("Just a regular description")).toBeUndefined();
  });

  it("truncates at URL", () => {
    expect(extractLocationFromDescription("WHERE: The Pub https://maps.google.com/foo")).toBe("The Pub");
  });

  it("extracts Address: pattern", () => {
    expect(extractLocationFromDescription("Address: 456 Oak Ave, Suite 100")).toBe("456 Oak Ave, Suite 100");
  });

  it("extracts Start: label with coordinates and place name (KAW!H3 format)", () => {
    const desc = "Hare: Gayzelle\nTrail: Mostly pavement\nStart: 30.290552, -97.772365, the corner of Enfield and Exposition\nBring: virgins";
    expect(extractLocationFromDescription(desc)).toBe("30.290552, -97.772365, the corner of Enfield and Exposition");
  });

  it("returns undefined when Start: value is a time string", () => {
    expect(extractLocationFromDescription("Start: 6:30pm\nWhere: The Park")).toBe("The Park");
  });

  it("returns undefined for Start: with bare time", () => {
    expect(extractLocationFromDescription("Start: 7:00 PM")).toBeUndefined();
  });

  it("extracts bare LOCATION label with URL line then place name (Mr. Happy's format)", () => {
    const desc = "🍆🍅🥒Veggie hash🍆🍅🥒\n\nLOCATION\nhttps://maps.app.goo.gl/NGW5BNYxe8mNCXyv7\nVista del Prado Park\n\nWe're the Mr. Happy's Hashers";
    expect(extractLocationFromDescription(desc)).toBe("Vista del Prado Park");
  });

  it("extracts bare WHERE label with no URL line", () => {
    expect(extractLocationFromDescription("WHERE\nCentral Park")).toBe("Central Park");
  });

  it("extracts bare LOCATION label without URL intermediary", () => {
    expect(extractLocationFromDescription("LOCATION\nThe Old Pub, 123 Main St")).toBe("The Old Pub, 123 Main St");
  });

  it("returns undefined for Start: with 24-hour time", () => {
    expect(extractLocationFromDescription("Start: 18:30")).toBeUndefined();
  });

  it("returns undefined for Start: with bare time (no am/pm)", () => {
    expect(extractLocationFromDescription("Start: 7:00")).toBeUndefined();
  });

  it("returns Maps short URL as-is when it is the entire location value (LAH3 pattern)", () => {
    expect(extractLocationFromDescription("Location: https://maps.app.goo.gl/zpyewJa4kXbu2pnd9?g_st=a"))
      .toBe("https://maps.app.goo.gl/zpyewJa4kXbu2pnd9?g_st=a");
  });

  it("still truncates inline URL when location has text before it", () => {
    expect(extractLocationFromDescription("WHERE: The Pub https://maps.google.com/foo")).toBe("The Pub");
  });

  it("extracts 'Start Address:' label (Voodoo H3 format)", () => {
    const desc = "Hare & Co-Hares: Steven with a D\nStart Address: 128 S Roadway St., New Orleans, LA 70124\nHash Cash: $7";
    expect(extractLocationFromDescription(desc)).toBe("128 S Roadway St., New Orleans, LA 70124");
  });

  it("extracts 'Start Address:' with venue name prefix", () => {
    const desc = "Start Address: St. Patrick Playground - meet at the corner by 501 S Bernadotte St. New Orleans, LA 70119";
    expect(extractLocationFromDescription(desc)).toBe("St. Patrick Playground - meet at the corner by 501 S Bernadotte St. New Orleans, LA 70119");
  });
});

// ── extractTimeFromDescription ──

describe("extractTimeFromDescription", () => {
  it("extracts Pack Meet time", () => {
    expect(extractTimeFromDescription("Pack Meet: 6:30pm")).toBe("18:30");
  });

  it("extracts When: time", () => {
    expect(extractTimeFromDescription("When: Monday March 23th 7:00 PM")).toBe("19:00");
  });

  it("extracts Time: pattern", () => {
    expect(extractTimeFromDescription("Time: 4:00 pm")).toBe("16:00");
  });

  it("extracts Circle time", () => {
    expect(extractTimeFromDescription("Circle: 6:30 PM")).toBe("18:30");
  });

  it("extracts Chalk Talk time", () => {
    expect(extractTimeFromDescription("Chalk Talk: 5:45 pm")).toBe("17:45");
  });

  it("returns undefined when no time found", () => {
    expect(extractTimeFromDescription("Just some text with no time")).toBeUndefined();
  });

  it("extracts Start: time", () => {
    expect(extractTimeFromDescription("Start: 3:00 PM")).toBe("15:00");
  });
});

// ── extractTitleFromDescription — updated label filtering ──

describe("extractTitleFromDescription — updated label filtering", () => {
  it("skips Pack Meet lines", () => {
    expect(extractTitleFromDescription("Pack Meet: 6:30pm\nActual Title Here")).toBe("Actual Title Here");
  });

  it("skips pure time strings", () => {
    expect(extractTitleFromDescription("6:30pm\nReal Title")).toBe("Real Title");
  });

  it("skips Meeting lines", () => {
    expect(extractTitleFromDescription("Meeting: at the park\nTrail Name")).toBe("Trail Name");
  });

  it("skips Circle lines", () => {
    expect(extractTitleFromDescription("Circle: 7:00 PM\nSt. Patrick's Day Run")).toBe("St. Patrick's Day Run");
  });

  it("skips Chalk Talk lines", () => {
    expect(extractTitleFromDescription("Chalk Talk: 5:45 pm\nSummer Solstice")).toBe("Summer Solstice");
  });

  it("skips lines with embedded time patterns", () => {
    const desc = "Pack Meet: 6:30pm\nChalk Talk & Hares Off: 7:05pm\nPack Off: 7:20pm-ish";
    expect(extractTitleFromDescription(desc)).toBeUndefined();
  });

  it("skips schedule line even when label regex does not match compound label", () => {
    // "Chalk Talk & Hares Off:" doesn't match TITLE_LABEL_RE because of the "& Hares Off" part
    // But the schedule pattern ": 7:05pm" should still cause it to be skipped
    expect(extractTitleFromDescription("Chalk Talk & Hares Off: 7:05pm\nTrail Info")).toBe("Trail Info");
  });

  it("does not skip legitimate titles that mention times", () => {
    // Titles like "5K at 7:30pm" should NOT be filtered — only schedule lines (label: time)
    expect(extractTitleFromDescription("5K at 7:30pm")).toBe("5K at 7:30pm");
  });
});

// ── stripDatePrefix ──

describe("stripDatePrefix", () => {
  it("strips day + month + ordinal prefix", () => {
    expect(stripDatePrefix("Wed April 1st OH3 Full Moon #1365")).toBe("OH3 Full Moon #1365");
  });

  it("strips Saturday + month + date prefix", () => {
    expect(stripDatePrefix("Saturday March 28th Toga Hash")).toBe("Toga Hash");
  });

  it("strips abbreviated day + numeric date prefix", () => {
    expect(stripDatePrefix("Sat 3/28 Trail Name")).toBe("Trail Name");
  });

  it("returns original text when no date prefix", () => {
    expect(stripDatePrefix("OH3 Full Moon #1365")).toBe("OH3 Full Moon #1365");
  });

  it("returns original text when prefix would consume everything", () => {
    expect(stripDatePrefix("Wed April 1st")).toBe("Wed April 1st");
  });
});

// ── buildRawEventFromGCalItem — description fallbacks ──

describe("buildRawEventFromGCalItem — description fallback for location", () => {
  it("falls back to description location when item.location is missing", () => {
    const item = {
      summary: "Hash Run",
      description: "Hare: Someone\nWhere: The Old Pub, 123 Main St",
      start: { dateTime: "2026-03-15T14:00:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.location).toBe("The Old Pub, 123 Main St");
    expect(event!.locationUrl).toContain("google.com/maps");
  });

  it("prefers item.location over description", () => {
    const item = {
      summary: "Hash Run",
      description: "Where: Some Other Place",
      location: "The Real Place",
      start: { dateTime: "2026-03-15T14:00:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.location).toBe("The Real Place");
  });

  it("treats placeholder item.location as absent and falls back to description", () => {
    const item = {
      summary: "Hash Run",
      description: "Where: The Old Pub, 123 Main St",
      location: "TBD",
      start: { dateTime: "2026-03-15T14:00:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.location).toBe("The Old Pub, 123 Main St");
  });
});

describe("buildRawEventFromGCalItem — description fallback for time", () => {
  it("falls back to description time when dateTime yields no parseable time", () => {
    // dateTime without a T-separated time component — extractDateTimeFromGCalItem returns no startTime
    const item = {
      summary: "Hash Run",
      description: "Pack Meet: 6:30pm\nHare: Someone",
      start: { dateTime: "2026-03-15" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.startTime).toBe("18:30");
  });

  it("prefers dateTime-derived time over description time", () => {
    const item = {
      summary: "Hash Run",
      description: "Pack Meet: 6:00pm",
      start: { dateTime: "2026-03-15T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.startTime).toBe("18:30");
  });
});

// ── Title-embedded field extraction ──

describe("buildRawEventFromGCalItem — parenthetical hare extraction", () => {
  it("extracts hare name from trailing parenthetical", () => {
    const item = {
      summary: "Beantown #276 (Mr Rogers)",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "beantown" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Beantown #276");
    expect(event!.hares).toBe("Mr Rogers");
  });

  it("does not extract hares from instructional parenthetical", () => {
    const item = {
      summary: "BFMH3 Weekly Hash (Trail info usually posted Monday on website, or email for more details!)",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "BFM" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("BFMH3 Weekly Hash");
    expect(event!.hares).toBeUndefined();
  });

  it("does not override hares from description with parenthetical", () => {
    const item = {
      summary: "Hash #100 (Trail Name Here)",
      description: "Hare: Speedy",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Speedy");
    // Parenthetical stays in title when hares already set from description
    expect(event!.title).toBe("Hash #100 (Trail Name Here)");
  });

  it("rejects descriptive parentheticals as hares", () => {
    const item = {
      summary: "Summer Trail (A to B)",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Summer Trail (A to B)");
    expect(event!.hares).toBeUndefined();
  });

  it("rejects directive parentheticals as hares", () => {
    const item = {
      summary: "Hash #200 (No Dogs)",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Hash #200 (No Dogs)");
    expect(event!.hares).toBeUndefined();
  });
});

describe("buildRawEventFromGCalItem — w/ hare-location extraction", () => {
  it("extracts hares and location from 'w/' pattern", () => {
    const item = {
      summary: "Passover Trail w/ Mongo & Tatas - Dupont Circle",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "EWH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Passover Trail");
    expect(event!.hares).toBe("Mongo & Tatas");
    expect(event!.location).toBe("Dupont Circle");
  });

  it("does not match 'with' (only matches 'w/' abbreviation)", () => {
    const item = {
      summary: "Running with Bears - Riverside Park",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "EWH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Running with Bears - Riverside Park");
    expect(event!.hares).toBeUndefined();
  });

  it("does not override location from item.location", () => {
    const item = {
      summary: "Trail w/ SomeHare - Somewhere",
      location: "123 Main St, Washington, DC",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "EWH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Trail");
    expect(event!.hares).toBe("SomeHare");
    expect(event!.location).toBe("123 Main St, Washington, DC");
  });

  it("rejects placeholder values in w/ captures", () => {
    const item = {
      summary: "Hash Run w/ TBD - TBA",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Hash Run");
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBeUndefined();
  });
});

// ── Dash-separated title cleanup ──

describe("buildRawEventFromGCalItem — dash-separated hare/location extraction", () => {
  it("extracts hares from ' - Hare: Name' suffix", () => {
    const item = {
      summary: "H5 Hash Run#2297 - Makiki District Park - Hare: Double Dipped Tip",
      location: "Makiki District Park",
      start: { dateTime: "2026-03-31T17:00:00-10:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "H5" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Double Dipped Tip");
    expect(event!.title).toBe("H5 Hash Run#2297");
  });

  it("extracts hares from ' - Hares: Names' suffix (OCHHH)", () => {
    const item = {
      summary: "OCHHH - Hares: Some Really Cool Peeps",
      start: { dateTime: "2026-04-05T17:00:00-07:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "OCHHH" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Some Really Cool Peeps");
    expect(event!.title).toBe("OCHHH");
  });

  it("extracts hares from 'Name - Location TBD' (EWH3 placeholder)", () => {
    const item = {
      summary: "Captain Jack Swallows - Location TBD",
      start: { dateTime: "2026-04-09T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "EWH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Captain Jack Swallows");
    expect(event!.title).toBe("EWH3");
  });

  it("extracts hares from 'hared by Name' suffix (Voodoo H3)", () => {
    const item = {
      summary: "Voodoo Trail #1032 hared by The Iceman Thumbeth",
      start: { dateTime: "2026-03-12T23:30:00Z" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "VOO" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("The Iceman Thumbeth");
    expect(event!.title).toBe("Voodoo Trail #1032");
  });

  it("replaces address-as-title with kennel tag", () => {
    const item = {
      summary: "11385 Pioneer Road, Tustin, CA",
      start: { dateTime: "2026-04-08T18:30:00-07:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "OC Hump" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("OC Hump");
    expect(event!.location).toBe("11385 Pioneer Road, Tustin, CA");
  });

  it("skips CTA placeholder events (title is 'Hares needed')", () => {
    const item = {
      summary: "Hares needed! Email the Hare Razor <ewh3harerazor@gmail.com>!",
      start: { dateTime: "2026-04-23T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "EWH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).toBeNull();
  });

  it("strips known location suffix from title", () => {
    const item = {
      summary: "Hash Run #100 - Central Park",
      location: "Central Park",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "TEST" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Hash Run #100");
    expect(event!.location).toBe("Central Park");
  });
});

describe("buildRawEventFromGCalItem — non-English country name stripping", () => {
  it("strips French country suffix from location", () => {
    const item = {
      summary: "FCH3 Hash Run",
      location: "Lucien Morin Park, 1135 Empire Blvd, Rochester, NY 14609, États-Unis",
      start: { dateTime: "2026-04-01T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "FCH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.location).toBe("Lucien Morin Park, 1135 Empire Blvd, Rochester, NY 14609");
  });
});

// ── extractWhatFieldFromDescription + 4X2H4 / Chicagoland title fix (#496) ──

describe("extractWhatFieldFromDescription", () => {
  it("captures the value of a `What:` line", () => {
    expect(extractWhatFieldFromDescription("What: 4x2 H4 No. 124\nWhen: Tuesday 4/7"))
      .toBe("4x2 H4 No. 124");
  });

  it("is case-insensitive", () => {
    expect(extractWhatFieldFromDescription("WHAT: Some Trail Name")).toBe("Some Trail Name");
  });

  it("returns undefined when no What: line is present", () => {
    expect(extractWhatFieldFromDescription("Hare: Bob\nWhere: Park")).toBeUndefined();
  });

  it("returns undefined for an empty value", () => {
    expect(extractWhatFieldFromDescription("What: \nWhere: Park")).toBeUndefined();
  });

  it("does not match `What` embedded mid-line", () => {
    expect(extractWhatFieldFromDescription("Look at What: this looks like")).toBeUndefined();
  });

  it("does not match a word that ends in `What` (e.g. `SoWhat:`)", () => {
    // \b before `What` rejects mid-word matches even when the line otherwise
    // looks label-shaped — the value here is on its own line.
    expect(extractWhatFieldFromDescription("foo\nSoWhat: trail")).toBeUndefined();
  });

  it("does not match a word that starts with `What` (e.g. `WhatNot:`)", () => {
    expect(extractWhatFieldFromDescription("WhatNot: trail")).toBeUndefined();
  });
});

describe("buildRawEventFromGCalItem — 4X2H4 stale-default title fix (#496/#497)", () => {
  // Mirrors the live Chicagoland calendar 4X2H4 event shape:
  //   SUMMARY = "4X2 H4" (the kennel slug, not a real title)
  //   DESCRIPTION carries the canonical name in `What:` and the run number too
  // The kennelPatterns map "4X2|4x2" → "4x2h4", so kennelTag = "4x2h4" and the
  // SUMMARY-vs-tag equality used to fail (whitespace mismatch), leaving every
  // event titled "4X2 H4". The fix relaxes that comparison and prefers
  // `What:` over the generic first-non-label heuristic.
  const item = {
    summary: "4X2 H4",
    description: "What: 4x2 H4 No. 124\nWhen: Tuesday 4/7, 6:30 pm, on-out at 7:00 sharp!\nWhere: Life on Marz Community Club\nHare: Lifa",
    location: "Life on Marz Community Club",
    start: { dateTime: "2026-04-07T18:30:00-05:00" },
    status: "confirmed",
  };
  const config = {
    kennelPatterns: [["4X2|4x2", "4x2h4"]] as [string, string][],
    defaultKennelTag: "ch3",
    runNumberPatterns: [String.raw`What:\s*4x2\s*H4\s*No\.?\s*(\d+)`],
  };

  it("extracts the title from the `What:` line", () => {
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("4x2 H4 No. 124");
  });

  it("extracts the run number from the description via runNumberPatterns", () => {
    // Caller (the adapter) pre-compiles patterns once per scrape and threads them in.
    const compiledRunNumberPatterns = [/What:\s*4x2\s*H4\s*No\.?\s*(\d+)/i];
    const event = buildRawEventFromGCalItem(item, config, undefined, compiledRunNumberPatterns);
    expect(event!.runNumber).toBe(124);
  });

  it("still extracts hares from the existing Hare: line", () => {
    const event = buildRawEventFromGCalItem(item, config);
    expect(event!.hares).toBe("Lifa");
  });

  it("falls back to defaultTitle when description has no What: line", () => {
    const noWhat = { ...item, description: "When: Tuesday 4/7\nHare: Lifa" };
    const event = buildRawEventFromGCalItem(noWhat, { ...config, defaultTitle: "4x2 H4 Trail" });
    expect(event!.title).toBe("4x2 H4 Trail");
  });

  it("leaves the title as the SUMMARY when no fallback is configured and no What: line exists", () => {
    const noWhat = { ...item, description: "When: Tuesday 4/7" };
    const event = buildRawEventFromGCalItem(noWhat, config);
    // No What:, no defaultTitle → title stays as the SUMMARY
    expect(event!.title).toBe("4X2 H4");
  });
});

describe("endTime extraction (#504)", () => {
  it("extracts local HH:MM from end.dateTime", () => {
    const event = buildRawEventFromGCalItem(
      testGCalEvent({
        start: { dateTime: "2026-08-15T10:00:00-07:00" },
        end: { dateTime: "2026-08-15T13:00:00-07:00" },
      }),
      { defaultKennelTag: "test" },
    );
    expect(event!.startTime).toBe("10:00");
    expect(event!.endTime).toBe("13:00");
  });

  it("leaves endTime undefined for all-day events", () => {
    const event = buildRawEventFromGCalItem(
      testGCalEvent({
        start: { date: "2026-08-15" },
        end: { date: "2026-08-16" },
      }),
      { defaultKennelTag: "test", includeAllDayEvents: true },
    );
    expect(event!.endTime).toBeUndefined();
  });

  it("leaves endTime undefined when end is missing", () => {
    const event = buildRawEventFromGCalItem(testGCalEvent(), { defaultKennelTag: "test" });
    expect(event!.endTime).toBeUndefined();
  });

  it("suppresses endTime when end is on a different calendar day (overnight run)", () => {
    const event = buildRawEventFromGCalItem(
      testGCalEvent({
        start: { dateTime: "2026-08-15T22:00:00-07:00" },
        end: { dateTime: "2026-08-16T02:00:00-07:00" },
      }),
      { defaultKennelTag: "test" },
    );
    expect(event!.startTime).toBe("22:00");
    expect(event!.endTime).toBeUndefined();
  });
});

// ── parseInlineHareline (#498) ──
//
// Live Chicagoland calendar only populates the soonest-upcoming 4X2H4 event's
// description. That one description contains a `4x2 H4 Hareline:` block
// listing future dates and their hares. Parse it into a map that a scrape
// post-pass can use to back-fill hares onto events whose own descriptions
// came back empty.

describe("parseInlineHareline", () => {
  const SAMPLE = [
    "What: 4x2 H4 No. 124",
    "Hare: Lifa",
    "",
    "4x2 H4 Hareline:",
    "Tue 5/5: Oh Die Mark!",
    "Tue 6/2:",
    "Tue 7/7:",
    "Tue 8/3: Bert's Special Friend & Meat Inside Her",
    "Tue 9/1:",
    "",
    "Find us on Facebook:",
    "https://www.facebook.com/groups/833761823403207",
  ].join("\n");

  it("captures populated dates and skips empty ones", () => {
    const map = parseInlineHareline(SAMPLE, "4x2 H4 Hareline:");
    expect(map).toEqual({
      "5/5": "Oh Die Mark!",
      "8/3": "Bert's Special Friend & Meat Inside Her",
    });
  });

  it("returns an empty map when the header is missing", () => {
    const map = parseInlineHareline("Hare: Lifa\nWhere: Park", "4x2 H4 Hareline:");
    expect(map).toEqual({});
  });

  it("returns an empty map when every entry is empty", () => {
    const onlyEmpty = "4x2 H4 Hareline:\nTue 5/5:\nTue 6/2:\nTue 7/7:";
    expect(parseInlineHareline(onlyEmpty, "4x2 H4 Hareline:")).toEqual({});
  });

  it("tolerates blank lines within the block", () => {
    // Earlier behavior stopped parsing at the first blank line, which was
    // fragile to accidental double-newlines in calendar descriptions. The
    // loop now runs until end-of-input; blank lines are simply skipped.
    const withBlank = [
      "4x2 H4 Hareline:",
      "Tue 5/5: Hare A",
      "",
      "Tue 6/2: Hare B",
    ].join("\n");
    expect(parseInlineHareline(withBlank, "4x2 H4 Hareline:")).toEqual({
      "5/5": "Hare A",
      "6/2": "Hare B",
    });
  });

  it("treats placeholder hare values like TBD / Pending / None as empty", () => {
    const withPlaceholders = [
      "4x2 H4 Hareline:",
      "Tue 5/5: TBD",
      "Tue 6/2: Needed",
      "Tue 7/7: tba",
      "Tue 8/3: None",
      "Tue 9/1: Pending",
      "Tue 10/6: Real Hare",
    ].join("\n");
    expect(parseInlineHareline(withPlaceholders, "4x2 H4 Hareline:")).toEqual({
      "10/6": "Real Hare",
    });
  });

  it("skips non-hareline lines between entries without terminating the block", () => {
    // `Find us on Facebook:` and URLs don't match HARELINE_LINE_RE so they're
    // silently skipped; the block only terminates on a blank line after entries.
    const withJunk = [
      "4x2 H4 Hareline:",
      "Tue 5/5: Hare A",
      "Find us on Facebook:",  // not a hareline line → skip, don't terminate
      "Tue 6/2: Hare B",
    ].join("\n");
    expect(parseInlineHareline(withJunk, "4x2 H4 Hareline:")).toEqual({
      "5/5": "Hare A",
      "6/2": "Hare B",
    });
  });

  it("ignores leading blank lines before any entries", () => {
    const leadingBlank = "4x2 H4 Hareline:\n\nTue 5/5: Hare A";
    expect(parseInlineHareline(leadingBlank, "4x2 H4 Hareline:")).toEqual({ "5/5": "Hare A" });
  });

  it("zero-pads dates only when the input does (keys match `M/D` not `MM/DD`)", () => {
    // Single-digit months and days are stored without padding so they match
    // event dates after we parseInt them, not string-prefix them.
    const padded = "4x2 H4 Hareline:\nTue 05/05: Hare A\nTue 12/31: Hare B";
    expect(parseInlineHareline(padded, "4x2 H4 Hareline:")).toEqual({
      "5/5": "Hare A",
      "12/31": "Hare B",
    });
  });
});

describe("applyInlineHarelineBackfill (#498)", () => {
  const donorDescription = [
    "What: 4x2 H4 No. 124",
    "Hare: Lifa",
    "",
    "4x2 H4 Hareline:",
    "Tue 5/5: Oh Die Mark!",
    "Tue 8/3: Bert's Special Friend & Meat Inside Her",
  ].join("\n");

  function makeEvent(overrides: Partial<RawEventData>): RawEventData {
    return {
      date: "2026-04-07",
      kennelTag: "4x2h4",
      title: "4x2 H4 No. 124",
      ...overrides,
    };
  }

  const pattern = { kennelTag: "4x2h4", blockHeader: "4x2 H4 Hareline:" };
  // Pin the reference `now` so donor selection is deterministic across all tests
  // (we filter on `e.date >= today`).
  const now = new Date("2026-04-07T00:00:00Z");

  it("back-fills hares on matching-date events with empty hares", () => {
    const events = [
      makeEvent({ date: "2026-04-07", hares: "Lifa", description: donorDescription }),
      makeEvent({ date: "2026-05-05" }),
      makeEvent({ date: "2026-08-03" }),
    ];
    const count = applyInlineHarelineBackfill(events, pattern, { now });
    expect(count).toBe(2);
    expect(events[0].hares).toBe("Lifa"); // donor unchanged
    expect(events[1].hares).toBe("Oh Die Mark!");
    expect(events[2].hares).toBe("Bert's Special Friend & Meat Inside Her");
  });

  it("never overwrites events that already have hares", () => {
    const events = [
      makeEvent({ date: "2026-04-07", hares: "Lifa", description: donorDescription }),
      makeEvent({ date: "2026-05-05", hares: "Existing Hare" }),
    ];
    applyInlineHarelineBackfill(events, pattern, { now });
    expect(events[1].hares).toBe("Existing Hare");
  });

  it("ignores events for other kennels", () => {
    const events = [
      makeEvent({ date: "2026-04-07", hares: "Lifa", description: donorDescription }),
      makeEvent({ date: "2026-05-05", kennelTag: "ch3" }),
    ];
    applyInlineHarelineBackfill(events, pattern, { now });
    expect(events[1].hares).toBeUndefined();
  });

  it("returns 0 when no donor event exists", () => {
    const events = [
      makeEvent({ date: "2026-05-05" }),
      makeEvent({ date: "2026-08-03" }),
    ];
    expect(applyInlineHarelineBackfill(events, pattern, { now })).toBe(0);
    expect(events[0].hares).toBeUndefined();
  });

  it("returns 0 when the pattern is null or undefined", () => {
    const events = [makeEvent({ description: donorDescription })];
    expect(applyInlineHarelineBackfill(events, null, { now })).toBe(0);
    expect(applyInlineHarelineBackfill(events, undefined, { now })).toBe(0);
  });

  // ── Regressions for Codex adversarial review findings ──

  it("prefers the soonest-upcoming donor over a past stale donor", () => {
    // Past event still carries a hareline block that lists STALE hares — if
    // we naively pick the first matching donor, the stale block wins and
    // upcoming events get wrong hares. The correct donor is the soonest
    // upcoming event for the target kennel.
    const staleDonor = [
      "4x2 H4 Hareline:",
      "Tue 5/5: STALE HARE (wrong)",
      "Tue 8/3: STALE HARE (wrong)",
    ].join("\n");
    const events = [
      makeEvent({ date: "2026-01-06", hares: "Old Hasher", description: staleDonor }),
      makeEvent({ date: "2026-04-07", hares: "Lifa", description: donorDescription }),
      makeEvent({ date: "2026-05-05" }),
      makeEvent({ date: "2026-08-03" }),
    ];
    applyInlineHarelineBackfill(events, pattern, { now });
    // Events pulled from the current (April) donor, not the stale January one
    expect(events[2].hares).toBe("Oh Die Mark!");
    expect(events[3].hares).toBe("Bert's Special Friend & Meat Inside Her");
  });

  it("year-scopes back-fill so multi-year scrape windows don't collide", () => {
    // A ±365-day scrape window can contain both 2026-05-05 and 2027-05-05.
    // The hareline's 5/5 entry belongs to the donor's year only; the next
    // year's same-date event must NOT receive those hares.
    const events = [
      makeEvent({ date: "2026-04-07", hares: "Lifa", description: donorDescription }),
      makeEvent({ date: "2026-05-05" }), // should get hares
      makeEvent({ date: "2027-05-05" }), // must NOT get hares
    ];
    applyInlineHarelineBackfill(events, pattern, { now });
    expect(events[1].hares).toBe("Oh Die Mark!");
    expect(events[2].hares).toBeUndefined();
  });

  it("rolls entries into the next year when donor is late-year", () => {
    // Donor is 2026-11-01 and the hareline lists an entry for 1/7 — that
    // must resolve to 2027-01-07 (first occurrence at or after the donor),
    // not 2026-01-07 (which would be in the past).
    const lateDonor = [
      "4x2 H4 Hareline:",
      "Tue 1/7: New Year Hare",
    ].join("\n");
    const events = [
      makeEvent({ date: "2026-01-07" }), // in the past relative to donor → NO match
      makeEvent({ date: "2026-11-01", hares: "Late Year Hare", description: lateDonor }),
      makeEvent({ date: "2027-01-07" }), // the correct target
    ];
    applyInlineHarelineBackfill(events, pattern, { now: new Date("2026-10-01T00:00:00Z") });
    expect(events[0].hares).toBeUndefined();
    expect(events[2].hares).toBe("New Year Hare");
  });

  it("returns 0 when no target events match by date", () => {
    const events = [
      makeEvent({ date: "2026-04-07", hares: "Lifa", description: donorDescription }),
      makeEvent({ date: "2026-06-02" }), // empty in the hareline block
      makeEvent({ date: "2026-09-01" }), // empty too
    ];
    expect(applyInlineHarelineBackfill(events, pattern, { now })).toBe(0);
  });
});

// ── normalizeGCalDescription ──

describe("normalizeGCalDescription", () => {
  it("strips Harrier Central boilerplate prefix from GCal-synced descriptions (#724)", () => {
    const raw = "Morgantown H3\nLocation: WVU Coliseum\nDescription: In case yall don't know, I'm conquering a marathon in each state!";
    const result = normalizeGCalDescription(raw);
    expect(result.description).toBe("In case yall don't know, I'm conquering a marathon in each state!");
    expect(result.description).not.toContain("Morgantown H3");
    expect(result.description).not.toContain("Location:");
    expect(result.description).not.toContain("Description:");
  });

  it("strips HC boilerplate when description spans multiple lines", () => {
    const raw = "Tokyo H3\nLocation: Waseda Station\nDescription: Meet at the west exit.\nBring cash.";
    const result = normalizeGCalDescription(raw);
    expect(result.description).toBe("Meet at the west exit.\nBring cash.");
    expect(result.description).not.toContain("Tokyo H3");
  });

  it("does not alter normal GCal descriptions without HC boilerplate", () => {
    const raw = "A beautiful trail through the park\nHare: Indiana Bones\nWhere: Central Park";
    const result = normalizeGCalDescription(raw);
    expect(result.description).toContain("A beautiful trail through the park");
    expect(result.description).toContain("Hare: Indiana Bones");
  });

  it("does not strip when Location: appears mid-description (not in HC header position)", () => {
    const raw = "Trail notes\nLocation: Central Park — meet at the fountain\nBring water";
    const result = normalizeGCalDescription(raw);
    // No "Description:" label after Location:, so it is NOT the HC boilerplate pattern
    expect(result.description).toContain("Trail notes");
  });
});

describe("buildRawEventFromGCalItem — trailing dash + defaultTitle (#756 Moooouston)", () => {
  it("strips trailing dash and applies defaultTitle when the result equals the kennelTag", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "Moooouston H3 -" }),
      {
        kennelPatterns: [["Moooouston", "moooouston-h3"]],
        defaultTitle: "Moooouston H3 Trail",
      },
    );
    expect(result?.title).toBe("Moooouston H3 Trail");
  });

  it.each([
    ["en-dash", "–"],
    ["em-dash", "—"],
  ])("strips trailing %s too", (_label, dash) => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: `Moooouston H3 ${dash}` }),
      {
        kennelPatterns: [["Moooouston", "moooouston-h3"]],
        defaultTitle: "Moooouston H3 Trail",
      },
    );
    expect(result?.title).toBe("Moooouston H3 Trail");
  });

  it("defaultTitles map scopes fallback per-kennel on aggregator calendars", () => {
    const config = {
      kennelPatterns: [
        ["Moooouston", "moooouston-h3"],
        ["Mosquito", "mosquito-h3"],
      ] as [string, string][],
      defaultTitles: { "moooouston-h3": "Moooouston H3 Trail" },
    };
    const moo = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "Moooouston H3 -" }),
      config,
    );
    const skeeter = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "Mosquito" }),
      config,
    );
    expect(moo?.title).toBe("Moooouston H3 Trail");
    // Mosquito has no entry in defaultTitles — no fallback, title stays as kennel tag slug
    expect(skeeter?.title).toBe("Mosquito");
  });
});

describe("buildRawEventFromGCalItem — trailing dash after titleFromDescription (#815 GyNO)", () => {
  it("scrubs trailing ' -' when a What: field pulled from description carries the delimiter", () => {
    // Repro: GCal summary is bare kennel tag, so title is replaced by the
    // `What:` field from the description. If that value ends with ' -' the
    // earlier trailing-dash strip (runs before the substitution) misses it.
    const result = buildRawEventFromGCalItem(
      testGCalEvent({
        summary: "GyNO",
        description:
          "What: GyNO H3 4/20 Trail -\nLocation: Belvedere Park, 672 S. Belvedere Blvd., Memphis, TN 38104",
      }),
      { kennelPatterns: [["GyNO", "gynoh3"]] },
    );
    expect(result?.title).toBe("GyNO H3 4/20 Trail");
  });
});

describe("buildRawEventFromGCalItem — audit Round 2 (#796 #798 #799 #800)", () => {
  const pedal = { kennelPatterns: [["Bash", "pedal-files"]] as [string, string][], defaultTitle: "Bash" };
  const wasatch = { kennelPatterns: [["wasatch", "wasatch-h3"]] as [string, string][], defaultTitles: { "wasatch-h3": "Wasatch H3 Trail" } };
  const dayton = { kennelPatterns: [["DH[34]", "dh4"]] as [string, string][], defaultTitle: "Dayton H4 Trail" };
  const april = { kennelPatterns: [["April", "wasatch-h3"]] as [string, string][], defaultTitle: "Wasatch H3 Trail" };
  const numeric = { kennelPatterns: [["1144", "wasatch-h3"]] as [string, string][], defaultTitles: { "wasatch-h3": "Wasatch H3 Trail" } };

  it.each([
    ["strips trailing '- tbd' placeholder then applies defaultTitle (#799 Pedal Files)", "Bash - tbd", pedal, "Bash"],
    ["strips trailing '- TBA' placeholder too (#799)", "Bash - TBA", pedal, "Bash"],
    ["strips trailing '- TBC' placeholder too (#799)", "Bash - TBC", pedal, "Bash"],
    ["substitutes defaultTitle for bare '{kennelCode} #N' (#796 Wasatch)", "wasatch #1144", wasatch, "Wasatch H3 Trail #1144"],
    ["substitutes defaultTitle for '{kennelCode}#N' no-space variant (#800 Dayton)", "DH3#1663", dayton, "Dayton H4 Trail #1663"],
    ["substitutes defaultTitle for '{kennelCode} #N' with space (#800 Dayton)", "DH3 #1663", dayton, "Dayton H4 Trail #1663"],
    ["leaves multi-word titles alone even with defaultTitle set (#796 guard)", "April Hash", april, "April Hash"],
    ["leaves already-canonical 'DefaultTitle #N' titles unchanged (#796 guard)", "Wasatch H3 Trail #1144", wasatch, "Wasatch H3 Trail #1144"],
    ["leaves bare-number-only titles alone (#796 guard — no letter prefix)", "1144", numeric, "1144"],
  ] as const)("%s", (_name, summary, config, expected) => {
    const result = buildRawEventFromGCalItem(testGCalEvent({ summary }), config);
    expect(result?.title).toBe(expected);
  });

  it.each([
    ["drops location when it's an 'inquire for location' email CTA (#798 ABQ)", "Inquire for location: abqh3misman@gmail.com"],
    ["drops location when it's a bare email address (#798)", "abqh3misman@gmail.com"],
  ])("%s", (_name, location) => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "ABQ Hash #42", location }),
      { defaultKennelTag: "abq-h3" },
    );
    expect(result?.location).toBeUndefined();
  });
});

describe("buildRawEventFromGCalItem — strictKennelRouting (#753 WA Hash)", () => {
  // `defaultKennelTag` is set alongside strict routing to prove the strict flag
  // actually short-circuits the fallback, not merely that no fallback exists.
  const config = {
    kennelPatterns: [[String.raw`Seattle H3|\bSH3\b`, "seattle-h3"]] as [string, string][],
    defaultKennelTag: "wa-hash",
    strictKennelRouting: true,
  };

  it("drops events whose summary matches no kennel pattern under strict routing", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "Lexi's surgery" }),
      config,
    );
    expect(result).toBeNull();
  });

  it("retains events that match a kennel pattern under strict routing", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "Seattle H3 #500" }),
      config,
    );
    expect(result?.kennelTag).toBe("seattle-h3");
  });

  it("falls back to defaultKennelTag when strictKennelRouting is not set", () => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "Random Event" }),
      {
        kennelPatterns: [[String.raw`Seattle H3|\bSH3\b`, "seattle-h3"]],
        defaultKennelTag: "wa-hash",
      },
    );
    expect(result?.kennelTag).toBe("wa-hash");
  });
});

describe("buildRawEventFromGCalItem — location sanitization (#743 SWH3)", () => {
  // Trailing-only strip: mid-string digits (e.g. "Suite 1 800 555 1234 Main St")
  // are preserved verbatim as the address.
  it.each([
    ["trailing phone", "123 Main St, Raleigh NC 919-555-1234", "123 Main St, Raleigh NC"],
    ["parenthetical CTA", "Raleigh Beer Garden (text for details)", "Raleigh Beer Garden"],
    ["phone + CTA together", "Raleigh Beer Garden 919-555-1234 (call for details)", "Raleigh Beer Garden"],
    ["mid-string digits preserved", "Suite 1 800 555 1234 Main St", "Suite 1 800 555 1234 Main St"],
  ])("%s", (_label, location, expected) => {
    const result = buildRawEventFromGCalItem(
      testGCalEvent({ summary: "SWH3 Run", location }),
      { defaultKennelTag: "swh3" },
    );
    expect(result?.location).toBe(expected);
  });
});

describe("extractHares — bare 10-digit phone strip (#742 BAH3, #809)", () => {
  it.each([
    ["bare 10-digit suffix", "Hares: Slick Willy 2406185563", "Slick Willy"],
    ["formatted phone suffix", "Hares: Slick Willy 240-618-5563", "Slick Willy"],
    ["mid-string phone + commentary", "Hares: Any Cock'll Do Me, 2406185563 CALL for same day service", "Any Cock'll Do Me"],
    ["mid-string formatted phone", "Hares: Slick Willy 240-618-5563 text for address", "Slick Willy"],
    ["phone with 'Phone:' label", "Hares: Slick Willy, phone: 2406185563 for details", "Slick Willy"],
  ])("%s", (_label, desc, expected) => {
    expect(extractHares(desc)).toBe(expected);
  });
});

describe("extractLocationFromDescription — hash-vernacular labels (#742)", () => {
  it.each([
    ["De'erections", "De'erections: 123 Main St"],
    ["Deerections", "Deerections: 123 Main St"],
    ["Direcshits", "Direcshits: 123 Main St"],
    ["Where to gather", "Where to gather: 123 Main St"],
  ])("extracts location from %s label", (_label, desc) => {
    expect(extractLocationFromDescription(desc)).toBe("123 Main St");
  });
});

// ── Audit Round 3 — #774 BJH3 cost + WHO ARE THE HARES + #779 BMPH3 coord-only location ──

describe("extractCostFromDescription (#774)", () => {
  it.each([
    ["bare integer gets $ prefix", "Hash Cash: 5", "$5"],
    ["WHAT IS THE COST template variant", "WHAT IS THE COST: $7", "$7"],
    ["Cost: Free passes through", "Cost: Free", "Free"],
    ["decimal bare number", "Price: 10.50", "$10.50"],
    ["already prefixed $ kept verbatim", "Hash Cash: $10 cash", "$10 cash"],
    ["non-USD currency preserved", "Cost: €10", "€10"],
    // #861 BDH3 uses "How much: $6" phrasing — add to label alternation.
    ["How much: $6 (BDH3 #861)", "How much: $6", "$6"],
    ["How much: bare integer gets $ prefix", "How much: 7", "$7"],
  ])("%s", (_label, desc, expected) => {
    expect(extractCostFromDescription(desc)).toBe(expected);
  });

  it("returns undefined when no cost label present", () => {
    expect(extractCostFromDescription("Hares: Slick Willy\nLocation: 123 Main")).toBeUndefined();
  });

  it("returns undefined for placeholder values", () => {
    expect(extractCostFromDescription("Hash Cash: TBD")).toBeUndefined();
  });

  it("truncates at embedded next-field label (HTML-collapsed)", () => {
    // When HTML stripping collapses fields onto one line, EVENT_FIELD_LABEL_RE
    // truncates at the next recognized label so the value doesn't leak.
    expect(extractCostFromDescription("Hash Cash: $5 When: 6pm")).toBe("$5");
  });
});

describe("extractHares — WHO ARE THE HARES template (#774 BJH3)", () => {
  it("captures hare name from WHO ARE THE HARES: label", () => {
    expect(extractHares("WHO ARE THE HARES: Leeroy")).toBe("Leeroy");
  });

  it("captures multiple hares from WHO ARE THE HARES: label", () => {
    expect(extractHares("WHO ARE THE HARES: Leeroy & Jenkins")).toBe(
      "Leeroy & Jenkins",
    );
  });

  it("matches case-insensitively", () => {
    expect(extractHares("Who Are The Hares: Leeroy")).toBe("Leeroy");
  });
});

describe("buildRawEventFromGCalItem — coord-only item.location (#779 BMPH3)", () => {
  it("clears coord-only location and populates lat/lng from item.location", () => {
    const item = {
      summary: "BMPH3 Trail",
      description: "Start: Rue de la Gare, 1332 Genval\nHares: Tester",
      location: "50.7234, 4.5123",
      start: { dateTime: "2026-04-05T14:00:00+02:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "bmph3-be" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.latitude).toBe(50.7234);
    expect(event!.longitude).toBe(4.5123);
    // Coord-only text cleared → description fallback surfaces the real address
    expect(event!.location).toBe("Rue de la Gare, 1332 Genval");
  });

  it("discards out-of-range coord strings (description fallback takes over)", () => {
    const item = {
      summary: "BMPH3 Trail",
      description: "Hares: Tester",
      location: "999.0, 4.5123",
      start: { dateTime: "2026-04-05T14:00:00+02:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "bmph3-be" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.latitude).toBeUndefined();
    expect(event!.longitude).toBeUndefined();
  });

  it("leaves real address item.location alone", () => {
    const item = {
      summary: "Trail",
      description: "Hares: Tester",
      location: "123 Main St, Philadelphia, PA",
      start: { dateTime: "2026-04-05T14:00:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "bmph3-be" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.latitude).toBeUndefined();
    expect(event!.longitude).toBeUndefined();
    expect(event!.location).toBe("123 Main St, Philadelphia, PA");
  });

  it("populates cost from description when label present", () => {
    const item = {
      summary: "BJ Invasion",
      description: "WHO ARE THE HARES: Leeroy\nHash Cash: 5",
      start: { dateTime: "2026-04-05T14:00:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "bjh3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.cost).toBe("$5");
    expect(event!.hares).toBe("Leeroy");
  });
});

// ── #938 Chicagoland routing: C2B3H4 + strictKennelRouting ──

describe("Chicagoland Hash Calendar routing (#938)", () => {
  const source = SOURCES.find((s) => s.name === "Chicagoland Hash Calendar");
  if (!source?.config) throw new Error("Chicagoland Hash Calendar seed config missing");
  const config = source.config as { kennelPatterns: [string, string][]; strictKennelRouting?: boolean };

  it.each([
    ["C2B3H4 - We're back, bitches", "c2b3h4"],
    ["C2B3H4 #2", "c2b3h4"],
    ["C2B3 #5", "c2b3h4"],
    ["Chicago H3 #1234", "ch3"],
    ["CH3 - Slashie themed", "ch3"],
    ["TH3 #99", "th3"],
    ["4X2 H4 No. 124", "4x2h4"],
    ["BDH3 #200", "bdh3"],
  ])("routes %j → %s", (summary, expectedTag) => {
    const result = buildRawEventFromGCalItem(
      { summary, start: { dateTime: "2026-04-15T19:00:00-05:00" }, status: "confirmed" },
      config,
    );
    expect(result?.kennelTag).toBe(expectedTag);
  });

  it("drops C2B3H4 placeholder 'HARE NEEDED' events (CTA filter)", () => {
    const result = buildRawEventFromGCalItem(
      { summary: "C2B3H4 - HARE NEEDED", start: { dateTime: "2026-04-15T19:00:00-05:00" }, status: "confirmed" },
      config,
    );
    expect(result).toBeNull();
  });

  it("routes unmatched events to chicago-h3 default (Hash Ball, Drinking Practice, etc.)", () => {
    // Non-routing-matched events default to ch3 — they're calendar-wide social
    // or special events hosted by Chicago H3 (e.g. "Hash Ball 2026"). The
    // pre-fix C2B3H4 leak is closed by the explicit kennelPattern, not by
    // dropping unmatched titles.
    const result = buildRawEventFromGCalItem(
      { summary: "Hash Ball 2026", start: { dateTime: "2026-12-31T19:00:00-05:00" }, status: "confirmed" },
      config,
    );
    expect(result?.kennelTag).toBe("ch3");
  });
});

// ── #924 extractLocationFromDescription instructional-text filter ──

describe("extractLocationFromDescription — #924 instructional text filter", () => {
  it.each<[string, string, string | undefined]>([
    ["themed prose (Chicagoland C2B3H4 case)", "WHERE: Slashie themed, so start is Ola's on Damen. Carry your shit & bring cash", undefined],
    ["'carry your X' phrase", "WHERE: Meet at the bar and carry your gear", undefined],
    ["'bring cash' phrase", "WHERE: The Pub. Bring cash, no cards", undefined],
    ["costume keyword", "WHERE: costume required, location TBA", undefined],
    ["preserves Dress Circle Pub (no false positive on 'dress')", "WHERE: Dress Circle Pub", "Dress Circle Pub"],
    ["preserves clean address", "WHERE: 123 Main St, Chicago, IL 60601", "123 Main St, Chicago, IL 60601"],
    ["preserves simple venue name", "WHERE: Portland Saturday Market fountain", "Portland Saturday Market fountain"],
    ["rejects > 100 chars", "WHERE: " + "x".repeat(120), undefined],
  ])("%s", (_label, input, expected) => {
    expect(extractLocationFromDescription(input)).toBe(expected);
  });
});

// ── #958 extractTimeFromTitle (NOH3 social events) ──

describe("extractTimeFromTitle (#958)", () => {
  it.each<[string, string | undefined]>([
    ["Social @ JBs Fuel Dock, 6pm", "18:00"],
    ["Hash Run 7:30pm", "19:30"],
    ["Morning trail 9:15 AM", "09:15"],
    ["Lunch run 12pm", "12:00"],
    ["Midnight run 12am", "00:00"],
    ["Monday Hash Run", undefined],
    // HH:MM form is matched first because the optional ":MM" group is greedy.
    ["Run 7:30 pm meets at 6pm", "19:30"],
  ])("extractTimeFromTitle(%j) === %j", (input, expected) => {
    expect(extractTimeFromTitle(input)).toBe(expected);
  });

  it("end-to-end: all-day event with title-embedded time gets startTime populated", () => {
    const event = buildRawEventFromGCalItem(
      { summary: "Social @ JBs Fuel Dock, 6pm", start: { date: "2026-04-24" }, status: "confirmed" },
      { defaultKennelTag: "noh3", includeAllDayEvents: true },
    );
    expect(event?.startTime).toBe("18:00");
  });

  it("end-to-end: start.dateTime takes precedence over title-embedded time", () => {
    const event = buildRawEventFromGCalItem(
      { summary: "Hash run 6pm", start: { dateTime: "2026-04-24T19:00:00-05:00" }, status: "confirmed" },
      { defaultKennelTag: "noh3" },
    );
    expect(event?.startTime).toBe("19:00");
  });
});

// ── #939 RRULE horizon cap ──

describe("GoogleCalendarAdapter — RRULE future-horizon cap (#939)", () => {
  const adapter = new GoogleCalendarAdapter();

  function makeSource(config: object = { defaultKennelTag: "test" }) {
    return {
      id: "test-source",
      url: "test@calendar.google.com",
      type: "GOOGLE_CALENDAR" as const,
      config,
      scrapeDays: 365,
    } as unknown as Parameters<typeof adapter.fetch>[0];
  }

  // Spy on fetch, swap in a stub API key, run the adapter, return the
  // captured request URL plus the wall-clock window the call spanned.
  async function runAndCapture(
    source: Parameters<typeof adapter.fetch>[0],
    days: number,
  ): Promise<{ url: URL; before: number; after: number }> {
    const originalKey = process.env.GOOGLE_CALENDAR_API_KEY;
    process.env.GOOGLE_CALENDAR_API_KEY = "test-key";
    let capturedUrl: URL | undefined;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
      capturedUrl = new URL(input as string);
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    try {
      const before = Date.now();
      await adapter.fetch(source, { days });
      const after = Date.now();
      if (!capturedUrl) throw new Error("fetch was not called");
      return { url: capturedUrl, before, after };
    } finally {
      fetchSpy.mockRestore();
      if (originalKey === undefined) delete process.env.GOOGLE_CALENDAR_API_KEY;
      else process.env.GOOGLE_CALENDAR_API_KEY = originalKey;
    }
  }

  it("caps timeMax at now + 180 days even when options.days = 365", async () => {
    const { url, before, after } = await runAndCapture(makeSource(), 365);
    const timeMin = new Date(url.searchParams.get("timeMin")!).getTime();
    const timeMax = new Date(url.searchParams.get("timeMax")!).getTime();
    expect(before - timeMin).toBeGreaterThanOrEqual(364 * 86_400_000);
    expect(after - timeMin).toBeLessThanOrEqual(366 * 86_400_000);
    expect(timeMax - before).toBeLessThanOrEqual(181 * 86_400_000);
    expect(timeMax - after).toBeGreaterThanOrEqual(179 * 86_400_000);
  });

  it("does not artificially extend timeMax when options.days < 180", async () => {
    const { url, before, after } = await runAndCapture(makeSource(), 30);
    const timeMax = new Date(url.searchParams.get("timeMax")!).getTime();
    expect(timeMax - before).toBeLessThanOrEqual(31 * 86_400_000);
    expect(timeMax - after).toBeGreaterThanOrEqual(29 * 86_400_000);
  });

  it("respects per-source futureHorizonDays override (e.g. 365 for annual events)", async () => {
    const wide = makeSource({ defaultKennelTag: "test", futureHorizonDays: 365 });
    const { url, before, after } = await runAndCapture(wide, 365);
    const timeMax = new Date(url.searchParams.get("timeMax")!).getTime();
    expect(timeMax - before).toBeLessThanOrEqual(366 * 86_400_000);
    expect(timeMax - after).toBeGreaterThanOrEqual(364 * 86_400_000);
  });
});
