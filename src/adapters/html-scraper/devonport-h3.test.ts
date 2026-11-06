import { readFileSync } from "node:fs";
import path from "node:path";
import type { Source } from "@/generated/prisma/client";
import { DevonportH3Adapter, parseAnnouncement, parseHareline, parseWhenTime, postLines, type DevonportPost } from "./devonport-h3";

vi.mock("../blogger-api", () => ({ fetchBloggerPosts: vi.fn() }));
import { fetchBloggerPosts } from "../blogger-api";

/** Real Blogger API posts from dhash.com captured 2026-11-05: [0] Run 2331 (hareline edited to 30/11), [1] Run 2326. */
const POSTS: DevonportPost[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/devonport-h3-posts-2026-11-05.json.fixture"), "utf8"),
);

describe("parseWhenTime", () => {
  it("uses the 'for' time as the start", () => {
    expect(parseWhenTime("Monday, 31 August 2026, 6.30pm for 6.45pm Sharp START (AEST)")).toBe("18:45");
    expect(parseWhenTime("Monday, 1 April 2024, 6.15pm")).toBe("18:15");
    expect(parseWhenTime("Monday, 1 April 2024")).toBe("18:45");
  });
});

describe("parseAnnouncement", () => {
  it("reads the labelled Hare/Where/When/Cost/Notes lines", () => {
    expect(parseAnnouncement(POSTS[0], postLines(POSTS[0].content))).toEqual({
      date: "2026-08-31",
      kennelTags: ["devonport-h3"],
      runNumber: 2331,
      startTime: "18:45",
      hares: "Lantern",
      location: "Durkins Road, powerlines parking side off road",
      cost: "$20.00",
      description: "OnOn @ 168 Stony Rise Road, Devonport",
      sourceUrl: POSTS[0].url,
    });
    expect(parseAnnouncement(POSTS[1], postLines(POSTS[1].content))).toMatchObject({
      date: "2026-07-27", runNumber: 2326, hares: "Gyno", location: "K-Tek Workshop, Matthews Way, Don", cost: "$20",
    });
  });

  it("ignores non-run posts", () => {
    expect(parseAnnouncement({ ...POSTS[0], title: "Christmas Party" }, postLines(POSTS[0].content))).toBeNull();
  });
});

describe("parseHareline", () => {
  it("reads Run NNNN – D/M Hare rows with the year from the publish date", () => {
    const rows = parseHareline(postLines(POSTS[0].content), POSTS[0].published, POSTS[0].url);
    expect(rows[0]).toMatchObject({ runNumber: 2332, date: "2026-09-07", hares: "Jinx" });
    // "Nez Please check dates as all have moved." → hare only
    expect(rows.find((r) => r.runNumber === 2334)?.hares).toBe("Nez");
    expect(rows.at(-1)).toMatchObject({ runNumber: 2344, date: "2026-11-30" });
    expect(rows.every((r) => new Date(`${r.date}T12:00:00Z`).getUTCDay() === 1)).toBe(true);
  });

  it("rolls D/M into the next year from a December post", () => {
    const rows = parseHareline(["Receding Hareline:", "Run 2350 – 4/1 Crow"], "2026-12-20T10:00:00+11:00", "u");
    expect(rows[0].date).toBe("2027-01-04");
  });
});

describe("DevonportH3Adapter.fetch", () => {
  const source = { url: "https://www.dhash.com/", scrapeDays: 365 } as Source;

  it("merges announcements with the newest post's hareline only", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: [POSTS[1], POSTS[0]], blogId: "7231198193475707740" });
    const result = await new DevonportH3Adapter().fetch(source, { days: 36500 });
    expect(result.errors).toEqual([]);
    const runs = result.events.map((e) => e.runNumber);
    expect(runs.slice(0, 2)).toEqual([2331, 2326]);
    // Run 2326's hareline (old numbering, e.g. "Run 2340 – 24/8") must not leak in.
    expect(result.events.some((e) => e.runNumber === 2340 && e.date === "2026-08-24")).toBe(false);
    expect(runs).toContain(2344);
  });

  it("fails loud when posts exist but none parse", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: [{ ...POSTS[0], title: "Notice", content: "hi" }], blogId: "x" });
    const result = await new DevonportH3Adapter().fetch(source);
    expect(result.errors[0]).toContain("parsed 0 runs");
  });
});
