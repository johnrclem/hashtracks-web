import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseVoodooTitle,
  parseVoodooBody,
  parseVoodooTime,
  processVoodooPost,
  VoodooH3Adapter,
} from "./voodoo-h3";
import * as wordpressApi from "../wordpress-api";

vi.mock("../wordpress-api");

describe("parseVoodooTitle", () => {
  it("parses standard numbered title with colon", () => {
    const result = parseVoodooTitle("Trail #1035: The Egg-Stra Dirty Spring Scramble");
    expect(result).toEqual({
      runNumber: 1035,
      trailName: "The Egg-Stra Dirty Spring Scramble",
    });
  });

  it("parses title with colon separator", () => {
    const result = parseVoodooTitle("Trail #1031: Suburban Jungle");
    expect(result).toEqual({
      runNumber: 1031,
      trailName: "Suburban Jungle",
    });
  });

  it("parses title with special characters", () => {
    const result = parseVoodooTitle("Trail #1026: Awards Season!");
    expect(result).toEqual({
      runNumber: 1026,
      trailName: "Awards Season!",
    });
  });

  it("parses title with Unicode smart quotes", () => {
    const result = parseVoodooTitle('Trail #1035: The \u201cEgg-Stra\u201d Dirty Spring Scramble');
    expect(result).toEqual({
      runNumber: 1035,
      trailName: 'The \u201cEgg-Stra\u201d Dirty Spring Scramble',
    });
  });

  it("handles title with no trail name after number", () => {
    const result = parseVoodooTitle("Trail #1031");
    expect(result).toEqual({
      runNumber: 1031,
      trailName: undefined,
    });
  });

  it("falls back to full title when no Trail # pattern", () => {
    const result = parseVoodooTitle("Special Event: Mardi Gras Run");
    expect(result).toEqual({
      trailName: "Special Event: Mardi Gras Run",
    });
  });

  it("returns null for empty string", () => {
    expect(parseVoodooTitle("")).toBeNull();
  });
});

describe("parseVoodooBody", () => {
  const sampleBody = `
Bring: $1 (no coins); Beverages of choice (glass discouraged), whistle, flashlight
Date: Thursday, April 2nd
Time: 6:30pm show, 7:00pm GO!
Start Address: The park across from JB's. 128 S Roadway St., New Orleans, LA  70124
Hare & Co-Hares: Steven with a D and Surprise Co Hare.
Beer Hare: TBD
Pre-Lube: JB's Fuel Dock.
On-After: JB's Fuel Dock.
Dog Friendly: Yes, outdoor area available for dogs.
`;

  it("extracts date", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.date).toBe("Thursday, April 2nd");
  });

  it("extracts time", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.time).toBe("6:30pm show, 7:00pm GO!");
  });

  it("extracts start address", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.location).toBe("The park across from JB's. 128 S Roadway St., New Orleans, LA  70124");
  });

  it("extracts hares", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.hares).toBe("Steven with a D and Surprise Co Hare.");
  });

  it("extracts on-after", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.onAfter).toBe("JB's Fuel Dock.");
  });

  it("extracts pre-lube", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.preLube).toBe("JB's Fuel Dock.");
  });

  it("extracts dog friendly", () => {
    const result = parseVoodooBody(sampleBody);
    expect(result.dogFriendly).toBe("Yes, outdoor area available for dogs.");
  });

  it("extracts theme when present", () => {
    const bodyWithTheme = `
Date: Thursday, March 26th
Time: 6:30pm show, 7:00pm GO!
Theme: Disco Party in Dawoods, wear anything that glows, blinks, or lights up
Start Address: Neutral ground across from 959 Harrison Ave, New Orleans, LA 70124
`;
    const result = parseVoodooBody(bodyWithTheme);
    expect(result.theme).toBe("Disco Party in Dawoods, wear anything that glows, blinks, or lights up");
  });

  it("handles body with just Hare (no Co-Hares)", () => {
    const bodyHareOnly = `
Date: Thursday, March 12th
Hare: The Iceman Thumbeth
`;
    const result = parseVoodooBody(bodyHareOnly);
    expect(result.hares).toBe("The Iceman Thumbeth");
  });

  it("returns empty object for body with no labeled fields", () => {
    const result = parseVoodooBody("Just a random paragraph with no fields.");
    expect(result.date).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.hares).toBeUndefined();
  });
});

describe("parseVoodooTime", () => {
  it("extracts 6:30pm as 18:30", () => {
    expect(parseVoodooTime("6:30pm show, 7:00pm GO!")).toBe("18:30");
  });

  it("extracts 5:30pm as 17:30", () => {
    expect(parseVoodooTime("5:30pm show, 6:00pm GO! This time is SHARP.")).toBe("17:30");
  });

  it("defaults to 18:30 when no argument", () => {
    expect(parseVoodooTime()).toBe("18:30");
  });

  it("defaults to 18:30 for unparseable string", () => {
    expect(parseVoodooTime("sometime in the evening")).toBe("18:30");
  });

  it("handles 12:00pm as noon", () => {
    expect(parseVoodooTime("12:00pm start")).toBe("12:00");
  });
});

describe("processVoodooPost", () => {
  it("processes a complete post into a RawEventData", () => {
    const title = "Trail #1035: The Egg-Stra Dirty Spring Scramble";
    const body = `
Date: Thursday, April 2nd
Time: 6:30pm show, 7:00pm GO!
Start Address: The park across from JB's. 128 S Roadway St., New Orleans, LA 70124
Hare & Co-Hares: Steven with a D and Surprise Co Hare.
Pre-Lube: JB's Fuel Dock.
On-After: JB's Fuel Dock.
`;
    const result = processVoodooPost(title, body, "https://www.voodoohash.com/2026/03/29/trail-1035/");
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-04-02");
    expect(result!.kennelTag).toBe("voodoo-h3");
    expect(result!.runNumber).toBe(1035);
    expect(result!.title).toBe("The Egg-Stra Dirty Spring Scramble");
    expect(result!.hares).toBe("Steven with a D and Surprise Co Hare.");
    expect(result!.location).toBe("The park across from JB's. 128 S Roadway St., New Orleans, LA 70124");
    expect(result!.startTime).toBe("18:30");
    expect(result!.sourceUrl).toBe("https://www.voodoohash.com/2026/03/29/trail-1035/");
  });

  it("returns null when date cannot be parsed", () => {
    const result = processVoodooPost("Trail #1035: Test", "No date field here", "https://example.com");
    expect(result).toBeNull();
  });

  it("includes theme in description when present", () => {
    const title = "Trail #1034: Disco Party in Dawoods";
    const body = `
Date: Thursday, March 26th
Time: 6:30pm show, 7:00pm GO!
Theme: Disco Party in Dawoods, wear anything that glows
Start Address: 959 Harrison Ave, New Orleans, LA 70124
Hare & Co-Hares: YMBJ
On-After: The Velvet Cactus
`;
    const result = processVoodooPost(title, body, "https://www.voodoohash.com/trail-1034/");
    expect(result).not.toBeNull();
    expect(result!.description).toContain("Theme: Disco Party in Dawoods");
    expect(result!.description).toContain("On-After: The Velvet Cactus");
  });

  it("parses full date with year", () => {
    const title = "Trail #1033: Irish, Italian Heritage Hash";
    const body = `
Date: Thursday, March 19, 2026
Time: 6:30pm show, 7:00pm GO!
Start Address: 2513 Bayou Rd, New Orleans, LA 70119
Hare & Co-Hares: That One
`;
    const result = processVoodooPost(title, body, "https://www.voodoohash.com/trail-1033/");
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-19");
  });

  it("handles early time override (Muses parade)", () => {
    const title = "Trail #1028: Muses Parade";
    const body = `
Date: Thursday, Feb 12, 2026
Time: 5:30pm show, 6:00pm GO! This time is SHARP.
Start Address: Coliseum Square Park
Hare & Co-hares: The Iceman Thumbeth
`;
    const result = processVoodooPost(title, body, "https://www.voodoohash.com/trail-1028/");
    expect(result).not.toBeNull();
    expect(result!.startTime).toBe("17:30");
  });
});

describe("VoodooH3Adapter", () => {
  const adapter = new VoodooH3Adapter();

  const mockSource = {
    id: "test-voodoo",
    url: "https://www.voodoohash.com/",
  } as Parameters<typeof adapter.fetch>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns events from WordPress API", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [
        {
          title: "Trail #1035: The Egg-Stra Dirty Spring Scramble",
          content: `<p>Date: Thursday, April 2nd<br />
Time: 6:30pm show, 7:00pm GO!<br />
Start Address: 128 S Roadway St., New Orleans, LA 70124<br />
Hare &amp; Co-Hares: Steven with a D</p>`,
          url: "https://www.voodoohash.com/2026/03/29/trail-1035/",
          date: "2026-03-29T15:21:21",
        },
      ],
      fetchDurationMs: 200,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-04-02");
    expect(result.events[0].kennelTag).toBe("voodoo-h3");
    expect(result.events[0].runNumber).toBe(1035);
    expect(result.events[0].startTime).toBe("18:30");
    expect(result.errors).toHaveLength(0);
  });

  it("returns error when WordPress API fails", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [],
      error: { message: "WordPress API HTTP 403: Forbidden", status: 403 },
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("WordPress API HTTP 403: Forbidden");
  });

  it("skips posts that cannot be parsed", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [
        {
          title: "Trail #1035: Good Post",
          content: "<p>Date: Thursday, April 2nd<br />Time: 6:30pm</p>",
          url: "https://www.voodoohash.com/trail-1035/",
          date: "2026-03-29",
        },
        {
          title: "Some non-trail post",
          content: "<p>No date info here</p>",
          url: "https://www.voodoohash.com/some-post/",
          date: "2026-03-28",
        },
      ],
      fetchDurationMs: 150,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(1035);
  });

  it("includes diagnostic context", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [],
      fetchDurationMs: 50,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.diagnosticContext).toEqual({
      fetchMethod: "wordpress-api",
      postsFound: 0,
      eventsParsed: 0,
      fetchDurationMs: 50,
    });
  });
});
