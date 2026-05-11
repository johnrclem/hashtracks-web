import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseKCH3Time,
  parseKCH3Body,
  resolveKennelTag,
  processKCH3Post,
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
});

describe("resolveKennelTag", () => {
  it("returns kch3 for standard title", () => {
    expect(resolveKennelTag("14 March Snake Saturday Trail")).toBe("kch3");
  });

  it("returns pnh3 for Pearl Necklace title", () => {
    expect(
      resolveKennelTag("8 February 2026 Ladies Only Olympic Trials Trail"),
    ).toBe("kch3");
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

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("returns events from WordPress posts", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [
        {
          title: "21 March 2026 SHHHHHHH Trail",
          content:
            "<p>Meetup: 2 p.m.<br>Hash Cash: $5<br>Location: Williams Grant Park<br>Hare: Shhhhhhhh</p>",
          url: "https://kansascityh3.com/21-march-2026-shhhhhhh-trail/",
          date: "2026-03-18T16:50:59",
        },
      ],
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-03-21");
    expect(result.events[0].kennelTags[0]).toBe("kch3");
    expect(result.events[0].hares).toBe("Shhhhhhhh");
  });

  it("returns errors on fetch failure", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [],
      error: { message: "HTTP 403", status: 403 },
      fetchDurationMs: 50,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("HTTP 403");
  });
});
