import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import type { BloggerPost } from "../blogger-api";
import { stripHtmlTags } from "../utils";
import { parseTvh3Post, TeignValleyH3Adapter } from "./teign-valley-h3";

vi.mock("../blogger-api", () => ({ fetchBloggerPosts: vi.fn() }));
import { fetchBloggerPosts } from "../blogger-api";

/**
 * Real Blogger API v3 post objects captured 2026-11-05 from teignvalleyh3.com:
 * [0] #2153 firework hash (what3words, no hare clause)
 * [1] #2152 Halloween hash ("with Psycho for our Halloween Hash")
 * [2] #2147 venue with no "from", "Hare: Beefy" label run-on, W3W line
 * [3] #2100 stale day number ("Monday 28th October" in 2025 → Monday 27th)
 * [4] #2045 "7:15 pm Circle up from …" ordering, stale day (16th → Monday 14th)
 * [5] "TVH THE WORDS" recap of #2150 (must be skipped)
 * [6] "Awaiting words." stub (must be skipped)
 */
const POSTS: BloggerPost[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/teign-valley-h3-posts-2026-11-05.json.fixture"), "utf8"),
);

function parse(post: BloggerPost) {
  return parseTvh3Post(stripHtmlTags(post.content, "\n"), post.published, post.url);
}

describe("parseTvh3Post", () => {
  it("parses a run announcement with what3words and no hare", () => {
    expect(parse(POSTS[0])).toEqual({
      runNumber: 2153,
      date: "2026-11-02",
      startTime: "19:15",
      location: "Forrest's hideaway at Tinkley Bottom, Trusham, Newton Abbot TQ13 0NT",
      description: "what3words: ///princely.screeches.dissolve",
      hares: undefined,
      sourceUrl: POSTS[0].url,
    });
  });

  it("cuts the venue at the postcode and the hare at 'for our'", () => {
    const parsed = parse(POSTS[1]);
    expect(parsed).toMatchObject({
      runNumber: 2152,
      date: "2026-10-26",
      location: "Court Farm Inn, Abbotskerswell, Newton Abbot TQ12 5NY",
      hares: "Psycho",
    });
  });

  it("reads a venue with no 'from' and rejects a run-on hare label", () => {
    const parsed = parse(POSTS[2]);
    expect(parsed).toMatchObject({
      runNumber: 2147,
      date: "2026-09-21",
      location: "Manaton Church Car Park Manaton, Newton Abbot TQ13 9UJ",
      description: "what3words: ///parked.defected.nerves",
    });
    expect(parsed?.hares).toBeUndefined();
  });

  it("snaps a stale day number onto the stated weekday", () => {
    expect(parse(POSTS[3])).toMatchObject({ runNumber: 2100, date: "2025-10-27", hares: "Archangel" });
    expect(parse(POSTS[4])).toMatchObject({
      runNumber: 2045,
      date: "2024-10-14",
      hares: "Ollie, Poacher & Compo",
    });
  });

  it("skips recaps and stubs", () => {
    expect(parse(POSTS[5])).toBeNull();
    expect(parse(POSTS[6])).toBeNull();
  });

  it("infers the year across the Dec→Jan boundary from the publish date", () => {
    const parsed = parseTvh3Post(
      "Run #2162 Monday 4th January Circle up 7:15 pm from the Park Inn, Kingskerswell TQ12 5DB with Beefy.",
      "2026-12-30T10:00:00Z",
      "https://example.com/post",
    );
    expect(parsed).toMatchObject({ date: "2027-01-04", location: "Park Inn, Kingskerswell TQ12 5DB", hares: "Beefy" });
  });
});

describe("TeignValleyH3Adapter.fetch", () => {
  const source = { url: "https://www.teignvalleyh3.com/", scrapeDays: 365 } as Source;

  it("emits tvh3 events for announcements only", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: POSTS, blogId: "6215655085042468089" });
    const result = await new TeignValleyH3Adapter().fetch(source, { days: 36500 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([2153, 2152, 2147, 2100, 2045]);
    expect(result.events.every((e) => e.kennelTags[0] === "tvh3" && e.startTime === "19:15")).toBe(true);
    expect(result.events.every((e) => e.title === undefined)).toBe(true);
  });

  it("fails loud when posts exist but none parse", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: [POSTS[5], POSTS[6]], blogId: "x" });
    const result = await new TeignValleyH3Adapter().fetch(source, { days: 36500 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("parsed 0 run announcements");
  });

  it("surfaces a Blogger API error", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: [], error: { message: "HTTP 403", status: 403 } });
    const result = await new TeignValleyH3Adapter().fetch(source);
    expect(result.errors[0]).toContain("HTTP 403");
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);
  });
});
