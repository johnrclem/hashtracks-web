import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseGlasgowRow, GlasgowH3Adapter } from "./glasgow-h3";

vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-glasgow"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

const sourceUrl = "https://glasgowh3.co.uk/hareline.php";

describe("parseGlasgowRow", () => {
  it("parses a standard Glasgow row", () => {
    const cells = ["2206", "Monday 23 March", "Redhurst Hotel, Giffnock", "Audrey"];
    const hrefs = ["run_request.php?id=1", undefined, undefined, undefined];
    const event = parseGlasgowRow(cells, hrefs, sourceUrl);
    expect(event).not.toBeNull();
    expect(event!.date).toMatch(/^\d{4}-03-23$/);
    expect(event!.runNumber).toBe(2206);
    expect(event!.kennelTag).toBe("Glasgow H3");
    expect(event!.location).toBe("Redhurst Hotel, Giffnock");
    expect(event!.hares).toBe("Audrey");
    expect(event!.startTime).toBe("19:00");
    expect(event!.title).toBe("Glasgow H3 #2206");
  });

  it("extracts Google Maps locationUrl", () => {
    const cells = ["2207", "Monday 30 March", "The Tavern, Hamilton", "Bob"];
    const hrefs = [undefined, undefined, "https://maps.app.goo.gl/abc123", undefined];
    const event = parseGlasgowRow(cells, hrefs, sourceUrl);
    expect(event!.locationUrl).toBe("https://maps.app.goo.gl/abc123");
  });

  it("returns null for rows with fewer than 4 cells", () => {
    expect(parseGlasgowRow(["2206", "Monday 23 March"], [], sourceUrl)).toBeNull();
  });

  it("returns null when date is empty", () => {
    expect(parseGlasgowRow(["2206", "", "Somewhere", "Someone"], [], sourceUrl)).toBeNull();
  });

  it("filters TBD hares", () => {
    const cells = ["2208", "Monday 6 April", "The Pub", "TBD"];
    const event = parseGlasgowRow(cells, [], sourceUrl);
    expect(event!.hares).toBeUndefined();
  });
});

describe("GlasgowH3Adapter", () => {
  let adapter: GlasgowH3Adapter;

  beforeEach(() => {
    adapter = new GlasgowH3Adapter();
    vi.clearAllMocks();
  });

  it("returns only Glasgow events, not UK or International events", async () => {
    const html = `<html><body>
      <div class="row no-brd">
        <table class="halloffame">
          <tr><th>Run No</th><th>When</th><th>Where</th><th>Hare / Hares</th></tr>
          <tr><td><a href="run_request.php?id=1">2206</a></td><td>Monday 23 March</td><td>Redhurst Hotel, Giffnock</td><td>Audrey</td></tr>
          <tr></tr>
          <tr><td><a href="run_request.php?id=2">2207</a></td><td>Monday 30 March</td><td><a href="https://maps.app.goo.gl/abc">The Tavern, Hamilton</a></td><td>Bob &amp; Alice</td></tr>
        </table>
      </div>
      <div class="">
        <table class="halloffame">
          <tr><th>Date</th><th>Event</th><th>Venue</th></tr>
          <tr><td>13 - 14 June 2026</td><td>Shetland Simmer Dim Weekend</td><td>Shetland</td></tr>
          <tr><td>26 - 28 June 2026</td><td>BRAS H3 weekend</td><td>Palace Hotel Buxton</td></tr>
        </table>
      </div>
      <div class="">
        <table class="halloffame">
          <tr><th>Date</th><th>Event</th><th>Venue</th></tr>
          <tr><td>8-10 May 2026</td><td>Interhash 2026</td><td>Goa, India</td></tr>
        </table>
      </div>
    </body></html>`;

    mockFetchResponse(html);
    const source = { id: "src-glasgow", url: sourceUrl, config: {} } as unknown as Source;
    const result = await adapter.fetch(source, { days: 365 });

    // CRITICAL: only Glasgow events, not UK or International
    expect(result.events).toHaveLength(2);
    expect(result.events[0].runNumber).toBe(2206);
    expect(result.events[0].location).toBe("Redhurst Hotel, Giffnock");
    expect(result.events[1].runNumber).toBe(2207);
    expect(result.events[1].locationUrl).toBe("https://maps.app.goo.gl/abc");
    expect(result.events[1].hares).toBe("Bob & Alice");

    // No 8-digit garbage run numbers
    const badRuns = result.events.filter(e => e.runNumber && e.runNumber > 99999);
    expect(badRuns).toHaveLength(0);
  });

  it("all events have default startTime 19:00", async () => {
    const html = `<html><body>
      <div class="row no-brd">
        <table class="halloffame">
          <tr><th>Run No</th><th>When</th><th>Where</th><th>Hare / Hares</th></tr>
          <tr><td>2206</td><td>Monday 23 March</td><td>The Pub</td><td>Hare Name</td></tr>
        </table>
      </div>
    </body></html>`;

    mockFetchResponse(html);
    const source = { id: "src-glasgow", url: sourceUrl, config: {} } as unknown as Source;
    const result = await adapter.fetch(source, { days: 365 });

    expect(result.events).toHaveLength(1);
    expect(result.events[0].startTime).toBe("19:00");
  });

  it("includes recent past events — forwardDate does not push them to next year", async () => {
    const html = `<html><body>
      <div class="row no-brd">
        <table class="halloffame">
          <tr><th>Run No</th><th>When</th><th>Where</th><th>Hare / Hares</th></tr>
          <tr><td>2206</td><td>Monday 23 March</td><td>Redhurst Hotel</td><td>Audrey</td></tr>
          <tr><td>2207</td><td>Monday 30 March</td><td>Hamilton</td><td>Bob</td></tr>
        </table>
      </div>
    </body></html>`;

    mockFetchResponse(html);
    const source = { id: "src-glasgow", url: sourceUrl, config: {} } as unknown as Source;
    const result = await adapter.fetch(source, { days: 90 });

    // Both events should be included — March 23 is within 90-day lookback
    expect(result.events).toHaveLength(2);
    expect(result.events.find(e => e.runNumber === 2206)).toBeDefined();
    expect(result.events.find(e => e.runNumber === 2207)).toBeDefined();
  });
});
