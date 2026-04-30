import { describe, it, expect, vi } from "vitest";
import {
  parseMonthHeader,
  extractDayNumber,
  WCFHCalendarAdapter,
} from "./wcfh-calendar";

describe("parseMonthHeader", () => {
  it("parses 'Mar 2026'", () => {
    expect(parseMonthHeader("Mar 2026")).toEqual({ month: 2, year: 2026 });
  });

  it("parses 'Feb 2026'", () => {
    expect(parseMonthHeader("Feb 2026")).toEqual({ month: 1, year: 2026 });
  });

  it("parses 'Apr 2026'", () => {
    expect(parseMonthHeader("Apr 2026")).toEqual({ month: 3, year: 2026 });
  });

  it("parses full month name 'December 2025'", () => {
    expect(parseMonthHeader("December 2025")).toEqual({ month: 11, year: 2025 });
  });

  it("returns null for invalid month", () => {
    expect(parseMonthHeader("Xyz 2026")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseMonthHeader("")).toBeNull();
  });

  it("returns null for non-header text", () => {
    expect(parseMonthHeader("Sun Mon Tue Wed")).toBeNull();
  });
});

describe("extractDayNumber", () => {
  it("extracts day from '22 CH3'", () => {
    expect(extractDayNumber("22 CH3")).toBe(22);
  });

  it("extracts day from '1 B2BH3'", () => {
    expect(extractDayNumber("1 B2BH3")).toBe(1);
  });

  it("extracts day from just '31'", () => {
    expect(extractDayNumber("31")).toBe(31);
  });

  it("returns null for empty cell", () => {
    expect(extractDayNumber("")).toBeNull();
  });

  it("returns null for non-numeric text", () => {
    expect(extractDayNumber("Sun")).toBeNull();
  });

  it("returns null for nbsp", () => {
    expect(extractDayNumber("\u00a0")).toBeNull();
  });

  it("rejects day > 31", () => {
    expect(extractDayNumber("32")).toBeNull();
  });

  it("rejects day 0", () => {
    expect(extractDayNumber("0")).toBeNull();
  });
});

// Minimal WCFH HTML fixture with Feb and Mar 2026
const SAMPLE_HTML = `
<html><body>
<div align="center">
<table border="5" id="table2">
  <tr>
    <td colspan="7" bgcolor="#000000">
      <p>WEST CENTRAL FLORIDA HASH CALENDAR</p>
      <table id="table3"><tr><td>Legend row</td></tr></table>
    </td>
  </tr>
  <tr>
    <td>Sun</td><td>Mon</td><td>Tue</td><td>Wed</td><td>Thu</td><td>Fri</td><td>Sat</td>
  </tr>
  <tr>
    <td colspan="7"><p align="center"><b><font face="Verdana">Feb 2026</font></b></p></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">22 </font><a href="https://facebook.com/circushash"><font>CH3</font></a></b></td>
    <td><b><font face="Verdana">23</font></b></td>
    <td><b><font face="Verdana">24 </font><a href="https://facebook.com/tacotuesday"><font>TTH3</font></a></b></td>
    <td><b><font face="Verdana">25</font></b></td>
    <td><b><font face="Verdana">26</font></b></td>
    <td><b><font face="Verdana">27 </font><a href="https://facebook.com/stpeteh3"><font>SPH3</font></a></b></td>
    <td><b><font face="Verdana">28</font></b></td>
  </tr>
  <tr>
    <td colspan="7"><p align="center"><b><font face="Verdana">Mar 2026</font></b></p></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">1 </font><a href="https://facebook.com/b2bh3"><font>B2BH3</font></a></b></td>
    <td><b><font face="Verdana">2</font></b></td>
    <td><b><font face="Verdana">3</font></b></td>
    <td><b><font face="Verdana">4</font></b></td>
    <td><b><font face="Verdana">5</font></b></td>
    <td><b><font face="Verdana">6</font></b></td>
    <td><b><font face="Verdana">7</font></b></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">8 </font><a href="https://facebook.com/circushash"><font>CH3</font></a></b></td>
    <td><b><font face="Verdana">9</font></b></td>
    <td><b><font face="Verdana">10</font></b></td>
    <td><b><font face="Verdana">11</font></b></td>
    <td><b><font face="Verdana">12</font></b></td>
    <td><b><font face="Verdana">13 </font><a href="https://facebook.com/stpeteh3"><font>SPH3</font></a></b></td>
    <td><b><font face="Verdana">14</font></b></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">15</font></b></td>
    <td><b><font face="Verdana">16</font></b></td>
    <td><b><font face="Verdana">17</font></b></td>
    <td><b><font face="Verdana">18</font></b></td>
    <td><b><font face="Verdana">19</font></b></td>
    <td><b><font face="Verdana">20</font></b></td>
    <td><b><font face="Verdana">21</font></b></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">22 </font><a href="https://facebook.com/circushash"><font>CH3</font></a></b></td>
    <td><b><font face="Verdana">23</font></b></td>
    <td><b><font face="Verdana">24 </font><a href="https://facebook.com/tacotuesday"><font>TTH3</font></a></b></td>
    <td><b><font face="Verdana">25</font></b></td>
    <td><b><font face="Verdana">26</font></b></td>
    <td><b><font face="Verdana">27 </font><a href="https://facebook.com/stpeteh3"><font>SPH3</font></a></b></td>
    <td><b><font face="Verdana">28</font></b></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">29</font></b></td>
    <td><b><font face="Verdana">30</font></b></td>
    <td><b><font face="Verdana">31</font></b></td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
  </tr>
  <tr>
    <td colspan="7"><p align="center"><b><font face="Verdana">Apr 2026</font></b></p></td>
  </tr>
  <tr>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td><b><font face="Verdana">1</font></b></td>
    <td><b><font face="Verdana">2</font></b></td>
    <td><b><font face="Verdana">3</font></b></td>
    <td><b><font face="Verdana">4</font></b></td>
  </tr>
  <tr>
    <td><b><font face="Verdana">5 </font><a href="https://facebook.com/circushash"><font>CH3</font></a>, <a href="https://facebook.com/b2bh3"><font>B2BH3</font></a></b></td>
    <td><b><font face="Verdana">6</font></b></td>
    <td><b><font face="Verdana">7</font></b></td>
    <td><b><font face="Verdana">8</font></b></td>
    <td><b><font face="Verdana">9</font></b></td>
    <td><b><font face="Verdana">10 </font><a href="https://facebook.com/stpeteh3"><font>SPH3</font></a></b></td>
    <td><b><font face="Verdana">11 </font><a href="https://facebook.com/tbh3"><font>TBH3</font></a></b></td>
  </tr>
</table>
</div>
</body></html>
`;

describe("WCFHCalendarAdapter.fetch", () => {
  it("parses sample HTML and returns events", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // Count expected events:
    // Feb: CH3(22), TTH3(24), SPH3(27) = 3
    // Mar: B2BH3(1), CH3(8), SPH3(13), CH3(22), TTH3(24), SPH3(27) = 6
    // Apr: CH3(5), B2BH3(5), SPH3(10), TBH3(11) = 4
    // Total = 13
    expect(result.events).toHaveLength(13);
    expect(result.errors).toHaveLength(0);
    expect(result.structureHash).toBeDefined();

    vi.restoreAllMocks();
  });

  it("parses month headers correctly", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // First event is Feb 22 CH3 (circus-h3)
    const feb22 = result.events.find(e => e.date === "2026-02-22" && e.kennelTags[0] === "circus-h3");
    expect(feb22).toBeDefined();
    expect(feb22!.sourceUrl).toBe("https://www.jollyrogerh3.com/WCFH_Calendar.htm");

    // March events
    const mar1 = result.events.find(e => e.date === "2026-03-01" && e.kennelTags[0] === "b2b-h3");
    expect(mar1).toBeDefined();

    const mar8 = result.events.find(e => e.date === "2026-03-08" && e.kennelTags[0] === "circus-h3");
    expect(mar8).toBeDefined();

    vi.restoreAllMocks();
  });

  it("handles multi-kennel day cells", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // Apr 5 has both CH3 (circus-h3) and B2BH3 (b2b-h3)
    const apr5Events = result.events.filter(e => e.date === "2026-04-05");
    expect(apr5Events).toHaveLength(2);
    expect(apr5Events.map(e => e.kennelTags[0]).sort((a, b) => a.localeCompare(b))).toEqual(["b2b-h3", "circus-h3"]);

    vi.restoreAllMocks();
  });

  it("skips empty/padding cells", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // No events with undefined dates
    for (const event of result.events) {
      expect(event.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }

    vi.restoreAllMocks();
  });

  it("only emits events for known kennel tags", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    const knownTags = new Set(["barf-h3", "b2b-h3", "jrh3", "lh3-fl", "sbh3", "lush", "nsah3", "circus-h3", "sph3-fl", "tth3-fl", "tbh3-fl"]);
    for (const event of result.events) {
      expect(knownTags.has(event.kennelTags[0])).toBe(true);
    }

    vi.restoreAllMocks();
  });

  it("generates display titles using calendar abbreviations, not kennelCodes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // TTH3 should use the display abbreviation, not the kennelCode "tth3-fl"
    const tth3 = result.events.find(e => e.kennelTags[0] === "tth3-fl");
    expect(tth3).toBeDefined();
    expect(tth3!.title).toBe("TTH3 Trail");

    // CH3 → circus-h3 should produce "CH3 Trail"
    const ch3 = result.events.find(e => e.kennelTags[0] === "circus-h3");
    expect(ch3).toBeDefined();
    expect(ch3!.title).toBe("CH3 Trail");

    // SPH3 → sph3-fl should produce "SPH3 Trail"
    const sph3 = result.events.find(e => e.kennelTags[0] === "sph3-fl");
    expect(sph3).toBeDefined();
    expect(sph3!.title).toBe("SPH3 Trail");

    // B2BH3 → b2b-h3 should produce "B2BH3 Trail"
    const b2b = result.events.find(e => e.kennelTags[0] === "b2b-h3");
    expect(b2b).toBeDefined();
    expect(b2b!.title).toBe("B2BH3 Trail");

    // TBH3 → tbh3-fl should produce "TBH3 Trail"
    const tbh3 = result.events.find(e => e.kennelTags[0] === "tbh3-fl");
    expect(tbh3).toBeDefined();
    expect(tbh3!.title).toBe("TBH3 Trail");

    vi.restoreAllMocks();
  });

  it("all emitted events have title fields with display abbreviations", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // Every event should have a title ending in " Trail"
    for (const event of result.events) {
      expect(event.title).toBeDefined();
      expect(event.title).toMatch(/ Trail$/);
      // Title should NOT contain lowercase kennelCode slugs (no hyphens)
      expect(event.title).not.toMatch(/-/);
    }

    vi.restoreAllMocks();
  });

  it("returns fetch error on network failure", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValueOnce(
      new Error("Network error"),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);

    vi.restoreAllMocks();
  });

  it("returns fetch error on HTTP error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response("Not found", { status: 404, statusText: "Not Found" }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errorDetails?.fetch?.[0].status).toBe(404);

    vi.restoreAllMocks();
  });

  it("uses correct UTC noon dates", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(SAMPLE_HTML, { status: 200 }),
    );

    const adapter = new WCFHCalendarAdapter();
    const result = await adapter.fetch({
      id: "test",
      url: "https://www.jollyrogerh3.com/WCFH_Calendar.htm",
    } as never);

    // Verify dates are valid ISO date strings
    for (const event of result.events) {
      const d = new Date(event.date + "T12:00:00Z");
      expect(d.getTime()).not.toBeNaN();
    }

    vi.restoreAllMocks();
  });
});
