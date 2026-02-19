import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseDch4Title, parseDch4Body } from "./dch4";
import { DCH4Adapter } from "./dch4";

describe("parseDch4Title", () => {
  it("parses standard title with 2-digit year", () => {
    const result = parseDch4Title("DCH4 Trail# 2298 - 2/7/26 @ 2pm", 2026);
    expect(result).toEqual({
      runNumber: 2298,
      date: "2026-02-07",
      startTime: "14:00",
      theme: undefined,
    });
  });

  it("parses title without year (uses reference year)", () => {
    const result = parseDch4Title("DCH4 Trail# 2299 - 2/14 @ 2pm", 2026);
    expect(result).toEqual({
      runNumber: 2299,
      date: "2026-02-14",
      startTime: "14:00",
      theme: undefined,
    });
  });

  it("parses title with theme suffix", () => {
    const result = parseDch4Title("DCH4 Trail# 2224 - 2/17 @ 2pm - SWILL TEAM SIX!!", 2026);
    expect(result).toEqual({
      runNumber: 2224,
      date: "2026-02-17",
      startTime: "14:00",
      theme: "SWILL TEAM SIX!!",
    });
  });

  it("parses title with 3pm summer time", () => {
    const result = parseDch4Title("DCH4 Trail# 2243 - 8/24/24 @ 3pm", 2024);
    expect(result).toEqual({
      runNumber: 2243,
      date: "2024-08-24",
      startTime: "15:00",
      theme: undefined,
    });
  });

  it("parses title with 10am morning time", () => {
    const result = parseDch4Title("DCH4 Trail# 1926 - 10/15 @ 10am", 2026);
    expect(result).toEqual({
      runNumber: 1926,
      date: "2026-10-15",
      startTime: "10:00",
      theme: undefined,
    });
  });

  it("returns null for unparseable title", () => {
    expect(parseDch4Title("Random post title", 2026)).toBeNull();
    expect(parseDch4Title("Hash Trash Week 3", 2026)).toBeNull();
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
});

describe("DCH4Adapter integration", () => {
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

  let adapter: DCH4Adapter;

  beforeEach(() => {
    adapter = new DCH4Adapter();
    vi.stubGlobal("fetch", vi.fn());
  });

  it("parses multiple trail posts", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }) as never
    );

    const result = await adapter.fetch({
      id: "test-dch4",
      url: "https://dch4.org/",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2);

    // First event
    expect(result.events[0]).toMatchObject({
      date: "2026-02-14",
      kennelTag: "DCH4",
      runNumber: 2299,
      hares: "Blinded by the Spooge",
      location: "Twinbrook Metro Station (1600 Chapman Ave. Rockville, MD)",
      startTime: "14:00",
      sourceUrl: "https://dch4.org/dch4-trail-2299-2-14-2pm/",
    });

    // Second event
    expect(result.events[1]).toMatchObject({
      date: "2026-02-07",
      kennelTag: "DCH4",
      runNumber: 2298,
      hares: "Spike and Big in Japan",
      startTime: "14:00",
    });
  });

  it("returns fetch error on HTTP failure", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response("Not Found", { status: 404 }) as never
    );

    const result = await adapter.fetch({
      id: "test-dch4",
      url: "https://dch4.org/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
  });
});
