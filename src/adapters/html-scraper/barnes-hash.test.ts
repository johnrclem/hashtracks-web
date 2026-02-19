import { describe, it, expect, vi } from "vitest";
import {
  parseBarnesDate,
  extractPostcode,
  parseRunNumber,
  parseBarnesRow,
} from "./barnes-hash";
import { BarnesHashAdapter } from "./barnes-hash";

describe("parseBarnesDate", () => {
  it("parses ordinal date with full month", () => {
    expect(parseBarnesDate("19th February 2026")).toBe("2026-02-19");
  });

  it("parses ordinal date with short month", () => {
    expect(parseBarnesDate("5th Mar 2026")).toBe("2026-03-05");
  });

  it("parses 1st, 2nd, 3rd ordinals", () => {
    expect(parseBarnesDate("1st January 2026")).toBe("2026-01-01");
    expect(parseBarnesDate("2nd February 2026")).toBe("2026-02-02");
    expect(parseBarnesDate("3rd March 2026")).toBe("2026-03-03");
  });

  it("parses date without ordinal suffix", () => {
    expect(parseBarnesDate("19 February 2026")).toBe("2026-02-19");
  });

  it("parses DD/MM/YYYY format", () => {
    expect(parseBarnesDate("19/02/2026")).toBe("2026-02-19");
  });

  it("parses date with day name prefix", () => {
    expect(parseBarnesDate("Wednesday 19th February 2026")).toBe("2026-02-19");
  });

  it("returns null for invalid month", () => {
    expect(parseBarnesDate("19th Flob 2026")).toBeNull();
  });

  it("returns null for missing year", () => {
    expect(parseBarnesDate("19th February")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseBarnesDate("")).toBeNull();
  });
});

describe("extractPostcode", () => {
  it("extracts standard postcode", () => {
    expect(extractPostcode("The Pub KT20 7ES")).toBe("KT20 7ES");
  });

  it("extracts postcode from full address", () => {
    expect(extractPostcode("The Sun Inn, Richmond, TW9 1TH near the river")).toBe("TW9 1TH");
  });

  it("returns null when no postcode present", () => {
    expect(extractPostcode("The Pub, Richmond")).toBeNull();
  });
});

describe("parseRunNumber", () => {
  it("parses run number with hash prefix", () => {
    expect(parseRunNumber("#2104")).toBe(2104);
  });

  it("parses plain run number", () => {
    expect(parseRunNumber("2104")).toBe(2104);
  });

  it("parses from mixed text", () => {
    expect(parseRunNumber("Run #2104 - Wed")).toBe(2104);
  });

  it("returns null for no number", () => {
    expect(parseRunNumber("no number here")).toBeNull();
  });
});

describe("parseBarnesRow", () => {
  it("parses a complete row with all fields", () => {
    const cells = [
      "2104  19th February 2026",
      "Speedy & Flasher",
      "The Sun Inn, Richmond TW9 1TH",
    ];
    const event = parseBarnesRow(cells);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-19");
    expect(event!.kennelTag).toBe("BarnesH3");
    expect(event!.runNumber).toBe(2104);
    expect(event!.hares).toBe("Speedy & Flasher");
    expect(event!.location).toBe("The Sun Inn, Richmond TW9 1TH");
    expect(event!.locationUrl).toContain("TW9%201TH");
    expect(event!.startTime).toBe("19:30");
  });

  it("parses row with DD/MM/YYYY date", () => {
    const cells = ["2105  26/02/2026", "Muddy Boots", "The Crown, SW15 2PA"];
    const event = parseBarnesRow(cells);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-02-26");
    expect(event!.runNumber).toBe(2105);
    expect(event!.hares).toBe("Muddy Boots");
  });

  it("parses row without postcode", () => {
    const cells = ["2106  5th March 2026", "Trail Blazer", "TBA"];
    const event = parseBarnesRow(cells);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-05");
    expect(event!.hares).toBe("Trail Blazer");
    expect(event!.locationUrl).toBeUndefined();
  });

  it("returns null for too few cells", () => {
    expect(parseBarnesRow(["2104"])).toBeNull();
  });

  it("returns null for row without valid date", () => {
    expect(parseBarnesRow(["2104", "No date here", "Some pub"])).toBeNull();
  });

  it("sets BarnesH3 as kennel tag", () => {
    const cells = ["2107  12th March 2026", "Hare Name", "The Fox SW19 3AA"];
    const event = parseBarnesRow(cells);
    expect(event!.kennelTag).toBe("BarnesH3");
  });
});

const SAMPLE_HTML = `
<html><body>
<table>
  <tr>
    <td><b>Run #</b></td>
    <td><b>Date</b></td>
    <td><b>Hare</b></td>
    <td><b>Location</b></td>
  </tr>
  <tr>
    <td>2104  19th February 2026</td>
    <td>Speedy</td>
    <td>The White Horse, Richmond TW9 1TH</td>
  </tr>
  <tr>
    <td>2105  26th February 2026</td>
    <td>Muddy Boots &amp; Flash</td>
    <td>The Red Lion, Putney SW15 2PA</td>
  </tr>
  <tr>
    <td>2106  5th March 2026</td>
    <td>Trail Blazer</td>
    <td>TBA</td>
  </tr>
</table>
</body></html>
`;

describe("BarnesHashAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new BarnesHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.barnesh3.com/HareLine.htm",
    } as never);

    expect(result.events).toHaveLength(3);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();

    const first = result.events[0];
    expect(first.date).toBe("2026-02-19");
    expect(first.kennelTag).toBe("BarnesH3");
    expect(first.startTime).toBe("19:30");

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new BarnesHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.barnesh3.com/HareLine.htm",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errorDetails?.fetch).toHaveLength(1);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Forbidden", { status: 403, statusText: "Forbidden" }),
    );

    const adapter = new BarnesHashAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "http://www.barnesh3.com/HareLine.htm",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(403);

    vi.restoreAllMocks();
  });
});
