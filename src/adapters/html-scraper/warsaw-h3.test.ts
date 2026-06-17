import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";

// The fail-loud guard lives in the adapter's fetch(), which calls fetchHTMLPage;
// mock only that (keep the real stripHtmlTags / MONTHS the parser relies on).
vi.mock("../utils", async () => {
  const actual = await vi.importActual("../utils");
  return { ...actual, fetchHTMLPage: vi.fn() };
});

import { fetchHTMLPage } from "../utils";
import { parseWarsawH3Page, WarsawH3Adapter } from "./warsaw-h3";

const mockFetchHTMLPage = vi.mocked(fetchHTMLPage);
const SOURCE_URL = "https://warsawh3.com/";

/**
 * Verbatim from warsawh3.com (captured 2026-06-17). The whole forward feed is a
 * single <p class="… display-7"> with <br> separators. Two DECOY display-7
 * paragraphs above it (the "Welcome" blurb mentioning "WH3" + "1983 … 1600
 * times", and the generic "The Hash is a loose association" text) are included
 * to prove the parser anchors on the "WH3 Run #" marker, not "first paragraph".
 * The mid-string newlines after each list date mirror the real Mobirise markup.
 */
const FIXTURE = `<!DOCTYPE html><html><head>
<meta name="generator" content="Mobirise v6.0.1, mobirise.com">
</head><body>
<section class="header2"><div class="container"><div class="row">
<p class="mbr-text mbr-fonts-style display-7">Welcome to the website of the Warsaw Hash House Harriers, otherwise known as the WH3! Established in 1983, the WH3 has run more than 1600 times.
<br><br>The WH3 is not a serious running club - those who want to run do so, but many of us just stroll around the trails at our own lazy pace.</p>
</div></div></section>
<section class="article"><div class="container"><div class="row">
<p class="mbr-text mbr-fonts-style display-7">The Hash is a loose association of people from all sorts of backgrounds, who meet twice a month for a run (or walk...), followed by a few beers.</p>
</div></div></section>
<section class="article"><div class="container"><div class="row">
<h5 class="item-title mbr-fonts-style display-5"><strong>WH3 meets every second Saturday. The next run is:</strong></h5>
<p class="mbr-text mbr-fonts-style display-7">WH3 Run #1643<br>Sat 20 June 2026, 14h00<br><br><strong>Where?</strong><br>Meet at the Presidential Hotel opposite the central railway station<br><br><strong>Who?</strong><br>The trail will be set by:<br>Stiff Pointer<br><br><strong>Upcoming runs</strong><br><br>#1644 July 4, 2026
<br>Hare: Chasing Yanks<br><br>#1645 July 18, 2026
<br>Hare: ???<br><br>#1646 August 1, 2026
<br>Hare: It Could Be You!<br></p>
</div></div></section>
</body></html>`;

function eventsByRun(html: string) {
  const { events, errors } = parseWarsawH3Page(html, SOURCE_URL);
  return { byRun: new Map(events.map((e) => [e.runNumber, e])), events, errors };
}

describe("parseWarsawH3Page", () => {
  it("parses all 4 runs (next-run + upcoming list) merged by run number, sorted by date", () => {
    const { events, errors } = parseWarsawH3Page(FIXTURE, SOURCE_URL);
    expect(errors).toEqual([]);
    expect(events.map((e) => e.runNumber)).toEqual([1643, 1644, 1645, 1646]);
    expect(events.map((e) => e.date)).toEqual([
      "2026-06-20", // D Month YYYY (next-run block)
      "2026-07-04", // Month D, YYYY (upcoming list)
      "2026-07-18",
      "2026-08-01",
    ]);
  });

  it("extracts time + venue from the next-run block, undefined on upcoming rows", () => {
    const { byRun } = eventsByRun(FIXTURE);
    expect(byRun.get(1643)).toMatchObject({
      startTime: "14:00",
      location: "Meet at the Presidential Hotel opposite the central railway station",
    });
    for (const rn of [1644, 1645, 1646]) {
      expect(byRun.get(rn)?.startTime).toBeUndefined();
      expect(byRun.get(rn)?.location).toBeUndefined();
    }
  });

  it("keeps real hares but clears placeholders (??? / It Could Be You!) with null (#2032)", () => {
    // null = explicit clear (the source says "no hare yet") so a stale hare on
    // the canonical event is cleared, not preserved. undefined = no signal.
    const { byRun } = eventsByRun(FIXTURE);
    expect(byRun.get(1643)?.hares).toBe("Stiff Pointer");
    expect(byRun.get(1644)?.hares).toBe("Chasing Yanks");
    expect(byRun.get(1645)?.hares).toBeNull();
    expect(byRun.get(1646)?.hares).toBeNull();
  });

  it("distinguishes placeholder hare (null = clear) from a missing Hare: line (undefined = preserve)", () => {
    // Placeholder present → explicit clear.
    const placeholder = FIXTURE.replace("Hare: Chasing Yanks", "Hare: ???");
    expect(eventsByRun(placeholder).byRun.get(1644)?.hares).toBeNull();
    // No Hare: line at all for #1644 → no signal, preserve existing.
    const missing = FIXTURE.replace("<br>Hare: Chasing Yanks", "");
    expect(eventsByRun(missing).byRun.get(1644)?.hares).toBeUndefined();
  });

  it("leaves title undefined (merge synthesizes 'Warsaw H3 Trail #N') and tags warsaw-h3", () => {
    const { events } = parseWarsawH3Page(FIXTURE, SOURCE_URL);
    for (const e of events) {
      expect(e.title).toBeUndefined();
      expect(e.kennelTags).toEqual(["warsaw-h3"]);
      expect(e.sourceUrl).toBe(SOURCE_URL);
    }
  });

  it("ignores decoy blurb paragraphs — no spurious events", () => {
    expect(parseWarsawH3Page(FIXTURE, SOURCE_URL).events).toHaveLength(4);
  });

  it("keeps the next-run hare clean even if the 'Upcoming runs' heading drifts", () => {
    // Drop the heading text but keep the list rows — the next-run block must
    // still stop at the first "#NNNN …" row, not absorb the list into #1643.
    const drifted = FIXTURE.replace("<strong>Upcoming runs</strong><br><br>", "");
    const { byRun, events } = eventsByRun(drifted);
    expect(events).toHaveLength(4);
    expect(byRun.get(1643)?.hares).toBe("Stiff Pointer");
    expect(byRun.get(1644)?.hares).toBe("Chasing Yanks");
  });

  it("returns no events when the run block is absent (drift)", () => {
    const { events } = parseWarsawH3Page(
      "<html><body><p>Site under construction</p></body></html>",
      SOURCE_URL,
    );
    expect(events).toEqual([]);
  });
});

describe("WarsawH3Adapter", () => {
  beforeEach(() => mockFetchHTMLPage.mockReset());

  it("fetches and parses the live-shaped page into 4 events", async () => {
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      html: FIXTURE,
      $: cheerio.load(FIXTURE),
      structureHash: "hash",
      fetchDurationMs: 1,
    } as never);

    const result = await new WarsawH3Adapter().fetch({ url: SOURCE_URL } as Source);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(4);
    expect(result.diagnosticContext?.eventsParsed).toBe(4);
  });

  it("fails loud when Mobirise markup drifts (events [] → error pushed)", async () => {
    mockFetchHTMLPage.mockResolvedValue({
      ok: true,
      html: "<html><body><p>Brand new design</p></body></html>",
      $: cheerio.load("<html></html>"),
      structureHash: "hash",
      fetchDurationMs: 1,
    } as never);

    const result = await new WarsawH3Adapter().fetch({ url: SOURCE_URL } as Source);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/markup may have changed/i);
  });
});
