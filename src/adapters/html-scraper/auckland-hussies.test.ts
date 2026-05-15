import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  AucklandHussiesAdapter,
  parseAucklandHussiesRow,
} from "./auckland-hussies";

vi.mock("@/adapters/safe-fetch", () => ({ safeFetch: vi.fn() }));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-akhussies"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides: Partial<Source> = {}): Source {
  return {
    id: "src-akhussies",
    name: "Auckland Hussies Website",
    url: "https://aucklandhussies.co.nz/Run%20List.html",
    type: "HTML_SCRAPER",
    trustLevel: 5,
    scrapeFreq: "daily",
    scrapeDays: 180,
    config: { kennelTag: "auckland-hussies" },
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function mockFetch(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

describe("parseAucklandHussiesRow", () => {
  const refDate = new Date("2026-05-15T00:00:00Z");

  it("parses a standard run row using refDate-year", () => {
    const row = parseAucklandHussiesRow(
      { dateText: "5-May", hareText: "Triple One & Cross Dresser", locationText: "111 Walker Rd, Pt Chevalier" },
      { kennelTag: "auckland-hussies", referenceDate: refDate, sourceUrl: "https://aucklandhussies.co.nz/Run%20List.html" },
    );
    expect(row).not.toBeNull();
    // Year is inferred from refDate (2026-05-15); no forwardDate bump.
    expect(row!.date).toBe("2026-05-05");
    // normalizeHaresField only splits on commas, so "X & Y" stays joined.
    expect(row!.hares).toBe("Triple One & Cross Dresser");
    expect(row!.location).toBe("111 Walker Rd, Pt Chevalier");
    expect(row!.kennelTags).toEqual(["auckland-hussies"]);
  });

  it("bumps year monotonically when a later row goes backwards", () => {
    // Synthesize a year-roll: prev locked in 2026-12-15, the next row's
    // refDate-year parse gives 2026-01-05 (before prev) — bump to 2027.
    const second = parseAucklandHussiesRow(
      { dateText: "5-Jan", hareText: "", locationText: "" },
      { kennelTag: "k", referenceDate: refDate, sourceUrl: "https://x", prevDate: "2026-12-15" },
    );
    expect(second!.date).toBe("2027-01-05");
  });

  it("returns null when the date cell is unparseable", () => {
    const row = parseAucklandHussiesRow(
      { dateText: "021-420209", hareText: "", locationText: "" },
      { kennelTag: "auckland-hussies", referenceDate: refDate, sourceUrl: "https://x" },
    );
    expect(row).toBeNull();
  });

  it("treats &nbsp; / empty location cells as undefined", () => {
    const row = parseAucklandHussiesRow(
      { dateText: "16-Jun", hareText: "Demon", locationText: " " },
      { kennelTag: "auckland-hussies", referenceDate: refDate, sourceUrl: "https://x" },
    );
    expect(row!.location).toBeUndefined();
  });
});

describe("AucklandHussiesAdapter.fetch", () => {
  // Faithful 6-column Excel-export shape: run rows + intervening annotation
  // rows that the discriminator must reject.
  const html = `<!DOCTYPE html><html><body>
    <table>
      <tr><td>5-May</td><td></td><td></td><td>Triple One &amp; Cross Dresser</td><td>111 Walker Rd, Pt Chevalier</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td><td>Please text the hare</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td><td>021 136 4186</td><td></td></tr>
      <tr><td>12-May</td><td></td><td></td><td>Demon</td><td>Chang Thai Caf&eacute;, Panmure</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td><td></td><td></td></tr>
      <tr><td>16-Jun</td><td></td><td></td><td>Dickorum and LC</td><td>34 Mahara Ave, Birkenhead</td><td></td></tr>
    </table>
  </body></html>`;

  it("extracts only the 3 date-shaped rows, ignoring annotation rows", async () => {
    mockFetch(html);
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });

    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(3);
    const hares = result.events.map((e) => e.hares);
    expect(hares).toContain("Demon");
    expect(hares).toContain("Triple One & Cross Dresser");
    expect(result.diagnosticContext?.rowsConsidered).toBe(3);
  });
});
