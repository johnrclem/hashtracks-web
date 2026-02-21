import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseEwh3Date, parseEwh3Title, parseEwh3Body } from "./ewh3";
import { EWH3Adapter } from "./ewh3";
import * as wordpressApi from "../wordpress-api";

vi.mock("../wordpress-api");

describe("parseEwh3Date", () => {
  it("parses 'February 19, 2026'", () => {
    expect(parseEwh3Date("February 19, 2026")).toBe("2026-02-19");
  });

  it("parses 'January 29th, 2026'", () => {
    expect(parseEwh3Date("January 29th, 2026")).toBe("2026-01-29");
  });

  it("parses 'Dec 25 2025'", () => {
    expect(parseEwh3Date("Dec 25 2025")).toBe("2025-12-25");
  });

  it("parses 'July 27, 2023'", () => {
    expect(parseEwh3Date("July 27, 2023")).toBe("2023-07-27");
  });

  it("parses ordinals: 1st, 2nd, 3rd", () => {
    expect(parseEwh3Date("March 1st, 2026")).toBe("2026-03-01");
    expect(parseEwh3Date("April 2nd, 2026")).toBe("2026-04-02");
    expect(parseEwh3Date("May 3rd, 2026")).toBe("2026-05-03");
  });

  it("returns null for invalid input", () => {
    expect(parseEwh3Date("no date here")).toBeNull();
    expect(parseEwh3Date("Floptober 5, 2026")).toBeNull();
  });
});

describe("parseEwh3Title", () => {
  it("parses standard numbered title", () => {
    const result = parseEwh3Title(
      "EWH3 #1506: Huaynaputina's Revenge, February 19, 2026, NoMa/Gallaudet U (Red Line)"
    );
    expect(result).toEqual({
      runNumber: 1506,
      trailName: "Huaynaputina's Revenge",
      date: "2026-02-19",
      metro: "NoMa/Gallaudet U",
      metroLines: "Red Line",
    });
  });

  it("parses title with multiple metro lines", () => {
    const result = parseEwh3Title(
      "EWH3 #1503: Curmudgeons Trail, January 29th, 2026, Eastern Market (Blue, Orange, Silver)"
    );
    expect(result).toEqual({
      runNumber: 1503,
      trailName: "Curmudgeons Trail",
      date: "2026-01-29",
      metro: "Eastern Market",
      metroLines: "Blue, Orange, Silver",
    });
  });

  it("parses half-number trail", () => {
    const result = parseEwh3Title(
      "EWH3 #1499.5: Outgoing Misman Trail, January 8th, 2025, Navy Yard/Ballpark (Green)"
    );
    expect(result).toEqual({
      runNumber: 1499.5,
      trailName: "Outgoing Misman Trail",
      date: "2025-01-08",
      metro: "Navy Yard/Ballpark",
      metroLines: "Green",
    });
  });

  it("parses unnumbered title", () => {
    const result = parseEwh3Title(
      "EWH3 Orphan Christmas Trail, Dec 25 2025, Greenbelt (Green Line)"
    );
    expect(result).toEqual({
      runNumber: undefined,
      trailName: "Orphan Christmas Trail",
      date: "2025-12-25",
      metro: "Greenbelt",
      metroLines: "Green Line",
    });
  });

  it("parses title with trailing site name", () => {
    const result = parseEwh3Title(
      "EWH3 #1505: Roose Rips Fukov Farewell Trail, February 12, 2026, Navy Yard-Ball Park Metro (Green) – EWH3"
    );
    expect(result).toEqual({
      runNumber: 1505,
      trailName: "Roose Rips Fukov Farewell Trail",
      date: "2026-02-12",
      metro: "Navy Yard-Ball Park Metro",
      metroLines: "Green",
    });
  });

  it("returns null for unparseable title", () => {
    expect(parseEwh3Title("EWH3 Trash – AGM/Trail #1500")).toBeNull();
    expect(parseEwh3Title("Random unrelated text")).toBeNull();
  });
});

describe("parseEwh3Body", () => {
  it("extracts hares from body text", () => {
    const text = "When: 6:45 PM Thursday\nHares: Mongo & Lo Ho\nWhere: Dupont Circle";
    expect(parseEwh3Body(text).hares).toBe("Mongo & Lo Ho");
  });

  it("extracts on-after", () => {
    const text = "On After*: Problem Child (0.5 mi from End) – 1201 Half St SE";
    expect(parseEwh3Body(text).onAfter).toBe("Problem Child (0.5 mi from End) – 1201 Half St SE");
  });

  it("extracts end metro", () => {
    const text = "End Metro: Rhode Island Ave-Brentwood\nOn After: The Bar";
    expect(parseEwh3Body(text).endMetro).toBe("Rhode Island Ave-Brentwood");
  });

  it("handles multiple hares", () => {
    const text = "Hares: Roose Rips, Ha-Cum-On My Tatas, Ms. Nuttersworth\nWhere: Somewhere";
    expect(parseEwh3Body(text).hares).toBe("Roose Rips, Ha-Cum-On My Tatas, Ms. Nuttersworth");
  });
});

const SAMPLE_HTML = `
<!DOCTYPE html>
<html>
<body>
  <article class="post type-post">
    <h2 class="entry-title">
      <a href="https://www.ewh3.com/2026/02/16/ewh3-1506/">EWH3 #1506: Huaynaputina's Revenge, February 19, 2026, NoMa/Gallaudet U (Red Line)</a>
    </h2>
    <div class="entry-content">
      <p>When: 6:45 PM Thursday, Feb 19, 2026. Pack will be away right at 7:15 PM.</p>
      <p>Hares: Mongo &amp; Lo Ho</p>
      <p>Where: NoMa/Gallaudet U Metro</p>
      <p>End Metro: Rhode Island Ave-Brentwood</p>
      <p>On After*: The Dew Drop Inn</p>
    </div>
  </article>
  <article class="post type-post">
    <h2 class="entry-title">
      <a href="https://www.ewh3.com/2026/02/09/ewh3-1505/">EWH3 #1505: Roose Rips Fukov Farewell Trail, February 12, 2026, Navy Yard-Ball Park Metro (Green)</a>
    </h2>
    <div class="entry-content">
      <p>Hares: Roose Rips, Ha-Cum-On My Tatas</p>
      <p>On After*: Problem Child</p>
    </div>
  </article>
  <article class="post type-post">
    <h2 class="entry-title">
      <a href="https://www.ewh3.com/2026/01/10/ewh3-trash/">EWH3 Trash – AGM/Trail #1500</a>
    </h2>
    <div class="entry-content">
      <p>Post-run write-up, no event data.</p>
    </div>
  </article>
</body>
</html>`;

describe("EWH3Adapter (WordPress API path)", () => {
  let adapter: EWH3Adapter;

  beforeEach(() => {
    adapter = new EWH3Adapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses WordPress API when available and parses events", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "EWH3 #1506: Huaynaputina's Revenge, February 19, 2026, NoMa/Gallaudet U (Red Line)",
          content: "<p>When: 6:45 PM Thursday</p><p>Hares: Mongo & Lo Ho</p><p>End Metro: Rhode Island Ave-Brentwood</p><p>On After*: The Dew Drop Inn</p>",
          url: "https://www.ewh3.com/2026/02/16/ewh3-1506/",
          date: "2026-02-16T12:00:00",
        },
        {
          title: "EWH3 Trash – AGM/Trail #1500",
          content: "<p>Post-run write-up, no event data.</p>",
          url: "https://www.ewh3.com/2026/01/10/ewh3-trash/",
          date: "2026-01-10T12:00:00",
        },
      ],
      fetchDurationMs: 150,
    });

    const result = await adapter.fetch({
      id: "test-ewh3",
      url: "https://www.ewh3.com/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({
      date: "2026-02-19",
      kennelTag: "EWH3",
      runNumber: 1506,
      title: "Huaynaputina's Revenge",
      hares: "Mongo & Lo Ho",
      location: "NoMa/Gallaudet U (Red Line)",
      startTime: "18:45",
      sourceUrl: "https://www.ewh3.com/2026/02/16/ewh3-1506/",
    });

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "wordpress-api",
      postsFound: 2,
      eventsParsed: 1,
    });

    // structureHash is not set for API path
    expect(result.structureHash).toBeUndefined();
  });

  it("skips unparseable posts via WordPress API", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "EWH3 #1506: Huaynaputina's Revenge, February 19, 2026, NoMa/Gallaudet U (Red Line)",
          content: "<p>Hares: Mongo</p>",
          url: "https://www.ewh3.com/post1/",
          date: "2026-02-16T00:00:00",
        },
        {
          title: "Random non-trail post",
          content: "<p>Not a trail announcement</p>",
          url: "https://www.ewh3.com/post2/",
          date: "2026-01-01T00:00:00",
        },
      ],
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch({
      id: "test-ewh3",
      url: "https://www.ewh3.com/",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.diagnosticContext).toMatchObject({
      postsFound: 2,
      eventsParsed: 1,
    });
  });
});

describe("EWH3Adapter (HTML fallback path)", () => {
  let adapter: EWH3Adapter;

  beforeEach(() => {
    adapter = new EWH3Adapter();
    // Make WordPress API return error to trigger HTML fallback
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [],
      error: { message: "WordPress API HTTP 403: Forbidden", status: 403 },
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("falls back to HTML scrape and parses events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const result = await adapter.fetch({
      id: "test-ewh3",
      url: "https://www.ewh3.com/",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2); // Trash post is skipped (no parseable date)

    // First event
    expect(result.events[0]).toMatchObject({
      date: "2026-02-19",
      kennelTag: "EWH3",
      runNumber: 1506,
      title: "Huaynaputina's Revenge",
      hares: "Mongo & Lo Ho",
      location: "NoMa/Gallaudet U (Red Line)",
      startTime: "18:45",
      sourceUrl: "https://www.ewh3.com/2026/02/16/ewh3-1506/",
    });

    // Second event
    expect(result.events[1]).toMatchObject({
      date: "2026-02-12",
      kennelTag: "EWH3",
      runNumber: 1505,
      title: "Roose Rips Fukov Farewell Trail",
      hares: "Roose Rips, Ha-Cum-On My Tatas",
      startTime: "18:45",
    });

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "html-scrape",
    });
  });

  it("returns fetch error on HTTP failure", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403 }) as never
    );

    const result = await adapter.fetch({
      id: "test-ewh3",
      url: "https://www.ewh3.com/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });
});
