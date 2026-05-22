import { describe, it, expect } from "vitest";
import { parseArchiveRows } from "./backfill-lil-history";

const LIL_1_ROW = `<tr><td class="deeplink_container"><a class="deeplink" id="2012May6"></a>Sunday<br>May 6<br>4:00 pm<br><b></b>2012</td><td><b>Long Island Lunatics Inaugural Hash!</b><br>LIL #1<br>Start: 150 West Bay Dr. Long Beach NY<br>Transit: Take the 2:45PM LIRR Train to Long Beach from Penn Station. <a href="http://g.co/maps/bxrwa" target="_blank">Google Maps Directions</a><br><br>There'll be Beer, Sand, Surf &amp; Mad Cow Haberdashery in Abundance on this historical trail.<br></td><td>I-Feel Tower &amp; Rafa</td><td class="onin"></td></tr>`;

const LIL_49_ROW = `<tr><td class="deeplink_container"><a class="deeplink" id="2016April23"></a>Saturday<br>April 23<br>3:00 pm<br><b></b>2016</td><td>LIL #49<br>Start: Massapequa<br>Prelube: Ziggy's Corner Pub, <a href="https://goo.gl/maps/kpYMopMN9qN2">1 Central Ave</a><br>Transit: Take the 1:45 PaRtY tRaIn from Penn to Massapequa station, arriving 2:45pm.<br><br>It's 'Spring Training' – wear your favorite sports team attire!<br></td><td>Patron Taint of the Willing Tongue</td><td class="onin"></td></tr>`;

const NYC_NON_LIL_ROW = `<tr><td class="deeplink_container"><a class="deeplink" id="2026April29"></a>Wednesday<br>April 29<br>7:00 pm<br><b></b>2026</td><td>NYC #2147<br>Start: Reichenbach Hall<br>Transit: B/D/F to 34th St<br><br>A to A live trail.<br></td><td>Just Roscoe</td><td class="onin"></td></tr>`;

const HEADER_ROW = `<tr><th>Date</th><th>Details</th></tr>`;

function wrapTable(rows: string[]): string {
  return `<html><body><table class="past_hashes">${rows.join("")}</table></body></html>`;
}

describe("parseArchiveRows", () => {
  it("parses LIL #1 (2012) row with pre-2016 date intact (no year guard)", () => {
    const events = parseArchiveRows(wrapTable([LIL_1_ROW]), "https://hashnyc.com");
    expect(events).toHaveLength(1);
    const ev = events[0];
    expect(ev.date).toBe("2012-05-06");
    expect(ev.kennelTags).toEqual(["lil"]);
    expect(ev.runNumber).toBe(1);
    expect(ev.startTime).toBe("16:00");
    expect(ev.hares).toContain("I-Feel Tower");
    expect(ev.location).toContain("150 West Bay Dr");
  });

  it("parses LIL #49 (2016) row from the upper boundary of the gap", () => {
    const events = parseArchiveRows(wrapTable([LIL_49_ROW]), "https://hashnyc.com");
    expect(events).toHaveLength(1);
    expect(events[0].date).toBe("2016-04-23");
    expect(events[0].runNumber).toBe(49);
    expect(events[0].hares).toBe("Patron Taint of the Willing Tongue");
  });

  it("filters out non-LIL rows even when they share the table", () => {
    const events = parseArchiveRows(
      wrapTable([LIL_1_ROW, NYC_NON_LIL_ROW, LIL_49_ROW]),
      "https://hashnyc.com",
    );
    expect(events.map((e) => e.runNumber).sort()).toEqual([1, 49]);
    expect(events.every((e) => e.kennelTags[0] === "lil")).toBe(true);
  });

  it("skips header rows and malformed rows with fewer than 2 cells", () => {
    const events = parseArchiveRows(wrapTable([HEADER_ROW, LIL_1_ROW]), "https://hashnyc.com");
    expect(events).toHaveLength(1);
    expect(events[0].runNumber).toBe(1);
  });

  it("populates sourceUrl from the deeplink anchor id", () => {
    const events = parseArchiveRows(wrapTable([LIL_1_ROW]), "https://hashnyc.com");
    expect(events[0].sourceUrl).toBe("https://hashnyc.com/#2012May6");
  });
});
