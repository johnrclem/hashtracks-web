import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { formatPostcode, parseWfDate, parseWfRows, WyreForestHashAdapter } from "./wyre-forest-hash";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

/**
 * Real wyreforesthhh.org.uk pages captured 2026-11-05 via the residential proxy:
 * the forward index.php hareline, and an excerpt of the Page_on-back.php archive
 * (first 3 + last 2 of its 929 rows; markup unchanged).
 */
const fixture = (name: string) => readFileSync(path.join(__dirname, "fixtures", name), "utf8");
const INDEX = fixture("wfh3-index-2026-11-05.html.fixture");
const ARCHIVE = fixture("wfh3-archive-excerpt-2026-11-05.html.fixture");

describe("helpers", () => {
  it("parses '12th Nov 2026'", () => {
    expect(parseWfDate("12th Nov 2026")).toBe("2026-11-12");
    expect(parseWfDate("Number")).toBeNull();
  });

  it("re-spaces compact postcodes", () => {
    expect(formatPostcode("SY83LZ")).toBe("SY8 3LZ");
    expect(formatPostcode("WR26LX")).toBe("WR2 6LX");
    expect(formatPostcode("not a postcode")).toBe("not a postcode");
  });
});

describe("parseWfRows", () => {
  it("parses the forward hareline (unclosed <td> layout table)", () => {
    const rows = parseWfRows(cheerio.load(INDEX), "u");
    expect(rows.map((r) => r.runNumber)).toEqual([930, 931, 932, 933, 934, 935, 936]);
    expect(rows[0]).toEqual({
      date: "2026-11-12",
      kennelTags: ["wfh3"],
      runNumber: 930,
      startTime: "19:00",
      location: "Camp at Grimley",
      locationStreet: "WR2 6LX",
      locationUrl: "https://www.google.com/maps/dir/?api=1&destination=WR26LX",
      hares: "Still Keen",
      description: undefined,
      sourceUrl: "u",
    });
    expect(rows[1]).toMatchObject({ location: undefined, locationStreet: undefined, hares: "Herr Flash" });
  });

  it("parses the archive via data-order, skipping OS grid refs as streets", () => {
    const rows = parseWfRows(cheerio.load(ARCHIVE), "u");
    expect(rows[0]).toMatchObject({
      runNumber: 1,
      date: "2008-05-01",
      location: "Royal Forester at Callow Hill, Bewdley",
      locationStreet: undefined,
      locationUrl: undefined,
      hares: "Compost & Pant Buster",
    });
    expect(rows.at(-1)).toMatchObject({ runNumber: 929, date: "2026-11-05", locationStreet: "DY7 6HZ" });
  });
});

describe("WyreForestHashAdapter.fetch", () => {
  const page = (html: string) => ({ ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1 }) as never;

  it("fetches through the residential proxy when configured", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page(INDEX));
    const source = { url: "https://www.wyreforesthhh.org.uk/index.php", scrapeDays: 90, config: { useResidentialProxy: true } } as unknown as Source;
    const result = await new WyreForestHashAdapter().fetch(source, { days: 3650 });
    expect(fetchHTMLPage).toHaveBeenCalledWith(source.url, { useResidentialProxy: true });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(7);
  });

  it("fails loud on an empty table", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page("<table></table>"));
    const result = await new WyreForestHashAdapter().fetch({ url: "https://x/", config: {} } as unknown as Source);
    expect(result.errors[0]).toContain("0 runs parsed");
  });
});
