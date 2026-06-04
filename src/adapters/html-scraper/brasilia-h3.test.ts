import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseBrasiliaPost, BrasiliaH3Adapter } from "./brasilia-h3";
import { stripHtmlTags } from "../utils";
import * as bloggerApi from "../blogger-api";

vi.mock("../blogger-api");

// The adapter only reads source.url + source.scrapeDays. A single typed cast
// here keeps the fetch() call sites assertion-free (Sonar S4325).
function brasiliaSource(scrapeDays = 90): Source {
  return { id: "test-bsb", url: "https://brasiliah3.blogspot.com/", scrapeDays } as unknown as Source;
}

// Real N+340 post body (Praça dos Orixás Hash), trimmed. Titles are empty on
// this blog, so the run number + date live in the body. Published 2026-06-02,
// run on Sunday 7 June 2026.
const N340_HTML = [
  "<div>Hash N+340 \"Pra&#231;a dos Orix&#225;s Hash\"</div>",
  "<div>Sunday, 7th of June</div>",
  "<p>Welcome to Hash N+340: the lakeside edition.</p>",
  "<p>This week we gather at Pra&#231;a dos Orix&#225;s.</p>",
].join("");

describe("parseBrasiliaPost", () => {
  it("extracts run number and date from a post body (empty title, body-only)", () => {
    const body = stripHtmlTags(N340_HTML, "\n");
    const parsed = parseBrasiliaPost(body, "2026-06-02T17:29:24-03:00", "https://brasiliah3.blogspot.com/2026/06/n340.html");
    expect(parsed).not.toBeNull();
    expect(parsed?.runNumber).toBe(340);
    expect(parsed?.date).toBe("2026-06-07");
    expect(parsed?.sourceUrl).toBe("https://brasiliah3.blogspot.com/2026/06/n340.html");
    // No `Start:` label in this post → location stays undefined (merge geocodes prose).
    expect(parsed?.location).toBeUndefined();
  });

  it("returns null for a non-run post (no `Hash N+NNN` heading)", () => {
    const body = "Brasilia Hash House Harriers Weekend Away 2025\nFriday, 6th of June\nJoin us for the annual trip.";
    expect(parseBrasiliaPost(body, "2025-05-26T12:00:00-03:00", "https://brasiliah3.blogspot.com/x")).toBeNull();
  });

  it("returns null when a run post has no parseable date line", () => {
    const body = "Hash N+205\nNo date given this week, watch the group chat.";
    expect(parseBrasiliaPost(body, "2021-09-01T12:00:00-03:00", "https://brasiliah3.blogspot.com/x")).toBeNull();
  });

  it("returns null for an impossible date (round-trip guard)", () => {
    const body = "Hash N+500\nSunday, 31st of February";
    expect(parseBrasiliaPost(body, "2026-02-20T12:00:00-03:00", "https://brasiliah3.blogspot.com/x")).toBeNull();
  });

  it("extracts a clean `Start:`-labelled venue (inline form)", () => {
    const body = "Hash N+300\nSunday, 12th of April\nStart: SQN 107, Bloco C\nBring beer money.";
    const parsed = parseBrasiliaPost(body, "2025-04-07T12:00:00-03:00", "https://brasiliah3.blogspot.com/x");
    expect(parsed?.location).toBe("SQN 107, Bloco C");
  });

  it("extracts a venue from a `📍 Start` heading with the venue on the next line", () => {
    const body = "Hash N+335 \"University Hash\"\nSunday, 29th of March\n📍 Start\nSQS 406, Bloco K\n🏃 Runners\n6 km";
    const parsed = parseBrasiliaPost(body, "2026-03-24T12:00:00-03:00", "https://brasiliah3.blogspot.com/x");
    expect(parsed?.location).toBe("SQS 406, Bloco K");
  });

  it("does not treat mid-prose 'start at …' as a venue label", () => {
    const body = "Hash N+334 \"Richard Hash\"\nSunday, 15th of March\nWe start at the park at SQN 216, Bloco B, at the far end of Asa Norte.";
    const parsed = parseBrasiliaPost(body, "2026-03-10T12:00:00-03:00", "https://brasiliah3.blogspot.com/x");
    expect(parsed?.location).toBeUndefined();
  });

  it("ignores a placeholder venue", () => {
    const body = "Hash N+301\nSunday, 26th of April\nStart Location: TBD";
    const parsed = parseBrasiliaPost(body, "2025-04-21T12:00:00-03:00", "https://brasiliah3.blogspot.com/x");
    expect(parsed?.location).toBeUndefined();
  });

  // Year is absent from the date line; it is inferred as the year (pubY-1/pubY/pubY+1)
  // that puts the run closest to the publish date. Covers announcement, Dec→Jan
  // rollover, and recap-published-after-the-run cases.
  it.each([
    // label,             body date line,            published,                     expected date
    ["announcement",      "Sunday, 7th of June",     "2026-06-02T17:29:24-03:00",   "2026-06-07"],
    ["Dec→Jan rollover",  "Sunday, 3rd of January",  "2025-12-28T12:00:00-03:00",   "2026-01-03"],
    ["recap after run",   "Friday, 20th of January", "2023-02-10T12:00:00-03:00",   "2023-01-20"],
  ])("infers the year for the %s case", (_label, dateLine, published, expected) => {
    const body = `Hash N+123 "Theme Hash"\n${dateLine}\nSome prose.`;
    const parsed = parseBrasiliaPost(body, published, "https://brasiliah3.blogspot.com/x");
    expect(parsed?.date).toBe(expected);
  });
});

describe("BrasiliaH3Adapter.fetch", () => {
  let adapter: BrasiliaH3Adapter;

  beforeEach(() => {
    adapter = new BrasiliaH3Adapter();
    // Fix "now" so applyDateWindow(±90d) is deterministic (the API is mocked).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-04T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("parses run events from Blogger API posts", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "",
          content: N340_HTML,
          url: "https://brasiliah3.blogspot.com/2026/06/n340.html",
          published: "2026-06-02T17:29:24-03:00",
        },
        {
          title: "",
          content: "<div>Hash N+338 \"Farewell Hash\"</div><div>Sunday, 10th of May</div><p>Start: Road entrance to SQN 306, Asa Norte</p>",
          url: "https://brasiliah3.blogspot.com/2026/05/n338.html",
          published: "2026-05-05T15:42:00-03:00",
        },
      ],
      blogId: "777",
      fetchDurationMs: 120,
    });

    const result = await adapter.fetch(brasiliaSource());

    expect(result.errors).toHaveLength(0);
    expect(result.events).toHaveLength(2);
    expect(result.events[0]).toMatchObject({
      date: "2026-06-07",
      kennelTags: ["brasilia-h3"],
      runNumber: 340,
    });
    expect(result.events[0].title).toBeUndefined();
    expect(result.events[1]).toMatchObject({
      date: "2026-05-10",
      kennelTags: ["brasilia-h3"],
      runNumber: 338,
      location: "Road entrance to SQN 306, Asa Norte",
    });
    expect(result.diagnosticContext).toMatchObject({
      fetchMethod: "blogger-api",
      blogId: "777",
      postsFound: 2,
      eventsParsed: 2,
    });
    expect(result.diagnosticContext?.eventsParsed).toBe(2);
  });

  it("skips non-run posts (away-hash socials) without erroring", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "",
          content: "<div>Hash N+340 \"Pra&#231;a dos Orix&#225;s Hash\"</div><div>Sunday, 7th of June</div>",
          url: "https://brasiliah3.blogspot.com/2026/06/n340.html",
          published: "2026-06-02T17:29:24-03:00",
        },
        {
          title: "",
          content: "<div>Yearly Weekend Away Hash 2026</div><div>Friday, 6th of June to Sunday 8th</div>",
          url: "https://brasiliah3.blogspot.com/2026/05/away.html",
          published: "2026-05-20T12:00:00-03:00",
        },
      ],
      blogId: "777",
      fetchDurationMs: 90,
    });

    const result = await adapter.fetch(brasiliaSource());
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(340);
    expect(result.errors).toHaveLength(0);
  });

  it("fails loud when posts are fetched but none parse as runs", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [
        {
          title: "",
          content: "<div>Some announcement with no run heading and no date.</div>",
          url: "https://brasiliah3.blogspot.com/2026/06/x.html",
          published: "2026-06-02T12:00:00-03:00",
        },
      ],
      blogId: "777",
      fetchDurationMs: 80,
    });

    const result = await adapter.fetch(brasiliaSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors.some((e) => e.includes("parsed 0 run events"))).toBe(true);
  });

  it("surfaces a Blogger API error", async () => {
    vi.mocked(bloggerApi.fetchBloggerPosts).mockResolvedValueOnce({
      posts: [],
      error: { message: "Missing GOOGLE_CALENDAR_API_KEY environment variable" },
    });

    const result = await adapter.fetch(brasiliaSource());
    expect(result.events).toHaveLength(0);
    expect(result.errors[0]).toContain("Blogger API fetch failed");
    expect(result.errorDetails?.fetch?.[0].message).toContain("Blogger API fetch failed");
  });
});
