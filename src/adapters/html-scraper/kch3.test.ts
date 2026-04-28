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
