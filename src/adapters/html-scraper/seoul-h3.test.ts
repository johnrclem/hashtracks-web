import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSeoulH3Events, parseSeoulHareline, SeoulH3Adapter } from "./seoul-h3";
import type { Source } from "@/generated/prisma/client";

// Mock safeFetch (used by fetchHTMLPage) + structure hash for the adapter path.
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-sh3-kr"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

const SOURCE_URL = "https://seoulhash.com/index.php";

function htmlResponse(html: string): Response {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response;
}

/**
 * Fixture = the real seoulhash.com/index.php markup (captured 2026-06-16).
 * Semantically-classed divs: .event > {.number,.title,.section>.label_value>
 * {.label,.value}, .section>.subsection>p}. The Geo Coordinates value is a bare
 * "…/maps/place/" stub with no place id (must NOT become locationUrl).
 */
const INDEX_FIXTURE = `<!DOCTYPE html><html><head><title>Seoul Hash House Harriers</title></head>
<body>
<div class="header"><img src="images/shhh_logo_120.png"/></div>
<div class="content">
<div class="group">
  <div class="event">
    <div class="datetime">Jun/13 - 16:00</div>
    <div class="number">2897</div>
    <div class="title">Anti-Celibacy Day</div>
    <img class="banner" src="uploads/banner.jpeg"/>
    <div class="section">
      <div class="label_value"><div class="label">Title:</div><div class="value">Anti-Celibacy Day</div></div>
      <div class="label_value"><div class="label">Meeting Time:</div><div class="value">2026/06/13 16:00</div></div>
      <div class="label_value"><div class="label">Location: </div><div class="value">Samgakji Station Line 4, exit 8</div></div>
      <div class="label_value"><div class="label">Geo Coordinates: </div><div class="value"><a href="https://www.google.com/maps/place/"></a></div></div>
      <div class="label_value"><div class="label">Hares: </div><div class="value">GM Professor D'Erections</div></div>
      <div class="label_value"><div class="label">Apres Trail: </div><div class="value">Local Craft Beer place</div></div>
      <div class="label_value"><div class="label">Hash Cash: </div><div class="value">W10,000</div></div>
    </div>
    <div class="section">
      <div class="subsection"><p>Martin Luther rejected priestly celibacy in 1525. Take cover under the Samgakji overpass.</p></div>
      <div class="subsection"><p>From Seoul Station get on line 4 and head south for 2 stops. Get off at Samgakji and head to exit 8.</p></div>
    </div>
  </div>
</div>
</div>
</body></html>`;

describe("parseSeoulH3Events (index.php)", () => {
  it("parses the single current run with date, time, run #, theme, and fields", () => {
    const events = parseSeoulH3Events(INDEX_FIXTURE, SOURCE_URL);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      date: "2026-06-13",
      startTime: "16:00",
      runNumber: 2897,
      title: "Anti-Celibacy Day",
      location: "Samgakji Station Line 4, exit 8",
      hares: "GM Professor D'Erections",
      kennelTags: ["sh3-kr"],
      sourceUrl: SOURCE_URL,
    });
    expect(events[0].description).toContain("Martin Luther");
    expect(events[0].description).toContain("Apres: Local Craft Beer place");
  });

  it("scrubs phone numbers the live page embeds in hare names", () => {
    const withPhone = INDEX_FIXTURE.replace(
      "GM Professor D'Erections",
      "GM Professor D'Erections +82 10-1234-5678",
    );
    const [event] = parseSeoulH3Events(withPhone, SOURCE_URL);
    expect(event.hares).toBe("GM Professor D'Erections");
  });

  it("does not fabricate coords or store the bare /maps/place/ stub", () => {
    const [event] = parseSeoulH3Events(INDEX_FIXTURE, SOURCE_URL);
    expect(event.latitude).toBeUndefined();
    expect(event.longitude).toBeUndefined();
    expect(event.locationUrl).toBeUndefined();
  });

  it("omits Event.cost when Hash Cash equals the kennel default", () => {
    const [event] = parseSeoulH3Events(INDEX_FIXTURE, SOURCE_URL);
    expect(event.cost).toBeUndefined();
  });

  it("sets Event.cost only when a run's Hash Cash differs from the default", () => {
    const altered = INDEX_FIXTURE.replace("W10,000", "W15,000");
    const [event] = parseSeoulH3Events(altered, SOURCE_URL);
    expect(event.cost).toBe("W15,000");
  });

  it("leaves title undefined when the theme is blank (merge synthesizes)", () => {
    const blankTitle = INDEX_FIXTURE.replace(
      '<div class="title">Anti-Celibacy Day</div>',
      '<div class="title"></div>',
    );
    const [event] = parseSeoulH3Events(blankTitle, SOURCE_URL);
    expect(event.title).toBeUndefined();
  });
});

/** Archive multi-event fixture: ascending run #, one with a "(Sunset: …)" suffix. */
const ARCHIVE_FIXTURE = `<!DOCTYPE html><html><body><div class="content"><div class="group">
  <div class="event">
    <div class="number">2897</div><div class="title">Newest</div>
    <div class="section"><div class="label_value"><div class="label">Meeting Time:</div><div class="value">2026/06/13 16:00</div></div></div>
  </div>
  <div class="event">
    <div class="number">2896</div><div class="title">Older with sunset</div>
    <div class="section"><div class="label_value"><div class="label">Meeting Time:</div><div class="value">2015/06/27 16:00 (Sunset: 19:53)</div></div></div>
  </div>
</div></div></body></html>`;

describe("parseSeoulH3Events (archive.php)", () => {
  it("parses every .event block and strips the (Sunset: …) suffix", () => {
    const events = parseSeoulH3Events(ARCHIVE_FIXTURE, "https://seoulhash.com/archive.php");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ runNumber: 2897, date: "2026-06-13", startTime: "16:00" });
    expect(events[1]).toMatchObject({ runNumber: 2896, date: "2015-06-27", startTime: "16:00" });
  });
});

/**
 * Verbatim shape of the live index.php (captured 2026-06-17): the featured run
 * #2898 plus the forward "Hareline" as the THIRD `.subsection` (date/hare pairs
 * separated by empty `<p></p>`).
 */
const HARELINE_FIXTURE = `<!DOCTYPE html><html><body>
<div class="content"><div class="group">
  <div class="event">
    <div class="number">2898</div>
    <div class="title">GM Changeover</div>
    <div class="section">
      <div class="label_value"><div class="label">Meeting Time:</div><div class="value">2026/06/20 15:00</div></div>
      <div class="label_value"><div class="label">Location: </div><div class="value">Ground Zero, near Itaewon Grand Hyatt</div></div>
      <div class="label_value"><div class="label">Hares: </div><div class="value">A GM</div></div>
    </div>
    <div class="section">
      <div class="subsection"><p>The time has come for the annual GM Changeover.</p><p></p><p>Hymen: 010-4244-1928</p></div>
      <div class="subsection"><p>Go out Hangangjin Line 6, Exit 1 and follow the pack marks to Ground Zero.</p></div>
      <div class="subsection"><p>Hareline</p><p></p><p>June 27 - Hare needed</p><p></p><p>July 4 - Hare needed</p><p></p><p>July 11 - Hymen</p><p></p><p>July 18 - Longfellow</p></div>
    </div>
  </div>
</div></div>
</body></html>`;

describe("parseSeoulHareline (#2239)", () => {
  it("emits one event per Hareline line, year-resolved off the featured run date", () => {
    const events = parseSeoulHareline(HARELINE_FIXTURE, "2026-06-20", SOURCE_URL);
    expect(events.map((e) => e.date)).toEqual([
      "2026-06-27",
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
    ]);
    expect(events.every((e) => e.kennelTags[0] === "sh3-kr")).toBe(true);
    expect(events.every((e) => e.sourceUrl === SOURCE_URL)).toBe(true);
  });

  it("captures real hare names and clears 'Hare needed' placeholders to null (#2239)", () => {
    const events = parseSeoulHareline(HARELINE_FIXTURE, "2026-06-20", SOURCE_URL);
    expect(events[0].hares).toBeNull(); // "Hare needed" → explicit clear (not preserve)
    expect(events[1].hares).toBeNull(); // "Hare needed"
    expect(events[2].hares).toBe("Hymen");
    expect(events[3].hares).toBe("Longfellow");
  });

  it("leaves run number, title, and start time undefined (merge fills them later)", () => {
    const events = parseSeoulHareline(HARELINE_FIXTURE, "2026-06-20", SOURCE_URL);
    for (const e of events) {
      expect(e.runNumber).toBeUndefined();
      expect(e.title).toBeUndefined();
      expect(e.startTime).toBeUndefined();
    }
  });

  it("rolls a Dec→Jan hareline date into the next year off a late-December anchor", () => {
    const decFixture = HARELINE_FIXTURE.replace(
      "<p>June 27 - Hare needed</p>",
      "<p>January 3 - Hare needed</p>",
    );
    const events = parseSeoulHareline(decFixture, "2026-12-27", SOURCE_URL);
    expect(events[0].date).toBe("2027-01-03");
  });

  it("resolves a leap day (Feb 29) to the next leap year, not null, off a non-leap anchor (#2239)", () => {
    const leapFixture = HARELINE_FIXTURE.replace(
      "<p>June 27 - Hare needed</p>",
      "<p>February 29 - Hymen</p>",
    );
    // Anchor 2027 (non-leap): Date.UTC(2027,1,29) rolls to Mar 1, so the naive
    // path would drop it; validate-first rolls to the next leap year (2028).
    const events = parseSeoulHareline(leapFixture, "2027-02-01", SOURCE_URL);
    expect(events[0].date).toBe("2028-02-29");
    expect(events[0].hares).toBe("Hymen");
  });

  it("returns [] when the page has no Hareline subsection", () => {
    expect(parseSeoulHareline(INDEX_FIXTURE, "2026-06-13", SOURCE_URL)).toEqual([]);
  });
});

describe("parseSeoulH3Events excludes the Hareline subsection from description (#2239)", () => {
  it("keeps prose + directions but drops the Hareline list from the featured run", () => {
    const [event] = parseSeoulH3Events(HARELINE_FIXTURE, SOURCE_URL);
    expect(event.runNumber).toBe(2898);
    expect(event.description).toContain("GM Changeover");
    expect(event.description).toContain("follow the pack marks");
    expect(event.description).not.toContain("Hareline");
    expect(event.description).not.toContain("Longfellow");
    expect(event.description).not.toContain("Hare needed");
  });
});

describe("SeoulH3Adapter.fetch", () => {
  const source = { url: SOURCE_URL } as Source;

  beforeEach(() => {
    mockedSafeFetch.mockReset();
  });

  it("emits the single current run on a healthy page", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse(INDEX_FIXTURE));
    const result = await new SeoulH3Adapter().fetch(source);
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]).toMatchObject({ runNumber: 2897, date: "2026-06-13", kennelTags: ["sh3-kr"] });
  });

  it("emits the featured run plus the forward Hareline schedule (#2239)", async () => {
    mockedSafeFetch.mockResolvedValue(htmlResponse(HARELINE_FIXTURE));
    const result = await new SeoulH3Adapter().fetch(source);
    expect(result.errors).toEqual([]);
    // featured #2898 + 4 Hareline entries
    expect(result.events).toHaveLength(5);
    expect(result.events[0]).toMatchObject({ runNumber: 2898, date: "2026-06-20" });
    expect(result.events.slice(1).map((e) => e.date)).toEqual([
      "2026-06-27",
      "2026-07-04",
      "2026-07-11",
      "2026-07-18",
    ]);
    expect(result.diagnosticContext).toMatchObject({ eventsParsed: 5, harelineEvents: 4 });
  });

  it("fails loud (errors[], not empty events[]) when no run block parses", async () => {
    mockedSafeFetch.mockResolvedValue(
      htmlResponse("<html><body><div class='content'></div></body></html>"),
    );
    const result = await new SeoulH3Adapter().fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("Seoul H3: no current run parsed");
  });
});
