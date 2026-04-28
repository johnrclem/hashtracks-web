import { describe, it, expect, vi, beforeEach } from "vitest";
import * as cheerio from "cheerio";
import {
  parseDetailedBlock,
  parseOttawaTime,
  parsePlanningLine,
  Oh3OttawaAdapter,
} from "./oh3-ottawa";
import * as utils from "../utils";
import type { FetchHTMLSuccess } from "../utils";

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchHTMLPage: vi.fn(),
  };
});

// ---------------------------------------------------------------------------
// parseOttawaTime
// ---------------------------------------------------------------------------

describe("parseOttawaTime", () => {
  it("parses '6:45 p.m.' as 18:45", () => {
    expect(parseOttawaTime("6:45 p.m.")).toBe("18:45");
  });

  it("parses '7:00 a.m.' as 07:00", () => {
    expect(parseOttawaTime("7:00 a.m.")).toBe("07:00");
  });

  it("parses '12:00 p.m.' as noon", () => {
    expect(parseOttawaTime("12:00 p.m.")).toBe("12:00");
  });

  it("parses '12:00 a.m.' as midnight", () => {
    expect(parseOttawaTime("12:00 a.m.")).toBe("00:00");
  });

  it("handles compact format '6:45pm'", () => {
    expect(parseOttawaTime("6:45pm")).toBe("18:45");
  });

  it("returns undefined for unparseable string", () => {
    expect(parseOttawaTime("sometime")).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// parseDetailedBlock
// ---------------------------------------------------------------------------

describe("parseDetailedBlock", () => {
  const fullBlock = `R*n # 2203                Just wait until they see & hear me!
When:                        Monday, 30 March 2026 @ 6:45 p.m.
Hares:                       Didgeri-Do-Me
Start:                       Coliseum Theatre   Carling Ave
ON IN:                       Lorenzo's Pizza, (just opposite at 3007)
Hash Cash:                   $5`;

  it("parses run number", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(2203);
  });

  it("parses title from R*n line", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.title).toBe("Just wait until they see & hear me!");
  });

  it("parses date to YYYY-MM-DD", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.date).toBe("2026-03-30");
  });

  it("parses time from @ separator", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.startTime).toBe("18:45");
  });

  it("parses hares", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.hares).toBe("Didgeri-Do-Me");
  });

  it("parses start location", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.location).toBe("Coliseum Theatre   Carling Ave");
  });

  it("includes ON IN in description", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.description).toContain("ON IN:");
    expect(result!.description).toContain("Lorenzo's Pizza");
  });

  it("sets kennelTag to oh3-ca", () => {
    const result = parseDetailedBlock(fullBlock);
    expect(result!.kennelTags[0]).toBe("oh3-ca");
  });

  it("returns null when no R*n pattern found", () => {
    const result = parseDetailedBlock("Just some text without a run header");
    expect(result).toBeNull();
  });

  it("returns null when no When: field found", () => {
    const result = parseDetailedBlock("R*n # 2203  Title\nHares: Someone");
    expect(result).toBeNull();
  });

  it("parses block with Map link", () => {
    const blockWithMap = `R*n # 2206                Wet & Muddy Fun!
When:                        Monday, 20 April 2026 @ 6:45 p.m.
Hares:                       El Tucuche & La Touchée
Start:                       Jack Pine Parking Lot 9    Stony Swamp
Hash Cash:                   $5
Note 1:                      Expect shiggy!
ON IN:                       Big Mort's Little Pub,  2011 Robertson Rd.
Map:                         https://goo.gl/maps/FYEiY8a4Td7LDT1b6`;

    const result = parseDetailedBlock(blockWithMap);
    expect(result).not.toBeNull();
    expect(result!.locationUrl).toBe("https://goo.gl/maps/FYEiY8a4Td7LDT1b6");
    expect(result!.description).toContain("Expect shiggy!");
    expect(result!.description).toContain("ON IN:");
  });

  it("handles TBD start location as undefined", () => {
    const block = `R*n # 2207
When:                        Monday, 27 March 2026 @ 6:45 p.m.
Hares:                       Multiple Entry
Start:                       TBD
Hash Cash:                   $$`;

    const result = parseDetailedBlock(block);
    expect(result).not.toBeNull();
    expect(result!.location).toBeUndefined();
  });

  it("defaults to 18:45 when no time after @", () => {
    const block = `R*n # 2204                Hare today
When:                        Monday, 6 April 2026
Hares:                       Someone`;

    const result = parseDetailedBlock(block);
    expect(result).not.toBeNull();
    expect(result!.startTime).toBe("18:45");
  });
});

// ---------------------------------------------------------------------------
// parsePlanningLine
// ---------------------------------------------------------------------------

describe("parsePlanningLine", () => {
  it("parses a planning line with hare name", () => {
    const result = parsePlanningLine("2210        Monday, 18 May                    2026           Alkasleezer");
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(2210);
    expect(result!.date).toBe("2026-05-18");
    expect(result!.hares).toBe("Alkasleezer");
    expect(result!.kennelTags[0]).toBe("oh3-ca");
    expect(result!.startTime).toBe("18:45");
  });

  it("parses NEED A HARE as undefined hares", () => {
    const result = parsePlanningLine("2208        Monday, 4 May                    2026           NEED A HARE");
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(2208);
    expect(result!.date).toBe("2026-05-04");
    expect(result!.hares).toBeUndefined();
  });

  it("parses planning line with compound hare names", () => {
    const result = parsePlanningLine("2213        Monday, 8 June                    2026           Tie Me Up & Clogged Nozzle");
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBe(2213);
    expect(result!.date).toBe("2026-06-08");
    expect(result!.hares).toBe("Tie Me Up & Clogged Nozzle");
  });

  it("returns null for non-planning text", () => {
    const result = parsePlanningLine("Just some random text here");
    expect(result).toBeNull();
  });

  it("returns null for empty string", () => {
    const result = parsePlanningLine("");
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Oh3OttawaAdapter
// ---------------------------------------------------------------------------

describe("Oh3OttawaAdapter", () => {
  const adapter = new Oh3OttawaAdapter();

  const mockSource = {
    id: "test-oh3",
    url: "https://docs.google.com/document/d/1jGyBUKxOYkxrZg8WVfpBYDP84fbacanoX_TJuyCmtAI/pub",
  } as Parameters<typeof adapter.fetch>[0];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses detailed event blocks and planning-ahead lines", async () => {
    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: true,
      html: "",
      $: cheerio.load(`
        <div id="contents"><div class="doc-content">
          <hr>
          <p>R*n # 2203                Just wait until they see &amp; hear me!</p>
          <p>When:                        Monday, 30 March 2026 @ 6:45 p.m.</p>
          <p>Hares:                       Didgeri-Do-Me</p>
          <p>Start:                       Coliseum Theatre   Carling Ave</p>
          <p>Hash Cash:                   $5</p>
          <hr>
          <p>R*n # 2204                Hare today, gone tomorrow!</p>
          <p>When:                        Monday, 6 April 2026 @ 6:45 p.m.</p>
          <p>Hares:                       Corkscrewer &amp; POG</p>
          <p>Start:                       20 Gervin Street, Nepean</p>
          <p>Hash Cash:                   $15</p>
          <hr>
          <p>Planning ahead</p>
          <p>2208        Monday, 4 May                    2026           NEED A HARE</p>
          <p>2210        Monday, 18 May                    2026           Alkasleezer</p>
        </div></div>
      `),
      structureHash: "abc123",
      fetchDurationMs: 200,
    } as FetchHTMLSuccess);

    const result = await adapter.fetch(mockSource);
    expect(result.errors).toHaveLength(0);

    // Should have 2 detailed + 2 planning = 4 events
    expect(result.events.length).toBeGreaterThanOrEqual(2);

    const run2203 = result.events.find((e) => e.runNumber === 2203);
    expect(run2203).toBeDefined();
    expect(run2203!.date).toBe("2026-03-30");
    expect(run2203!.hares).toBe("Didgeri-Do-Me");
    expect(run2203!.kennelTags[0]).toBe("oh3-ca");

    const run2204 = result.events.find((e) => e.runNumber === 2204);
    expect(run2204).toBeDefined();
    expect(run2204!.date).toBe("2026-04-06");
    expect(run2204!.hares).toBe("Corkscrewer & POG");
  });

  it("returns error when fetch fails", async () => {
    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: false,
      result: {
        events: [],
        errors: ["HTTP 500: Internal Server Error"],
        errorDetails: { fetch: [{ url: mockSource.url, status: 500, message: "HTTP 500" }] },
      },
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("HTTP 500: Internal Server Error");
  });

  it("returns error when content div not found", async () => {
    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: true,
      html: "",
      $: cheerio.load("<html><body><p>No content div</p></body></html>"),
      structureHash: "xyz",
      fetchDurationMs: 100,
    } as FetchHTMLSuccess);

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("Could not find document content");
  });

  it("includes diagnostic context", async () => {
    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: true,
      html: "",
      $: cheerio.load(`<div id="contents"><div class="doc-content"><hr><p>empty</p></div></div>`),
      structureHash: "abc",
      fetchDurationMs: 150,
    } as FetchHTMLSuccess);

    const result = await adapter.fetch(mockSource);
    expect(result.diagnosticContext).toBeDefined();
    expect(result.diagnosticContext!.fetchMethod).toBe("google-doc-pub");
    expect(result.diagnosticContext!.fetchDurationMs).toBe(150);
  });
});
