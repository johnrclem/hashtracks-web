import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  parseKCH3Time,
  parseKCH3Body,
  resolveKennelTag,
  processKCH3Post,
  stripLeadingParenLabel,
  KCH3Adapter,
} from "./kch3";
import * as wordpressApi from "../wordpress-api";

vi.mock("../wordpress-api");

describe("parseKCH3Time", () => {
  it("parses time with periods in am/pm", () => {
    expect(parseKCH3Time("8 a.m.")).toBe("08:00");
  });

  it("parses time with periods and minutes", () => {
    expect(parseKCH3Time("2:00 p.m.")).toBe("14:00");
  });

  it("parses time without periods", () => {
    expect(parseKCH3Time("2:30pm")).toBe("14:30");
  });

  it("parses time with CST suffix", () => {
    expect(parseKCH3Time("2:15pm CST")).toBe("14:15");
  });

  it("parses noon", () => {
    expect(parseKCH3Time("12:00p")).toBe("12:00");
  });

  it("returns default for undefined", () => {
    expect(parseKCH3Time(undefined)).toBe("14:00");
  });

  it("returns default for unparseable string", () => {
    expect(parseKCH3Time("early as you want")).toBe("14:00");
  });

  // ── #1369 — When the source omits the AM/PM marker entirely, default to PM
  //    (hash convention). Explicit AM tokens are still honored. The
  //    regression case is "2:00 at: Fox & Hound" — the old regex matched the
  //    `a` in `at` as the AM marker.

  it("does not treat the `a` in `at` as an AM marker (#1369)", () => {
    expect(parseKCH3Time("2:00 at: Fox & Hound")).toBe("14:00");
  });

  it("finds an hour token after leading filler text (PR #1382 codex P1)", () => {
    // parseKCH3Body captures the whole meetup line as time, so "Meetup at
    // 6 p.m." reaches this function as "at 6 p.m.". Anchoring to `^` would
    // mis-default it to 14:00.
    expect(parseKCH3Time("at 6 p.m.")).toBe("18:00");
  });

  it.each([
    ["2:00", "14:00"],
    ["5:00", "17:00"],
    ["6:00", "18:00"],
    ["12:00", "12:00"], // noon — no PM shift
  ])("defaults bare %s to PM (#1369)", (input, expected) => {
    expect(parseKCH3Time(input)).toBe(expected);
  });

  it("honors an explicit AM marker (sunrise event)", () => {
    expect(parseKCH3Time("7:00 a.m.")).toBe("07:00");
  });

  it("honors 12 a.m. as midnight", () => {
    expect(parseKCH3Time("12 a.m.")).toBe("00:00");
  });

  it("falls back to default for joke time '1:69' (minutes > 59)", () => {
    // Real source data: "Meetup: 1:69" appeared in #1874 (April 2025).
    expect(parseKCH3Time("1:69")).toBe("14:00");
  });
});

describe("parseKCH3Body", () => {
  const sampleBody = `
Meetup: 2 p.m.
Pack Away: 2:30 p.m.
Hash Cash: $5
Location: Williams Grant Park 401 SE Howard Ave, Lee's Summit, MO 64063
Hare: Shhhhhhhh
Short-ish trail with possible Bar Audibles
`;

  it("extracts time", () => {
    expect(parseKCH3Body(sampleBody).time).toBe("2 p.m.");
  });

  it("extracts hash cash", () => {
    expect(parseKCH3Body(sampleBody).hashCash).toBe("$5");
  });

  it("extracts hare", () => {
    expect(parseKCH3Body(sampleBody).hares).toBe("Shhhhhhhh");
  });

  it("extracts location", () => {
    expect(parseKCH3Body(sampleBody).location).toBe(
      "Williams Grant Park 401 SE Howard Ave, Lee's Summit, MO 64063",
    );
  });

  it("handles Meet Up (two words) format", () => {
    const body = "Meet Up 2:00 at: Fox & Hound\nHash Cash $5\nHare PMS";
    const result = parseKCH3Body(body);
    expect(result.time).toBe("2:00 at: Fox & Hound");
    expect(result.hares).toBe("PMS");
  });

  it("extracts location from Start: label", () => {
    const body = "Start: Strawberry Hill Brewing Co. 601 Central Ave, Kansas City, KS 66101";
    const result = parseKCH3Body(body);
    expect(result.location).toBe(
      "Strawberry Hill Brewing Co. 601 Central Ave, Kansas City, KS 66101",
    );
  });

  it("extracts location from Where: label", () => {
    const body = "Where: Swope Park Woodchuck trailhead";
    expect(parseKCH3Body(body).location).toBe("Swope Park Woodchuck trailhead");
  });

  it("strips a parenthetical label between 'Location' and the colon (#2019)", () => {
    const body =
      "Location (also prelube and on-after): Helen's J.A.D. – 2002 Armour Rd, North Kansas City, MO 64116";
    expect(parseKCH3Body(body).location).toBe(
      "Helen's J.A.D. – 2002 Armour Rd, North Kansas City, MO 64116",
    );
  });

  // #2110 follow-up: the location label must only match at the start of a line,
  // with its colon, capturing same-line text — never the bare word in prose or
  // the next line's content.
  it("does not capture theme prose containing the word 'start' (Olympic Trials leak)", () => {
    const body =
      "Meetup: 10:00 a.m. Just outside The Dub KC 105 W 9th St, Kansas City, MO 64105\n" +
      "Hare(s): Black to the Cooter and HoMo\n" +
      "The first PN trail of 2026 and just in time for the start of the winter Olympics!!! Come dressed as your favorite Olympian";
    expect(parseKCH3Body(body).location).toBeUndefined();
  });

  it("prefers a real WHERE: line over a prose 'start' later in the body (Drinksgiving)", () => {
    const body =
      "Meetup 2pm / Pack away 2:30pm\n" +
      "WHERE: 1601 N 98th St, Kansas City, KS 66111\n" +
      "ON-AFTER continues at Casa de EZ Odor, a hop skip from trail start – approximately 5pm.";
    expect(parseKCH3Body(body).location).toBe("1601 N 98th St, Kansas City, KS 66111");
  });

  it("does not let \\s* span a newline from a prose 'location' word into the next line (Chili: Hash Cash)", () => {
    const body =
      "Meetup: 1:00 p.m.\n" +
      "Pack away shortly thereafter – shuttling to the trail start location\n" +
      "Hash Cash: $5\n" +
      "Location: 7103 Harvard Ave, Raytown, MO 64133";
    expect(parseKCH3Body(body).location).toBe("7103 Harvard Ave, Raytown, MO 64133");
  });

  it("ignores a 'Start' line whose colon belongs to a time, not a label (Spock 5:00pm)", () => {
    const body = "Start at Tuckers, hares away 5:00pm.\nHare: Spock";
    expect(parseKCH3Body(body).location).toBeUndefined();
  });

  it("ignores 'Start @ Private Home:' / 'Start Time …' non-label lines", () => {
    expect(parseKCH3Body("Start @ Private Home:\n3013 New Lawrence Rd").location).toBeUndefined();
    expect(parseKCH3Body("Start Time 3 p.m.\nHares: Naked Rider").location).toBeUndefined();
  });
});

describe("stripLeadingParenLabel", () => {
  it("strips a leading '(label):' annotation", () => {
    expect(stripLeadingParenLabel("(also prelube and on-after): Helen's J.A.D.")).toBe(
      "Helen's J.A.D.",
    );
  });

  it("preserves a leading parenthetical that is part of the venue (no following colon)", () => {
    expect(stripLeadingParenLabel("(near the fountain) Central Park")).toBe(
      "(near the fountain) Central Park",
    );
  });

  it("leaves a value with no leading parenthetical untouched", () => {
    expect(stripLeadingParenLabel("Macken Park 1002 Clark Ferguson Dr")).toBe(
      "Macken Park 1002 Clark Ferguson Dr",
    );
  });
});

describe("resolveKennelTag", () => {
  it("returns kch3 for standard title", () => {
    expect(resolveKennelTag("14 March Snake Saturday Trail")).toBe("kch3");
  });

  it.each([
    "8 February 2026 Ladies Only Olympic Trials Trail",
    "8 June 2025 LADIES ONLY Pride Trail",
    "Bangers and BABES Ladies-only Pearl Necklace Trail",
  ])("returns pnh3 for a 'Ladies Only' title: %s (#2110)", (title) => {
    expect(resolveKennelTag(title)).toBe("pnh3");
  });

  it("keeps a bare 'Ladies' (no 'Only') KCH3 theme on kch3", () => {
    expect(resolveKennelTag("14 March Ladies Night Theme Trail")).toBe("kch3");
  });

  it("returns pnh3 when title contains PNH3", () => {
    expect(resolveKennelTag("PNH3 Spring Fling Trail")).toBe("pnh3");
  });

  it("returns pnh3 when title contains Pearl Necklace", () => {
    expect(
      resolveKennelTag("Pearl Necklace Valentines Day Trail"),
    ).toBe("pnh3");
  });
});

describe("processKCH3Post", () => {
  it("parses a standard post", () => {
    const title = "21 March 2026 SHHHHHHH Trail";
    const body =
      "Meetup: 2 p.m.\nPack Away: 2:30 p.m.\nHash Cash: $5\nLocation: Williams Grant Park 401 SE Howard Ave\nHare: Shhhhhhhh";
    const result = processKCH3Post(title, body, "https://kansascityh3.com/test");

    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-21");
    expect(result!.kennelTags[0]).toBe("kch3");
    expect(result!.title).toBe("SHHHHHHH Trail");
    expect(result!.hares).toBe("Shhhhhhhh");
    expect(result!.startTime).toBe("14:00");
    expect(result!.location).toBe(
      "Williams Grant Park 401 SE Howard Ave",
    );
  });

  it("parses title without year", () => {
    const title = "14 March Snake Saturday Trail";
    const body = "Meetup: 8 a.m.\nHash Cash: $5\nHare: Sow Cow Me Maybe";
    const result = processKCH3Post(title, body, "https://kansascityh3.com/test");

    expect(result).not.toBeNull();
    expect(result!.title).toBe("Snake Saturday Trail");
    expect(result!.startTime).toBe("08:00");
    expect(result!.hares).toBe("Sow Cow Me Maybe");
  });

  it("returns null for unparseable date", () => {
    const result = processKCH3Post("No date here", "body text", "https://x.com");
    expect(result).toBeNull();
  });

  it("includes hash cash in description", () => {
    const title = "7 March 2026 Trail";
    const body = "Hash Cash $5\nHare PMS";
    const result = processKCH3Post(title, body, "https://x.com");

    expect(result).not.toBeNull();
    expect(result!.description).toBe("Hash Cash: $5");
  });

  // ── #1368 — When the title omits the year, anchor on the WordPress post
  //    publish date so "28 February" posted in 2026 resolves to 2026-02-28,
  //    not 2027-02-28. The fix passes `post.date` as the chrono refDate.

  it("anchors year-less title to publishDate (28 February → 2026-02-28)", () => {
    const result = processKCH3Post(
      "28 February Short, Sunny TAIL Trail",
      "Meet Up 2:00 at: Fox & Hound",
      "https://kansascityh3.com/x",
      "2026-02-28T10:00:00",
    );
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-02-28");
  });

  it("anchors year-less title to publishDate (14 March → 2026-03-14)", () => {
    const result = processKCH3Post(
      "14 March Snake Saturday Trail",
      "Meetup: 8 a.m.",
      "https://kansascityh3.com/x",
      "2026-03-11T08:00:00",
    );
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-14");
  });

  it("ignores a malformed publishDate and still parses an explicit-year title", () => {
    // Defensive: an invalid `new Date("garbage")` produces NaN, which chrono
    // would honor as a reference and drop the parse. Fall back to undefined.
    const result = processKCH3Post(
      "21 March 2026 SHHHHHHH Trail",
      "Meetup: 2 p.m.",
      "https://kansascityh3.com/x",
      "not-a-date",
    );
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-21");
  });

  it("honors explicit year in title regardless of publishDate", () => {
    const result = processKCH3Post(
      "21 March 2026 SHHHHHHH Trail",
      "Meetup: 2 p.m.",
      "https://kansascityh3.com/x",
      "2020-01-01T00:00:00",
    );
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-21");
  });

  it("integrates with the AM/PM fix: bare 2:00 in body → 14:00 (#1369)", () => {
    const result = processKCH3Post(
      "7 March 2026 Trail",
      "Meet Up 2:00 at: Fox & Hound\nHash Cash $5\nHare PMS",
      "https://kansascityh3.com/x",
      "2026-03-04T12:00:00",
    );
    expect(result).not.toBeNull();
    expect(result!.startTime).toBe("14:00");
  });
});

describe("KCH3Adapter", () => {
  const adapter = new KCH3Adapter();
  const mockSource = {
    id: "test-kch3",
    url: "https://kansascityh3.com/",
  } as never;

  // Freeze the clock at the fixtures' era so the windowed/year-inferred assertions never age out (#2066).
  beforeEach(() => {
    vi.resetAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns events from WordPress posts", async () => {
    vi.mocked(wordpressApi.fetchAllWordPressPosts).mockResolvedValue([
      {
        title: "21 March 2026 SHHHHHHH Trail",
        content:
          "<p>Meetup: 2 p.m.<br>Hash Cash: $5<br>Location: Williams Grant Park<br>Hare: Shhhhhhhh</p>",
        url: "https://kansascityh3.com/21-march-2026-shhhhhhh-trail/",
        date: "2026-03-18T16:50:59",
      },
    ]);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-03-21");
    expect(result.events[0].kennelTags[0]).toBe("kch3");
    expect(result.events[0].hares).toBe("Shhhhhhhh");
  });

  it("paginates the feed, routes Ladies-Only to pnh3, and trims out-of-window posts (#2110)", async () => {
    vi.mocked(wordpressApi.fetchAllWordPressPosts).mockResolvedValue([
      {
        title: "8 February 2026 Ladies Only Olympic Trials Trail",
        content: "<p>Meetup: 2 p.m.<br>Hash Cash: $10<br>Hare: Just Jane</p>",
        url: "https://kansascityh3.com/ladies-only-olympic/",
        date: "2026-02-04T12:00:00",
      },
      {
        title: "21 February 2026 SHHHHHHH Trail",
        content: "<p>Meetup: 2 p.m.<br>Hare: Shhhhhhhh</p>",
        url: "https://kansascityh3.com/shhhhhhh/",
        date: "2026-02-18T12:00:00",
      },
      {
        // Far outside the ±365d window (clock frozen at 2026-03-01) — trimmed.
        title: "20 August 2023 Ladies Only: Do You Play Croquet?",
        content: "<p>Meetup: 2 p.m.<br>Hare: Old Hare</p>",
        url: "https://kansascityh3.com/croquet/",
        date: "2023-08-17T12:00:00",
      },
    ]);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(2);
    const byTag = (tag: string) => result.events.filter((e) => e.kennelTags[0] === tag);
    expect(byTag("pnh3")).toHaveLength(1);
    expect(byTag("pnh3")[0].date).toBe("2026-02-08");
    expect(byTag("kch3")).toHaveLength(1);
    // The 2023 post is outside the window → dropped by applyDateWindow.
    expect(result.events.some((e) => e.date.startsWith("2023"))).toBe(false);

    // The recurring scrape bounds pagination to the date-window floor.
    expect(wordpressApi.fetchAllWordPressPosts).toHaveBeenCalledWith(
      "https://kansascityh3.com/",
      expect.objectContaining({ stopBefore: expect.any(Date) }),
    );
  });

  it("surfaces a graceful error when the paginator throws", async () => {
    vi.mocked(wordpressApi.fetchAllWordPressPosts).mockRejectedValue(
      new Error("WordPress paginator page 2: HTTP 403"),
    );

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("HTTP 403");
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });
});
