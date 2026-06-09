import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseDch4Title, parseDch4Body } from "./dch4";
import { DCH4Adapter } from "./dch4";
import * as wordpressApi from "../wordpress-api";

vi.mock("../wordpress-api");

describe("parseDch4Title", () => {
  // Representative publish dates for year-less titles (announcements post ~days
  // before the run, so the publish month anchors the inferred year).
  const febPub = new Date("2026-02-01T12:00:00Z");
  const octPub = new Date("2026-10-01T12:00:00Z");

  it("parses standard title with 2-digit year", () => {
    const result = parseDch4Title("DCH4 Trail# 2298 - 2/7/26 @ 2pm", febPub);
    expect(result).toEqual({
      runNumber: 2298,
      date: "2026-02-07",
      startTime: "14:00",
      theme: undefined,
    });
  });

  it("parses title without year (infers from publish date)", () => {
    const result = parseDch4Title("DCH4 Trail# 2299 - 2/14 @ 2pm", febPub);
    expect(result).toEqual({
      runNumber: 2299,
      date: "2026-02-14",
      startTime: "14:00",
      theme: undefined,
    });
  });

  it("parses title with theme suffix", () => {
    const result = parseDch4Title("DCH4 Trail# 2224 - 2/17 @ 2pm - SWILL TEAM SIX!!", febPub);
    expect(result).toEqual({
      runNumber: 2224,
      date: "2026-02-17",
      startTime: "14:00",
      theme: "SWILL TEAM SIX!!",
    });
  });

  it("parses title with 3pm summer time", () => {
    const result = parseDch4Title("DCH4 Trail# 2243 - 8/24/24 @ 3pm", new Date("2024-08-01T12:00:00Z"));
    expect(result).toEqual({
      runNumber: 2243,
      date: "2024-08-24",
      startTime: "15:00",
      theme: undefined,
    });
  });

  it("parses title with 10am morning time", () => {
    const result = parseDch4Title("DCH4 Trail# 1926 - 10/15 @ 10am", octPub);
    expect(result).toEqual({
      runNumber: 1926,
      date: "2026-10-15",
      startTime: "10:00",
      theme: undefined,
    });
  });

  it("(#1074) a December run resurfacing in a Feb post resolves to the PRIOR December, not a future one", () => {
    // The zombie: "DCH4 Trail# 2294 - 12/20 @ 5pm" posted 2026-02-22 was stamped
    // 2026-12-20 (future) because the year defaulted to the current year. With
    // publish-date inference it lands on 2025-12-20 (past), so it can't become a
    // future zombie that outranks the real latest run (#2310).
    const result = parseDch4Title("DCH4 Trail# 2294 - 12/20 @ 5pm", new Date("2026-02-22T12:00:00Z"));
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(2294);
    expect(result!.date).toBe("2025-12-20");
  });

  it("(#1074) a year-end run announced in late December rolls forward to January", () => {
    // Closest-to-publish handles the rollover: a "1/4" run posted Dec 28 2026 is
    // Jan 4 2027 (7 days later), not Jan 4 2026 (~358 days earlier).
    const result = parseDch4Title("DCH4 Trail# 2400 - 1/4 @ 2pm", new Date("2026-12-28T12:00:00Z"));
    expect(result!.date).toBe("2027-01-04");
  });

  it("returns null for unparseable title", () => {
    expect(parseDch4Title("Random post title", febPub)).toBeNull();
    expect(parseDch4Title("Hash Trash Week 3", febPub)).toBeNull();
  });
});

describe("parseDch4Body", () => {
  it("extracts hare name", () => {
    const text = "Hare: Blinded by the Spooge\nStart: Third Hill Brewing";
    expect(parseDch4Body(text).hares).toBe("Blinded by the Spooge");
  });

  it("extracts multiple hares", () => {
    const text = "Hares: 3west, Princess Jizzmine, and Blonde Roots\nStart Location: Metro Station";
    expect(parseDch4Body(text).hares).toBe("3west, Princess Jizzmine, and Blonde Roots");
  });

  it("extracts location", () => {
    const text = "Start: Third Hill Brewing (8216 Georgia Ave. Silver Spring, MD)\nCost: $7";
    expect(parseDch4Body(text).location).toBe("Third Hill Brewing (8216 Georgia Ave. Silver Spring, MD)");
  });

  it("extracts hash cash", () => {
    const text = "Cost: $7\nHare: Someone";
    expect(parseDch4Body(text).hashCash).toBe("$7");
  });

  it("extracts on-after", () => {
    const text = "On After: Buffalo Wings & Beer, 15412 New Hampshire Ave\nEnd of post";
    expect(parseDch4Body(text).onAfter).toBe("Buffalo Wings & Beer, 15412 New Hampshire Ave");
  });

  it("extracts runner and walker distances", () => {
    const text = "Runners less than 5mi first half\nWalkers about 3mi total";
    expect(parseDch4Body(text).runnerDistance).toBe("5 mi");
    expect(parseDch4Body(text).walkerDistance).toBe("3 mi");
  });

  it("extracts approximate distances with tilde", () => {
    const text = "Runners ~4mi trail\nWalkers ~2.5mi trail";
    expect(parseDch4Body(text).runnerDistance).toBe("4 mi");
    expect(parseDch4Body(text).walkerDistance).toBe("2.5 mi");
  });

  // #1072: newer DCH4 posts use emoji-prefixed labels with `Hare(s):` form.
  it("extracts emoji-prefixed Hare(s)/Start Location/Cost labels (#1072)", () => {
    const text = [
      "🐇 Hare(s): No Child Left Behind and Princess Jizzmine",
      "📍 Start Location: Saints Row Brewing",
      "⏰ Time: 2pm gather, pack on out @ 3pm",
      "🍺 on after: Mayan Monkey",
      "💵 Cost: $7",
    ].join("\n");
    const parsed = parseDch4Body(text);
    expect(parsed.hares).toBe("No Child Left Behind and Princess Jizzmine");
    expect(parsed.location).toBe("Saints Row Brewing");
    expect(parsed.hashCash).toBe("$7");
    expect(parsed.onAfter).toBe("Mayan Monkey");
  });
});

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <article class="post type-post">
    <h2 class="entry-title">
      <a href="https://dch4.org/dch4-trail-2299-2-14-2pm/">DCH4 Trail# 2299 - 2/14 @ 2pm</a>
    </h2>
    <div class="entry-content">
      <p>Hare: Blinded by the Spooge</p>
      <p>Start: Twinbrook Metro Station (1600 Chapman Ave. Rockville, MD)</p>
      <p>Cost: $7</p>
      <p>Runners ~4mi trail through Rock Creek</p>
      <p>Walkers ~2.5mi mostly paved</p>
      <p>On After: Buffalo Wings & Beer</p>
    </div>
  </article>
  <article class="post type-post">
    <h2 class="entry-title">
      <a href="https://dch4.org/dch4-trail-2298-2-7-26-2pm/">DCH4 Trail# 2298 - 2/7/26 @ 2pm</a>
    </h2>
    <div class="entry-content">
      <p>Hares: Spike and Big in Japan</p>
      <p>Start Location: Third Hill Brewing (8216 Georgia Ave. Silver Spring, MD)</p>
      <p>Hash Cash: $7</p>
      <p>On-After: TBD</p>
    </div>
  </article>
</body>
</html>`;

describe("DCH4Adapter (WordPress API path)", () => {
  let adapter: DCH4Adapter;

  // Freeze the clock at the fixtures' era so the windowed/year-inferred assertions never age out (#2066).
  beforeEach(() => {
    adapter = new DCH4Adapter();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("uses WordPress API when available and parses events", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "DCH4 Trail# 2299 - 2/14 @ 2pm",
          content: "<p>Hare: Blinded by the Spooge</p><p>Start: Twinbrook Metro Station (1600 Chapman Ave. Rockville, MD)</p><p>Cost: $7</p><p>Runners ~4mi trail</p><p>Walkers ~2.5mi trail</p><p>On After: Buffalo Wings & Beer</p>",
          url: "https://dch4.org/dch4-trail-2299-2-14-2pm/",
          date: "2026-02-10T12:00:00",
        },
        {
          title: "Hash Trash from last week",
          content: "<p>Not a trail post</p>",
          url: "https://dch4.org/hash-trash/",
          date: "2026-02-08T12:00:00",
        },
      ],
      fetchDurationMs: 200,
    });

    const result = await adapter.fetch({
      id: "test-dch4",
      url: "https://dch4.org/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      date: "2026-02-14",
      kennelTags: ["dch4"],
      runNumber: 2299,
      hares: "Blinded by the Spooge",
      location: "Twinbrook Metro Station (1600 Chapman Ave. Rockville, MD)",
      startTime: "14:00",
      sourceUrl: "https://dch4.org/dch4-trail-2299-2-14-2pm/",
    });

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "wordpress-api",
      postsFound: 2,
      eventsParsed: 1,
    });

    expect(result.structureHash).toBeUndefined();
  });

  it("skips unparseable posts via WordPress API", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "DCH4 Trail# 2299 - 2/14 @ 2pm",
          content: "<p>Hare: Someone</p>",
          url: "https://dch4.org/post1/",
          date: "2026-02-10T00:00:00",
        },
        {
          title: "Not a trail post at all",
          content: "<p>Just random content</p>",
          url: "https://dch4.org/post2/",
          date: "2026-01-01T00:00:00",
        },
      ],
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch({
      id: "test-dch4",
      url: "https://dch4.org/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.diagnosticContext).toMatchObject({
      postsFound: 2,
      eventsParsed: 1,
    });
  });
});

describe("DCH4Adapter (HTML fallback path)", () => {
  let adapter: DCH4Adapter;

  // Freeze the clock at the fixtures' era so the windowed/year-inferred assertions never age out (#2066).
  beforeEach(() => {
    adapter = new DCH4Adapter();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-02-01T12:00:00Z"));
    // Make WordPress API return error to trigger HTML fallback
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [],
      error: { message: "WordPress API HTTP 403: Forbidden", status: 403 },
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("falls back to HTML scrape and parses events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test-dch4",
      url: "https://dch4.org/",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2);

    expect(result.events[0]).toMatchObject({
      date: "2026-02-14",
      kennelTags: ["dch4"],
      runNumber: 2299,
      hares: "Blinded by the Spooge",
      location: "Twinbrook Metro Station (1600 Chapman Ave. Rockville, MD)",
      startTime: "14:00",
      sourceUrl: "https://dch4.org/dch4-trail-2299-2-14-2pm/",
    });

    expect(result.events[1]).toMatchObject({
      date: "2026-02-07",
      kennelTags: ["dch4"],
      runNumber: 2298,
      hares: "Spike and Big in Japan",
      startTime: "14:00",
    });

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "html-scrape",
    });
  });

  it("returns fetch error on HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-dch4",
      url: "https://dch4.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
