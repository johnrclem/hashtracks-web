import { describe, it, expect } from "vitest";
import {
  extractKennelTag,
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
  buildRawEventFromGCalItem,
} from "./adapter";
import type { RawEventData } from "../types";

// ── extractKennelTag ──

describe("extractKennelTag", () => {
  it("matches Boston Ball Buster", () => {
    expect(extractKennelTag("Boston Ball Buster #123")).toBe("bobbh3");
  });

  it("matches BoBBH3 abbreviation", () => {
    expect(extractKennelTag("BoBBH3: Run Name")).toBe("bobbh3");
  });

  it("matches Beantown", () => {
    expect(extractKennelTag("Beantown #255: Taste of Spring")).toBe("beantown");
  });

  it("matches Pink Taco", () => {
    expect(extractKennelTag("Pink Taco: Ladies Night")).toBe("pink-taco");
  });

  it("matches PT2H3 → pink-taco", () => {
    expect(extractKennelTag("PT2H3: Run")).toBe("pink-taco");
  });

  it("matches Boston Moon", () => {
    expect(extractKennelTag("Boston Moon: Full Moon Run")).toBe("bos-moon");
  });

  it("matches Moon keyword", () => {
    expect(extractKennelTag("Full Moon Hash")).toBe("bos-moon");
  });

  it("matches BoH3", () => {
    expect(extractKennelTag("BoH3: Weekly Run")).toBe("boh3");
  });

  it("matches BH3", () => {
    expect(extractKennelTag("BH3: Something")).toBe("boh3");
  });

  it("matches B3H4 → bobbh3", () => {
    expect(extractKennelTag("B3H4 Run")).toBe("bobbh3");
  });

  it("falls back to boh3 for unknown", () => {
    expect(extractKennelTag("Unknown Event Name")).toBe("boh3");
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

  it("replaces email-in-title with kennel tag", () => {
    const item = {
      summary: "Hares needed! Email the Hare Razor <ewh3harerazor@gmail.com>!",
      start: { dateTime: "2026-04-23T18:30:00-04:00" },
      status: "confirmed",
    };
    const config = { defaultKennelTag: "EWH3" };
    const event = buildRawEventFromGCalItem(item, config);
    expect(event).not.toBeNull();
    expect(event!.title).toBe("EWH3");
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
