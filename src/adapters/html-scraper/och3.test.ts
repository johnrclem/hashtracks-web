import { describe, it, expect, vi } from "vitest";
import {
  parseOCH3Date,
  extractDayOfWeek,
  getStartTimeForDay,
  parseDotTime,
  parseDetailPage,
  parseEventsPage,
  mergeDetailIntoEvent,
} from "./och3";
import { OCH3Adapter } from "./och3";
import * as cheerio from "cheerio";
import type { RawEventData } from "../types";

describe("parseOCH3Date", () => {
  it("parses ordinal date with day name", () => {
    expect(parseOCH3Date("Sunday 22nd February 2026")).toBe("2026-02-22");
  });

  it("parses ordinal date without day name", () => {
    expect(parseOCH3Date("22nd February 2026")).toBe("2026-02-22");
  });

  it("parses date without ordinal suffix", () => {
    expect(parseOCH3Date("22 February 2026")).toBe("2026-02-22");
  });

  it("parses DD/MM/YYYY format", () => {
    expect(parseOCH3Date("22/02/2026")).toBe("2026-02-22");
  });

  it("parses 1st, 2nd, 3rd ordinals", () => {
    expect(parseOCH3Date("1st March 2026")).toBe("2026-03-01");
    expect(parseOCH3Date("Monday 2nd March 2026")).toBe("2026-03-02");
    expect(parseOCH3Date("3rd March 2026")).toBe("2026-03-03");
  });

  it("returns null for invalid month", () => {
    expect(parseOCH3Date("22nd Flob 2026")).toBeNull();
    expect(parseOCH3Date("9th March", 2026)).toBe("2026-03-09");
  });

  it("returns null for empty string", () => {
    expect(parseOCH3Date("")).toBeNull();
  });

  it("parses text-form 2-digit year: '22nd February 26'", () => {
    expect(parseOCH3Date("22nd February 26")).toBe("2026-02-22");
  });
});

describe("extractDayOfWeek", () => {
  it("extracts Sunday", () => {
    expect(extractDayOfWeek("Sunday 22nd February 2026")).toBe("sunday");
  });

  it("extracts Monday", () => {
    expect(extractDayOfWeek("Monday 23rd February 2026")).toBe("monday");
  });

  it("returns null for no day name", () => {
    expect(extractDayOfWeek("22nd February 2026")).toBeNull();
  });
});

describe("getStartTimeForDay", () => {
  it("returns 11:00 for Sunday", () => {
    expect(getStartTimeForDay("sunday")).toBe("11:00");
  });

  it("returns 19:30 for Monday", () => {
    expect(getStartTimeForDay("monday")).toBe("19:30");
  });

  it("defaults to 11:00 for unknown day", () => {
    expect(getStartTimeForDay(null)).toBe("11:00");
    expect(getStartTimeForDay("wednesday")).toBe("11:00");
  });
});

describe("parseDotTime", () => {
  it("parses 19.30 → 19:30", () => {
    expect(parseDotTime("19.30")).toBe("19:30");
  });

  it("parses 11.00 → 11:00", () => {
    expect(parseDotTime("11.00")).toBe("11:00");
  });

  it("parses 7.30 → 07:30", () => {
    expect(parseDotTime("7.30")).toBe("07:30");
  });

  it("returns undefined for invalid hours", () => {
    expect(parseDotTime("25.00")).toBeUndefined();
  });

  it("returns undefined for no time", () => {
    expect(parseDotTime("no time")).toBeUndefined();
  });
});

describe("parseDetailPage", () => {
  const DETAIL_HTML = `
<html><body>
<div class="paragraph">
  <strong>Run 1989</strong> - Monday 9th March at 19.30.
</div>
<div class="paragraph">
  Venue: Mill Lane Car Park, adj St Mary's Church, Dorking RH4 1DU
</div>
<div class="paragraph">
  On Inn - The Bush, Dorking
</div>
<div class="paragraph">
  <b>H</b>are: Anna 'Fish N Chips' Cooper
</div>
<div class="wsite-map">
  <iframe src="https://maps.google.com/maps?long=-0.3321353&lat=51.2336578&z=15"></iframe>
</div>
</body></html>
`;

  it("parses full detail page with all fields", () => {
    const $ = cheerio.load(DETAIL_HTML);
    const detail = parseDetailPage($, "http://www.och3.org.uk/next-run-details.html");
    expect(detail).not.toBeNull();
    expect(detail!.runNumber).toBe(1989);
    expect(detail!.startTime).toBe("19:30");
    expect(detail!.location).toContain("Mill Lane Car Park");
    expect(detail!.location).toContain("RH4 1DU");
    expect(detail!.hares).toBe("Anna 'Fish N Chips' Cooper");
    expect(detail!.onInn).toBe("The Bush, Dorking");
    expect(detail!.latitude).toBeCloseTo(51.2336578, 5);
    expect(detail!.longitude).toBeCloseTo(-0.3321353, 5);
    expect(detail!.sourceUrl).toBe("http://www.och3.org.uk/next-run-details.html");
  });

  it("handles split-tag hare label", () => {
    const html = `<html><body>
      <div class="paragraph"><b>H</b>are: Speedy McHash</div>
    </body></html>`;
    const $ = cheerio.load(html);
    const detail = parseDetailPage($, "http://www.och3.org.uk/next-run-details.html");
    expect(detail).not.toBeNull();
    expect(detail!.hares).toBe("Speedy McHash");
  });

  it("returns graceful undefined for missing fields", () => {
    const html = `<html><body>
      <div class="paragraph">Run 2000 - Sunday 15th March 2026</div>
    </body></html>`;
    const $ = cheerio.load(html);
    const detail = parseDetailPage($, "http://www.och3.org.uk/next-run-details.html");
    expect(detail).not.toBeNull();
    expect(detail!.runNumber).toBe(2000);
    expect(detail!.date).toBe("2026-03-15");
    expect(detail!.startTime).toBeUndefined();
    expect(detail!.location).toBeUndefined();
    expect(detail!.hares).toBeUndefined();
    expect(detail!.latitude).toBeUndefined();
    expect(detail!.longitude).toBeUndefined();
    expect(detail!.onInn).toBeUndefined();
  });

  it("returns null for empty page", () => {
    const $ = cheerio.load("<html><body></body></html>");
    const detail = parseDetailPage($, "http://www.och3.org.uk/next-run-details.html");
    expect(detail).toBeNull();
  });
});

describe("mergeDetailIntoEvent", () => {
  const baseEvent: RawEventData = {
    date: "2026-03-09",
    kennelTag: "OCH3",
    title: "Anna 'Fish n Chips' Cooper",
    startTime: "19:30",
    sourceUrl: "http://www.och3.org.uk/upcoming-run-list.html",
  };

  it("merges all detail fields into event", () => {
    const detail = {
      date: "2026-03-09",
      runNumber: 1989,
      startTime: "19:30",
      location: "Mill Lane Car Park, Dorking RH4 1DU",
      hares: "Anna 'Fish N Chips' Cooper",
      latitude: 51.2336578,
      longitude: -0.3321353,
      onInn: "The Bush, Dorking",
      sourceUrl: "http://www.och3.org.uk/next-run-details.html",
    };

    const merged = mergeDetailIntoEvent(baseEvent, detail);
    expect(merged.runNumber).toBe(1989);
    expect(merged.startTime).toBe("19:30");
    expect(merged.location).toBe("Mill Lane Car Park, Dorking RH4 1DU");
    expect(merged.hares).toBe("Anna 'Fish N Chips' Cooper");
    expect(merged.latitude).toBeCloseTo(51.2336578, 5);
    expect(merged.longitude).toBeCloseTo(-0.3321353, 5);
    expect(merged.description).toBe("On Inn: The Bush, Dorking");
    expect(merged.sourceUrl).toBe("http://www.och3.org.uk/next-run-details.html");
    // Original fields preserved
    expect(merged.kennelTag).toBe("OCH3");
    expect(merged.title).toBe("Anna 'Fish n Chips' Cooper");
  });

  it("only overrides populated detail fields", () => {
    const partialDetail = {
      date: "2026-03-09",
      runNumber: 1989,
      sourceUrl: "http://www.och3.org.uk/next-run-details.html",
    };

    const merged = mergeDetailIntoEvent(baseEvent, partialDetail);
    expect(merged.runNumber).toBe(1989);
    expect(merged.startTime).toBe("19:30"); // kept from base
    expect(merged.location).toBeUndefined(); // not in base or detail
    expect(merged.hares).toBeUndefined();
    expect(merged.latitude).toBeUndefined();
    expect(merged.description).toBeUndefined();
  });
});


const SAMPLE_UPCOMING_RUNS_BLOCK_HTML = `
<html><body>
<div class="wsite-section-wrap">
  <p>Upcoming Runs:</p>
  <p>1st March 2026 - Linda 'One in the Eye' Cooper - Outwood</p>
  <p>9th March - Anna 'Fish n Chips' Cooper</p>
  <p>22nd March 2026 - 'Chipmonk's last lay' Hash - Joint OCH3, W&NK, EGH3 - Charlwood. Details to follow</p>
  <p>29th March 2026 - Iain 'Arsola' Davidson</p>
</div>
</body></html>
`;

const SAMPLE_DETAIL_HTML = `
<html><body>
<div class="paragraph">
  <strong>Run 1989</strong> - Monday 9th March at 19.30.
</div>
<div class="paragraph">
  Venue: Mill Lane Car Park, adj St Mary's Church, Dorking RH4 1DU
</div>
<div class="paragraph">
  On Inn - The Bush, Dorking
</div>
<div class="paragraph">
  <b>H</b>are: Anna 'Fish N Chips' Cooper
</div>
<div class="wsite-map">
  <iframe src="https://maps.google.com/maps?long=-0.3321353&lat=51.2336578&z=15"></iframe>
</div>
</body></html>
`;

describe("parseEventsPage", () => {
  it("extracts events from <li> items", () => {
    const html = `<html><body>
      <div class="paragraph">
        <strong>OCH3 Events</strong>
        <ul>
          <li>22nd March 2026 - 'Chipmonk's last lay' Hash - From Charlwood Village Hall, 92 The Street, Charlwood, Horley, RH6 0DU. The village hall is booked from 12.30pm to 3.30pm.</li>
          <li>10th May 2026 - Memorial Run for Lawrence 'Dynorod' Pearce - The Red Lion, Betchworth</li>
          <li>23rd May 2026 - 2000th run and overnight stay at The Pheasantry.</li>
        </ul>
      </div>
    </body></html>`;
    const events = parseEventsPage(html, "http://www.och3.org.uk/eventslinks.html");
    expect(events).toHaveLength(3);
    expect(events[0].date).toBe("2026-03-22");
    expect(events[0].title).toBe("'Chipmonk's last lay' Hash");
    expect(events[0].location).toBe("Charlwood Village Hall, 92 The Street, Charlwood, Horley, RH6 0DU");
    expect(events[1].date).toBe("2026-05-10");
    expect(events[1].title).toBe("Memorial Run for Lawrence 'Dynorod' Pearce");
    expect(events[2].date).toBe("2026-05-23");
  });

  it("skips items without parseable dates", () => {
    const html = `<html><body><div class="paragraph"><ul>
      <li>Some non-date text about the club</li>
      <li>22nd March 2026 - Valid Event</li>
    </ul></div></body></html>`;
    const events = parseEventsPage(html, "http://test.com");
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Valid Event");
  });

  it("returns empty array for page without <li> items", () => {
    const html = `<html><body><div class="paragraph"><p>No events listed</p></div></body></html>`;
    const events = parseEventsPage(html, "http://test.com");
    expect(events).toHaveLength(0);
  });
});

describe("OCH3Adapter.fetch", () => {
  it("parses multiple upcoming runs from compact line block", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_UPCOMING_RUNS_BLOCK_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(4);
    expect(result.events.map((e) => e.date)).toEqual([
      "2026-03-01",
      "2026-03-09",
      "2026-03-22",
      "2026-03-29",
    ]);
    expect(result.events[0].title).toContain("One in the Eye");
    expect(result.events[0].location).toBe("Outwood");
    expect(result.events[2].location).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("enriches next event with detail page data", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_UPCOMING_RUNS_BLOCK_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response(SAMPLE_DETAIL_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(4);

    // The 2026-03-09 event should be enriched
    const enriched = result.events.find((e) => e.date === "2026-03-09");
    expect(enriched).toBeDefined();
    expect(enriched!.runNumber).toBe(1989);
    expect(enriched!.location).toContain("Mill Lane Car Park");
    expect(enriched!.latitude).toBeCloseTo(51.2336578, 5);
    expect(enriched!.longitude).toBeCloseTo(-0.3321353, 5);
    expect(enriched!.hares).toBe("Anna 'Fish N Chips' Cooper");
    expect(enriched!.description).toContain("The Bush, Dorking");
    expect(enriched!.sourceUrl).toContain("next-run-details.html");

    // Non-enriched events keep run-list data
    const otherEvent = result.events.find((e) => e.date === "2026-03-01");
    expect(otherEvent!.runNumber).toBeUndefined();
    expect(otherEvent!.sourceUrl).toContain("upcoming-run-list.html");

    expect(result.diagnosticContext?.detailPageMerged).toBe(true);

    vi.restoreAllMocks();
  });

  it("continues with run-list data when detail page fails", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_UPCOMING_RUNS_BLOCK_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response("Not found", { status: 404, statusText: "Not Found" }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(4);
    expect(result.errors).toContain("Detail page fetch failed; using run-list data only");
    expect(result.diagnosticContext?.detailPageMerged).toBe(false);

    vi.restoreAllMocks();
  });

  it("handles detail page with no date match (no enrichment)", async () => {
    const noMatchDetail = `<html><body>
      <div class="paragraph">Run 1989 - Monday 1st January at 19.30.</div>
    </body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(SAMPLE_UPCOMING_RUNS_BLOCK_HTML, { status: 200 }))
      .mockResolvedValueOnce(new Response(noMatchDetail, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(4);
    expect(result.diagnosticContext?.detailPageMerged).toBe(false);
    // All events still have run-list sourceUrl
    for (const event of result.events) {
      expect(event.sourceUrl).toContain("upcoming-run-list.html");
    }

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(
      new Error("Network error"),
    );

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });

  it("strips nav/boilerplate phrases from event titles", async () => {
    const htmlWithNavBleed = `
      <html><body>
      <div class="wsite-section-wrap">
        <p>Upcoming Runs:</p>
        <p>1st March 2026 - Linda 'One in the Eye' Cooper home about us contact</p>
      </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(htmlWithNavBleed, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("Linda 'One in the Eye' Cooper");
    expect(result.events[0].title).not.toContain("home");
    expect(result.events[0].title).not.toContain("about us");

    vi.restoreAllMocks();
  });

  it("strips script and style elements from page content", async () => {
    const htmlWithScripts = `
      <html><body>
      <script>var _gaq = _gaq || []; _gaq.push(['_setAccount', 'UA-7870337-1']);</script>
      <style>.header { color: red; }</style>
      <div class="wsite-section-wrap">
        <script>document.write('injected');</script>
        <p>Upcoming Runs:</p>
        <p>1st March 2026 - Linda 'One in the Eye' Cooper - Outwood</p>
      </div>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(htmlWithScripts, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    // Should parse the event without script content bleeding in
    expect(result.events.length).toBeGreaterThanOrEqual(1);
    const allText = result.events.map(e => `${e.title ?? ""} ${e.hares ?? ""} ${e.location ?? ""}`).join(" ");
    expect(allText).not.toContain("_gaq");
    expect(allText).not.toContain("document.write");
    expect(allText).not.toContain("color: red");

    vi.restoreAllMocks();
  });

  it("strips nav, header, and footer elements from page content", async () => {
    const htmlWithNav = `
      <html><body>
      <nav><ul><li>Home</li><li>Run List</li><li>About Us</li></ul></nav>
      <header><h1>OCH3 Website</h1></header>
      <div class="wsite-section-wrap">
        <p>Upcoming Runs:</p>
        <p>1st March 2026 - Linda 'One in the Eye' Cooper - Outwood</p>
      </div>
      <footer><p>Copyright 2026 OCH3</p></footer>
      </body></html>
    `;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(htmlWithNav, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(1);
    const allText = result.events.map(e => `${e.title ?? ""} ${e.hares ?? ""} ${e.location ?? ""}`).join(" ");
    expect(allText).not.toContain("Run List");
    expect(allText).not.toContain("About Us");
    expect(allText).not.toContain("Copyright");

    vi.restoreAllMocks();
  });
});
