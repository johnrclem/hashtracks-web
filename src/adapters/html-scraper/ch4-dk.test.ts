import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import {
  Ch4DkAdapter,
  parseCh4DateTime,
  parseCh4Hares,
  flattenAddressCell,
} from "./ch4-dk";

vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-ch4-dk"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-ch4-dk",
    name: "Copenhagen Howling H3 Runsheet",
    url: "https://ch4.dk/",
    type: "HTML_SCRAPER",
    trustLevel: 8,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: {},
    isActive: true,
    lastScrapedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Source;
}

function mockFetchResponse(html: string) {
  mockedSafeFetch.mockResolvedValue({
    ok: true,
    status: 200,
    statusText: "OK",
    text: () => Promise.resolve(html),
    headers: new Headers({ "content-type": "text/html" }),
  } as Response);
}

describe("parseCh4DateTime", () => {
  it("parses 'Friday 03-04-2026<br>20:00 hrs'", () => {
    const result = parseCh4DateTime(
      `Friday 03-04-2026<br>20:00 hrs`,
      2026,
    );
    expect(result).toEqual({ date: "2026-04-03", startTime: "20:00" });
  });

  it("parses Good Friday with mixed-color spans", () => {
    const result = parseCh4DateTime(
      `<font COLOR="#FF0000">Good </font><font COLOR="#FFFF00">Friday 03-04-2026<br>20:00 hrs</font>`,
      2026,
    );
    expect(result).toEqual({ date: "2026-04-03", startTime: "20:00" });
  });

  it("parses date with appended day-context note", () => {
    const result = parseCh4DateTime(
      `Friday 01-05-2026<br>20:00 hrs<br><font COLOR="#FF0000">May 1<sup>st</sup> / Big Prayer Day!</font>`,
      2026,
    );
    expect(result).toEqual({ date: "2026-05-01", startTime: "20:00" });
  });

  it("parses date without inline time", () => {
    const result = parseCh4DateTime(`Friday 05-06-2026`, 2026);
    expect(result).toEqual({ date: "2026-06-05" });
  });

  it("uses yearHint when only DD-MM is present", () => {
    const result = parseCh4DateTime(`Friday 25-09<br>20:00 hrs`, 2026);
    expect(result).toEqual({ date: "2026-09-25", startTime: "20:00" });
  });

  it("returns null for invalid month", () => {
    const result = parseCh4DateTime(`Friday 03-13-2026`, 2026);
    expect(result).toBeNull();
  });

  it("returns null for impossible day-month combination (April 31)", () => {
    expect(parseCh4DateTime(`Wednesday 31-04-2026<br>20:00 hrs`, 2026)).toBeNull();
  });

  it("returns null for Feb 29 in non-leap year", () => {
    expect(parseCh4DateTime(`Tuesday 29-02-2025<br>20:00 hrs`, 2025)).toBeNull();
  });

  it("accepts Feb 29 in leap year (2024)", () => {
    const result = parseCh4DateTime(`Thursday 29-02-2024<br>20:00 hrs`, 2024);
    expect(result).toEqual({ date: "2024-02-29", startTime: "20:00" });
  });

  it("returns null when no date-like text is present", () => {
    expect(parseCh4DateTime(`Full Moon Hash`, 2026)).toBeNull();
  });
});

describe("flattenAddressCell", () => {
  it("flattens multi-line venue address with <br>", () => {
    const result = flattenAddressCell(
      `<a href="https://example.com">Cafe Ellebo</a><br>Sj&aelig;l&oslash;r Boulevard 49<br>2450 Copenhagen SV`,
    );
    expect(result).toBe("Cafe Ellebo, Sjælør Boulevard 49, 2450 Copenhagen SV");
  });

  it("returns undefined for 'Location TBA'", () => {
    expect(flattenAddressCell(`Location TBA`)).toBeUndefined();
    expect(flattenAddressCell(`<i>Location TBC</i>`)).toBeUndefined();
  });

  it("returns undefined for empty cells", () => {
    expect(flattenAddressCell(`&nbsp;<br>`)).toBeUndefined();
  });
});

describe("parseCh4Hares", () => {
  it("returns single hare unchanged", () => {
    expect(parseCh4Hares("Codpiece")).toBe("Codpiece");
  });

  it("alphabetizes multi-hare 'X and Y'", () => {
    expect(parseCh4Hares("Red Carpet and Codpiece")).toBe(
      "Codpiece, Red Carpet",
    );
  });

  it("alphabetizes comma-separated", () => {
    expect(parseCh4Hares("Z, A, M")).toBe("A, M, Z");
  });

  it("alphabetizes ampersand-separated", () => {
    expect(parseCh4Hares("Doggy Bag & Apple Pie")).toBe("Apple Pie, Doggy Bag");
  });

  it("drops 'HARES WANTED' recruitment placeholder", () => {
    expect(
      parseCh4Hares("HARES WANTED Contact the CH4 Junta"),
    ).toBeUndefined();
  });

  it("drops generic TBD placeholder", () => {
    expect(parseCh4Hares("TBD")).toBeUndefined();
    expect(parseCh4Hares("???")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(parseCh4Hares("")).toBeUndefined();
    expect(parseCh4Hares(undefined)).toBeUndefined();
  });
});

describe("Ch4DkAdapter.fetch", () => {
  let adapter: Ch4DkAdapter;

  beforeEach(() => {
    adapter = new Ch4DkAdapter();
    vi.clearAllMocks();
  });

  const minimalRunsheet = `
<html><body>
  <h2>Runsheet 2026</h2>
  <table border="1" cellpadding="5">
    <tr>
      <th>Run no.</th><th>Date and time</th><th>Location</th>
      <th>Public transport</th><th>Hare(s)</th><th>Notes</th>
    </tr>
    <tr align="center">
      <td><a href="https://ch4.dk/index.html">CH4</a> #367</td>
      <td><font COLOR="#FF0000">Good </font><font COLOR="#FFFF00">Friday 03-04-2026<br>20:00 hrs</font></td>
      <td><a href="http://kbhguide.com/foo">Cafe Ellebo</a><br>Sj&aelig;l&oslash;r Boulevard 49<br>2450 Copenhagen SV</td>
      <td><a href="http://rejseplanen.dk/foo"><img src="ht-bus.gif"></a></td>
      <td>Red Carpet and Codpiece</td>
      <td>Full Moon Hash<br><a href='https://www.google.com/calendar/event?...'><img src='gc.gif'></a></td>
    </tr>
    <tr align="center">
      <td><a href="https://ch4.dk/index.html">CH4</a> #368</td>
      <td>Friday 01-05-2026<br>20:00 hrs</td>
      <td><a href="https://www.visitcopenhagen.com/x">Kanalhuset Christianshavn</a><br>Overgaden Oven Vandet 62A<br>1415 Copenhagen K</td>
      <td>&nbsp;</td>
      <td>Little Sperm Maid</td>
      <td>Full Moon Hash</td>
    </tr>
    <tr align="center">
      <td><a href="https://ch4.dk/index.html">CH4</a> #370</td>
      <td>Friday 03-07-2026<br>20:00 hrs</td>
      <td>Location TBA</td>
      <td>&nbsp;</td>
      <td>HARES WANTED Contact the CH4 Junta</td>
      <td>Full Moon Hash</td>
    </tr>
  </table>
</body></html>`;

  it("parses three rows from a minimal runsheet", async () => {
    mockFetchResponse(minimalRunsheet);
    const result = await adapter.fetch(makeSource(), { days: 1000 });
    expect(result.errors).toEqual([]);
    expect(result.events).toHaveLength(3);
  });

  it("populates fields for run #367", async () => {
    mockFetchResponse(minimalRunsheet);
    const result = await adapter.fetch(makeSource(), { days: 1000 });
    const run367 = result.events.find((e) => e.runNumber === 367);
    expect(run367).toMatchObject({
      date: "2026-04-03",
      kennelTag: "ch4-dk",
      runNumber: 367,
      title: "CH4 #367",
      startTime: "20:00",
      location: "Cafe Ellebo, Sjælør Boulevard 49, 2450 Copenhagen SV",
      locationUrl: "http://kbhguide.com/foo",
      hares: "Codpiece, Red Carpet",
      description: "Full Moon Hash",
      sourceUrl: "https://ch4.dk/",
    });
  });

  it("drops Location TBA and HARES WANTED placeholders for run #370", async () => {
    mockFetchResponse(minimalRunsheet);
    const result = await adapter.fetch(makeSource(), { days: 1000 });
    const run370 = result.events.find((e) => e.runNumber === 370);
    expect(run370).toBeDefined();
    expect(run370!.location).toBeUndefined();
    expect(run370!.hares).toBeUndefined();
    expect(run370!.date).toBe("2026-07-03");
  });

  it("filters events outside the date window", async () => {
    mockFetchResponse(minimalRunsheet);
    const result = await adapter.fetch(makeSource(), { days: 1 });
    // none of the 2026 runs are within ±1 day of test execution
    expect(result.events).toHaveLength(0);
  });

  it("captures runsheetYear in diagnosticContext", async () => {
    mockFetchResponse(minimalRunsheet);
    const result = await adapter.fetch(makeSource(), { days: 1000 });
    expect(result.diagnosticContext?.runsheetYear).toBe(2026);
  });

  it("emits a parse error when the runsheet table is missing", async () => {
    mockFetchResponse(`<html><body><h1>nothing here</h1></body></html>`);
    const result = await adapter.fetch(makeSource(), { days: 1000 });
    expect(result.events).toEqual([]);
    expect(result.errors).toContain("Runsheet table not found");
    expect(result.errorDetails?.parse?.[0].section).toBe("runsheet");
  });
});
