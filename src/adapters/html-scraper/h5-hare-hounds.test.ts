import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { extractRunData, H5HareHoundsAdapter, parseH5Date, toEvent } from "./h5-hare-hounds";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

/** Real h5hashers.org.uk/hareline.php captured 2026-11-05 (inline runData JSON island). */
const HTML = readFileSync(path.join(__dirname, "fixtures/h5-hareline-2026-11-05.html.fixture"), "utf8");
const URL = "https://www.h5hashers.org.uk/hareline.php";

describe("extractRunData", () => {
  it("reads the inline runData array", () => {
    const runs = extractRunData(HTML);
    expect(runs).toHaveLength(13);
    expect(runs?.[0]).toMatchObject({ runno: "1868", date: "Sun 08 Nov 26", pub: "The Five Bells" });
  });

  it("returns null for a missing or malformed island", () => {
    expect(extractRunData("<html></html>")).toBeNull();
    expect(extractRunData('runData = [{"runno":1}];')).toBeNull();
    expect(extractRunData("runData = [oops];")).toBeNull();
  });
});

describe("parseH5Date", () => {
  it("parses 'Sun 08 Nov 26'", () => {
    expect(parseH5Date("Sun 08 Nov 26")).toBe("2026-11-08");
    expect(parseH5Date("Mon 31 Feb 27")).toBeNull();
  });
});

describe("toEvent", () => {
  it("maps pub/town/postcode and the streetmap link", () => {
    const runs = extractRunData(HTML)!;
    expect(toEvent(runs[0], URL)).toEqual({
      date: "2026-11-08",
      kennelTags: ["h5-gb"],
      runNumber: 1868,
      startTime: "11:00",
      hares: "Forking & Chipolatte",
      location: "The Five Bells",
      locationStreet: "Stanbridge, LU7 9JF",
      locationUrl: "https://streetmap.co.uk/map.srf?x=496362&y=224091",
      sourceUrl: URL,
    });
  });

  it("drops 'Hares Needed' and empty venues; Bank Holiday Monday starts 16:00", () => {
    const blank = { runno: "1880", date: "Mon 31 May 27", hares: "<font color=blue>Hares Needed</font>", town: "", pub: "", postcode: "", maplink: "" };
    expect(toEvent(blank, URL)).toMatchObject({ date: "2027-05-31", startTime: "16:00", hares: undefined, location: undefined, locationStreet: undefined, locationUrl: undefined });
  });
});

describe("H5HareHoundsAdapter.fetch", () => {
  const source = { url: URL, scrapeDays: 120 } as Source;
  const page = (html: string) => ({ ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1 }) as never;

  it("parses every runData row", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page(HTML));
    const result = await new H5HareHoundsAdapter().fetch(source, { days: 3650 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(13);
  });

  it("fails loud when the island is gone", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue(page("<html><body>maintenance</body></html>"));
    const result = await new H5HareHoundsAdapter().fetch(source);
    expect(result.errors[0]).toContain("runData array not found");
  });
});
