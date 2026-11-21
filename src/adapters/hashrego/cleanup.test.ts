import {
  cleanHashRegoCost,
  cleanHashRegoHares,
  cleanHashRegoLocation,
  cleanHashRegoTitle,
} from "./cleanup";

// Real Hash Rego titles from prod (2026-11-20), one per date format seen.
describe("cleanHashRegoTitle", () => {
  it.each([
    [
      "EWH3 #1521: The British are Cumming Trail, June 4, 2026, Dupont Circle (Red Line)",
      "EWH3 #1521: The British are Cumming Trail",
    ],
    [
      "EWH3 #1527: Will Squat for Friends Trail, 7/16/2026, 2026, Huntington Metro (Yellow Line)",
      "EWH3 #1527: Will Squat for Friends Trail",
    ],
    [
      "EWH3 #1529: The Friendship Slip n Slide Trail, 30 July, 2026, Rosslyn Metro (Orange/Silver/Blue Line)",
      "EWH3 #1529: The Friendship Slip n Slide Trail",
    ],
    [
      "EWH3 #1528: Turd’s 10th Hashiversary Trail, July 23rd 2026, East Fall Church (Orange/Silver)",
      "EWH3 #1528: Turd’s 10th Hashiversary Trail",
    ],
    [
      "EWH3 #1549: The “On Wednesdays We Wear Pink” Red Dress Pre-lube Trail, Thursday, October 8th, 2026, Red Line",
      "EWH3 #1549: The “On Wednesdays We Wear Pink” Red Dress Pre-lube Trail",
    ],
    [
      "EWH3 #1533: The 5th Anal Glitter Trail: the Happiest Hash on Earth! August 27, 2026, 2026, Crystal City (Blue/Yellow)",
      "EWH3 #1533: The 5th Anal Glitter Trail: the Happiest Hash on Earth!",
    ],
    [
      "EWH3 #1532: The Back to School, aka Hot for Teacher, Hash, Thursday, August 20, 2026, Friendship Heights (Red Line)",
      "EWH3 #1532: The Back to School, aka Hot for Teacher, Hash",
    ],
    [
      "EWH3 #1551: The Graffiti Hash Trail - Columbia Heights Metro (Green/Yellow)",
      "EWH3 #1551: The Graffiti Hash Trail",
    ],
    [
      "EWH3 [UPDATED] DRINKING PRACTICE - #1554: The Blue Wave Trail, Thursday, November 12th, 2026, Virginia Square Metro (Orange/Silver)",
      "EWH3 DRINKING PRACTICE - #1554: The Blue Wave Trail",
    ],
    ["BFMH3 Green Dress Weekend 2027 2027", "BFMH3 Green Dress Weekend 2027"],
    ["2026 Oregon HHH Spring Campout 2026", "Oregon HHH Spring Campout 2026"],
    ["St. Patrick's Day Pub Crawl, March 14, 2026", "St. Patrick's Day Pub Crawl"],
    ["Red Dress Run - June 4 2026 - Dupont", "Red Dress Run"],
  ])("%s", (input, expected) => {
    expect(cleanHashRegoTitle(input)).toBe(expected);
  });

  it.each([
    "July 4th Hash",
    "NYC 5-Boro Pub Crawl 2026",
    "Party Gras! 2027",
    "The 2nd Anal ABC Trail",
    "June 4, 2026",
    "Red Dress Run - Meet at the Metro",
    "MoA2H3 Red Dress Run",
    // Mid-title dates (adversarial review): the date isn't a tail here.
    "Hashers on May 4 2026 aka Star Wars",
    "Run 2 May 2026 Weekend Bash",
    "Founders Day 31 May 2026 at the Park",
    "Hash (June 4 2026)",
    "Analversary 5/5/25 Campout",
    "Campout (aka June 5, 2026 Weekend)",
    "Hashers on, May 4 2026",
  ])("leaves %s alone", (title) => {
    expect(cleanHashRegoTitle(title)).toBe(title);
  });
});

describe("cleanHashRegoLocation", () => {
  it.each(["Start Location TBA", "TBA", "TBD", "Location TBD", " start location tba. "])(
    "drops placeholder %j",
    (value) => {
      expect(cleanHashRegoLocation(value)).toBeUndefined();
    },
  );

  it("keeps real venues and empty input stays undefined", () => {
    expect(cleanHashRegoLocation("Camp Koinonia")).toBe("Camp Koinonia");
    expect(cleanHashRegoLocation("TBA Brewing Co")).toBe("TBA Brewing Co");
    expect(cleanHashRegoLocation("")).toBeUndefined();
    expect(cleanHashRegoLocation(undefined)).toBeUndefined();
  });
});

describe("cleanHashRegoHares", () => {
  it.each(["TBA", "NA", "N/A", "tbd", "Away: 3:30pm"])("drops placeholder %j", (value) => {
    expect(cleanHashRegoHares(value)).toBeUndefined();
  });

  it("keeps real hare names", () => {
    expect(cleanHashRegoHares("Dick Ender, Cream-n-Jerk")).toBe("Dick Ender, Cream-n-Jerk");
    expect(cleanHashRegoHares("Nail")).toBe("Nail");
  });
});

describe("cleanHashRegoCost", () => {
  it("drops the joke price $6969", () => {
    expect(cleanHashRegoCost("$6969")).toBeUndefined();
    expect(cleanHashRegoCost(" $6969 ")).toBeUndefined();
  });

  it("keeps real prices, including free", () => {
    expect(cleanHashRegoCost("$0")).toBe("$0");
    expect(cleanHashRegoCost("$69.69")).toBe("$69.69");
    expect(cleanHashRegoCost("$69 / $69")).toBe("$69 / $69");
    expect(cleanHashRegoCost("$10")).toBe("$10");
    expect(cleanHashRegoCost("(PayPal @BloomingFools)")).toBe("(PayPal @BloomingFools)");
    expect(cleanHashRegoCost(undefined)).toBeUndefined();
  });
});
