import { readFileSync } from "node:fs";
import path from "node:path";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { parseForwardRows, parseNextRun, parseStartBanner, TamarValleyH3Adapter } from "./tamar-valley-h3";

vi.mock("../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../utils")>()),
  fetchHTMLPage: vi.fn(),
}));
import { fetchHTMLPage } from "../utils";

/** Real tvh3.co.uk homepage captured 2026-11-05 (iso-8859-1, MS-Word/FrontPage markup). */
const HTML = new TextDecoder("iso-8859-1").decode(
  readFileSync(path.join(__dirname, "fixtures/tamar-valley-h3-index-2026-11-05.html.fixture")),
);
const URL = "https://www.tvh3.co.uk/";

describe("Tamar Valley H3 homepage", () => {
  const $ = cheerio.load(HTML);

  it("reads the start time from the site banner", () => {
    expect(parseStartBanner($("body").text().replaceAll(/\s+/g, " "))).toBe("19:00");
    expect(parseStartBanner("no banner here")).toBe("19:00");
    expect(parseStartBanner("TVH3 runs start at 7.30pm")).toBe("19:30");
  });

  it("parses the labelled next-run block", () => {
    expect(parseNextRun($, "19:00", URL)).toEqual({
      date: "2026-11-09",
      kennelTags: ["tamar-h3"],
      runNumber: 2381,
      startTime: "19:00",
      location: "Denham Woods Car Park",
      hares: "Bottom & Trip Advisor",
      description: "Start what3words: ///joke.huddled.whisker\nOn Down: Drake Manor Inn, Buckland Monachorum",
      sourceUrl: URL,
    });
  });

  it("parses the forward table with DD/MM/YY dates and TBA placeholders", () => {
    const rows = parseForwardRows($, "19:00", URL);
    expect(rows.map((r) => [r.runNumber, r.date])).toEqual([
      [2382, "2026-11-16"],
      [2383, "2026-11-23"],
      [2384, "2026-11-30"],
      [2385, "2026-12-07"],
      [2386, "2026-12-14"],
    ]);
    expect(rows[0]).toMatchObject({
      hares: "Scupper Sucker & Pist 'N' Broke",
      location: "Little Down Lane, Roborough Down",
      description: "On Down: The Walkhampton Inn, Walkhampton",
    });
    expect(rows[1].location).toBeUndefined();
    expect(rows[1].description).toBeUndefined();
  });

  it("returns null when the next-run block is missing", () => {
    expect(parseNextRun(cheerio.load("<table><tr><td>Hello</td></tr></table>"), "19:00", URL)).toBeNull();
  });
});

describe("TamarValleyH3Adapter.fetch", () => {
  const source = { url: URL, scrapeDays: 90 } as Source;

  it("merges the next run with the forward table", async () => {
    vi.mocked(fetchHTMLPage).mockResolvedValue({
      ok: true, $: cheerio.load(HTML), html: HTML, structureHash: "h", fetchDurationMs: 1,
    } as never);
    const result = await new TamarValleyH3Adapter().fetch(source, { days: 3650 });
    expect(result.errors).toEqual([]);
    expect(result.events.map((e) => e.runNumber)).toEqual([2381, 2382, 2383, 2384, 2385, 2386]);
  });

  it("fails loud when the next-run block is missing", async () => {
    const html = "<table><tr><td>Hi</td></tr></table>";
    vi.mocked(fetchHTMLPage).mockResolvedValue({
      ok: true, $: cheerio.load(html), html, structureHash: "h", fetchDurationMs: 1,
    } as never);
    const result = await new TamarValleyH3Adapter().fetch(source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("next-run block");
  });
});
