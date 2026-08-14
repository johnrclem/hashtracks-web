import { describe, it, expect, vi } from "vitest";
import * as cheerio from "cheerio";
import type { Source } from "@/generated/prisma/client";
import { parseHertsRow, HertsHashAdapter } from "./herts-hash";

vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));
vi.mock("@/pipeline/structure-hash", () => ({
  generateStructureHash: vi.fn(() => "mock-hash-herts"),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-herts",
    name: "Herts H3 Website Hareline",
    url: "https://www.hertshash.co.uk/hare_line.htm",
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

// Trimmed real-page fixture (curl'd 2026-08-14 from hertshash.co.uk/hare_line.htm,
// NOT a hand-rendered sample) — a promo banner row, the <th> header row, two
// normal Herts H3 rows (#2229, #2230), an interleaved F.U.K Full Moon H3 row
// (#495, must be filtered out), a bank-holiday-decorated Herts row (#2231), a
// Herts row whose logo has an extra inline <img> after the run number (#2232),
// and a Herts row whose venue/address/postcode are all "TBC" (#2233).
const REAL_FIXTURE = `
<table width="1373" border="5" background="images/background.png">
	<caption>
	<p style="margin-top: 0; margin-bottom: 0">&nbsp;</p>
	</caption>
	<tr>
		<td align="center" height="147" colspan="7">
		<p align="center">New runners/drinkers welcome</p>
		</td>
	</tr>
	<tr>
		<th width="200" scope="col"><div align="center"><p><strong>Hash &amp; Trail No. </strong></div></th>
		<th width="146" scope="col"><div align="center"><p><strong>Date</strong></div></th>
		<th width="123" scope="col"><div align="center"><p><strong>Time</strong></div></th>
		<th width="155" scope="col"><p>Hare/s</th>
		<th width="179" scope="col"><div align="center"><p><strong>Venue</strong></div></th>
		<th width="310" scope="col"><div align="center"><p><strong>Address &amp; further Info</strong></div></th>
		<th width="215" scope="col"><div align="center"><p><strong>Nearest Post Code*</strong></div></th>
	</tr>
	<tr>
		<td width="200" align="center" height="147">
		<p><img border="0" src="images/Herts%20Logo.png" width="100" height="80"></p>
		<p><b>Herts H<sup>3
		</sup>2229</b></p>
		</td>
		<td width="146" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><font color="#CC0000"><b>&nbsp;Monday</b></font></p>
		<p style="margin-top: 0; margin-bottom: 0"><b>17/08/26</b></td>
		<td width="123" align="center" height="147">
		<b>19:00Hrs</b></td>
		<td width="155" align="center" height="147">
		<b>Mr X</b></td>
		<td width="179" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0">
		<font face="Arial"><b>
		<a title="Click Here for Map of Venue!" href="https://what3words.com/kinks.sport.pinks">
		Attimore Hall</a></b></font><p style="margin-top: 0; margin-bottom: 0">
		<font face="Arial"><b>&nbsp;<img border="0" src="images/dogswelcome.png" width="25" height="25"></b></font></td>
		<td width="310" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><b><font face="Arial">
		Ridgeway, Black Fan Road, </font></b></p>
		<p style="margin-top: 0; margin-bottom: 0"><b><font face="Arial">Welwyn
		Garden City</font></b></td>
		<td width="215" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0">&nbsp;</p>
		<p style="margin-top: 0; margin-bottom: 0"><b>
		<font face="Arial" color="#CC0000">AL7 2AD</font></b></p>
		<p style="margin-top: 0; margin-bottom: 0"><b>
		<font color="#FF0000" face="Arial">
		<img border="0" src="images/what3words.png" width="90" height="20"></font></b></p>
		<p style="margin-top: 0; margin-bottom: 0">
		<b><font face="Arial">
		<a title="Click Here for What3words Map!" href="https://what3words.com/kinks.sport.pinks">
		kinks.sport.pinks</a> </font></b><p style="margin-top: 0; margin-bottom: 0">
		<b><font face="Arial" color="#CC0000">CAR REGISTRATIONS NEED TO BE LEFT
		BEHIND THE&nbsp; BAR!</font></b></td>
		</tr>
	<tr>
		<td width="200" align="center" height="147">
		<p><img border="0" src="images/Herts%20Logo.png" width="100" height="80"></p>
		<p><b>Herts H<sup>3
		</sup>2230</b></p>
		</td>
		<td width="146" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><font color="#CC0000"><b>&nbsp;Monday</b></font></p>
		<p style="margin-top: 0; margin-bottom: 0"><b>24/08/26</b></td>
		<td width="123" align="center" height="147">
		<b>19:00Hrs</b></td>
		<td width="155" align="center" height="147">
		<b>My Lil'</b></td>
		<td width="179" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0">
		<b><font face="Arial" color="#FF0000">
		<a title="Click Here for what3words Map!" href="https://what3words.com/cats.half.candy">The Admiral Byng</a></font></b></p>
		</td>
		<td width="310" align="center" height="147">
		<font face="Arial"><b>186-192 Darkes Lane, Potter's Bar</b></font></td>
		<td width="225" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><b><font color="#D90000" face="Arial"> EN6 1AF </font></b></p>
		<p style="margin-top: 0; margin-bottom: 0"><b><font face="Arial" color="#CC0000">Street Parking or Quakers Lane car
		park</font></b></p>
		</td>
		</tr>
	<tr>
		<td width="200" align="center" bgcolor="#000000">
		<p align="center"><font color="#FFFF00"><b><img border="0" src="images/moon.gif" width="71" height="71"></b></font></p>
		<p align="center"><b><font color="#FFFF00">F.U.K Full Moon H<sup>3 </sup></font></b></p>
		<p align="center"><font color="#FFFF00"><b>495</b></font></p>
		</td>
		<td width="146" align="center" bgcolor="#000000">
		<p><font color="#FFFF00"><b>Saturday</b></font></p>
		<p><font color="#FFFF00"><b>30th August</b></font></p>
		</td>
		<td width="123" align="center" bgcolor="#000000">
		<p><font color="#FFFF00"><b>Noon</b></font></td>
		<td width="155" align="center" bgcolor="#000000">
		<p><font color="#FFFF00"><b>Paxo</b></font></td>
		<td width="179" align="center" bgcolor="#000000">
		<p><b><font face="Arial" color="#FFFFFF">
		<a title="Click Here for Map!" href="https://what3words.com/adults.script.lifted">
		<font color="#00FFFF">The Waterside Inn</font></a></font></b></p>
		</td>
		<td width="310" align="center" bgcolor="#000000">
		<p><b><font face="Arial" color="#FFFFFF">Bridgefoot, Ware, Hertfordshire</font></b></p>
		</td>
		<td width="215" align="center" bgcolor="#000000">
		<p><b><font face="Arial" color="#FFFF00">SG12 9DW</font></b></p>
		</td>
		</tr>
	<tr>
		<td width="200" align="center" height="147">
		<p><img border="0" src="images/Herts%20Logo.png" width="100" height="80"></p>
		<p><b>Herts H<sup>3
		</sup>2231</b></p>
		</td>
		<td width="146" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><font color="#CC0000"><b>&nbsp;Bank
		Holiday Monday</b></font></p>
		<p style="margin-top: 0; margin-bottom: 0"><b>31/08/26</b></td>
		<td width="123" align="center" height="147">
		<b>11:00Hrs</b></td>
		<td width="155" align="center" height="147">
		<b>3D &amp; Slug</b></td>
		<td width="179" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><b>
		<a title="Click Here for venue map!" href="https://what3words.com/cutlets.wiggling.balloons">
		The Heath Club</a> </b></p>
		</td>
		<td width="310" align="center" height="147">
		<font face="Arial"><b>Baldock Road, Royston</b></font></td>
		<td width="215" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><b><font color="#D90000" face="Arial"> SG8 5BG</font></b></p>
		</td>
		</tr>
	<tr>
		<td width="200" align="center" height="147">
		<p><img border="0" src="images/Herts%20Logo.png" width="100" height="80"></p>
		<p><b>Herts H<sup>3
		</sup>2233</b></p>
		</td>
		<td width="146" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><font color="#CC0000"><b>&nbsp;Monday</b></font></p>
		<p style="margin-top: 0; margin-bottom: 0"><b>14/09/26</b></td>
		<td width="123" align="center" height="147">
		<b>19:00Hrs</b></td>
		<td width="155" align="center" height="147">
		<b>Ketchup End of Season Pig Out!</b></td>
		<td width="179" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0">
		<font color="#CC0000"><b>TBC</b></font></td>
		<td width="310" align="center" height="147">
		<font color="#CC0000"><b>TBC</b></font></td>
		<td width="215" align="center" height="147">
		<p style="margin-top: 0; margin-bottom: 0"><font color="#CC0000"><b>TBC </b></font></p>
		</td>
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

describe("parseHertsRow", () => {
  const rows = extractRows(REAL_FIXTURE);

  it("parses a normal Herts H3 row (#2229)", () => {
    const row = rows.find((r) => r.cells[0]?.includes("2229"))!;
    const event = parseHertsRow(row.cells, row.hrefs);
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBe(2229);
    expect(event!.date).toBe("2026-08-17");
    expect(event!.startTime).toBe("19:00");
    expect(event!.hares).toBe("Mr X");
    expect(event!.location).toBe("Attimore Hall");
    expect(event!.locationStreet).toBe("Ridgeway, Black Fan Road, Welwyn Garden City, AL7 2AD");
    expect(event!.kennelTags).toEqual(["herts-h3"]);
    expect(event!.title).toBeUndefined();
    // what3words is never a Maps URL
    expect(event!.locationUrl).toBeUndefined();
  });

  it("filters out the interleaved F.U.K Full Moon H3 row (#495)", () => {
    const row = rows.find((r) => r.cells[0]?.includes("495"))!;
    expect(parseHertsRow(row.cells, row.hrefs)).toBeNull();
  });

  it("parses a bank-holiday-decorated date cell (#2231)", () => {
    const row = rows.find((r) => r.cells[0]?.includes("2231"))!;
    const event = parseHertsRow(row.cells, row.hrefs);
    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-08-31");
    expect(event!.startTime).toBe("11:00");
  });

  it("leaves TBC venue/address/postcode fields undefined (#2233)", () => {
    const row = rows.find((r) => r.cells[0]?.includes("2233"))!;
    const event = parseHertsRow(row.cells, row.hrefs);
    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
    expect(event!.locationStreet).toBeUndefined();
  });

  it("skips the promo banner row and the <th> header row", () => {
    // Neither has 7 <td> cells, so parseHertsRow returns null for both.
    const bannerRow = rows[0];
    const headerRow = rows[1];
    expect(parseHertsRow(bannerRow.cells, bannerRow.hrefs)).toBeNull();
    expect(parseHertsRow(headerRow.cells, headerRow.hrefs)).toBeNull();
  });
});

describe("HertsHashAdapter.fetch", () => {
  it("returns only Herts H3 events, excluding F.U.K Full Moon H3", async () => {
    mockFetchResponse(REAL_FIXTURE);
    const adapter = new HertsHashAdapter();
    const result = await adapter.fetch(makeSource(), { days: 3650 });

    expect(result.errors).toEqual([]);
    const runNumbers = result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(runNumbers).toEqual([2229, 2230, 2231, 2233]);
    expect(result.events.every((e) => e.kennelTags.includes("herts-h3"))).toBe(true);
  });

  it("fails loud when 0 Herts H3 rows parse (markup drift)", async () => {
    mockFetchResponse("<table><tr><td>nothing here</td></tr></table>");
    const adapter = new HertsHashAdapter();
    const result = await adapter.fetch(makeSource(), { days: 3650 });
    expect(result.events).toEqual([]);
    expect(result.errors.some((e) => e.includes("0 Herts H3 rows"))).toBe(true);
  });
});
