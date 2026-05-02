import { describe, it, expect, vi, afterEach } from "vitest";
import * as cheerio from "cheerio";
import {
  buildDFWMonthUrl,
  ICON_TO_KENNEL,
  extractDFWEvents,
  extractDetailPageDate,
  parseDFWDetailPage,
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
  it("maps all 5 DFW kennel icons to kennelCodes", () => {
    expect(ICON_TO_KENNEL["dallas.png"]).toBe("dh3-tx");
    expect(ICON_TO_KENNEL["DUH.png"]).toBe("duhhh");
    expect(ICON_TO_KENNEL["NoDHHH2.png"]).toBe("noduhhh");
    expect(ICON_TO_KENNEL["ftworth.png"]).toBe("fwh3");
    expect(ICON_TO_KENNEL["YAKH3.png"]).toBe("yakh3");
  });

  it("does not map dallas.png to DH3 (Denver collision)", () => {
    expect(ICON_TO_KENNEL["dallas.png"]).not.toBe("DH3");
  });
});

/** Realistic calendar HTML matching the live dfwhhh.org structure. */
const SAMPLE_CALENDAR_HTML = `
<html><body>
<table class="main">
  <tr>
    <th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th>
  </tr>
  <tr>
    <td class="empty"></td>
    <td class="empty"></td>
    <td class="day">
      <table class="inner"><tr><td class="dom">1</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">2</td></tr><tr><td class="event">
        <a href="event.php?month=3&day=2&year=2026&no=1"><img src="/icons/DUH.png" /></a><br />DUHHH Run<br /><em>Hare Name</em>
      </td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">3</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">4</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">5</td></tr><tr><td class="event">
        <a href="event.php?month=3&day=5&year=2026&no=1"><img src="/icons/dallas.png" /></a><br />DH3 Trail<br /><em>Dallas Hare</em>
      </td></tr></table>
    </td>
  </tr>
  <tr>
    <td class="day">
      <table class="inner"><tr><td class="dom">6</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">7</td></tr><tr><td class="event">
        <a href="event.php?month=3&day=7&year=2026&no=1"><img src="/icons/NoDHHH2.png" /></a><br />NODUHHH Trail
      </td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">8</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">9</td></tr><tr><td class="event">
        <a href="event.php?month=3&day=9&year=2026&no=1"><img src="/icons/DUH.png" /></a><br />DUHHH Run<br /><em>Another Hare</em>
      </td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">10</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">11</td></tr><tr><td class="event"></td></tr></table>
    </td>
    <td class="day">
      <table class="inner"><tr><td class="dom">12</td></tr><tr><td class="event">
        <a href="event.php?month=3&day=12&year=2026&no=1"><img src="/icons/ftworth.png" /></a><br />FWH3 Trail<br /><em>FW Hare</em>
      </td></tr></table>
    </td>
  </tr>
</table>
</body></html>
`;

describe("extractDFWEvents", () => {
  it("extracts events from calendar HTML with nested table.inner structure", () => {
    const $ = cheerio.load(SAMPLE_CALENDAR_HTML);
    const { events, errors } = extractDFWEvents($, 2026, 2, "http://test.com"); // March 2026

    expect(errors).toHaveLength(0);
    expect(events.length).toBeGreaterThanOrEqual(4);

    // Check first DUHHH event (Wed March 2)
    const duhhh = events.find((e) => e.event.kennelTags[0] === "duhhh" && e.event.date === "2026-03-02");
    expect(duhhh).toBeDefined();
    expect(duhhh!.event.hares).toBe("Hare Name");
    expect(duhhh!.detailUrl).toContain("event.php");

    // Check Dallas H3 event (Sat March 5)
    const dh3 = events.find((e) => e.event.kennelTags[0] === "dh3-tx");
    expect(dh3).toBeDefined();
    expect(dh3!.event.date).toBe("2026-03-05");
    expect(dh3!.event.hares).toBe("Dallas Hare");

    // Check NODUHHH event (Mon March 7)
    const noduhhh = events.find((e) => e.event.kennelTags[0] === "noduhhh");
    expect(noduhhh).toBeDefined();
    expect(noduhhh!.event.date).toBe("2026-03-07");
    expect(noduhhh!.event.hares).toBeUndefined(); // no <em> tag

    // Check FWH3 event (Sat March 12)
    const fwh3 = events.find((e) => e.event.kennelTags[0] === "fwh3");
    expect(fwh3).toBeDefined();
    expect(fwh3!.event.date).toBe("2026-03-12");
    expect(fwh3!.event.hares).toBe("FW Hare");
  });

  it("skips cells without known icons", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day">
            <table class="inner"><tr><td class="dom">1</td></tr><tr><td class="event">
              <img src="/icons/unknown.png" /> Some Event
            </td></tr></table>
          </td>
          <td class="day"><table class="inner"><tr><td class="dom">2</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">3</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">4</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">5</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">6</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">7</td></tr><tr><td class="event"></td></tr></table></td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 2, "http://test.com");
    expect(events).toHaveLength(0);
  });

  it("separates title from hare when joined by <br>", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day">
            <table class="inner"><tr><td class="dom">25</td></tr><tr><td class="event">
              <a href="event.php?month=3&day=25&year=2026&no=1"><img src="DUH.png" /></a><br />Bubblecum Strikes Again<br /><em>Bubblecum</em>
            </td></tr></table>
          </td>
          <td class="day"><table class="inner"><tr><td class="dom">26</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">27</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">28</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">29</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">30</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">31</td></tr><tr><td class="event"></td></tr></table></td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 2, "http://test.com");
    const evt = events.find((e) => e.event.kennelTags[0] === "duhhh");
    expect(evt).toBeDefined();
    expect(evt!.event.title).toBe("Bubblecum Strikes Again");
    expect(evt!.event.hares).toBe("Bubblecum");
  });

  it("handles empty calendar", () => {
    const html = `<html><body><p>No calendar here</p></body></html>`;
    const $ = cheerio.load(html);
    const { events, errors } = extractDFWEvents($, 2026, 2, "http://test.com");
    expect(events).toHaveLength(0);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("No table found");
  });

  it("extracts YAKH3 event from YAKH3.png icon", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day">
            <table class="inner"><tr><td class="dom">19</td></tr><tr><td class="event">
              <a href="event.php?month=4&day=19&year=2026&no=1"><img src="YAKH3.png" width="130px" /></a><br />Yak Season Opener
            </td></tr></table>
          </td>
          <td class="day"><table class="inner"><tr><td class="dom">20</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">21</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">22</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">23</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">24</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">25</td></tr><tr><td class="event"></td></tr></table></td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 3, "http://test.com"); // April 2026
    const yak = events.find((e) => e.event.kennelTags[0] === "yakh3");
    expect(yak).toBeDefined();
    expect(yak!.event.date).toBe("2026-04-19");
    expect(yak!.event.title).toBe("Yak Season Opener");
  });
});

describe("day-number extraction with holiday prefixes (Issue #2)", () => {
  it("extracts event when cell has FullMoon Founded prefix (td.holiday)", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day"><table class="inner"><tr><td class="dom">15</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">16</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">17</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">18</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">19</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">20</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day">
            <table class="inner"><tr>
              <td class="holiday"><span class="tag">FullMoon Founded</span>21</td>
            </tr><tr><td class="event">
              <a href="event.php?month=3&day=21&year=2026&no=1"><img src="ftworth.png" /></a><br /><em>Whitney MutchaFuckin Houston</em>
            </td></tr></table>
          </td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 2, "http://test.com"); // March 2026
    const fwh3 = events.find((e) => e.event.kennelTags[0] === "fwh3");
    expect(fwh3).toBeDefined();
    expect(fwh3!.event.date).toBe("2026-03-21");
    expect(fwh3!.event.hares).toBe("Whitney MutchaFuckin Houston");
  });

  it("extracts event when cell has Safety Day prefix (td.holiday)", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day"><table class="inner"><tr><td class="dom">19</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day">
            <table class="inner"><tr>
              <td class="holiday"><span class="tag">Safety Day</span>20</td>
            </tr><tr><td class="event">
              <a href="event.php?month=4&day=20&year=2026&no=1"><img src="NoDHHH2.png" width="130px" /></a>
            </td></tr></table>
          </td>
          <td class="day"><table class="inner"><tr><td class="dom">21</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">22</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">23</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">24</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">25</td></tr><tr><td class="event"></td></tr></table></td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 3, "http://test.com"); // April 2026
    const noduhhh = events.find((e) => e.event.kennelTags[0] === "noduhhh");
    expect(noduhhh).toBeDefined();
    expect(noduhhh!.event.date).toBe("2026-04-20");
  });

  it("extracts event when cell has April Fools prefix (td.holiday)", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day"><table class="inner"><tr><td class="dom">29</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">30</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">31</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day">
            <table class="inner"><tr>
              <td class="holiday"><span class="tag">April Fool's</span>1</td>
            </tr><tr><td class="event">
              <a href="event.php?month=4&day=1&year=2026&no=1"><img src="DUH.png" /></a><br />Conjoined with the Full Moon!<br /><em>Pink Panty Poacher</em>
            </td></tr></table>
          </td>
          <td class="day"><table class="inner"><tr><td class="dom">2</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">3</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">4</td></tr><tr><td class="event"></td></tr></table></td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 3, "http://test.com"); // April 2026
    const duhhh = events.find((e) => e.event.kennelTags[0] === "duhhh");
    expect(duhhh).toBeDefined();
    expect(duhhh!.event.date).toBe("2026-04-01");
    expect(duhhh!.event.title).toBe("Conjoined with the Full Moon!");
    expect(duhhh!.event.hares).toBe("Pink Panty Poacher");
  });

  it("extracts event when cell has Easter prefix (td.holiday)", () => {
    const html = `
      <table class="main">
        <tr><th>Sunday</th><th>Monday</th><th>Tuesday</th><th>Wednesday</th><th>Thursday</th><th>Friday</th><th>Saturday</th></tr>
        <tr>
          <td class="day">
            <table class="inner"><tr>
              <td class="holiday"><span class="tag">Easter</span>5</td>
            </tr><tr><td class="event">
              <a href="event.php?month=4&day=5&year=2026&no=1"><img src="dallas.png" /></a><br />Easter Trail<br /><em>Bunny Hare</em>
            </td></tr></table>
          </td>
          <td class="day"><table class="inner"><tr><td class="dom">6</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">7</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">8</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">9</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">10</td></tr><tr><td class="event"></td></tr></table></td>
          <td class="day"><table class="inner"><tr><td class="dom">11</td></tr><tr><td class="event"></td></tr></table></td>
        </tr>
      </table>
    `;
    const $ = cheerio.load(html);
    const { events } = extractDFWEvents($, 2026, 3, "http://test.com"); // April 2026
    const dh3 = events.find((e) => e.event.kennelTags[0] === "dh3-tx");
    expect(dh3).toBeDefined();
    expect(dh3!.event.date).toBe("2026-04-05");
    expect(dh3!.event.title).toBe("Easter Trail");
    expect(dh3!.event.hares).toBe("Bunny Hare");
  });
});

describe("parseDFWDetailPage", () => {
  it("parses time, location, hares, and run number from detail page", () => {
    const html = `
      <html><body>
        <div id="container">
          <img src="NoDHHH2.png" alt="NODUH Hash" />
          <h1>NODUH Hash</h1>
          <h2>Monday, March 23, 2026</h2>
          <h3>Hash Run No 340</h3>
          <h4>Twilight: 8:05 PM</h4>
          <hr />
          <h5><em>Time:</em> 7:00 PM</h5>
          <h5><em>Start address:</em> Sam Houston Trail Park, Irving</h5>
          <h5><em>Map:</em> <a href="https://maps.google.com/test">Get Map</a></h5>
          <h5><em>Hares:</em> Casting Cooch</h5>
          <h5><em>Hash cash:</em> $7.00</h5>
          <h5><em>Description:</em> Give me beer or give me death!</h5>
        </div>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.startTime).toBe("19:00");
    expect(detail.location).toBe("Sam Houston Trail Park, Irving");
    expect(detail.hares).toBe("Casting Cooch");
    expect(detail.runNumber).toBe(340);
    expect(detail.cost).toBe("$7.00");
    expect(detail.description).toBe("Give me beer or give me death!");
    expect(detail.date).toBe("2026-03-23");
  });

  it("extracts verbatim FWH3 cost string without cleanup (#1151)", () => {
    // FWH3's hash cash row is a long free-form string with payment instructions.
    // The adapter must store it verbatim — issue authors explicitly call this out.
    const html = `
      <html><body>
        <h3>Hash Run No 1056</h3>
        <h5><em>Hash cash:</em> $7.00 cash - Paypal $7 - Pay pal (FWH3) or Zelle 817-689-9363 - BYOB pre-lube beer</h5>
        <h5><em>Description:</em> Y'all know what to bring when you see my name as the hare</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);
    expect(detail.cost).toBe(
      "$7.00 cash - Paypal $7 - Pay pal (FWH3) or Zelle 817-689-9363 - BYOB pre-lube beer",
    );
    expect(detail.description).toBe(
      "Y'all know what to bring when you see my name as the hare",
    );
  });

  it("returns canonical date from <h2> heading (#1155)", () => {
    // DUHHH #849 was stored on Fri 4/3 but the source detail page says
    // Wednesday, April 22, 2026. parseDFWDetailPage should surface the date
    // so the adapter enrich loop can override the (drifted) grid date.
    const html = `
      <html><body>
        <h1>Dallas Urban Hash</h1>
        <h2>Wednesday, April 22, 2026</h2>
        <h3>Hash Run No 849</h3>
        <h5><em>Time:</em> 6:30 PM</h5>
        <h5><em>Hares:</em> My Boyfriend Joe</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);
    expect(detail.date).toBe("2026-04-22");
    expect(detail.runNumber).toBe(849);
  });
});

describe("extractDetailPageDate", () => {
  it("parses a Wednesday date heading", () => {
    const $ = cheerio.load("<h2>Wednesday, April 22, 2026</h2>");
    expect(extractDetailPageDate($)).toBe("2026-04-22");
  });

  it("parses a Saturday date heading", () => {
    const $ = cheerio.load("<h2>Saturday, March 14, 2026</h2>");
    expect(extractDetailPageDate($)).toBe("2026-03-14");
  });

  it("falls back to <h1> when <h2> has no date", () => {
    const $ = cheerio.load(`
      <html><body>
        <h1>Friday, January 9, 2026</h1>
        <h2>Some Venue</h2>
      </body></html>
    `);
    expect(extractDetailPageDate($)).toBe("2026-01-09");
  });

  it("returns undefined when no date heading exists", () => {
    const $ = cheerio.load("<h2>Twin Peaks</h2><h3>Hash Run No 1</h3>");
    expect(extractDetailPageDate($)).toBeUndefined();
  });

  it("ignores headings without a day-of-week prefix", () => {
    const $ = cheerio.load("<h2>April 22, 2026</h2>");
    expect(extractDetailPageDate($)).toBeUndefined();
  });

  it("skips 'Nothing yet' values", () => {
    const html = `
      <html><body>
        <h3>Hash Run No 100</h3>
        <h5><em>Time:</em> Nothing yet</h5>
        <h5><em>Start address:</em> Nothing yet</h5>
        <h5><em>Hares:</em> Some Hare</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.startTime).toBeUndefined();
    expect(detail.location).toBeUndefined();
    expect(detail.hares).toBe("Some Hare");
    expect(detail.runNumber).toBe(100);
  });

  it("extracts hare name wrapped in second em tag (defense-in-depth)", () => {
    const html = `
      <html><body>
        <h3>Hash Run No 500</h3>
        <h5><em>Hares:</em> <em>Son of a Peach</em></h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);
    expect(detail.hares).toBe("Son of a Peach");
  });

  it("handles detail page with missing fields gracefully", () => {
    const html = `<html><body><p>Minimal page</p></body></html>`;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.startTime).toBeUndefined();
    expect(detail.location).toBeUndefined();
    expect(detail.hares).toBeUndefined();
    expect(detail.runNumber).toBeUndefined();
  });

  it("parses time and location from detail page with h1", () => {
    const html = `
      <html><body>
        <h1>Twin Peaks</h1>
        <h3>Hash Run No 250</h3>
        <h5><em>Time:</em> 6:30 PM</h5>
        <h5><em>Start address:</em> 5260 belt line Dallas 75254</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.startTime).toBe("18:30");
    // Venue name "Twin Peaks" prepended to address
    expect(detail.location).toBe("Twin Peaks, 5260 belt line Dallas 75254");
    expect(detail.runNumber).toBe(250);
  });

  it("inserts comma separators for multi-line <br/> addresses (#520)", () => {
    // DUHHH Run #847 case: the address uses <br/> between venue, street, and
    // city/ZIP. Cheerio's .text() strips <br/> without replacement, producing
    // a concatenated run-on like "VenueStreetCity, ST ZIP". stripHtmlTags
    // replaces each <br/> with ", " so the value reads correctly.
    const html = `
      <html><body>
        <h3>Hash Run No 847</h3>
        <h5><em>Start address:</em> UT Dallas Silver Line Station<br />3416 Waterview Parkway<br />Richardson, TX 75080</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);
    expect(detail.location).toBe("UT Dallas Silver Line Station, 3416 Waterview Parkway, Richardson, TX 75080");
  });

  it("does not duplicate the venue when the first address segment extends the venue name", () => {
    // Edge case for the dedup: venue "Twin Peaks" vs first segment "Twin Peaks Restaurant".
    // An exact-match dedup would still prepend, producing "Twin Peaks, Twin Peaks Restaurant".
    // startsWith handles this correctly.
    const html = `
      <html><body>
        <h2>Twin Peaks</h2>
        <h3>Hash Run No 252</h3>
        <h5><em>Start address:</em> Twin Peaks Restaurant<br />5260 Belt Line Rd<br />Dallas, TX 75254</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);
    expect(detail.location).toBe("Twin Peaks Restaurant, 5260 Belt Line Rd, Dallas, TX 75254");
  });

  it("does not duplicate the venue when the <h2> heading matches the first address line", () => {
    // Regression for the combination introduced by #520's br-separator fix:
    // when both the <h2> venue heading AND the first <br/> segment of the
    // Start address hold the same venue name, the old prepend would double it
    // ("Twin Peaks, Twin Peaks, 5260 Belt Line…").
    const html = `
      <html><body>
        <h2>Twin Peaks</h2>
        <h3>Hash Run No 251</h3>
        <h5><em>Start address:</em> Twin Peaks<br />5260 Belt Line Rd<br />Dallas, TX 75254</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);
    expect(detail.location).toBe("Twin Peaks, 5260 Belt Line Rd, Dallas, TX 75254");
  });

  it("prepends venue name from <h2> to address", () => {
    const html = `
      <html><body>
        <h2>Twin Peaks</h2>
        <h3>Hash Run No 250</h3>
        <h5><em>Time:</em> 6:30 PM</h5>
        <h5><em>Start address:</em> 5260 belt line Dallas 75254</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.location).toBe("Twin Peaks, 5260 belt line Dallas 75254");
  });

  it("filters out kennel name heading (NODUH Hash)", () => {
    const html = `
      <html><body>
        <h1>NODUH Hash</h1>
        <h2>Monday, March 23, 2026</h2>
        <h3>Hash Run No 340</h3>
        <h5><em>Time:</em> 7:00 PM</h5>
        <h5><em>Start address:</em> Sam Houston Trail Park, Irving</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    // "NODUH Hash" and date heading both filtered — location is just the address
    expect(detail.location).toBe("Sam Houston Trail Park, Irving");
  });

  it("filters out DFW Hash heading", () => {
    const html = `
      <html><body>
        <h2>DFW Hash</h2>
        <h3>Hash Run No 100</h3>
        <h5><em>Start address:</em> 123 Main St, Dallas</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.location).toBe("123 Main St, Dallas");
  });

  it("does not change location when no heading exists", () => {
    const html = `
      <html><body>
        <h3>Hash Run No 100</h3>
        <h5><em>Start address:</em> 123 Main St, Dallas</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    expect(detail.location).toBe("123 Main St, Dallas");
  });

  it("does not set venue as location when no address exists", () => {
    const html = `
      <html><body>
        <h2>Twin Peaks</h2>
        <h3>Hash Run No 250</h3>
        <h5><em>Time:</em> 6:30 PM</h5>
        <h5><em>Start address:</em> Nothing yet</h5>
      </body></html>
    `;
    const $ = cheerio.load(html);
    const detail = parseDFWDetailPage($);

    // No location because address was "Nothing yet", venue should not create one
    expect(detail.location).toBeUndefined();
  });
});

describe("DFWHashAdapter.fetch", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches two months and combines events", async () => {
    const adapter = new DFWHashAdapter();

    // Mock safeFetch for calendar pages + detail pages
    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      // Month 1 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // Month 2 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // Detail pages (mocked as minimal pages)
      .mockImplementation(
        async () => new Response("<html><body><h5><em>Time:</em> 7:00 PM</h5></body></html>", { status: 200 }) as never,
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

  it("enriches events with detail page data", async () => {
    const adapter = new DFWHashAdapter();

    const detailHtml = `
      <html><body>
        <h1>NODUH Hash</h1>
        <h3>Hash Run No 340</h3>
        <h5><em>Time:</em> 7:00 PM</h5>
        <h5><em>Start address:</em> Sam Houston Trail Park, Irving</h5>
        <h5><em>Hares:</em> Casting Cooch</h5>
      </body></html>
    `;

    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      // Month 1 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // Month 2 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // All detail page requests return the same detail page
      .mockImplementation(
        async () => new Response(detailHtml, { status: 200 }) as never,
      );

    const result = await adapter.fetch({
      id: "test-dfw",
      url: "http://www.dfwhhh.org/calendar/",
    } as never);

    // Events should be enriched with time/location from detail pages
    const enriched = result.events.filter((e) => e.startTime);
    expect(enriched.length).toBeGreaterThan(0);
    expect(enriched[0].startTime).toBe("19:00");
    expect(enriched[0].location).toBe("Sam Houston Trail Park, Irving");
  });

  it("detail page hares overwrite truncated calendar grid hares", async () => {
    // Calendar grid may extract a truncated hare from <em> (e.g. "S" from
    // a clipped tag), but the detail page has the full "Hare: Son of a Peach"
    // label. The enrichment guard must always prefer the detail page value.
    const adapter = new DFWHashAdapter();

    const detailHtml = `
      <html><body>
        <h3>Hash Run No 500</h3>
        <h5><em>Time:</em> 6:30 PM</h5>
        <h5><em>Start address:</em> Deep Ellum, Dallas</h5>
        <h5><em>Hares:</em> Son of a Peach</h5>
      </body></html>
    `;

    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      // Month 1 calendar — has truncated hare names in <em> tags
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // Month 2 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // All detail page requests return the full hare name
      .mockImplementation(
        async () => new Response(detailHtml, { status: 200 }) as never,
      );

    const result = await adapter.fetch({
      id: "test-dfw",
      url: "http://www.dfwhhh.org/calendar/",
    } as never);

    // Calendar grid events had hares like "Hare Name", "Dallas Hare", etc.
    // Detail page returns "Son of a Peach" — it should overwrite all of them
    const eventsWithHares = result.events.filter((e) => e.hares);
    expect(eventsWithHares.length).toBeGreaterThan(0);
    for (const evt of eventsWithHares) {
      expect(evt.hares).toBe("Son of a Peach");
    }
  });

  it("detail-page date overrides drifted grid date (DUHHH #849 regression, #1155)", async () => {
    // Calendar grid puts the DUHHH event on day 3 of the current month, but
    // the detail page's <h2> says Wednesday, April 22, 2026. The adapter must
    // trust the detail-page date and overwrite the grid-derived date.
    const adapter = new DFWHashAdapter();

    const calendarHtml = `
      <html><body>
        <table class="main">
          <tr><th>Sun</th><th>Mon</th><th>Tue</th><th>Wed</th><th>Thu</th><th>Fri</th><th>Sat</th></tr>
          <tr>
            <td class="day"><table class="inner"><tr><td class="dom">3</td></tr><tr><td class="event">
              <a href="event.php?month=4&day=22&year=2026&no=1"><img src="/icons/DUH.png" /></a><br />Hickery House Bar<br /><em>My Boyfriend Joe</em>
            </td></tr></table></td>
          </tr>
        </table>
      </body></html>
    `;

    const detailHtml = `
      <html><body>
        <h1>Dallas Urban Hash</h1>
        <h2>Wednesday, April 22, 2026</h2>
        <h3>Hash Run No 849</h3>
        <h5><em>Time:</em> 6:30 PM</h5>
        <h5><em>Hares:</em> My Boyfriend Joe</h5>
        <h5><em>Hash cash:</em> $3</h5>
      </body></html>
    `;

    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      .mockResolvedValueOnce(new Response(calendarHtml, { status: 200 }) as never)
      .mockResolvedValueOnce(new Response(calendarHtml, { status: 200 }) as never)
      .mockImplementation(async () => new Response(detailHtml, { status: 200 }) as never);

    const result = await adapter.fetch({
      id: "test-dfw",
      url: "http://www.dfwhhh.org/calendar/",
    } as never);

    const duhhhEvents = result.events.filter((e) => e.kennelTags?.includes("duhhh"));
    expect(duhhhEvents.length).toBeGreaterThan(0);
    for (const evt of duhhhEvents) {
      expect(evt.date).toBe("2026-04-22");
      expect(evt.runNumber).toBe(849);
      expect(evt.cost).toBe("$3");
    }
  });

  it("gracefully handles detail page fetch failures", async () => {
    const adapter = new DFWHashAdapter();

    const mockModule = await import("../safe-fetch");
    vi.spyOn(mockModule, "safeFetch")
      // Month 1 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // Month 2 calendar
      .mockResolvedValueOnce(
        new Response(SAMPLE_CALENDAR_HTML, { status: 200 }) as never,
      )
      // All detail pages fail
      .mockImplementation(
        async () => { throw new Error("Network error"); },
      );

    const result = await adapter.fetch({
      id: "test-dfw",
      url: "http://www.dfwhhh.org/calendar/",
    } as never);

    // Events should still exist (just without enrichment)
    expect(result.events.length).toBeGreaterThan(0);
    // All events should lack startTime since detail fetches failed
    expect(result.events.every((e) => !e.startTime)).toBe(true);
    expect(result.diagnosticContext?.detailPagesFailed).toBeGreaterThan(0);
  });
});
