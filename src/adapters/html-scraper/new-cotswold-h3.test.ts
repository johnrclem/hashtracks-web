import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { NewCotswoldH3Adapter, parseRowDate, parseRunTable } from "./new-cotswold-h3";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

/** Real newch3.org.uk pages captured 2026-11-05. */
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const HOME = fixture("newch3-home-2026-11-05.html.fixture");
const PAST = fixture("newch3-past-2026-11-05.html.fixture");

describe("parseRowDate", () => {
  it("parses ordinal dates, ignoring the Christmas tree", () => {
    expect(parseRowDate("8th November, 2026")).toBe("2026-11-08");
    expect(parseRowDate("🎄 20th December, 2026")).toBe("2026-12-20");
    expect(parseRowDate("Date")).toBeNull();
  });
});

describe("parseRunTable", () => {
  it("parses the homepage Upcoming Trails table", () => {
    const rows = parseRunTable(cheerio.load(HOME), "https://www.newch3.org.uk/");
    expect(rows.map((r) => [r.runNumber, r.date])).toEqual([
      [188, "2026-11-08"], [189, "2026-11-22"], [190, "2026-12-06"], [191, "2026-12-20"],
    ]);
    expect(rows[0]).toMatchObject({
      startTime: "11:00",
      location: "The Bridge Inn",
      locationStreet: "Offenham, WR11 8QZ",
      locationUrl: "https://maps.app.goo.gl/BhRLfp7EcPfKcnEv6",
      hares: "Turbo & Trolley Dolly",
    });
    // colspan="2" TBD row: no venue/address, hares still read from the last cell.
    expect(rows[1]).toMatchObject({ location: undefined, locationStreet: undefined, hares: "Zandra Woes" });
    expect(rows[3].hares).toBe("Foxy Lady & Dead Animal");
  });

  it("parses the full /past/ archive from run #1", () => {
    const rows = parseRunTable(cheerio.load(PAST), "https://www.newch3.org.uk/past/");
    expect(rows.length).toBeGreaterThanOrEqual(186);
    expect(rows.find((r) => r.runNumber === 1)).toMatchObject({
      date: "2019-01-13",
      location: "Cheltenham North RFC",
      locationStreet: "Bishops Cleeve, GL52 7DG",
      hares: "Dr Foster & Robo",
    });
  });
});

describe("NewCotswoldH3Adapter.fetch", () => {
  const source = { url: "https://www.newch3.org.uk/", scrapeDays: 90 } as Source;
  const page = (html: string) => ({ ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1 }) as never;

  it("returns the upcoming runs", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page(HOME));
    const result = await new NewCotswoldH3Adapter().fetch(source, { days: 3650 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
  });

  it("fails loud on an empty table", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page("<table></table>"));
    const result = await new NewCotswoldH3Adapter().fetch(source);
    expect(result.errors[0]).toContain("0 runs parsed");
  });
});
