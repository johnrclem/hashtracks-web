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
  mockedSafeFetch.mockResolvedValue(
    new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
  );
}

function mockFetchBytes(bytes: Uint8Array, contentType = "text/html") {
  // Copy into a fresh ArrayBuffer so the Response constructor accepts the
  // body (Uint8Array isn't directly assignable to BodyInit under TS 5.7+).
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  mockedSafeFetch.mockResolvedValue(
    new Response(buffer, { status: 200, headers: { "content-type": contentType } }),
  );
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
    expect(row?.date).toBe("2026-05-05");
    // normalizeHaresField only splits on commas, so "X & Y" stays joined.
    expect(row?.hares).toBe("Triple One & Cross Dresser");
    expect(row?.location).toBe("111 Walker Rd, Pt Chevalier");
    expect(row?.kennelTags).toEqual(["auckland-hussies"]);
  });

  it("bumps year monotonically when a later row goes backwards", () => {
    // Synthesize a year-roll: prev locked in 2026-12-15, the next row's
    // refDate-year parse gives 2026-01-05 (before prev) — bump to 2027.
    const second = parseAucklandHussiesRow(
      { dateText: "5-Jan", hareText: "", locationText: "" },
      { kennelTag: "k", referenceDate: refDate, sourceUrl: "https://x", prevDate: "2026-12-15" },
    );
    expect(second?.date).toBe("2027-01-05");
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
    expect(row?.location).toBeUndefined();
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

  it("decodes windows-1252 bytes (NBSP = 0xA0) without U+FFFD leakage (#1506)", async () => {
    // The live source ships bytes like:
    //   <td>With the men on a Monday night<span ...>\xA0 </span>- 4pm</td>
    // and declares the encoding only via `<meta charset=windows-1252>`. The
    // previous fetchHTMLPage path decoded as UTF-8 and the 0xA0 NBSP became
    // U+FFFD ("Monday night� - 4pm"). Build the exact byte sequence here.
    const head = Buffer.from(
      '<!DOCTYPE html><html><head><meta http-equiv=Content-Type content="text/html; charset=windows-1252"></head>' +
        "<body><table>" +
        // Row 1: location cell exercises the windows-1252 NBSP (0xA0) byte
        // that the previous fetchHTMLPage path turned into U+FFFD.
        "<tr><td>1-Jun</td><td></td><td></td><td>TBA</td><td>With the men on a Monday night",
      "ascii",
    );
    const nbspSpan = Buffer.from([
      0x3c, 0x73, 0x70, 0x61, 0x6e, 0x3e, // <span>
      0xa0,                                // windows-1252 NBSP (would be U+FFFD if decoded as UTF-8)
      0x20,                                // space
      0x3c, 0x2f, 0x73, 0x70, 0x61, 0x6e, 0x3e, // </span>
    ]);
    // Row 2: hare cell contains a windows-1252 0xE9 byte (`é`) — proves the
    // decode actually picked windows-1252, not UTF-8 + U+FFFD scrubbing
    // (which would erase 0xE9 too instead of converting it to "é").
    const cafeRowAscii = Buffer.from(
      "- 4pm</td><td></td></tr>" +
        "<tr><td>8-Jun</td><td></td><td></td><td>",
      "ascii",
    );
    const cafeRowBytes = Buffer.from([
      // "Caf" + 0xE9 (windows-1252 é) + "" (no extra chars)
      0x43, 0x61, 0x66, 0xe9,
    ]);
    const cafeRowTail = Buffer.from(
      " & Friends</td><td>1 Beach Rd, Mission Bay</td></tr></table></body></html>",
      "ascii",
    );
    const bytes = Buffer.concat([head, nbspSpan, cafeRowAscii, cafeRowBytes, cafeRowTail]);

    mockFetchBytes(new Uint8Array(bytes));
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });

    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(2);
    const [first, second] = result.events;
    expect(first.location).toBeDefined();
    expect(first.location).not.toContain("�");
    expect(first.location).toBe("With the men on a Monday night - 4pm");
    // TBA → undefined is the intentional placeholder behaviour, shared with
    // Geriatrix's "Hare Required" handling. Documented here so the contract
    // doesn't silently flip back to populating placeholders.
    expect(first.hares).toBeUndefined();
    // Decode must actually round-trip 0xE9 to "é" — not strip-as-U+FFFD,
    // which would erroneously pass the no-U+FFFD assertion on row 1.
    expect(second.hares).toBe("Café & Friends");
    expect(second.hares).not.toContain("�");
  });

  it("prefers the Content-Type header charset when it is present", async () => {
    // If the header advertises utf-8, trust the header (proper bytes) and
    // skip the meta-tag sniff. Modern servers do this; the legacy Auckland
    // Hussies Apache config doesn't.
    const utf8 = Buffer.from(
      '<!DOCTYPE html><html><body><table>' +
        '<tr><td>5-May</td><td></td><td></td><td>Triple One</td><td>Café corner</td></tr>' +
        '</table></body></html>',
      "utf8",
    );
    mockFetchBytes(new Uint8Array(utf8), "text/html; charset=utf-8");
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events.length).toBe(1);
    expect(result.events[0].location).toBe("Café corner");
  });
});
