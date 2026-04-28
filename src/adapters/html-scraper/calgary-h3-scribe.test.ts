import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseScribeTitle,
  parseScribeBody,
  processScribePost,
  CalgaryH3ScribeAdapter,
} from "./calgary-h3-scribe";
import * as wordpressApi from "../wordpress-api";

vi.mock("../wordpress-api");

// ---------------------------------------------------------------------------
// parseScribeTitle
// ---------------------------------------------------------------------------

describe("parseScribeTitle", () => {
  it("parses standard 'Run NNNN – Trail Name' format", () => {
    const result = parseScribeTitle("Run 2453 – A Hot Slippy Thong in the Cheeks");
    expect(result).toEqual({
      runNumber: 2453,
      trailName: "A Hot Slippy Thong in the Cheeks",
    });
  });

  it("parses title with hyphen separator", () => {
    const result = parseScribeTitle("Run 2450 - Ode to Joy");
    expect(result).toEqual({
      runNumber: 2450,
      trailName: "Ode to Joy",
    });
  });

  it("parses title with em-dash separator", () => {
    const result = parseScribeTitle("Run 2451 \u2014 Some Trail");
    expect(result).toEqual({
      runNumber: 2451,
      trailName: "Some Trail",
    });
  });

  it("handles run number only (no trail name)", () => {
    const result = parseScribeTitle("Run 2449");
    expect(result).toEqual({
      runNumber: 2449,
    });
  });

  it("handles non-standard title as trail name", () => {
    const result = parseScribeTitle("Special Anniversary Event");
    expect(result).toEqual({
      trailName: "Special Anniversary Event",
    });
  });

  it("returns null for empty string", () => {
    expect(parseScribeTitle("")).toBeNull();
  });

  it("is case-insensitive on 'Run'", () => {
    const result = parseScribeTitle("run 2453 – Test");
    expect(result).toEqual({
      runNumber: 2453,
      trailName: "Test",
    });
  });
});

// ---------------------------------------------------------------------------
// parseScribeBody
// ---------------------------------------------------------------------------

describe("parseScribeBody", () => {
  const sampleBody = `
Hares: Boner and Some Other Hasher
Location: Kensington Pub, 1131 Kensington Rd NW
RA: Chips Ahoy
Attendance: 35
Some other text that doesn't match any field.
`;

  it("extracts hares", () => {
    const result = parseScribeBody(sampleBody);
    expect(result.hares).toBe("Boner and Some Other Hasher");
  });

  it("extracts location", () => {
    const result = parseScribeBody(sampleBody);
    expect(result.location).toBe("Kensington Pub, 1131 Kensington Rd NW");
  });

  it("extracts RA", () => {
    const result = parseScribeBody(sampleBody);
    expect(result.ra).toBe("Chips Ahoy");
  });

  it("extracts attendance", () => {
    const result = parseScribeBody(sampleBody);
    expect(result.attendance).toBe("35");
  });

  it("returns undefined fields when not present", () => {
    const result = parseScribeBody("Just a paragraph with no fields.");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
    expect(result.ra).toBeUndefined();
    expect(result.attendance).toBeUndefined();
  });

  it("handles TBD as undefined", () => {
    const result = parseScribeBody("Hares: TBD\nLocation: TBA");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// processScribePost
// ---------------------------------------------------------------------------

describe("processScribePost", () => {
  it("processes a complete post into a RawEventData", () => {
    const title = "Run 2453 – A Hot Slippy Thong in the Cheeks";
    const body = `
Hares: Boner and Chips
Location: Kensington Pub
RA: Chips Ahoy
Attendance: 35
`;
    const result = processScribePost(
      title,
      body,
      "https://scribe.onon.org/2026/03/29/run-2453/",
      "2026-03-29T15:00:00",
    );
    expect(result).not.toBeNull();
    expect(result!.date).toBe("2026-03-29");
    expect(result!.kennelTags[0]).toBe("ch3-ab");
    expect(result!.runNumber).toBe(2453);
    expect(result!.title).toBe("A Hot Slippy Thong in the Cheeks");
    expect(result!.hares).toBe("Boner and Chips");
    expect(result!.location).toBe("Kensington Pub");
    expect(result!.sourceUrl).toBe("https://scribe.onon.org/2026/03/29/run-2453/");
    expect(result!.description).toContain("RA: Chips Ahoy");
    expect(result!.description).toContain("Attendance: 35");
  });

  it("returns null for unparseable date", () => {
    const result = processScribePost("Run 2453 – Test", "Hares: Someone", "url", "not-a-date");
    expect(result).toBeNull();
  });

  it("handles post with no body fields", () => {
    const result = processScribePost(
      "Run 2450 – Ode to Joy",
      "Just a story about the trail.",
      "https://scribe.onon.org/run-2450/",
      "2026-03-15",
    );
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(2450);
    expect(result!.hares).toBeUndefined();
    expect(result!.description).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// CalgaryH3ScribeAdapter
// ---------------------------------------------------------------------------

describe("CalgaryH3ScribeAdapter", () => {
  const adapter = new CalgaryH3ScribeAdapter();

  const mockSource = {
    id: "test-calgary-scribe",
    url: "https://scribe.onon.org/",
  } as Parameters<typeof adapter.fetch>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns events from WordPress API", async () => {
    vi.mocked(wordpressApi.fetchWordPressPosts).mockResolvedValue({
      posts: [
        {
          title: "Run 2453 – A Hot Slippy Thong in the Cheeks",
          content: `<p>Hares: Boner and Chips<br />
Location: Kensington Pub<br />
RA: Chips Ahoy<br />
Attendance: 35</p>`,
          url: "https://scribe.onon.org/2026/03/29/run-2453/",
          date: "2026-03-29T15:00:00",
        },
        {
          title: "Run 2452 – Ode to Joy",
          content: "<p>Hares: Some Hasher<br />Location: Ship &amp; Anchor</p>",
          url: "https://scribe.onon.org/2026/03/22/run-2452/",
          date: "2026-03-22T14:00:00",
        },
      ],
      fetchDurationMs: 300,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(2);
    expect(result.events[0].runNumber).toBe(2453);
    expect(result.events[0].kennelTags[0]).toBe("ch3-ab");
    expect(result.events[1].runNumber).toBe(2452);
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
          title: "Run 2453 – Good Post",
          content: "<p>Hares: Someone</p>",
          url: "https://scribe.onon.org/run-2453/",
          date: "2026-03-29",
        },
        {
          title: "",
          content: "<p>No title at all</p>",
          url: "https://scribe.onon.org/some-post/",
          date: "2026-03-28",
        },
      ],
      fetchDurationMs: 150,
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(2453);
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
      totalBeforeFilter: 0,
      fetchDurationMs: 50,
    });
  });
});
