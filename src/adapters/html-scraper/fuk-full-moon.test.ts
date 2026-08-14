import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { parseFukfmRow, parseFukfmDate, FukFullMoonH3Adapter } from "./fuk-full-moon";

vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-fukfm"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-fukfm",
    name: "F.U.K Full Moon H3 Hareline",
    url: "https://fukfmh3.co.uk/hareline.htm",
    type: "HTML_SCRAPER",
    trustLevel: 6,
    scrapeFreq: "daily",
    scrapeDays: 365,
    config: { upcomingOnly: true },
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

// Trimmed real-page fixture (curl'd 2026-08-14 from fukfmh3.co.uk/hareline.htm,
// NOT a hand-rendered sample): header row + 6 real rows (#495-#500), the last
// (#500) carrying an explicit "January '27" year marker and "Invite Only!" /
// "TBC" / "Limited Numbers" placeholders.
const REAL_FIXTURE = `
<table border="1" width="100%">
	<tr>
		<td width="5%" align="center"><b><font size="5">Run No.</font></b></td>
		<td width="14%" align="center"><p><b><font size="5">When?</font></b></td>
		<td width="17%" align="center"><p><b><font size="5">Where?</font></b></td>
		<td width="14%" align="center"><p><b><font size="5">Hare/s</font></b></td>
		<td align="center" width="47%"><p><b><font size="5">Details</font></b></td>
	</tr>
	<tr>
		<td width="5%" align="center" height="65">
		<p><b><font size="5" color="#FFFFFF">495</font></b></td>
		<td width="14%" align="center" height="65">
		<p><b><font size="5" color="#FFFFFF">Sat 29th </font></b></p>
		<p><b><font size="5" color="#FFFFFF">August</font></b></p>
		<p><b><font size="5" color="#FFFFFF">Noon</font></b><p><b>
		<font size="5" color="#FFFF00">(Pub Opens at 10:00Hrs)</font></b></td>
		<td width="17%" align="center" height="65">
		<p>&nbsp;<p>&nbsp;<p>
		<b><font size="5" color="#FFFFFF">
		<a title="Click Here for Map!" href="https://what3words.com/adults.script.lifted">
		<font color="#00FFFF">The Waterside Inn</font></a></font></b></td>
		<td width="14%" align="center" height="65">
		<p><b><font size="5" color="#FFFFFF">Paxo</font></b></td>
		<td align="center" height="65" width="47%">
		<p>&nbsp;<p><b><font size="5" color="#FFFFFF">Bridgefoot, Ware,
		Hertfordshire</font></b></td>
	</tr>
	<tr>
		<td width="5%" align="center">
		<p><b><font size="5" color="#FFFFFF">496</font></b></td>
		<td width="14%" align="center">
		<p><b><font size="5" color="#FFFFFF">Sat 26th </font></b></p>
		<p><b><font size="5" color="#FFFFFF">Sept</font></b></p>
		<p><b><font size="5" color="#FFFFFF">Noon</font></b></td>
		<td width="17%" align="center">
		<p><b><font size="5"><a title="Click Here for Map!" href="https://what3words.com/groups.dull.wipe">
		<font color="#00FFFF">The Grenadier</font></a></font></b></td>
		<td width="14%" align="center">
		<p><b><font size="5" color="#FFFFFF">Bangers</font></b></td>
		<td align="center" width="47%">
		<p>&nbsp;<p><b><font size="5" color="#FFFFFF">18 Wilton Row,
		Belgravia, London</font></b></td>
	</tr>
	<tr>
		<td width="5%" align="center" height="65">
		<p><b><font size="5" color="#FFFFFF">497</font></b></td>
		<td width="14%" align="center" height="65">
		<p><b><font size="5" color="#FFFFFF">Sat 24th </font></b></p>
		<p><b><font size="5" color="#FFFFFF">October</font></b></p>
		<p><b><font size="5" color="#FFFFFF">Noon</font></b></td>
		<td width="17%" align="center" height="65">
		<p><b><font><a title="Click Here forMap!" href="https://what3words.com/tree.hurry.carry">
		<font size="5" color="#00FFFF">The Southampton Arms</font></a></font></b></td>
		<td width="14%" align="center" height="65">
		<p><b><font size="5" color="#FFFFFF">Chikki, Tootuf &amp;
		Sidney</font></b></td>
		<td align="center" height="65" width="47%">
		<p>&nbsp;<p><b><font size="5" color="#FFFFFF">139 Highgate Road,
		Kentish Town, London,</font></b></td>
	</tr>
	<tr>
		<td width="5%" align="center" height="35">
		<p><b><font size="5" color="#FFFFFF">498</font></b></td>
		<td width="14%" align="center" height="35">
		<p><b><font size="5" color="#FFFFFF">Sat 21st </font></b></p>
		<p><b><font size="5" color="#FFFFFF">November</font></b></p>
		<p><b><font size="5" color="#FFFFFF">Noon</font></b></td>
		<td width="17%" align="center" height="35">
		<p><b><font size="5"><a title="Click Here for Map!" href="https://what3words.com/spot.best.cage">
		<font color="#00FFFF">The Essex Arms</font></a></font></b></td>
		<td width="14%" align="center" height="35">
		<p><b><font size="5" color="#FFFFFF">Compressed Fart</font></b></td>
		<td align="center" height="35" width="47%">
		<p>&nbsp;</p>
		<p><b><font size="5" color="#FFFFFF">Warley Hill/Myrtle
		Road, Brentwood, Essex</font></b></p>
	</tr>
	<tr>
		<td width="5%" align="center">
		<p><b><font size="5" color="#FFFFFF">499</font></b></td>
		<td width="14%" align="center">
		<p><b><font size="5" color="#FFFFFF">Sat 19th </font></b></p>
		<p><b><font size="5" color="#FFFFFF">December</font></b></p>
		<p><b><font size="5" color="#FFFFFF">Noon</font></b></td>
		<td width="17%" align="center">
		<p><b><font size="5"><a title="Click Here for Map!" href="https://what3words.com/from.answer.precautions">
		<font color="#00FFFF">The Devonshire Arms</font></a></font></b></td>
		<td width="14%" align="center">
		<p><b><font size="5" color="#FFFFFF">My Lil'</font></b></td>
		<td align="center" width="47%">
		<p>&nbsp;</p>
		<p><b><font size="5" color="#FFFFFF">1 Devonshire Road,
		Cambridge</font></b></p>
	</tr>
	<tr>
		<td width="5%" align="center">
		<p><b><font size="5" color="#FFFFFF">500</font></b></td>
		<td width="14%" align="center">
		<p><b><font size="5" color="#FFFFFF">Sat 23rd</font></b></p>
		<p><b><font size="5" color="#FFFFFF">January '27</font></b></p>
		<p><b><font size="5" color="#FFFFFF">Noon</font></b></td>
		<td width="17%" align="center">
		<p><b><font size="5" color="#FFFFFF">Invite Only!</font></b></td>
		<td width="14%" align="center">
		<p><b><font color="#FFFFFF" size="5">TBC</font></b><p><b>
		<font size="5" color="#FFFFFF">Limited Numbers</font></b></td>
		<td align="center" width="47%">
		<p>&nbsp;<p><b><font size="5" color="#FFFFFF">Bit of a weekend
		in Chelmsford?????</font></b></td>
	</tr>
</table>
`;

function extractRows(html: string) {
  const $ = cheerio.load(html);
  const rows: { cells: string[]; hrefs: (string | undefined)[] }[] = [];
  $("table tr").each((_i, el) => {
    const $row = $(el);
    const cells: string[] = [];
    const hrefs: (string | undefined)[] = [];
    $row.find("td").each((_j, td) => {
      const $td = $(td);
      $td.find("br").replaceWith(" ");
      cells.push($td.text().replace(/\s+/g, " ").trim());
      hrefs.push($td.find("a").first().attr("href") || undefined);
    });
    rows.push({ cells, hrefs });
  });
  return rows;
}

// Fixed reference so year-inference assertions are deterministic regardless
// of wall-clock test-execution date (the fixture was captured 2026-08-14).
const REF = new Date(Date.UTC(2026, 7, 14, 12, 0, 0));

describe("parseFukfmDate — year inference", () => {
  it("infers the year forward from the reference date for a year-less cell", () => {
    expect(parseFukfmDate("Sat 29th August Noon", REF)).toBe("2026-08-29");
  });

  it("infers across a month rollover using the walking reference", () => {
    const afterAugust = new Date(Date.UTC(2026, 7, 29, 12));
    expect(parseFukfmDate("Sat 26th Sept Noon", afterAugust)).toBe("2026-09-26");
  });

  it("uses the explicit 'YY year marker over inference, including across the Dec->Jan rollover", () => {
    const afterDecember = new Date(Date.UTC(2026, 11, 19, 12));
    expect(parseFukfmDate("Sat 23rd January '27 Noon", afterDecember)).toBe("2027-01-23");
  });
});

describe("parseFukfmRow", () => {
  const rows = extractRows(REAL_FIXTURE);

  it("parses a normal row (#495)", () => {
    const row = rows.find((r) => r.cells[0] === "495")!;
    const event = parseFukfmRow(row.cells, row.hrefs, REF);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(495);
    expect(event!.date).toBe("2026-08-29");
    expect(event!.startTime).toBe("12:00");
    expect(event!.hares).toBe("Paxo");
    expect(event!.location).toBe("The Waterside Inn");
    expect(event!.kennelTags).toEqual(["fukfm"]);
    expect(event!.title).toBeUndefined();
    expect(event!.locationUrl).toBeUndefined();
  });

  it("resolves the explicit-year row (#500) and leaves placeholder fields undefined", () => {
    const afterDecember = new Date(Date.UTC(2026, 11, 19, 12));
    const row = rows.find((r) => r.cells[0] === "500")!;
    const event = parseFukfmRow(row.cells, row.hrefs, afterDecember);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2027-01-23");
    expect(event!.location).toBeUndefined(); // "Invite Only!"
    expect(event!.hares).toBeUndefined(); // "TBC"
  });

  it("skips the header row (no <td> cells)", () => {
    const header = rows[0];
    expect(parseFukfmRow(header.cells, header.hrefs, REF)).toBeNull();
  });
});

describe("FukFullMoonH3Adapter.fetch", () => {
  it("parses all 6 real rows", async () => {
    // No exact-date assertions here — the adapter's own year-inference walks
    // from `new Date()` (real wall clock), and row #500's explicit "'27"
    // marker means a monotonic-dates check would eventually fail once real
    // time passes January 2027 and the walking reference for #499 outpaces
    // #500's fixed year. Exact-date coverage lives in the parseFukfmDate /
    // parseFukfmRow tests above, which pin an explicit referenceDate.
    mockFetchResponse(REAL_FIXTURE);
    const adapter = new FukFullMoonH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 3650 });

    expect(result.errors).toEqual([]);
    const runNumbers = result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(runNumbers).toEqual([495, 496, 497, 498, 499, 500]);
    expect(result.events.every((e) => e.kennelTags.includes("fukfm"))).toBe(true);
  });

  it("fails loud when 0 rows parse (markup drift)", async () => {
    mockFetchResponse("<table><tr><td>nothing here</td></tr></table>");
    const adapter = new FukFullMoonH3Adapter();
    const result = await adapter.fetch(makeSource(), { days: 3650 });
    expect(result.events).toEqual([]);
    expect(result.errors.some((e) => e.includes("0 run rows"))).toBe(true);
  });
});
