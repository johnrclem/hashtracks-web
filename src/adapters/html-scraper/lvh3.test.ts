import {
  resolveKennelTag,
  extractLvRunNumber,
  extractLocationFromDescription,
  extractHaresFromDescription,
} from "./lvh3";

describe("resolveKennelTag", () => {
  const patterns: [string, string][] = [
    ["lvhhh", "lv-h3"],
    ["assh3", "ass-h3"],
  ];

  it("matches LVHHH category to lv-h3", () => {
    expect(resolveKennelTag(["LVHHH", "Trails"], patterns, "lv-h3")).toBe("lv-h3");
  });

  it("matches ASSH3 category to ass-h3", () => {
    expect(resolveKennelTag(["ASSH3", "Trails"], patterns, "lv-h3")).toBe("ass-h3");
  });

  it("case-insensitive matching", () => {
    expect(resolveKennelTag(["Assh3"], patterns, "lv-h3")).toBe("ass-h3");
  });

  it("returns null when no category matches and default is null", () => {
    expect(resolveKennelTag(["RPHHH"], patterns, null)).toBeNull();
  });

  it("returns null on empty categories with null default", () => {
    expect(resolveKennelTag([], patterns, null)).toBeNull();
  });

  it("falls back to string default when provided", () => {
    expect(resolveKennelTag(["RPHHH"], patterns, "lv-h3")).toBe("lv-h3");
  });
});

describe("extractLvRunNumber", () => {
  it("extracts from '#1748 Boys Gone wild'", () => {
    expect(extractLvRunNumber("#1748 Boys Gone wild")).toBe(1748);
  });

  it("extracts from 'ASSH3 Pub Crawl – green mess weekend'", () => {
    expect(extractLvRunNumber("ASSH3 Pub Crawl – green mess weekend")).toBeUndefined();
  });

  it("extracts from 'Trail# 27'", () => {
    expect(extractLvRunNumber("Rat Pack# 27 – Year of the horse")).toBe(27);
  });

  it("returns undefined for plain text", () => {
    expect(extractLvRunNumber("Green Mess Weekend")).toBeUndefined();
  });
});

describe("extractLocationFromDescription", () => {
  it("extracts 'Start location:' venues from the description body", () => {
    const description =
      "Join us this weekend!\nStart location: Modest Brewing Company in the arts district\nHares: Symphomaniac";
    expect(extractLocationFromDescription(description)).toBe(
      "Modest Brewing Company in the arts district",
    );
  });

  it("handles 'Starting location:' with a trailing time marker", () => {
    const description =
      "Pub crawl prep!\nStarting location: Hammered Harry's – 450 Fremont St #140 @ 6:30PM";
    expect(extractLocationFromDescription(description)).toBe(
      "Hammered Harry's – 450 Fremont St #140",
    );
  });

  it("is case-insensitive and handles varied whitespace", () => {
    const description = "  start LOCATION:   The Park @ 7pm";
    expect(extractLocationFromDescription(description)).toBe("The Park");
  });

  it("returns undefined when no location line is present", () => {
    expect(extractLocationFromDescription("Just a blurb about the run.")).toBeUndefined();
  });

  it("preserves venue names containing '@' when not followed by a time", () => {
    // Only strip '@ <digit>...' (time markers). '@' inside a venue name must survive.
    const description = "Start location: Bar @ Downtown Grand\nHares: Symphomaniac";
    expect(extractLocationFromDescription(description)).toBe("Bar @ Downtown Grand");
  });

  it("returns undefined for empty description", () => {
    expect(extractLocationFromDescription(undefined)).toBeUndefined();
    expect(extractLocationFromDescription("")).toBeUndefined();
  });
});

describe("extractHaresFromDescription", () => {
  it("extracts 'Hares- X, Y' lines", () => {
    expect(extractHaresFromDescription("Hares- DIMA, Just Rosa")).toBe("DIMA, Just Rosa");
  });

  it("extracts 'Hares: X' with colon", () => {
    expect(extractHaresFromDescription("Hares: Symphomaniac")).toBe("Symphomaniac");
  });

  it("handles a single 'Hare:' (singular) too", () => {
    expect(extractHaresFromDescription("Hare: Railroad")).toBe("Railroad");
  });

  it("drops pure '???' placeholders", () => {
    expect(extractHaresFromDescription("Hares- ??? (IYKYK)")).toBeUndefined();
  });

  it("drops TBD / TBA / N/A placeholders", () => {
    expect(extractHaresFromDescription("Hares: TBD")).toBeUndefined();
    expect(extractHaresFromDescription("Hares: TBA")).toBeUndefined();
    expect(extractHaresFromDescription("Hares: N/A")).toBeUndefined();
  });

  it("strips trailing '(IYKYK)' marker when names are real", () => {
    expect(extractHaresFromDescription("Hares- Follows Your Anus (IYKYK)")).toBe(
      "Follows Your Anus",
    );
  });

  it("returns undefined when no hare line is present", () => {
    expect(extractHaresFromDescription("See you at the pub crawl!")).toBeUndefined();
  });

  it("returns undefined for long noise values (>200 chars)", () => {
    const long = "x".repeat(250);
    expect(extractHaresFromDescription(`Hares- ${long}`)).toBeUndefined();
  });

  it("returns undefined for empty description", () => {
    expect(extractHaresFromDescription(undefined)).toBeUndefined();
    expect(extractHaresFromDescription("")).toBeUndefined();
  });
});
