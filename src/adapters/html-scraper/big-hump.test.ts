import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  parseEventHeader,
  parseEventTitle,
  parseAttendanceHares,
  parseHistoryCard,
  parseHistoryPage,
  BigHumpAdapter,
} from "./big-hump";
import * as cheerio from "cheerio";
import * as utils from "../utils";

vi.mock("../utils", async () => {
  const actual = await vi.importActual<typeof import("../utils")>("../utils");
  return {
    ...actual,
    fetchHTMLPage: vi.fn(),
  };
});

describe("parseEventHeader", () => {
  it("parses date and run number", () => {
    const result = parseEventHeader("Wednesday 04/01/2026 #1991");
    expect(result.date).toBe("2026-04-01");
    expect(result.runNumber).toBe(1991);
  });

  it("parses Saturday date", () => {
    const result = parseEventHeader("Saturday 04/11/2026 #1993");
    expect(result.date).toBe("2026-04-11");
    expect(result.runNumber).toBe(1993);
  });

  it("returns null date for no date pattern", () => {
    const result = parseEventHeader("Hareline");
    expect(result.date).toBeNull();
    expect(result.runNumber).toBeUndefined();
  });

  it("handles date without run number", () => {
    const result = parseEventHeader("Wednesday 04/01/2026");
    expect(result.date).toBe("2026-04-01");
    expect(result.runNumber).toBeUndefined();
  });
});

describe("parseEventTitle", () => {
  it("splits on @ separator", () => {
    const result = parseEventTitle("Locknut Monster's April Fools' Trail @ Lemay");
    expect(result.title).toBe("Locknut Monster's April Fools' Trail @ Lemay");
    expect(result.hares).toBe("Locknut Monster");
    expect(result.location).toBe("Lemay");
  });

  it("handles title without @ separator", () => {
    const result = parseEventTitle("2FC");
    expect(result.title).toBe("2FC");
    expect(result.hares).toBeUndefined();
    expect(result.location).toBeUndefined();
  });

  it("handles ??? location as undefined", () => {
    const result = parseEventTitle("Whiney @ ???");
    expect(result.hares).toBe("Whiney");
    expect(result.location).toBeUndefined();
  });

  it("#754: strips trailing ' @ ???' from title when location is TBD", () => {
    const result = parseEventTitle("Whiney @ ???");
    expect(result.title).toBe("Whiney");
  });

  it("#754: keeps full 'Hare @ Venue' as title when location is a real venue", () => {
    const result = parseEventTitle("Whiney @ Forest Park");
    expect(result.title).toBe("Whiney @ Forest Park");
    expect(result.location).toBe("Forest Park");
  });

  it("#754: treats 'TBD' / 'TBA' / 'N/A' as TBD placeholders (not just ???)", () => {
    for (const tbd of ["TBD", "TBA", "tbd", "N/A", "?"]) {
      const result = parseEventTitle(`Whiney @ ${tbd}`);
      expect(result.title).toBe("Whiney");
      expect(result.location).toBeUndefined();
    }
  });

  it("handles multiple @ signs — splits on last one", () => {
    const result = parseEventTitle(
      "Disco's Hashers Not Trashers Mini-TrashBash & Hash @ South City",
    );
    expect(result.location).toBe("South City");
    expect(result.hares).toBe("Disco");
  });

  it("handles Headlights and Mr. Headlights @ ???", () => {
    const result = parseEventTitle("Headlights and Mr. Headlights @ ???");
    expect(result.hares).toBe("Headlights and Mr. Headlights");
    expect(result.location).toBeUndefined();
  });

  it("handles curly apostrophes in possessive names", () => {
    const result = parseEventTitle("Locknut Monster\u2019s April Fools\u2019 Trail @ Lemay");
    expect(result.hares).toBe("Locknut Monster");
    expect(result.location).toBe("Lemay");
  });

  it("handles left single quote in possessive names", () => {
    const result = parseEventTitle("Locknut Monster\u2018s Trail @ Lemay");
    expect(result.hares).toBe("Locknut Monster");
  });

  it("handles high-reversed-9 quote (U+201B) in possessive names", () => {
    const result = parseEventTitle("Foo\u201Bs Bar @ Baz");
    expect(result.hares).toBe("Foo");
    expect(result.location).toBe("Baz");
  });

  it("handles Bungle in the Jungle @ location", () => {
    const result = parseEventTitle(
      "Bungle in the Jungle  @ Steelville-the Cancun of Missouri",
    );
    expect(result.location).toBe("Steelville-the Cancun of Missouri");
  });

  // ─── #844: theme-text patterns that used to leak into Hares ───

  it("extracts hare after ' starring ' (#844)", () => {
    const result = parseEventTitle(
      "3rd An'al It's Gonna Be May starring Perp & Froggy @ ???",
    );
    expect(result.hares).toBe("Perp & Froggy");
  });

  it("extracts hare after ' with ' (#844)", () => {
    const result = parseEventTitle("Chase the Pride 🌈 with Beaver @ ???");
    expect(result.hares).toBe("Beaver");
  });

  it("extracts hare before colon-prefixed theme (#844)", () => {
    const result = parseEventTitle(
      "Locknut Monster: 23 Years of Hashing! @ ???",
    );
    expect(result.hares).toBe("Locknut Monster");
  });

  it("extracts hare before emoji colon-prefixed theme (#844)", () => {
    const result = parseEventTitle(
      "Beaver & Froggy: ✨🎄 Lightsmas Trail 🎄✨ @ ???",
    );
    expect(result.hares).toBe("Beaver & Froggy");
  });

  it("extracts hare before ' - ' dash-prefixed theme (#844)", () => {
    const result = parseEventTitle(
      "Ice Princess - World Naked Bike Ride @ ???",
    );
    expect(result.hares).toBe("Ice Princess");
  });

  it("extracts hare before Hashyversary suffix (#844)", () => {
    const result = parseEventTitle("Whiney Bitch Hashyversary @ ???");
    expect(result.hares).toBe("Whiney Bitch");
  });

  it("extracts hare before 'turns NN' suffix (#844)", () => {
    const result = parseEventTitle("Frankie turns 25 @ ???");
    expect(result.hares).toBe("Frankie");
  });

  it("returns ampersand-joined short hare pair as-is (#844)", () => {
    const result = parseEventTitle("Dewey & Colorado @ ???");
    expect(result.hares).toBe("Dewey & Colorado");
  });

  it("returns undefined for unstructured theme text (#844)", () => {
    // Source: #1996 "Locknut Saturday is for South County Shiggy @ Deep South County".
    // No recognizable delimiter — safer to leave hares null than leak theme text.
    const result = parseEventTitle(
      "Locknut Saturday is for South County Shiggy @ Deep South County",
    );
    expect(result.hares).toBeUndefined();
    expect(result.location).toBe("Deep South County");
  });

  it("does NOT apostrophe-truncate multi-apostrophe theme titles (#844)", () => {
    // Regression guard for the observed #1997 symptom: the old possessive
    // regex matched at the first apostrophe and returned "3rd An'al It" as
    // the hare. The new digit/apostrophe sanity check on Rule 3 rejects that
    // candidate, and Rule 6 refuses to guess on a long digit-bearing phrase.
    const result = parseEventTitle("3rd An'al It's Gonna Be May @ ???");
    expect(result.hares).toBeUndefined();
  });

  it("returns undefined for long phrase without pair joiner (#844)", () => {
    // Guards Rule 6 against mis-classifying theme text as a hare name.
    const result = parseEventTitle(
      "Bungle in the Jungle @ Steelville-the Cancun of Missouri",
    );
    expect(result.hares).toBeUndefined();
    expect(result.location).toBe("Steelville-the Cancun of Missouri");
  });
});

// ─── History page parsing ───────────────────────────────────────────────────

describe("parseAttendanceHares", () => {
  it("extracts hares marked with fa-carrot icon", () => {
    const html = `
      <div class="w3-card">
        <ul>
          <h4>Attendance:</h4>
          <form><li><a>Dabadoo</a></li></form>
          <form><li><a>Lock Nut Monster</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
          <form><li><a>Whiney Bitch</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
          <form><li><a>Numb Buns</a></li></form>
        </ul>
      </div>
    `;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const result = parseAttendanceHares($card, $);

    expect(result.hares).toEqual(["Lock Nut Monster", "Whiney Bitch"]);
    expect(result.attendeeCount).toBe(4);
  });

  it("handles visitors and alumni markers", () => {
    const html = `
      <div class="w3-card">
        <ul>
          <form><li><a>Dicksmith</a><span title='Visitor/Virgin'><strong> (V)</strong></span></li></form>
          <form><li><a>Duzzy Cum</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
          <form><li><a>Norman Bates</a></li></form>
        </ul>
      </div>
    `;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const result = parseAttendanceHares($card, $);

    expect(result.hares).toEqual(["Duzzy Cum"]);
    expect(result.attendeeCount).toBe(3);
  });

  it("returns empty when no attendance list", () => {
    const html = `<div class="w3-card"><h4>Some title</h4></div>`;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const result = parseAttendanceHares($card, $);

    expect(result.hares).toEqual([]);
    expect(result.attendeeCount).toBe(0);
  });

  it("handles multiple hares on same event", () => {
    const html = `
      <div class="w3-card">
        <ul>
          <form><li><a>KFC</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
          <form><li><a>Numb Buns</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
        </ul>
      </div>
    `;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const result = parseAttendanceHares($card, $);

    expect(result.hares).toEqual(["KFC", "Numb Buns"]);
    expect(result.attendeeCount).toBe(2);
  });
});

describe("parseHistoryCard", () => {
  it("parses a complete history card", () => {
    const html = `
      <div class='w3-card'>
        <header class='w3-container w3-grey'>
          <h3>Wednesday 03/25/2026 <span class='w3-text-amber'>#1989</span></h3>
        </header>
        <div class='w3-row'>
          <div class='w3-col m1 l1'>
            <a href='runinfo.php?num=1989'><img src='logos/Big-Humplogo.gif' /></a>
          </div>
          <div class='w3-col m7 l7'>
            <h4>Whiney The Beer Bitch's Birthday/LockNut Got Laid  @ Ladue</h4>
            <p class='w3-text-red'>Nobody has written the Hash Trash yet...</p>
          </div>
          <div class='w3-col w3-container m4 l4 w3-light-grey'>
            <span class='w3-small'><ul style='list-style-type:none;'>
              <h4 class='w3-text-indigo'>Attendance:</h4>
              <form><li><a class='w3-text-black' href="hasherinfo.php?num=858">2 Fuck Canuck</a></li></form>
              <form><li><a class='w3-text-black' href="hasherinfo.php?num=44">Lock Nut Monster</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
              <form><li><a class='w3-text-black' href="hasherinfo.php?num=99">Whiney Bitch</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
            </ul></span>
          </div>
        </div>
      </div>
    `;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const event = parseHistoryCard($card, $, "http://www.big-hump.com");

    expect(event).not.toBeNull();
    expect(event!.date).toBe("2026-03-25");
    expect(event!.runNumber).toBe(1989);
    expect(event!.kennelTag).toBe("bh4");
    expect(event!.title).toContain("Whiney The Beer Bitch");
    expect(event!.location).toBe("Ladue");
    // Attendance hares override title hares
    expect(event!.hares).toBe("Lock Nut Monster, Whiney Bitch");
    expect(event!.sourceUrl).toBe("http://www.big-hump.com/runinfo.php?num=1989");
    expect(event!.description).toBe("Attendance: 3 hashers");
  });

  it("falls back to title hares when no attendance list", () => {
    const html = `
      <div class='w3-card'>
        <header class='w3-container w3-grey'>
          <h3>Wednesday 03/17/1999 <span class='w3-text-amber'>#1</span></h3>
        </header>
        <div class='w3-row'>
          <div class='w3-col m1 l1'>
            <a href='runinfo.php?num=1'><img src='logos/Big-Humplogo.gif' /></a>
          </div>
          <div class='w3-col m7 l7'>
            <h4>Whistle @ Forest Park</h4>
          </div>
        </div>
      </div>
    `;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const event = parseHistoryCard($card, $, "http://www.big-hump.com");

    expect(event).not.toBeNull();
    expect(event!.date).toBe("1999-03-17");
    expect(event!.runNumber).toBe(1);
    expect(event!.hares).toBe("Whistle");
    expect(event!.location).toBe("Forest Park");
    expect(event!.description).toBeUndefined();
  });

  it("handles Open @ ??? events", () => {
    const html = `
      <div class='w3-card'>
        <header class='w3-container w3-grey'>
          <h3>Friday 12/31/1999 <span class='w3-text-amber'>#49</span></h3>
        </header>
        <div class='w3-row'>
          <div class='w3-col m1 l1'>
            <a href='runinfo.php?num=49'><img /></a>
          </div>
          <div class='w3-col m7 l7'>
            <h4>Open @ ???</h4>
          </div>
          <div class='w3-col m4 l4 w3-light-grey'>
            <span class='w3-small'><ul>
              <h4>Attendance:</h4>
              <form><li><a>Dabadoo</a></li></form>
              <form><li><a>Dicksmith</a></li></form>
            </ul></span>
          </div>
        </div>
      </div>
    `;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    const event = parseHistoryCard($card, $, "http://www.big-hump.com");

    expect(event).not.toBeNull();
    expect(event!.hares).toBe("Open");
    expect(event!.location).toBeUndefined();
    expect(event!.description).toBe("Attendance: 2 hashers");
  });

  it("returns null for cards without headers", () => {
    const html = `<div class='w3-card'><p>No header here</p></div>`;
    const $ = cheerio.load(html);
    const $card = $("div.w3-card");
    expect(parseHistoryCard($card, $, "http://www.big-hump.com")).toBeNull();
  });
});

describe("parseHistoryPage", () => {
  it("parses multiple cards from a full page", () => {
    const html = `
      <html><body>
        <div class='w3-card'>
          <header class='w3-container w3-grey'>
            <h3>Saturday 03/28/2026 <span class='w3-text-amber'>#1990</span></h3>
          </header>
          <div class='w3-row'>
            <div class='w3-col m1 l1'>
              <a href='runinfo.php?num=1990'><img /></a>
            </div>
            <div class='w3-col m7 l7'>
              <h4>Whistle  @ Not the zoo but close</h4>
            </div>
            <div class='w3-col m4 l4 w3-light-grey'>
              <span class='w3-small'><ul>
                <h4>Attendance:</h4>
                <form><li><a>Whistle While You Poop</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
                <form><li><a>Dapper Sapper</a></li></form>
              </ul></span>
            </div>
          </div>
        </div>
        <div class='w3-card'>
          <header class='w3-container w3-grey'>
            <h3>Wednesday 03/25/2026 <span class='w3-text-amber'>#1989</span></h3>
          </header>
          <div class='w3-row'>
            <div class='w3-col m1 l1'>
              <a href='runinfo.php?num=1989'><img /></a>
            </div>
            <div class='w3-col m7 l7'>
              <h4>Lock Nut Monster @ Ladue</h4>
            </div>
            <div class='w3-col m4 l4 w3-light-grey'>
              <span class='w3-small'><ul>
                <h4>Attendance:</h4>
                <form><li><a>Lock Nut Monster</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
              </ul></span>
            </div>
          </div>
        </div>
      </body></html>
    `;

    const events = parseHistoryPage(html, "http://www.big-hump.com");

    expect(events).toHaveLength(2);
    expect(events[0].date).toBe("2026-03-28");
    expect(events[0].runNumber).toBe(1990);
    expect(events[0].hares).toBe("Whistle While You Poop");
    expect(events[1].date).toBe("2026-03-25");
    expect(events[1].runNumber).toBe(1989);
    expect(events[1].hares).toBe("Lock Nut Monster");
    expect(events[1].location).toBe("Ladue");
  });
});

// ─── BigHumpAdapter integration tests ───────────────────────────────────────

describe("BigHumpAdapter", () => {
  const adapter = new BigHumpAdapter();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const harelineHtml = `
    <html><body>
      <div class="w3-card">
        <header class="w3-container w3-green">
          <h3>Wednesday 04/01/2026 <span class="w3-text-amber">#1991</span></h3>
        </header>
        <div class="w3-row">
          <div class="w3-col w3-container m9 l10">
            <h4>Locknut Monster's April Fools' Trail @ Lemay</h4>
            <span class="w3-small">Circle up: 6:45 p.m., 3661 Reavis Barracks Rd, St Louis, MO 63125</span>
          </div>
        </div>
      </div>
      <div class="w3-card">
        <header class="w3-container w3-green">
          <h3>Wednesday 04/08/2026 <span class="w3-text-amber">#1992</span></h3>
        </header>
        <div class="w3-row">
          <div class="w3-col w3-container m9 l10">
            <h4>2FC @ ???</h4>
            <span class="w3-small"></span>
          </div>
        </div>
      </div>
    </body></html>
  `;

  const historyHtml = `
    <html><body>
      <div class='w3-card'>
        <header class='w3-container w3-grey'>
          <h3>Wednesday 03/25/2026 <span class='w3-text-amber'>#1989</span></h3>
        </header>
        <div class='w3-row'>
          <div class='w3-col m1 l1'>
            <a href='runinfo.php?num=1989'><img /></a>
          </div>
          <div class='w3-col m7 l7'>
            <h4>Lock Nut Monster @ Ladue</h4>
          </div>
          <div class='w3-col m4 l4 w3-light-grey'>
            <span class='w3-small'><ul>
              <h4>Attendance:</h4>
              <form><li><a>Lock Nut Monster</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
              <form><li><a>Whiney Bitch</a></li></form>
            </ul></span>
          </div>
        </div>
      </div>
      <div class='w3-card'>
        <header class='w3-container w3-grey'>
          <h3>Wednesday 04/01/2026 <span class='w3-text-amber'>#1991</span></h3>
        </header>
        <div class='w3-row'>
          <div class='w3-col m1 l1'>
            <a href='runinfo.php?num=1991'><img /></a>
          </div>
          <div class='w3-col m7 l7'>
            <h4>Locknut Monster @ Lemay</h4>
          </div>
          <div class='w3-col m4 l4 w3-light-grey'>
            <span class='w3-small'><ul>
              <h4>Attendance:</h4>
              <form><li><a>Locknut Monster</a><strong> (<i class='fa fa-carrot'> hare</i>)</strong> </li></form>
            </ul></span>
          </div>
        </div>
      </div>
    </body></html>
  `;

  async function mockFetchHTMLPage(url: string) {
    const isHistory = url.includes("hashresults.php");
    const html = isHistory ? historyHtml : harelineHtml;
    return {
      ok: true as const,
      html,
      $: cheerio.load(html),
      structureHash: "abc123",
      fetchDurationMs: 100,
    };
  }

  it("parses events from hareline page (no history)", async () => {
    const mockSource = {
      id: "test-bh4",
      url: "http://www.big-hump.com/hareline.php",
      config: null,
    } as never;

    vi.mocked(utils.fetchHTMLPage).mockImplementation(mockFetchHTMLPage);

    // Use large days window to ensure fixture dates fall within the window
    const result = await adapter.fetch(mockSource, { days: 36500 });

    expect(result.events).toHaveLength(2);
    expect(result.events[0].date).toBe("2026-04-01");
    expect(result.events[0].runNumber).toBe(1991);
    expect(result.events[0].kennelTag).toBe("bh4");
    expect(result.events[0].startTime).toBe("18:45");
    expect((result.diagnosticContext as Record<string, unknown>).includeHistory).toBe(false);
    // Should not have fetched history pages
    expect(utils.fetchHTMLPage).toHaveBeenCalledTimes(1);
  });

  it("fetches history when includeHistory is true", async () => {
    const mockSource = {
      id: "test-bh4",
      url: "http://www.big-hump.com/hareline.php",
      config: { includeHistory: true, historyYearRange: [2026, 2026] },
    } as never;

    vi.mocked(utils.fetchHTMLPage).mockImplementation(mockFetchHTMLPage);

    const result = await adapter.fetch(mockSource, { days: 36500 });

    // Should have fetched hareline + 1 year page
    expect(utils.fetchHTMLPage).toHaveBeenCalledTimes(2);
    expect(utils.fetchHTMLPage).toHaveBeenCalledWith("http://www.big-hump.com/hareline.php");
    expect(utils.fetchHTMLPage).toHaveBeenCalledWith("http://www.big-hump.com/hashresults.php?year=2026");

    const diag = result.diagnosticContext as Record<string, unknown>;
    expect(diag.includeHistory).toBe(true);
    expect(diag.historyYearsFetched).toBe(1);
    expect((diag.historyEventsParsed as number)).toBeGreaterThan(0);
  });

  it("deduplicates: hareline events win over history", async () => {
    const mockSource = {
      id: "test-bh4",
      url: "http://www.big-hump.com/hareline.php",
      config: { includeHistory: true, historyYearRange: [2026, 2026] },
    } as never;

    vi.mocked(utils.fetchHTMLPage).mockImplementation(mockFetchHTMLPage);

    const result = await adapter.fetch(mockSource, { days: 36500 });

    // Run #1991 appears in both hareline and history — hareline should win
    const run1991Events = result.events.filter((e) => e.runNumber === 1991);
    expect(run1991Events).toHaveLength(1);

    // Hareline's richer data (startTime) should be preserved
    expect(run1991Events[0].startTime).toBe("18:45");
    expect(run1991Events[0].sourceUrl).toBe("http://www.big-hump.com/hareline.php");

    const diag = result.diagnosticContext as Record<string, unknown>;
    expect(diag.historyDeduped).toBe(1);
  });

  it("returns error on fetch failure", async () => {
    const mockSource = {
      id: "test-bh4",
      url: "http://www.big-hump.com/hareline.php",
      config: null,
    } as never;

    vi.mocked(utils.fetchHTMLPage).mockResolvedValue({
      ok: false as const,
      result: {
        events: [],
        errors: ["HTTP 500"],
        errorDetails: { fetch: [{ url: "http://www.big-hump.com/hareline.php", message: "HTTP 500" }] },
      },
    });

    const result = await adapter.fetch(mockSource);
    expect(result.events).toHaveLength(0);
    expect(result.errors).toContain("HTTP 500");
  });

  // #828: fixtures for title-construction + placeholder-skip tests. Shared
  // helper keeps both cases wiring-free.
  const bh4Card = (date: string, run: number, h4: string, small = "") => `
        <div class="w3-card">
          <header class="w3-container w3-green">
            <h3>Wednesday ${date} <span class="w3-text-amber">#${run}</span></h3>
          </header>
          <div class="w3-row"><div class="w3-col w3-container m9 l10">
            <h4>${h4}</h4>
            <span class="w3-small">${small}</span>
          </div></div>
        </div>`;
  async function run828Fixture(cards: string) {
    const html = `<html><body>${cards}</body></html>`;
    vi.mocked(utils.fetchHTMLPage).mockResolvedValueOnce({
      ok: true as const,
      html,
      $: cheerio.load(html),
      structureHash: "828-test",
      fetchDurationMs: 50,
    });
    const mockSource = { id: "test-bh4", url: "http://www.big-hump.com/hareline.php", config: null } as never;
    return adapter.fetch(mockSource, { days: 36500 });
  }

  it("#828: constructs 'BH4 #NNNN @ Venue' title from hareline '<Hare> @ <Venue>' h4", async () => {
    const result = await run828Fixture(bh4Card("04/22/2026", 1995, "Headlights and Mr. Headlights @ The Loop", "Circle up: 6:45 p.m."));
    expect(result.events).toHaveLength(1);
    expect(result.events[0].title).toBe("BH4 #1995 @ The Loop");
    expect(result.events[0].location).toBe("The Loop");
    expect(result.events[0].hares).toBe("Headlights and Mr. Headlights");
  });

  it("#828: skips 'Open @ ???' placeholder rows with no venue", async () => {
    const result = await run828Fixture(
      bh4Card("05/06/2026", 1998, "Open @ ???") + bh4Card("05/13/2026", 1999, "Hammock @ ???"),
    );
    // "Open @ ???" skipped (no hare named yet, no venue);
    // "Hammock @ ???" kept (hare is committed, venue just TBD).
    expect(result.events).toHaveLength(1);
    expect(result.events[0].runNumber).toBe(1999);
    expect(result.events[0].hares).toBe("Hammock");
  });

  it("does not leak description text into hares when 'hares' appears mid-sentence (#519)", async () => {
    // Reproduces Run #1992: the description body has no labeled Hare: line,
    // but mentions "hares" in the middle of a sentence. The old regex matched
    // that mid-sentence "hares" and captured half a paragraph as the hare
    // name. The fix anchors the label to the start of a line and requires a
    // mandatory colon.
    const html = `
      <html><body>
        <div class="w3-card">
          <header class="w3-container w3-green">
            <h3>Wednesday 04/08/2026 <span class="w3-text-amber">#1992</span></h3>
          </header>
          <div class="w3-row"><div class="w3-col w3-container m9 l10">
            <h4>2FC Takes Fenton @ Fenton</h4>
            <span class="w3-small">It's been a few months since the shiggyfest hares had us in Fenton. Don't expect a repeat of that experience but the runners will be off the sidewalks for some of this trail.<p>Circle up: 6:45 p.m.<p>Hare(s) away: 7 p.m.</span>
          </div></div>
        </div>
      </body></html>
    `;
    vi.mocked(utils.fetchHTMLPage).mockResolvedValueOnce({
      ok: true as const,
      html,
      $: cheerio.load(html),
      structureHash: "leak-test",
      fetchDurationMs: 50,
    });

    const mockSource = {
      id: "test-bh4",
      url: "http://www.big-hump.com/hareline.php",
      config: null,
    } as never;
    const result = await adapter.fetch(mockSource, { days: 36500 });

    expect(result.events).toHaveLength(1);
    const hares = result.events[0].hares ?? "";
    // The old bug captured the description sentence as hares
    expect(hares).not.toMatch(/had us in Fenton/i);
    expect(hares).not.toMatch(/cranium lamps/i);
    // The description is preserved for the event body
    expect(result.events[0].description).toMatch(/shiggyfest hares/i);
    expect(result.events[0].startTime).toBe("18:45");
  });
});

// ─── Live integration test (run manually with `vitest run --testNamePattern live`) ──

describe.skip("BigHumpAdapter live", () => {
  it("live: scrapes hareline from production site", async () => {
    const { BigHumpAdapter: LiveAdapter } = await import("./big-hump");
    const adapter = new LiveAdapter();
    const source = {
      id: "live-bh4",
      url: "http://www.big-hump.com/hareline.php",
      config: null,
    } as never;

    const result = await adapter.fetch(source, { days: 365 });

    expect(result.events.length).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);

    const sample = result.events[0];
    expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sample.kennelTag).toBe("bh4");
    expect(sample.runNumber).toBeGreaterThan(0);
  });

  it("live: scrapes history page from production site", async () => {
    const { parseHistoryPage: liveParse } = await import("./big-hump");
    const currentYear = new Date().getFullYear();
    const res = await fetch(`http://www.big-hump.com/hashresults.php?year=${currentYear}`);
    const html = await res.text();

    const events = liveParse(html, "http://www.big-hump.com");

    expect(events.length).toBeGreaterThan(0);

    const sample = events[0];
    expect(sample.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(sample.kennelTag).toBe("bh4");
    expect(sample.runNumber).toBeGreaterThan(0);
    expect(sample.sourceUrl).toContain("runinfo.php?num=");
  });
});
