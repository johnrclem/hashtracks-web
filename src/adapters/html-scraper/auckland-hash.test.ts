import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fetchHTMLPage (real) calls safeFetch, which does a DNS SSRF check — mock the
// safe-fetch seam so the fetch() tests stay offline (matches mijas-hash).
vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
import { safeFetch } from "@/adapters/safe-fetch";
import {
  parseStartTime,
  parseRunLine,
  groupRunRows,
  AucklandHashAdapter,
} from "./auckland-hash";

const mockSafeFetch = vi.mocked(safeFetch);

// Reference date inside the source's window — keeps year-inference deterministic
// alongside chrono's explicit-year fast-path ("1 Jun 26" → 2026-06-01).
const REF = new Date("2026-05-30T00:00:00Z");

describe("parseStartTime", () => {
  it.each([
    ["King's Birthday, 4pm Start. Pakuranga Sailing Club", "16:00"],
    ["start 7:30pm at the pub", "19:30"],
    ["meet 12pm noon", "12:00"],
    ["midnight 12am kickoff", "00:00"],
  ])("parses a stated time from %j -> %s", (notes, expected) => {
    expect(parseStartTime(notes)).toBe(expected);
  });

  it.each([
    ["29i James street, Glenfield"], // street number, no meridiem
    ["Spicy Bites Indian Restaurant: 7 Litten Road, Cockle Bay"],
    ["Venue TBC"],
    [""],
  ])("defaults to 18:30 when no am/pm marker is present (%j)", (notes) => {
    expect(parseStartTime(notes)).toBe("18:30");
  });
});

describe("parseRunLine", () => {
  it("parses a tab-delimited row (date / hare / venue)", () => {
    const event = parseRunLine("8-Jun-26\tRevs\t29i James street, Glenfield", REF);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-06-08");
    expect(event!.kennelTags).toEqual(["ah3-nz"]);
    expect(event!.hares).toBe("Revs");
    expect(event!.location).toBe("29i James street, Glenfield");
    expect(event!.startTime).toBe("18:30");
  });

  it("keeps multi-word hares intact via the tab delimiter (no greedy split)", () => {
    const event = parseRunLine("15-Jun-26\tLoose Change\t37 Waimoko Glen, Swanson", REF);
    expect(event!.hares).toBe("Loose Change");
    expect(event!.location).toBe("37 Waimoko Glen, Swanson");
  });

  it("applies a stated time override from the notes (4pm Start -> 16:00)", () => {
    const event = parseRunLine(
      "1-Jun-26\t   POY\tKing's Birthday, 4pm Start. Pakuranga Sailing Club, Bramley Drive",
      REF,
    );
    expect(event!.date).toBe("2026-06-01");
    expect(event!.hares).toBe("POY");
    expect(event!.startTime).toBe("16:00");
    expect(event!.location).toContain("Bramley Drive");
  });

  it("treats 'Venue TBC' as no location (explicit null clear)", () => {
    const event = parseRunLine("22-Jun-26\tHard to Port\tVenue TBC", REF);
    expect(event!.location).toBeNull();
    expect(event!.hares).toBe("Hard to Port");
  });

  it("treats the 'Hare Wanted' placeholder as no hare (and no title)", () => {
    const event = parseRunLine("6-Jul-26\t         Hare Wanted\t", REF);
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBeNull();
    expect(event!.title).toBeUndefined();
  });

  it("leaves title undefined (merge synthesizes; no run numbers on this source)", () => {
    const event = parseRunLine("13-Jul-26\tLoose Change\t37 Waimoko Glen, Swanson", REF);
    expect(event!.title).toBeUndefined();
    expect(event!.runNumber).toBeUndefined();
  });

  it("returns null when the leading token is not a date", () => {
    expect(parseRunLine("Upcoming Runs (visitors always welcome):", REF)).toBeNull();
  });

  it("fails loud (null) on delimiter drift — a date-led row missing its tabs", () => {
    // If the source ever switches tabs → spaces, chrono still finds the leading
    // date; without the field-count guard the venue would mis-bind as the hare.
    expect(parseRunLine("8-Jun-26 Revs 29i James street, Glenfield", REF)).toBeNull();
    expect(parseRunLine("8-Jun-26\tRevs 29i James street", REF)).toBeNull();
  });
});

describe("groupRunRows", () => {
  it("folds a wrapped continuation venue back into its date row", () => {
    const text = [
      "29-Jun-26\tTin Arse\tSpicy Bites Indian Restaurant: 7 Litten Road,  ",
      "                           Cockle Bay, Howick",
    ].join("\n");
    const rows = groupRunRows(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Cockle Bay, Howick");
  });

  it("does NOT append trailing junk (a stray '- ' after a blank line)", () => {
    const text = ["13-Jul-26\tLoose Change\t37 Waimoko Glen, Swanson", "", "- "].join("\n");
    const rows = groupRunRows(text);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toBe("13-Jul-26\tLoose Change\t37 Waimoko Glen, Swanson");
  });
});

// Faithful slice of the live Rocketspark homepage: the run list is a Draft.js
// content block (`.public-DraftEditor-content`) whose text nodes are
// TAB-delimited (`<date>\t<hare>\t<venue>`), with wrapped continuation lines
// and trailing junk. A second decoy block proves the "Upcoming Runs" selector.
const RUN_BLOCK = [
  "Upcoming Runs (visitors always welcome):",
  "1-Jun-26\t         POY\tKing's Birthday, 4pm Start. Pakuranga Sailing",
  "                          Club, Bramley Drive (Joint Run With Auckland Hussies)",
  "",
  "8-Jun-26\tRevs\t29i James street, Glenfield",
  "15-Jun-26\tLoose Change\t37 Waimoko Glen, Swanson ",
  "22-Jun-26\tHard to Port\tVenue TBC",
  "29-Jun-26\tTin Arse\tSpicy Bites Indian Restaurant: 7 Litten Road,  ",
  "                           Cockle Bay, Howick",
  "6-Jul-26\t         Hare Wanted\t",
  "13-Jul-26\t         Loose Change\t37 Waimoko Glen, Swanson ",
  "\t",
  " ",
  "- ",
].join("\n");

const SAMPLE_HTML = `<!doctype html><html><body>
<section><div class="public-DraftEditor-content"><div data-contents="true"><h2><span data-text="true">${RUN_BLOCK}</span></h2></div></div></section>
<section><div class="public-DraftEditor-content"><div data-contents="true"><h2><span data-text="true">About Auckland Hash — founded 25 August 1970, NZ's oldest hash club.</span></h2></div></div></section>
</body></html>`;

describe("AucklandHashAdapter.fetch", () => {
  beforeEach(() => {
    // Pin only Date (fetch is mocked) so the ±days window + year inference stay
    // deterministic and the test doesn't rot at a date boundary.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    mockSafeFetch.mockReset();
  });

  it("parses the 7 upcoming tab-delimited runs and resolves all to ah3-nz", async () => {
    mockSafeFetch.mockResolvedValueOnce(new Response(SAMPLE_HTML, { status: 200 }));

    const adapter = new AucklandHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.aucklandhashhouseharriers.co.nz/",
    } as never);

    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();
    expect(result.events).toHaveLength(7);
    expect(result.events.every((e) => e.kennelTags[0] === "ah3-nz")).toBe(true);

    const byDate = Object.fromEntries(result.events.map((e) => [e.date, e]));
    expect(byDate["2026-06-01"].hares).toBe("POY");
    expect(byDate["2026-06-01"].startTime).toBe("16:00"); // "4pm Start" override
    expect(byDate["2026-06-01"].location).toContain("Bramley Drive"); // wrapped venue folded in
    expect(byDate["2026-06-08"].hares).toBe("Revs");
    expect(byDate["2026-06-08"].startTime).toBe("18:30"); // default
    expect(byDate["2026-06-15"].hares).toBe("Loose Change"); // multi-word hare
    expect(byDate["2026-06-22"].location).toBeNull(); // Venue TBC → explicit clear
    expect(byDate["2026-07-06"].hares).toBeUndefined(); // Hare Wanted placeholder
  });

  it("surfaces a parse error (blocks reconcile) when a run row loses its tabs", async () => {
    // One good 3-field row + one date-led row whose tabs drifted to spaces.
    const html = `<!doctype html><html><body>
<div class="public-DraftEditor-content"><div data-contents="true"><h2><span data-text="true">Upcoming Runs:
8-Jun-26\tRevs\t29i James street, Glenfield
15-Jun-26 Loose Change 37 Waimoko Glen, Swanson</span></h2></div></div>
</body></html>`;
    mockSafeFetch.mockResolvedValueOnce(new Response(html, { status: 200 }));

    const adapter = new AucklandHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.aucklandhashhouseharriers.co.nz/",
    } as never);

    // The good row parses; the drifted row surfaces in errors[] so scrape.ts
    // (events>0 && errors===0) will NOT run the destructive reconcile.
    expect(result.events).toHaveLength(1);
    expect(result.events[0].date).toBe("2026-06-08");
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errorDetails?.parse?.length).toBeGreaterThan(0);
  });

  it("returns a fetch error on HTTP error", async () => {
    mockSafeFetch.mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const adapter = new AucklandHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.aucklandhashhouseharriers.co.nz/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);
  });

  it("returns a fetch error on network failure", async () => {
    mockSafeFetch.mockRejectedValueOnce(new Error("Network error"));

    const adapter = new AucklandHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.aucklandhashhouseharriers.co.nz/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);
  });
});
