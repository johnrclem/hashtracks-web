import { describe, it, expect, beforeEach, vi } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return { ...actual, fetchHTMLPage: vi.fn() };
});

import { fetchHTMLPage } from "../utils";
import { parseHanoiH3Page, HanoiH3Adapter } from "./hanoi-h3";

const SOURCE_URL = "https://hanoih3.com/";
const mockFetchHTMLPage = vi.mocked(fetchHTMLPage);

/**
 * Live-shaped fixture (captured 2026-06-22). Reproduces the real quirks:
 *  - a two-column layout where a stray "No. 1763" gallery caption lives in the
 *    SECOND column and must NOT shadow the real run heading,
 *  - hares published in a separate <p> well below the <h4> heading,
 *  - the first-pickup maps shortlink with the next run's "No." glued onto it.
 */
const FIXTURE_1820 = `<!DOCTYPE html><html><head><meta name="generator" content="WordPress.com" /></head><body>
<div class="wp-block-columns is-layout-flex">
<div class="wp-block-column is-layout-flow">
<h2 class="wp-block-heading"><br>Upcoming runs (the bus 🚐 leaves at 14.00 pm)Summer time schedule.</h2>
<h4 class="wp-block-heading">No.1820 on saturday, June,20th,2026 (A-B Run)<br>You will see special hidden part of the city, green area, rice fields, beautiful countryside.<br>📌 Location: Soc Son outside of Hanoi city.<br>🚶‍♂️ Walking : ~6km+<br>🏃 Running : ~8km+<br>📍First pick up: 08 Hai Bà Trưng Street, Hoàn Kiếm District. old quater. Hanoi<br>https://maps.app.goo.gl/FTavtwpc4hAoQTik7No.</h4>
<p class="wp-block-paragraph">** Second Pick up: 14:15 PM &#8211; 12 Đào Tấn Street, Ba Đình District<br>https://maps.app.goo.gl/LZJSZGKTpamgPodt8</p>
<p class="wp-block-paragraph">🍻 On On after : restaurant!<br>🐇 Hares: Faster Than Diarrhea and Finger In Van Dyke<br>&#8220;A drinking club with a running problem&#8221;.</p>
<p class="wp-block-paragraph">On On!👣</p>
</div>
<div class="wp-block-column is-layout-flow">
<div class="wp-block-jetpack-slideshow"><figure><figcaption class="wp-block-jetpack-slideshow_caption gallery-caption">No. 1763 Cold bia hoi run</figcaption></figure></div>
</div>
</div>
</body></html>`;

/** Prior-week capture (#1819): different comma format + a clean first-pickup URL. */
const FIXTURE_1819 = `<!DOCTYPE html><html><head></head><body>
<div class="wp-block-columns">
<div class="wp-block-column">
<h2 class="wp-block-heading">Upcoming runs (the bus 🚐 leaves at 14.00 pm)</h2>
<h4 class="wp-block-heading">No.1819 on saturday, June 13th, 2026 (A-B Run)<br>Beautiful trail near the lake.<br>📌 Location: Ba Vi National Park.<br>🚶‍♂️ Walking : ~5km+<br>🏃 Running : ~7km+<br>📍First pick up: 08 Hai Bà Trưng Street, Hoàn Kiếm District<br>https://maps.app.goo.gl/AbCdEfGhJkLmNpQr</h4>
<p class="wp-block-paragraph">🐇 Hares: Overfried Noodles and Co</p>
</div>
</div>
</body></html>`;

describe("parseHanoiH3Page", () => {
  it("parses the current-run block (#1820), scoping past the stray gallery caption", () => {
    const { event, error } = parseHanoiH3Page(FIXTURE_1820, SOURCE_URL);
    expect(error).toBeUndefined();
    expect(event).not.toBeNull();
    // 1820, NOT the slideshow column's "No. 1763" caption → column scoping works.
    expect(event).toMatchObject({
      date: "2026-06-20",
      kennelTags: ["hanoi-h3"],
      runNumber: 1820,
      hares: "Faster Than Diarrhea and Finger In Van Dyke",
      location: "Soc Son outside of Hanoi city.",
      locationStreet: "08 Hai Bà Trưng Street, Hoàn Kiếm District. old quater. Hanoi",
      trailLengthText: "Walking ~6km+ / Running ~8km+",
      sourceUrl: SOURCE_URL,
    });
    // Run-type "(A-B Run)" is NOT a theme → title undefined (merge synthesizes "Hanoi H3 Trail #N").
    expect(event?.title).toBeUndefined();
    // Trail blurb → description.
    expect(event?.description).toContain("special hidden part of the city");
  });

  it("strips the glued next-run 'No.' artifact off the first-pickup maps shortlink", () => {
    const { event } = parseHanoiH3Page(FIXTURE_1820, SOURCE_URL);
    expect(event?.locationUrl).toBe("https://maps.app.goo.gl/FTavtwpc4hAoQTik7");
  });

  it("parses the prior-week shape (#1819) with comma variance + a clean URL", () => {
    const { event, error } = parseHanoiH3Page(FIXTURE_1819, SOURCE_URL);
    expect(error).toBeUndefined();
    expect(event).toMatchObject({
      date: "2026-06-13",
      runNumber: 1819,
      hares: "Overfried Noodles and Co",
      location: "Ba Vi National Park.",
      locationUrl: "https://maps.app.goo.gl/AbCdEfGhJkLmNpQr",
    });
    expect(event?.title).toBeUndefined();
  });

  it("treats a 'Hares Needed' placeholder as no hares", () => {
    const html = FIXTURE_1820.replace("Faster Than Diarrhea and Finger In Van Dyke", "Hares Needed");
    const { event } = parseHanoiH3Page(html, SOURCE_URL);
    expect(event?.hares).toBeUndefined();
  });

  it("keeps a real occasion/theme as the title", () => {
    const html = FIXTURE_1820.replace("(A-B Run)", "(Sue's Birthday Run)");
    const { event } = parseHanoiH3Page(html, SOURCE_URL);
    expect(event?.title).toBe("Sue's Birthday Run");
  });

  it("fails loud when the run heading is absent (markup drift)", () => {
    const html = "<html><body><div class=\"wp-block-column\"><h2>Upcoming runs</h2><p>No run this week</p></div></body></html>";
    const { event, error } = parseHanoiH3Page(html, SOURCE_URL);
    expect(event).toBeNull();
    expect(error).toMatch(/no .*run heading/i);
  });

  it("fails loud when the date token is unparseable (drift guard)", () => {
    const html = FIXTURE_1820.replace("saturday, June,20th,2026", "qqqq");
    const { event, error } = parseHanoiH3Page(html, SOURCE_URL);
    expect(event).toBeNull();
    expect(error).toMatch(/could not extract date/i);
  });
});

describe("HanoiH3Adapter", () => {
  beforeEach(() => mockFetchHTMLPage.mockReset());

  it("fetches and parses the live-shaped page into one event", async () => {
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      html: FIXTURE_1820,
      $: cheerio.load(FIXTURE_1820),
      structureHash: "hash",
      fetchDurationMs: 1,
    });

    const result = await new HanoiH3Adapter().fetch({ url: SOURCE_URL } as Source);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ runNumber: 1820, date: "2026-06-20" });
    expect(result.diagnosticContext?.eventsParsed).toBe(1);
  });

  it("fails loud (events [] + error) when the markup drifts", async () => {
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      html: "<html><body><p>Brand new design</p></body></html>",
      $: cheerio.load("<html></html>"),
      structureHash: "hash",
      fetchDurationMs: 1,
    });

    const result = await new HanoiH3Adapter().fetch({ url: SOURCE_URL } as Source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/run heading/i);
  });
});
