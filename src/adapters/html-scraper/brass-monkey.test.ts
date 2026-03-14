import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseBrassMonkeyTitle, parseBrassMonkeyBody, BrassMonkeyAdapter } from "./brass-monkey";
import * as bloggerApi from "../blogger-api";

vi.mock("../blogger-api");

describe("parseBrassMonkeyTitle", () => {
  it("extracts run number and title", () => {
    const result = parseBrassMonkeyTitle("Brass Monkey #421 Just Short of A Brass Monkey Mile?");
    expect(result.runNumber).toBe(421);
    expect(result.title).toBe("Just Short of A Brass Monkey Mile?");
  });

  it("extracts run number when title is just the number", () => {
    const result = parseBrassMonkeyTitle("Brass Monkey #100");
    expect(result.runNumber).toBe(100);
    expect(result.title).toBeUndefined();
  });

  it("handles title without Brass Monkey prefix", () => {
    const result = parseBrassMonkeyTitle("Some Other Post Title");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBe("Some Other Post Title");
  });

  it("returns undefined title for empty string", () => {
    const result = parseBrassMonkeyTitle("");
    expect(result.runNumber).toBeUndefined();
    expect(result.title).toBeUndefined();
  });
});

describe("parseBrassMonkeyBody", () => {
  it("extracts date, time, location, and hares", () => {
    const text = [
      "Saturday, March 14, 2026 (3:30 PM start)",
      "Location: 3826 E Mossy Oaks Rd E, Spring 77389",
      "Hare(s): Lucky Stiff",
    ].join("\n");

    const result = parseBrassMonkeyBody(text);
    expect(result.date).toBe("2026-03-14");
    expect(result.startTime).toBe("15:30");
    expect(result.location).toBe("3826 E Mossy Oaks Rd E, Spring 77389");
    expect(result.hares).toBe("Lucky Stiff");
  });

  it("extracts date without time", () => {
    const text = "Saturday, April 5, 2026\nLocation: Memorial Park";
    const result = parseBrassMonkeyBody(text);
    expect(result.date).toBe("2026-04-05");
    expect(result.startTime).toBeUndefined();
    expect(result.location).toBe("Memorial Park");
  });

  it("extracts AM time", () => {
    const text = "Saturday, June 7, 2026 (10:00 AM start)";
    const result = parseBrassMonkeyBody(text);
    expect(result.startTime).toBe("10:00");
  });

  it("handles missing fields gracefully", () => {
    const text = "Join us for a fun trail!";
    const result = parseBrassMonkeyBody(text);
    expect(result.location).toBeUndefined();
    expect(result.hares).toBeUndefined();
  });

  it("extracts hares with alternate label format", () => {
    const text = "Hare: Trail Blazer\nLocation: Hermann Park";
    const result = parseBrassMonkeyBody(text);
    expect(result.hares).toBe("Trail Blazer");
  });
});

describe("BrassMonkeyAdapter.fetch (Blogger API path)", () => {
  let adapter: BrassMonkeyAdapter;

  beforeEach(() => {
    adapter = new BrassMonkeyAdapter();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("parses events from Blogger API posts", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "Brass Monkey #421 Just Short of A Brass Monkey Mile?",
          content: "<p>Saturday, March 14, 2026 (3:30 PM start)</p><p>Location: 3826 E Mossy Oaks Rd E, Spring 77389</p><p>Hare(s): Lucky Stiff</p>",
          url: "https://teambrassmonkey.blogspot.com/2026/03/brass-monkey-421.html",
          published: "2026-03-01T12:00:00Z",
        },
        {
          title: "Brass Monkey #420 Blaze It Trail",
          content: "<p>Saturday, February 28, 2026 (3:00 PM start)</p><p>Location: Buffalo Bayou Park</p><p>Hares: Hot Mess &amp; Cold Feet</p>",
          url: "https://teambrassmonkey.blogspot.com/2026/02/brass-monkey-420.html",
          published: "2026-02-15T12:00:00Z",
        },
      ],
      blogId: "12345",
      fetchDurationMs: 150,
    });

    const result = await adapter.fetch({
      id: "test-bmh3",
      url: "https://teambrassmonkey.blogspot.com",
    } as never);

    expect(result.events).toHaveLength(2);

    expect(result.events[0]).toMatchObject({
      date: "2026-03-14",
      kennelTag: "BMH3",
      runNumber: 421,
      title: "Just Short of A Brass Monkey Mile?",
      hares: "Lucky Stiff",
      location: "3826 E Mossy Oaks Rd E, Spring 77389",
      startTime: "15:30",
    });
    expect(result.events[0].locationUrl).toContain("google.com/maps");

    expect(result.events[1]).toMatchObject({
      date: "2026-02-28",
      kennelTag: "BMH3",
      runNumber: 420,
      title: "Blaze It Trail",
      hares: "Hot Mess & Cold Feet",
      location: "Buffalo Bayou Park",
      startTime: "15:00",
    });

    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "blogger-api",
      blogId: "12345",
      postsFound: 2,
      eventsParsed: 2,
    });
  });

  it("falls back to HTML scrape when Blogger API unavailable", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [],
      error: { message: "Missing GOOGLE_CALENDAR_API_KEY environment variable" },
    });

    const sampleHtml = `
      <div class="post-outer">
        <h3 class="post-title">
          <a href="https://teambrassmonkey.blogspot.com/2026/03/test.html">Brass Monkey #421 Test</a>
        </h3>
        <div class="post-body">
          <p>Saturday, March 14, 2026 (3:30 PM start)</p>
          <p>Location: Test Park</p>
        </div>
      </div>
    `;

    const safeFetchModule = await import("../safe-fetch");
    vi.spyOn(safeFetchModule, "safeFetch").mockResolvedValueOnce(
      new Response(sampleHtml, { status: 200 }) as never,
    );

    const result = await adapter.fetch({
      id: "test-bmh3",
      url: "https://teambrassmonkey.blogspot.com",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].kennelTag).toBe("BMH3");
    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "html-scrape",
    });
  });

  it("records parse error for posts without dates", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "Brass Monkey #422 Mystery Trail",
          content: "<p>Location: Somewhere in Houston</p><p>Hares: Someone</p>",
          url: "https://teambrassmonkey.blogspot.com/2026/04/mystery.html",
          published: "2026-04-01T12:00:00Z",
        },
      ],
      blogId: "12345",
      fetchDurationMs: 100,
    });

    const result = await adapter.fetch({
      id: "test-bmh3",
      url: "https://teambrassmonkey.blogspot.com",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No date found");
  });
});
