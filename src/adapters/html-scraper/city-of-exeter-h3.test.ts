import type { Source } from "@/generated/prisma/client";
import { CityOfExeterH3Adapter, parseCoeh3Title } from "./city-of-exeter-h3";

vi.mock("../blogger-api", () => ({ fetchBloggerPosts: vi.fn() }));
import { fetchBloggerPosts } from "../blogger-api";

/** Real recap titles + publish timestamps from cityofexeterhhh.blogspot.com (Blogger API, 2026-11-05). */
const REAL = [
  ["#1279 Chudleigh Knighton play park - NoButt and Mouthful - 11 October 2026", "2026-10-11T13:27:58+01:00"],
  ["#1278 Danes Wood - Can't Tell and Capt 🦚 - 4 Oct 2026", "2026-10-04T15:57:23+01:00"],
  ["#1275 Forest Gate Ashclyst - Sorepoint and Paperwork - 13 Sept 2026", "2026-09-13T17:55:03+01:00"],
  ["#1274 25th Anniversary Hash - Wide with a little help from Groucho - 6 September 2026", "2026-09-13T17:41:26+01:00"],
  ["#1273 Spockfest hangover hash - 30 August 2026", "2026-09-13T17:38:20+01:00"],
  ["#1250 Wonford Sports Centre car park - 15 March 2026 - Happy Snapper", "2026-03-15T14:00:00Z"],
  ["#1258 Exeter Arena - Can't Spell - May 10 2026", "2026-05-10T14:00:00+01:00"],
  ["#1254 Joney's Cross - Pearl - 12:April 2026", "2026-04-12T14:00:00+01:00"],
  ["#1186 Swans Nest, Exminster - Speedy - 22 Dec 2025", "2024-12-22T14:00:00Z"],
  ["#1232 Cricketfield Road, Newton Abbot - Brillo - 2nnd November 2025", "2025-11-02T14:00:00Z"],
  ["#1078 - Iford Manor (AGPU) - Spocky - 13 Nov 2022", "2022-11-13T14:00:00Z"],
  ["#1081 King George V playing fields - Speedy and Stix 4 Dec 2022 ", "2022-12-04T14:00:00Z"],
] as const;

describe("parseCoeh3Title", () => {
  const parse = (i: number) => parseCoeh3Title(REAL[i][0], REAL[i][1]);

  it("parses venue - hares - date", () => {
    expect(parse(0)).toEqual({
      runNumber: 1279, date: "2026-10-11", title: undefined,
      location: "Chudleigh Knighton play park", hares: "NoButt and Mouthful",
    });
    expect(parse(1)).toMatchObject({ date: "2026-10-04", location: "Danes Wood", hares: "Can't Tell and Capt 🦚" });
    expect(parse(2)).toMatchObject({ date: "2026-09-13", hares: "Sorepoint and Paperwork" });
  });

  it("treats a hash-named first segment as the title", () => {
    expect(parse(3)).toMatchObject({
      runNumber: 1274, date: "2026-09-06", title: "25th Anniversary Hash",
      location: undefined, hares: "Wide with a little help from Groucho",
    });
    expect(parse(4)).toMatchObject({ date: "2026-08-30", title: "Spockfest hangover hash", hares: undefined });
  });

  it("handles date-in-the-middle, month-first and colon variants", () => {
    expect(parse(5)).toMatchObject({ date: "2026-03-15", location: "Wonford Sports Centre car park", hares: "Happy Snapper" });
    expect(parse(6)).toMatchObject({ date: "2026-05-10", hares: "Can't Spell" });
    expect(parse(7)).toMatchObject({ date: "2026-04-12", hares: "Pearl" });
    expect(parse(9)).toMatchObject({ date: "2025-11-02", hares: "Brillo" });
    expect(parse(10)).toMatchObject({ date: "2022-11-13", location: "Iford Manor (AGPU)", hares: "Spocky" });
    expect(parse(11)).toMatchObject({ date: "2022-12-04", hares: "Speedy and Stix" });
  });

  it("takes the year from the publish date, not a mistyped title year", () => {
    expect(parse(8)).toMatchObject({ runNumber: 1186, date: "2024-12-22" });
  });

  it("skips notices and dateless titles", () => {
    expect(parseCoeh3Title("Updated City of Exeter H3 hash diary", "2022-12-01T10:00:00Z")).toBeNull();
    expect(parseCoeh3Title("#1272 Glory Hole, Exminster - Stix and Bollards", "2026-09-13T10:00:00Z")).toBeNull();
  });
});

describe("CityOfExeterH3Adapter.fetch", () => {
  const source = { url: "https://cityofexeterhhh.blogspot.com/", scrapeDays: 365 } as Source;
  const post = (title: string, published: string) => ({ title, published, content: "", url: `https://x/${published}` });

  it("emits coeh3 events with 11:00 on Sundays only", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({
      posts: [post(REAL[0][0], REAL[0][1]), post("#1271 BBQ at Zoot and Hotlips' abode - 15 Aug 2026", "2026-09-13T17:00:00Z"), post("AGM minutes", "2026-01-01T10:00:00Z")],
      blogId: "3873293245506806577",
    });
    const result = await new CityOfExeterH3Adapter().fetch(source, { days: 36500 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => [e.runNumber, e.startTime])).toEqual([[1279, "11:00"], [1271, undefined]]);
    expect(result.events.every((e) => e.kennelTags[0] === "coeh3")).toBe(true);
  });

  it("fails loud when posts exist but none parse", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: [post("AGM minutes", "2026-01-01T10:00:00Z")], blogId: "x" });
    const result = await new CityOfExeterH3Adapter().fetch(source);
    expect(result.errors[0]).toContain("parsed 0 run titles");
  });

  it("surfaces a Blogger API error", async () => {
    vi.mocked(fetchBloggerPosts).mockResolvedValue({ posts: [], error: { message: "HTTP 403", status: 403 } });
    const result = await new CityOfExeterH3Adapter().fetch(source);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);
  });
});
