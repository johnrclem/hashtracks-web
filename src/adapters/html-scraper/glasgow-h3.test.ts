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
    expect(event!.kennelTags[0]).toBe("Glasgow H3");
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

  it("strips `What 3 Words=` suffix from location and preserves it in description (#544)", () => {
    // Live Glasgow hareline renders the W3W code inline with the venue text:
    // "Anchor at the Abbey, 23 Gauze Street, Paisley What 3 Words= walks.intent.social"
    // The display `location` drops the W3W tail; the code survives in
    // `description` as a labeled line so a future geocoder can recover it.
    const cells = [
      "2209",
      "Sunday 13 April",
      "Anchor at the Abbey, 23 Gauze Street, Paisley What 3 Words= walks.intent.social",
      "Yer Maw",
    ];
    const event = parseGlasgowRow(cells, [], sourceUrl);
    expect(event!.location).toBe("Anchor at the Abbey, 23 Gauze Street, Paisley");
    expect(event!.description).toBe("What3Words: walks.intent.social");
  });

  it("leaves description undefined when the location cell has no W3W suffix", () => {
    const cells = ["2210", "Sunday 20 April", "Simple Venue", "Someone"];
    const event = parseGlasgowRow(cells, [], sourceUrl);
    expect(event!.location).toBe("Simple Venue");
    expect(event!.description).toBeUndefined();
  });

  it("preserves the full location string when the W3W suffix is malformed", () => {
    // Degraded source render: "What 3 Words=" with no code following. The
    // match regex fails, so neither the location strip nor the description
    // write-back fires. We leave the raw text intact rather than silently
    // shortening it to a partial venue. (Codex review on PR batch 1.)
    const cells = [
      "2212",
      "Sunday 4 May",
      "Venue Name What 3 Words=",
      "Someone",
    ];
    const event = parseGlasgowRow(cells, [], sourceUrl);
    expect(event!.location).toBe("Venue Name What 3 Words=");
    expect(event!.description).toBeUndefined();
  });

  it("rejects partial W3W codes that aren't exactly word.word.word", () => {
    // Single word or missing segments shouldn't trip the matcher — a real
    // W3W code is always three dot-separated words. Without the stricter
    // regex, "walks" would have been captured as the "W3W code" and the
    // location would have been silently truncated. (CodeRabbit + Claude
    // code review on PR #557.)
    const cells = [
      "2213",
      "Sunday 11 May",
      "Venue Name What 3 Words= walks",
      "Someone",
    ];
    const event = parseGlasgowRow(cells, [], sourceUrl);
    // Match failed → location preserved intact, no description write-back
    expect(event!.location).toBe("Venue Name What 3 Words= walks");
    expect(event!.description).toBeUndefined();
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

  // Verbatim chunk from glasgowh3.co.uk/hareline.php — exercises the live
  // structural quirks: rows close with `<TR>` instead of `</TR>`, venues are
  // wrapped in anchors, and W3W codes follow as a nested anchor after `<br>`.
  const LIVE_VERBATIM_HTML = `<html><body>
    <div class="row no-brd">
      <table class="halloffame">
        <thead><tr><th>Run No</th><th>When</th><th>Where</th><th>Hare / Hares</th></tr></thead>
        <tbody>
          <TR><TD>2211</TD><TD>Monday 27 April</TD><TD><a href=https://whatpub.com/pubs/GLA/0600/old-smiddy-glasgow target="_blank">The Old Smiddy, 131 Old Castle Road, Cathcart </a><br>What 3 Words= <a href="https://what3words.com/vague.food.code" target="_blank">vague.food.code</a></TD><TD> <a href="risk_assessment.php?run=2211">Kipper</a></TD> <TR><TR><TD> <a href="run_request.php?run=2212">2212</a> </TD><TD>Monday 4 May</TD><TD>Casa Entropia</td><TD> <a href="risk_assessment.php?run=2212">Stand and Deliver</a></TD> <TR><TR><TD> <a href="run_request.php?run=2213">2213</a> </TD><TD>Monday 11 May</TD><TD><a href=https://camra.org.uk/pubs/ladywell-bar-glasgow-195148 target="_blank">Ladywell Bar, 139 Barrack Street, Dennistoun </a><br>What 3 Words= <a href="https://what3words.com/tent.builds.tent" target="_blank">tent.builds.tent</a></TD><TD> <a href="risk_assessment.php?run=2213">Cumming Again</a></TD> <TR><TR><TD> <a href="run_request.php?run=2214">2214</a> </TD><TD>Monday 18 May</TD><TD><a href=https://camra.org.uk/REN/3 target="_blank">Brown Bull, 32 Main St., Lochwinnoch </a><br>What 3 Words= <a href="https://what3words.com/nourished.builder.decorator" target="_blank">nourished.builder.decorator</a></TD><TD> <a href="risk_assessment.php?run=2214">Dr Livingstone I Presume</a></TD> <TR>
        </tbody>
      </table>
    </div>
  </body></html>`;

  it("parses anchor-wrapped venues and W3W-suffixed cells from live HTML (#1143, #1174)", async () => {
    mockFetchResponse(LIVE_VERBATIM_HTML);
    const source = { id: "src-glasgow", url: sourceUrl, config: {} } as unknown as Source;
    const result = await adapter.fetch(source, { days: 365 });

    expect(result.events).toHaveLength(4);
    const byRun = new Map(result.events.map((e) => [e.runNumber, e]));

    const r2211 = byRun.get(2211)!;
    expect(r2211).toBeDefined();
    expect(r2211.location).toBe("The Old Smiddy, 131 Old Castle Road, Cathcart");
    expect(r2211.description).toBe("What3Words: vague.food.code");
    expect(r2211.locationUrl).toBe("https://whatpub.com/pubs/GLA/0600/old-smiddy-glasgow");
    expect(r2211.hares).toBe("Kipper");

    const r2212 = byRun.get(2212)!;
    expect(r2212.location).toBe("Casa Entropia");
    expect(r2212.description).toBeUndefined();
    expect(r2212.hares).toBe("Stand and Deliver");

    // #1174: #2213 must extract location from the same anchor+W3W structure
    // that works for #2211 and #2214 — historically dropped due to reconcile,
    // but the parser must produce a location for the row.
    const r2213 = byRun.get(2213)!;
    expect(r2213.location).toBe("Ladywell Bar, 139 Barrack Street, Dennistoun");
    expect(r2213.description).toBe("What3Words: tent.builds.tent");
    expect(r2213.locationUrl).toBe("https://camra.org.uk/pubs/ladywell-bar-glasgow-195148");
    expect(r2213.hares).toBe("Cumming Again");

    // #1143: #2214 was reportedly dropped entirely — must be present and parsed.
    const r2214 = byRun.get(2214)!;
    expect(r2214).toBeDefined();
    expect(r2214.location).toBe("Brown Bull, 32 Main St., Lochwinnoch");
    expect(r2214.description).toBe("What3Words: nourished.builder.decorator");
    expect(r2214.locationUrl).toBe("https://camra.org.uk/REN/3");
    expect(r2214.hares).toBe("Dr Livingstone I Presume");

    // No location should leak the W3W tail or the hare-cell risk_assessment URL
    for (const ev of result.events) {
      expect(ev.location).not.toMatch(/What\s*3\s*Words/i);
      expect(ev.locationUrl ?? "").not.toMatch(/risk_assessment\.php/);
      expect(ev.locationUrl ?? "").not.toMatch(/what3words\.com/);
    }
  });

  it("includes recent past events — forwardDate does not push them to next year", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-26T12:00:00Z"));
    try {
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
    } finally {
      vi.useRealTimers();
    }
  });
});
