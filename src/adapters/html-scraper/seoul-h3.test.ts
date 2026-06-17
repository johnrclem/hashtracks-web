import { describe, it, expect, vi, beforeEach } from "vitest";
import { parseSeoulH3Events, SeoulH3Adapter } from "./seoul-h3";
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

  it("fails loud (errors[], not empty events[]) when no run block parses", async () => {
    mockedSafeFetch.mockResolvedValue(
      htmlResponse("<html><body><div class='content'></div></body></html>"),
    );
    const result = await new SeoulH3Adapter().fetch(source);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("Seoul H3: no current run parsed");
  });
});
