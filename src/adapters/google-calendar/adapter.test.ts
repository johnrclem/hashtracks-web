import { describe, it, expect } from "vitest";
import {
  extractKennelTag,
  extractRunNumber,
  extractTitle,
  extractHares,
  extractTitleFromDescription,
  buildRawEventFromGCalItem,
} from "./adapter";

// ── extractKennelTag ──

describe("extractKennelTag", () => {
  it("matches Boston Ball Buster", () => {
    expect(extractKennelTag("Boston Ball Buster #123")).toBe("BoBBH3");
  });

  it("matches BoBBH3 abbreviation", () => {
    expect(extractKennelTag("BoBBH3: Run Name")).toBe("BoBBH3");
  });

  it("matches Beantown", () => {
    expect(extractKennelTag("Beantown #255: Taste of Spring")).toBe("Beantown");
  });

  it("matches Pink Taco", () => {
    expect(extractKennelTag("Pink Taco: Ladies Night")).toBe("Pink Taco");
  });

  it("matches PT2H3 → Pink Taco", () => {
    expect(extractKennelTag("PT2H3: Run")).toBe("Pink Taco");
  });

  it("matches Boston Moon", () => {
    expect(extractKennelTag("Boston Moon: Full Moon Run")).toBe("Bos Moon");
  });

  it("matches Moon keyword", () => {
    expect(extractKennelTag("Full Moon Hash")).toBe("Bos Moon");
  });

  it("matches BoH3", () => {
    expect(extractKennelTag("BoH3: Weekly Run")).toBe("BoH3");
  });

  it("matches BH3", () => {
    expect(extractKennelTag("BH3: Something")).toBe("BoH3");
  });

  it("matches B3H4 → BoBBH3", () => {
    expect(extractKennelTag("B3H4 Run")).toBe("BoBBH3");
  });

  it("falls back to BoH3 for unknown", () => {
    expect(extractKennelTag("Unknown Event Name")).toBe("BoH3");
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

  it("keeps kennel tag as title when description has no usable title", () => {
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
});
