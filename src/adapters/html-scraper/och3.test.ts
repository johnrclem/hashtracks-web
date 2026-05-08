import { describe, it, expect, vi } from "vitest";
import {
  parseOCH3Date,
  extractDayOfWeek,
  getStartTimeForDay,
  inferDayFromDate,
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

describe("inferDayFromDate", () => {
  it("infers monday from 2026-04-06", () => {
    expect(inferDayFromDate("2026-04-06")).toBe("monday");
  });

  it("infers sunday from 2026-03-22", () => {
    expect(inferDayFromDate("2026-03-22")).toBe("sunday");
  });

  it("returns null for invalid date", () => {
    expect(inferDayFromDate("not-a-date")).toBeNull();
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

  it("parses single-paragraph DOM without field contamination", () => {
    // Real DOM structure: everything in one .paragraph div with inline tags
    const html = `<html><body>
      <div class="paragraph">
        <strong>Run <span>1992 - Sunday 29th March at 11.00</span>
        Venue: The Palmerston, 31 Mill Lane, Carshalton, Surrey, SM5 2JY</strong>
        <b>H</b>ares: Steph 'Streaky' Joseph and Kev 'Cabin Boy' Rogers
        The Palmerston has just been taken over by a new landlord.
      </div>
      <div class="wsite-map">
        <iframe src="https://maps.google.com/maps?long=-0.16847&lat=51.3658&z=15"></iframe>
      </div>
    </body></html>`;
    const $ = cheerio.load(html);
    const detail = parseDetailPage($, "http://www.och3.org.uk/next-run-details.html");
    expect(detail).not.toBeNull();
    expect(detail!.runNumber).toBe(1992);
    expect(detail!.location).toBe("The Palmerston, 31 Mill Lane, Carshalton, Surrey, SM5 2JY");
    // Location should NOT contain description text
    expect(detail!.location).not.toContain("taken over");
    expect(detail!.hares).toBe("Steph 'Streaky' Joseph and Kev 'Cabin Boy' Rogers");
    // Hares should NOT contain description text
    expect(detail!.hares).not.toContain("taken over");
    expect(detail!.latitude).toBeCloseTo(51.3658, 3);
    expect(detail!.longitude).toBeCloseTo(-0.16847, 3);
  });
});

describe("mergeDetailIntoEvent", () => {
  const baseEvent: RawEventData = {
    date: "2026-03-09",
    kennelTags: ["och3"],
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
    expect(merged.kennelTags[0]).toBe("och3");
    // Title cleared because it matched the hare name (run-list sets hare as title for OCH3)
    expect(merged.title).toBeUndefined();
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
    expect(events[2].title).toContain("2000th run");
    // Bug 4: location should NOT contain "overnight stay" — should extract "The Pheasantry"
    if (events[2].location) {
      expect(events[2].location).not.toContain("overnight stay");
      expect(events[2].location).toMatch(/pheasantry/i);
    }
  });

  it("extracts venue from 'at The [Venue]' pattern for single-segment entries", () => {
    const html = `<html><body><div class="paragraph"><strong>OCH3 Events</strong><ul>
      <li>23rd May 2026 - 2000th run and overnight stay at The Pheasantry.</li>
    </ul></div></body></html>`;
    const events = parseEventsPage(html, "http://test.com");
    expect(events).toHaveLength(1);
    expect(events[0].location).toBe("The Pheasantry");
    expect(events[0].location).not.toContain("overnight stay");
  });

  it("skips items without parseable dates", () => {
    const html = `<html><body><div class="paragraph"><strong>OCH3 Events</strong><ul>
      <li>Some non-date text about the club</li>
      <li>22nd March 2026 - Valid Event</li>
    </ul></div></body></html>`;
    const events = parseEventsPage(html, "http://test.com");
    expect(events).toHaveLength(1);
    expect(events[0].title).toBe("Valid Event");
  });

  it("does NOT parse kennel links as events", () => {
    const html = `<html><body>
      <div class="paragraph">
        <strong>OCH3 Events</strong>
        <ul>
          <li>22nd March 2026 - Real Event - Some Venue</li>
        </ul>
      </div>
      <div class="paragraph">
        <strong>Links to local hashes and other groups</strong>
        <ul>
          <li><a href="http://www.barnesh3.com/">Barnes H3</a> (Wednesday evenings)</li>
          <li><a href="http://www.brightonhash.co.uk/">Brighton H3</a> (Monday evenings)</li>
          <li><a href="http://www.cityhash.org.uk/">City H3</a> (Tuesday evenings)</li>
          <li><a href="https://www.facebook.com/groups/440707183531968">Crawley CRAP</a> (usually 1st Sunday of every month)</li>
          <li><a href="http://westlondonhash.com/">West London H3</a> (Thursday evenings)</li>
        </ul>
      </div>
    </body></html>`;
    const events = parseEventsPage(html, "http://test.com");
    // Only the 1 real event — not the 5 kennel links
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2026-03-22");
    expect(events[0].title).toBe("Real Event");
    expect(events[0].location).toBe("Some Venue");
  });

  it("returns empty array for page without <li> items", () => {
    const html = `<html><body><div class="paragraph"><strong>OCH3 Events</strong><p>No events listed</p></div></body></html>`;
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

    // Bug 1 fix: detail page creates new event even when not in run list
    expect(result.events).toHaveLength(5);
    expect(result.diagnosticContext?.detailPageMerged).toBe(true);
    // The detail page event should have the detail sourceUrl
    const detailEvent = result.events.find(e => e.date === "2026-01-01");
    expect(detailEvent).toBeDefined();
    expect(detailEvent!.sourceUrl).toContain("next-run-details.html");

    vi.restoreAllMocks();
  });

  it("parses milestone runs (2000th, 2001th) without regex collision (#1273)", async () => {
    // Verbatim from live och3.org.uk/upcoming-run-list.html. Pre-fix the
    // dateStartPattern matched "00th Run" / "01th Run" inside the milestone
    // numbers, slicing the section so title="20" and hares were dropped.
    const html = `<html><body><div class="wsite-section-wrap">
      <p>Upcoming Runs:</p>
      <p>10th May 2026 - Memorial Run for Lawrence ' Dynorod' Pearce - The Red Lion, Betchworth</p>
      <p>18th May 2026 - The Fox, Coulsdon - Ray 'Sir Ray' Sterry</p>
      <p>23rd May 2026 - 2000th Run at the Pheasantry Mogador - Jamie 'Phil the Greek' Wheadon</p>
      <p>24th May 2026 - 2001th Run - The Sportsman, Mogador - Karen 'Legolas' Hedderman</p>
      <p>1st June 2026 - Inn on the Pond - Merstham - Jamie 'Phil the Greek' Wheadon</p>
    </div></body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    // All 5 entries parse, including the milestone rows that previously
    // collapsed to title="20".
    expect(result.events).toHaveLength(5);
    expect(result.events.map((e) => e.date)).toEqual([
      "2026-05-10",
      "2026-05-18",
      "2026-05-23",
      "2026-05-24",
      "2026-06-01",
    ]);

    const may23 = result.events.find((e) => e.date === "2026-05-23");
    expect(may23).toBeDefined();
    expect(may23!.title).toBe("2000th Run at the Pheasantry Mogador");
    expect(may23!.hares).toBe("Jamie 'Phil the Greek' Wheadon");
    expect(may23!.location).toBeUndefined();

    const may24 = result.events.find((e) => e.date === "2026-05-24");
    expect(may24).toBeDefined();
    expect(may24!.title).toBe("2001th Run - The Sportsman, Mogador");
    expect(may24!.hares).toBe("Karen 'Legolas' Hedderman");
    expect(may24!.location).toBeUndefined();

    // Non-milestone entries keep the legacy {date} - {hare} - {venue} layout.
    const may18 = result.events.find((e) => e.date === "2026-05-18");
    expect(may18!.title).toBe("The Fox, Coulsdon");
    expect(may18!.location).toBe("Ray 'Sir Ray' Sterry");

    const jun1 = result.events.find((e) => e.date === "2026-06-01");
    expect(jun1!.title).toBe("Inn on the Pond");
    expect(jun1!.location).toBe("Jamie 'Phil the Greek' Wheadon");

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
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }))
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
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }))
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

  it("creates new event from detail page when not in run list (Bug 1)", async () => {
    const runListHtml = `<html><body><div class="wsite-section-wrap">
      <p>Upcoming Runs:</p>
      <p>29th March 2026 - Steph 'Streaky' - the Palmerston Pub, Carshalton</p>
    </div></body></html>`;
    const detailHtml = `<html><body><div class="paragraph">
      <strong>Run 1991 - Sunday 22nd March at 11.00\nVenue:</strong>
      Charlwood Parish Hall, 92 The Street, Charlwood, Horley RH6 0DU
      <br><strong>Hare: Phil 'Layby' Mack</strong>
    </div></body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(runListHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response(detailHtml, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    const mar22 = result.events.find(e => e.date === "2026-03-22");
    expect(mar22).toBeDefined();
    expect(mar22!.hares).toBe("Phil 'Layby' Mack");
    expect(mar22!.location).toContain("Charlwood Parish Hall");
    expect(mar22!.runNumber).toBe(1991);
    expect(result.diagnosticContext?.detailPageMerged).toBe(true);
    vi.restoreAllMocks();
  });

  it("infers 19:30 for Monday run with no day name in text (Bug 2)", async () => {
    const html = `<html><body><div class="wsite-section-wrap">
      <p>Upcoming Runs:</p>
      <p>6th April 2026 - Iain 'Arsola' Davidson - Town End Car Park, Caterham</p>
    </div></body></html>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(html, { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }))
      .mockResolvedValueOnce(new Response("<html><body></body></html>", { status: 200 }));

    const adapter = new OCH3Adapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.och3.org.uk/upcoming-run-list.html",
    } as never);

    const apr6 = result.events.find(e => e.date === "2026-04-06");
    expect(apr6).toBeDefined();
    expect(apr6!.startTime).toBe("19:30");
    vi.restoreAllMocks();
  });
});
