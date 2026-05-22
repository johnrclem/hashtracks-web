import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  AucklandHussiesAdapter,
  classifyLocationCell,
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

  it("recovers the street address from a continuation row on joint-run annotation rows (#1516)", async () => {
    // Live source pattern: Apr 27 Butcher has the "With the men…" note in the
    // dated row's col-4 and the actual street address "6 Waterstone Way,
    // Henderson" on the next blank-date row. The classifier must end up with
    // location="6 Waterstone Way…", description="With the men…".
    const html = `<!DOCTYPE html><html><body><table>
      <tr><td>27-Apr</td><td></td><td></td><td>Butcher</td><td>With the men on a Monday night - 4pm</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td><td>6 Waterstone Way, Henderson</td><td></td></tr>
    </table></body></html>`;
    mockFetch(html);
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].location).toBe("6 Waterstone Way, Henderson");
    expect(result.events[0].description).toBe("With the men on a Monday night - 4pm");
  });

  it("does NOT merge continuation rows when the dated row already has a real venue", async () => {
    // Mangawhai / Café-style rows must stay untouched — continuation rows in
    // these cases contain phone numbers / cost notes / CTAs that would pollute
    // the address. Only joint-run annotation rows get the continuation merge.
    const html = `<!DOCTYPE html><html><body><table>
      <tr><td>24-Apr</td><td></td><td></td><td>Mangawhai HH</td><td>3pm 5 Olsen Ave, Mangawhai Heads</td><td></td></tr>
      <tr><td></td><td></td><td></td><td>Phantom &amp; Plunder</td><td>0274555753</td><td></td></tr>
      <tr><td>12-May</td><td></td><td></td><td>Demon</td><td>Chang Thai Caf&eacute;, Queens Road, Panmure</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td><td>Pay your own way + $5 for the run</td><td></td></tr>
    </table></body></html>`;
    mockFetch(html);
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events).toHaveLength(2);
    expect(result.events[0].location).toBe("5 Olsen Ave, Mangawhai Heads");
    expect(result.events[0].startTime).toBe("15:00");
    expect(result.events[1].location).toBe("Chang Thai Café, Queens Road, Panmure");
  });

  it("emits location: null when joint-run annotation has no address on the continuation row (#1516)", async () => {
    // Jun 1 TBA shape: annotation + a non-address CTA continuation. The
    // classifier should clear `location` (null) so the merge pipeline scrubs
    // any previously stored locationName.
    const html = `<!DOCTYPE html><html><body><table>
      <tr><td>1-Jun</td><td></td><td></td><td>TBA</td><td>With the men on a Monday night - 4pm</td><td></td></tr>
      <tr><td></td><td></td><td></td><td></td><td>Please text the hare prior to Monday that you are coming:</td><td></td></tr>
    </table></body></html>`;
    mockFetch(html);
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events).toHaveLength(1);
    expect(result.events[0].location).toBeNull();
    expect(result.events[0].description).toBe("With the men on a Monday night - 4pm");
  });

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
    // Joint-run note routes to description, with `location: null` to scrub
    // any stale `locationName` from previous scrapes (#1516, Codex review).
    // The cell must still contain a properly-decoded NBSP (0xA0) — no U+FFFD
    // leakage — which proves the windows-1252 path is exercised.
    expect(first.location).toBeNull();
    expect(first.description).toBe("With the men on a Monday night - 4pm");
    expect(first.description).not.toContain("�");
    // TBA → undefined is the intentional placeholder behaviour, shared with
    // Geriatrix's "Hare Required" handling. Documented here so the contract
    // doesn't silently flip back to populating placeholders.
    expect(first.hares).toBeUndefined();
    // Decode must actually round-trip 0xE9 to "é" — not strip-as-U+FFFD,
    // which would erroneously pass the no-U+FFFD assertion on row 1.
    expect(second.hares).toBe("Café & Friends");
    expect(second.hares).not.toContain("�");
  });

  it("falls back to windows-1252 when the meta tag advertises a bogus charset", async () => {
    // Defence against a misdeclared meta tag — TextDecoder would throw
    // RangeError on `charset=not-a-real-charset` and kill the scrape.
    // The fallback must keep the adapter alive (logs a warning).
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const head = Buffer.from(
      '<!DOCTYPE html><html><head><meta charset="not-a-real-charset"></head><body><table>' +
        '<tr><td>5-May</td><td></td><td></td><td>Triple One</td><td>',
      "ascii",
    );
    const eAcute = Buffer.from([0xe9]); // windows-1252 é — survives if fallback fired
    const tail = Buffer.from("clair St</td></tr></table></body></html>", "ascii");
    mockFetchBytes(new Uint8Array(Buffer.concat([head, eAcute, tail])));
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.errors).toEqual([]);
    expect(result.events.length).toBe(1);
    expect(result.events[0].location).toBe("éclair St");
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("not-a-real-charset"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("rejects responses larger than the body cap", async () => {
    // 3 MB declared length blows the 2 MB cap; safeFetch returns the
    // header alone (the body never gets consumed). The adapter must not
    // crash and must surface the rejection as a fetch error.
    mockedSafeFetch.mockResolvedValue(
      new Response("<html></html>", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": String(3 * 1024 * 1024) },
      }),
    );
    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/Response too large/);
  });

  // -------------------------------------------------------------------------
  // WS6 — #1516 location classifier
  // -------------------------------------------------------------------------

  describe("classifyLocationCell (#1516)", () => {
    it("routes joint-run notes to description with explicit null location (clears stale data)", () => {
      const c = classifyLocationCell("With the men on a Monday night - 4pm");
      expect(c.location).toBeNull();
      expect(c.description).toBe("With the men on a Monday night - 4pm");
      expect(c.startTime).toBeUndefined();
    });

    it("strips a bare-time prefix into startTime and keeps the address as location", () => {
      const c = classifyLocationCell("3pm 5 Olsen Ave, Mangawhai Heads");
      expect(c.startTime).toBe("15:00");
      expect(c.location).toBe("5 Olsen Ave, Mangawhai Heads");
      expect(c.description).toBeUndefined();
    });

    it("accepts H:MM am/pm shapes (6:30pm) and collapses extra whitespace", () => {
      const c = classifyLocationCell("6:30pm  12 Foo St, Bar");
      expect(c.startTime).toBe("18:30");
      expect(c.location).toBe("12 Foo St, Bar");
    });

    it("falls through unchanged for plain venue names with no annotation", () => {
      const c = classifyLocationCell("The Bond Sports Bar");
      expect(c.location).toBe("The Bond Sports Bar");
      expect(c.description).toBeUndefined();
      expect(c.startTime).toBeUndefined();
    });

    it("peels the trailing address out of an annotation + address cell", () => {
      const c = classifyLocationCell(
        "With the men on a Monday night - 4pm  6 Waterstone Way, Henderson",
      );
      expect(c.location).toBe("6 Waterstone Way, Henderson");
      expect(c.description).toBe("With the men on a Monday night - 4pm");
    });

    it.each([
      ["With the men on a Monday night - 4pm 1/23 Main St", "1/23 Main St"],
      ["With the men on a Monday night - 4pm 84A Church St", "84A Church St"],
      ["With the men on a Monday night - 4pm 23-25 Main Rd", "23-25 Main Rd"],
      ["With the men on a Monday night - 4pm 5 Pine Grove", "5 Pine Grove"],
      ["With the men on a Monday night - 4pm 12 Lake View", "12 Lake View"],
      ["With the men on a Monday night - 4pm 8 Marine Parade", "8 Marine Parade"],
      ["With the men on a Monday night - 4pm 6 Church St.", "6 Church St."],
    ])("peels NZ-specific address shapes (%s)", (cell, expected) => {
      const c = classifyLocationCell(cell);
      expect(c.location).toBe(expected);
      expect(c.description).toBe("With the men on a Monday night - 4pm");
    });

    it("returns empty object for undefined / empty input", () => {
      expect(classifyLocationCell(undefined)).toEqual({});
      expect(classifyLocationCell("")).toEqual({});
      expect(classifyLocationCell("   ")).toEqual({});
    });
  });

  // -------------------------------------------------------------------------
  // WS6 — #1515 live-bytes regression (no U+FFFD leakage from the production
  // source). Fixture captured 2026-05-22 via `curl -s aucklandhussies.co.nz/Run%20List.html`.
  // High bytes present in the fixture: 0xA0 (NBSP) + 0xE9 (é).
  // -------------------------------------------------------------------------

  it("decodes the live windows-1252 source with no U+FFFD anywhere (#1515)", async () => {
    const fixturePath = path.join(
      __dirname,
      "fixtures/auckland-hussies-live-2026-05-22.html.fixture",
    );
    const bytes = new Uint8Array(readFileSync(fixturePath));
    mockFetchBytes(bytes);

    const adapter = new AucklandHussiesAdapter();
    const result = await adapter.fetch(makeSource(), { days: 365 });

    expect(result.errors).toEqual([]);
    expect(result.events.length).toBeGreaterThan(0);
    for (const ev of result.events) {
      // Every field that could carry text must be U+FFFD-free.
      expect(ev.location ?? "").not.toContain("�");
      expect(ev.hares ?? "").not.toContain("�");
      expect(ev.description ?? "").not.toContain("�");
    }

    // The May 12 Chang Thai Café row exercises the 0xE9 byte. We don't know
    // its exact bucket in the fixture without re-parsing the date, but at
    // least one location must contain the decoded "é".
    const cafe = result.events.find((e) => e.location?.includes("Café"));
    expect(cafe).toBeDefined();
    expect(cafe!.location).toContain("Chang Thai Café");

    // At least one joint-run note row must end up with `location: null`
    // (explicit clear) — that's the Jun 1 TBA shape (annotation + non-address
    // continuation row). The Apr 27 Butcher shape recovers a street address
    // from its continuation row, so its location is set, not null.
    const cleared = result.events.find((e) =>
      e.description?.startsWith("With the men on a Monday night") && e.location === null,
    );
    expect(cleared).toBeDefined();
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
