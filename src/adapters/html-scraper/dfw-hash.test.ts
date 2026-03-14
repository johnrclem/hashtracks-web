import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";
import {
  buildDFWMonthUrl,
  ICON_TO_KENNEL,
  extractDFWEvents,
  DFWHashAdapter,
} from "./dfw-hash";

describe("buildDFWMonthUrl", () => {
  it("builds URL for January 2026", () => {
    expect(buildDFWMonthUrl(2026, 0)).toBe(
      "http://www.dfwhhh.org/calendar/2026/$01-2026.php",
    );
  });

  it("builds URL for December 2026", () => {
    expect(buildDFWMonthUrl(2026, 11)).toBe(
      "http://www.dfwhhh.org/calendar/2026/$12-2026.php",
    );
  });

  it("builds URL for March 2026", () => {
    expect(buildDFWMonthUrl(2026, 2)).toBe(
      "http://www.dfwhhh.org/calendar/2026/$03-2026.php",
    );
  });
});

describe("ICON_TO_KENNEL mapping", () => {
  it("maps all 4 DFW kennel icons", () => {
    expect(ICON_TO_KENNEL["dallas.png"]).toBe("DH3");
    expect(ICON_TO_KENNEL["DUH.png"]).toBe("DUHHH");
    expect(ICON_TO_KENNEL["NoDHHH2.png"]).toBe("NODUHHH");
    expect(ICON_TO_KENNEL["ftworth.png"]).toBe("FWH3");
  });
});

const SAMPLE_CALENDAR_HTML = `
<html><body>
<table>
  <tr>
    <td>Sun</td><td>Mon</td><td>Tue</td><td>Wed</td><td>Thu</td><td>Fri</td><td>Sat</td>
  </tr>
  <tr>
    <td>&nbsp;</td>
    <td>&nbsp;</td>
    <td>1</td>
    <td>2 <img src="/icons/DUH.png"> DUHHH Run<em>Hare Name</em></td>
    <td>3</td>
    <td>4</td>
    <td>5 <img src="/icons/dallas.png"> DH3 Trail<em>Dallas Hare</em></td>
  </tr>
  <tr>
    <td>6</td>
    <td>7 <img src="/icons/NoDHHH2.png"> NODUHHH Trail</td>
    <td>8</td>
    <td>9 <img src="/icons/DUH.png"> DUHHH Run<em>Another Hare</em></td>
    <td>10</td>
    <td>11</td>
    <td>12 <img src="/icons/ftworth.png"> FWH3 Trail<em>FW Hare</em></td>
  </tr>
</table>
</body></html>
`;

describe("extractDFWEvents", () => {
  it("extracts events from calendar HTML", () => {
    const $ = cheerio.load(SAMPLE_CALENDAR_HTML);
    const { events, errors } = extractDFWEvents($, 2026, 2, "http://test.com"); // March 2026

    expect(errors).toHaveLength(0);
    expect(events.length).toBeGreaterThanOrEqual(4);

    // Check first DUHHH event (Wed March 2)
    const duhhh = events.find((e) => e.kennelTag === "DUHHH" && e.date === "2026-03-02");
    expect(duhhh).toBeDefined();
    expect(duhhh!.hares).toBe("Hare Name");

    // Check DH3 event (Sat March 5)
    const dh3 = events.find((e) => e.kennelTag === "DH3");
    expect(dh3).toBeDefined();
    expect(dh3!.date).toBe("2026-03-05");
    expect(dh3!.hares).toBe("Dallas Hare");

    // Check NODUHHH event (Mon March 7)
    const noduhhh = events.find((e) => e.kennelTag === "NODUHHH");
    expect(noduhhh).toBeDefined();
    expect(noduhhh!.date).toBe("2026-03-07");
    expect(noduhhh!.hares).toBeUndefined(); // no <em> tag

    // Check FWH3 event (Sat March 12)
    const fwh3 = events.find((e) => e.kennelTag === "FWH3");
    expect(fwh3).toBeDefined();
    expect(fwh3!.date).toBe("2026-03-12");
    expect(fwh3!.hares).toBe("FW Hare");
  });

  it("skips cells without known icons", () => {
    const html = `
      <table>
        <tr><td>Sun</td><td>Mon</td><td>Tue</td><td>Wed</td><td>Thu</td><td>Fri</td><td>Sat</td></tr>
        <tr>
          <td>1 <img src="/icons/unknown.png"> Some Event</td>
          <td>2</td><td>3</td><td>4</td><td>5</td><td>6</td><td>7</td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 2, "http://test.com");
    expect(events).toHaveLength(0);
  });

  it("handles empty calendar", () => {
    const html = `<html><body><p>No calendar here</p></body></html>`;
    const $ = cheerio.load(html);
    const { events, errors } = extractDFWEvents($, 2026, 2, "http://test.com");
    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("No table found");
  });
});

describe("DFWHashAdapter.fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches two months and combines events", async () => {
    const adapter = new DFWHashAdapter();

    // Mock safeFetch for both month requests
    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      );

    const result = await adapter.fetch({
      id: "test-dfw",
      url: "http://www.dfwhhh.org/calendar/",
    } as never);

    // Should have events from both months
    expect(result.events.length).toBeGreaterThanOrEqual(4);
    expect(result.diagnosticContext).toMatchObject({
      monthsFetched: 2,
    });
    expect(result.structureHash).toBeDefined();
  });

  it("handles fetch error gracefully", async () => {
    const adapter = new DFWHashAdapter();

    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }) as never,
      )
      .mockResolvedValueOnce(
        new Response("Not Found", { status: 404, statusText: "Not Found" }) as never,
      );

    const result = await adapter.fetch({
      id: "test-dfw",
      url: "http://www.dfwhhh.org/calendar/",
    } as never);

    expect(result.events).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThanOrEqual(1);
  });
});
