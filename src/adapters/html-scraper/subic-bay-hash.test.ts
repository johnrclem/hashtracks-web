import { readFileSync } from "node:fs";
import path from "node:path";
import type { BloggerPost } from "../blogger-api";
import { buildSubicBayEvents, cutAtLabel, parseRecapPost, resolveMonthDay, splitHares } from "./subic-bay-hash";

// Live Blogger posts from subicbayhash.blogspot.com (2026-11-05): the latest
// "Hareline" post, a text recap (Run 1723) and an image-only recap (Run 1731).
const POSTS: BloggerPost[] = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures/subic-bay-hash-posts-2026-11-05.json.fixture"), "utf-8"),
);
const recap1723 = POSTS.find((p) => p.title === "Run 1723")!;

describe("helpers", () => {
  it("resolves M/D to the year nearest the post date", () => {
    expect(resolveMonthDay("10/12", new Date("2026-10-13T00:00:00Z"))).toBe("2026-10-12");
    expect(resolveMonthDay("1/4", new Date("2026-12-20T00:00:00Z"))).toBe("2027-01-04");
    expect(resolveMonthDay("2/30", new Date("2026-10-13T00:00:00Z"))).toBeNull();
  });
  it("splits hares on / and spaced &, keeping F&L whole", () => {
    expect(splitHares("Tiny Cunt/F&L")).toBe("F&L, Tiny Cunt");
    expect(splitHares("Fuck Buddy & Anal Intruder")).toBe("Anal Intruder, Fuck Buddy");
    expect(splitHares(" ")).toBeUndefined();
  });
});

describe("cutAtLabel", () => {
  it("stops the start point at a following label", () => {
    expect(cutAtLabel("Savers Hares: Demolition Derby/Stewed Rat")).toBe("Savers");
    expect(cutAtLabel("The VFW Run fees: Men . . P450")).toBe("The VFW");
    expect(cutAtLabel("Court 4 Rizal Ext.")).toBe("Court 4 Rizal Ext.");
  });
});

describe("parseRecapPost", () => {
  it("reads start time, start point, DMS coords, on-home and hares", () => {
    expect(parseRecapPost(recap1723)).toMatchObject({
      runNumber: 1723,
      startTime: "14:00",
      start: "Court 4 Rizal Ext",
      onHome: "Bella Monte",
      hares: "Leech My Nuggets",
    });
    expect(parseRecapPost(recap1723)?.latitude).toBeCloseTo(14.867, 2);
  });
  it("returns null for an image-only recap", () => {
    expect(parseRecapPost(POSTS.find((p) => p.title === "Run 1731")!)).toBeNull();
  });
});

describe("buildSubicBayEvents", () => {
  it("emits one event per Hareline row, Mondays, sorted", () => {
    const events = buildSubicBayEvents(POSTS);
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [1727, "2026-10-12"], [1728, "2026-10-19"], [1729, "2026-10-26"], [1730, "2026-11-02"],
      [1731, "2026-11-09"], [1732, "2026-11-16"], [1733, "2026-11-23"], [1734, "2026-11-30"],
      [1735, "2026-12-07"], [1736, "2026-12-14"],
    ]);
    expect(events[0]).toMatchObject({ kennelTags: ["sbh3-ph"], hares: "F&L, Tiny Cunt", location: "Johansson's", startTime: "14:00" });
    expect(events[4]).toMatchObject({ hares: undefined, location: undefined });
    expect(events.every((e) => e.title === undefined)).toBe(true);
  });

  it("ignores a recap far from its hareline date", () => {
    // Run 1723 (Sept) is not in the October Hareline post, so nothing is overlaid.
    const events = buildSubicBayEvents(POSTS);
    expect(events.some((e) => e.latitude !== undefined)).toBe(false);
  });
});
