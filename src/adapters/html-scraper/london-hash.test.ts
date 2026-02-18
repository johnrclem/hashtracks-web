import { describe, it, expect, vi } from "vitest";
import {
  parseRunBlocks,
  parseDateFromBlock,
  parseHaresFromBlock,
  parseLocationFromBlock,
  parseTimeFromBlock,
} from "./london-hash";
import { LondonHashAdapter } from "./london-hash";

describe("parseDateFromBlock", () => {
  it("parses DD/MM/YYYY format", () => {
    expect(parseDateFromBlock("Saturday 21/02/2026")).toBe("2026-02-21");
  });

  it("parses ordinal with 'of' and year", () => {
    expect(parseDateFromBlock("Saturday 21st of February 2026")).toBe("2026-02-21");
  });

  it("parses ordinal with 'of' without year (uses reference)", () => {
    expect(parseDateFromBlock("Saturday 21st of February", 2026)).toBe("2026-02-21");
  });

  it("parses ordinal without 'of'", () => {
    expect(parseDateFromBlock("Monday 22nd June 2026")).toBe("2026-06-22");
  });

  it("parses 1st", () => {
    expect(parseDateFromBlock("Saturday 1st March 2026")).toBe("2026-03-01");
  });

  it("parses 3rd", () => {
    expect(parseDateFromBlock("Saturday 3rd April 2026")).toBe("2026-04-03");
  });

  it("parses plain day number", () => {
    expect(parseDateFromBlock("15 January 2026")).toBe("2026-01-15");
  });

  it("returns null for invalid month", () => {
    expect(parseDateFromBlock("21st of Flibber 2026")).toBeNull();
  });

  it("returns null for empty text", () => {
    expect(parseDateFromBlock("")).toBeNull();
  });
});

describe("parseHaresFromBlock", () => {
  it("parses 'Hared by' with single hare", () => {
    expect(parseHaresFromBlock("Hared by Tuna Melt")).toBe("Tuna Melt");
  });

  it("parses 'Hared by' with multiple hares", () => {
    expect(parseHaresFromBlock("Hared by Tuna Melt and Opee")).toBe("Tuna Melt and Opee");
  });

  it("parses 'Hare:' format", () => {
    expect(parseHaresFromBlock("Hare: John Smith")).toBe("John Smith");
  });

  it("returns null for 'Hare required'", () => {
    expect(parseHaresFromBlock("Hared by Hare required")).toBeNull();
  });

  it("returns null for 'TBA'", () => {
    expect(parseHaresFromBlock("Hared by TBA")).toBeNull();
  });

  it("returns null when no hare info", () => {
    expect(parseHaresFromBlock("Some random text")).toBeNull();
  });

  it("trims text after asterisks", () => {
    expect(parseHaresFromBlock("Hared by Alice**extra notes")).toBe("Alice");
  });
});

describe("parseLocationFromBlock", () => {
  it("parses P-trail format with station and pub", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Sydenham station to The Dolphin",
    );
    expect(result.station).toBe("Sydenham");
    expect(result.location).toBe("The Dolphin");
  });

  it("parses P trail format without 'station' keyword", () => {
    const result = parseLocationFromBlock(
      "Follow the P trail from Vauxhall to The Old Dairy",
    );
    expect(result.station).toBe("Vauxhall");
    expect(result.location).toBe("The Old Dairy");
  });

  it("parses Start: format", () => {
    const result = parseLocationFromBlock("Start: Victoria Park");
    expect(result.location).toBe("Victoria Park");
    expect(result.station).toBeUndefined();
  });

  it("returns empty for no location info", () => {
    const result = parseLocationFromBlock("Some random text");
    expect(result.location).toBeUndefined();
    expect(result.station).toBeUndefined();
  });
});

describe("parseTimeFromBlock", () => {
  it("parses '12 Noon for 12:30'", () => {
    expect(parseTimeFromBlock("12 Noon for 12:30")).toBe("12:00");
  });

  it("parses 'Noon'", () => {
    expect(parseTimeFromBlock("Noon")).toBe("12:00");
  });

  it("parses '7pm'", () => {
    expect(parseTimeFromBlock("7pm for 7:15")).toBe("19:00");
  });

  it("parses '7:00 PM'", () => {
    expect(parseTimeFromBlock("7:00 PM")).toBe("19:00");
  });

  it("parses '10:30 AM'", () => {
    expect(parseTimeFromBlock("10:30 AM")).toBe("10:30");
  });

  it("returns null for no time", () => {
    expect(parseTimeFromBlock("Some text")).toBeNull();
  });
});

// Sample HTML mimicking London Hash run list structure
const SAMPLE_HTML = `
<html><body>
<div>
  <p>
    <a href="nextrun.php?run=3840">2820</a>
    Sydenham
    Saturday 21st of February 2026
    12 Noon for 12:30 (3 days time)
    Follow the P trail from Sydenham station to The Dolphin
    Hared by Tuna Melt and Opee
    ** 50th Anniversary Special **
  </p>
  <p>
    <a href="nextrun.php?run=3841">2821</a>
    Finsbury Park
    Saturday 28th of February 2026
    12 Noon for 12:30
    Follow the P trail from Finsbury Park to The World's End
    Hared by Captain Adventures
  </p>
  <p>
    <a href="nextrun.php?run=3842">2822</a>
    Brixton
    Saturday 7th March 2026
    12 Noon for 12:30
    Hare required
  </p>
  <p>
    <a href="nextrun.php?run=3843">2823</a>
    Ealing Broadway
    Monday 22nd June 2026
    7pm for 7:15
    Follow the P trail from Ealing Broadway to The Red Lion
    Hared by Summer Runner
  </p>
</div>
</body></html>
`;

describe("parseRunBlocks", () => {
  it("splits page into run blocks", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    expect(blocks[0].runNumber).toBe(2820);
    expect(blocks[0].runId).toBe("3840");
    expect(blocks[1].runNumber).toBe(2821);
    expect(blocks[2].runNumber).toBe(2822);
    expect(blocks[3].runNumber).toBe(2823);
  });

  it("captures text content for each block", () => {
    const blocks = parseRunBlocks(SAMPLE_HTML);
    expect(blocks[0].text).toContain("Sydenham");
    expect(blocks[0].text).toContain("Tuna Melt");
    expect(blocks[0].text).toContain("February");
  });
});

describe("LondonHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.events.length).toBeGreaterThanOrEqual(3);
    expect(result.structureHash).toBeDefined();

    // Check first event
    const first = result.events.find((e) => e.runNumber === 2820);
    expect(first).toBeDefined();
    expect(first!.date).toBe("2026-02-21");
    expect(first!.kennelTag).toBe("LH3");
    expect(first!.hares).toBe("Tuna Melt and Opee");
    expect(first!.location).toBe("The Dolphin");
    expect(first!.startTime).toBe("12:00");
    expect(first!.description).toContain("Nearest station: Sydenham");
    expect(first!.sourceUrl).toContain("nextrun.php?run=3840");

    vi.restoreAllMocks();
  });

  it("parses summer evening run with 7pm start", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    const summer = result.events.find((e) => e.runNumber === 2823);
    expect(summer).toBeDefined();
    expect(summer!.startTime).toBe("19:00");
    expect(summer!.date).toBe("2026-06-22");

    vi.restoreAllMocks();
  });

  it("handles 'Hare required' gracefully", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    const noHare = result.events.find((e) => e.runNumber === 2822);
    expect(noHare).toBeDefined();
    expect(noHare!.hares).toBeUndefined();

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns diagnostic context", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new LondonHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.londonhash.org/runlist.php",
    } as never);

    expect(result.diagnosticContext).toHaveProperty("blocksFound");
    expect(result.diagnosticContext).toHaveProperty("eventsParsed");
    expect(result.diagnosticContext).toHaveProperty("fetchDurationMs");

    vi.restoreAllMocks();
  });
});
