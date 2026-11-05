import { describe, it, expect } from "vitest";
import { findSheetUrl, parseTrueTrailCsv } from "./true-trail-h3";

const URL = "https://truetrailh3.com/";

// Trimmed from the live published sheet the homepage fetches (2026-11-05).
const CSV = `published,trailNumber,title,date,time,locationName,address,hares,theme,hashCash,description,mapUrl,paypalUrl
TRUE,177,Blue Dress Run,2026-07-02,18:30,Original Joes,12520 102 Ave,Tinder Tits,Blue Dress,8,Let's get educated and liberated!,https://maps.app.goo.gl/n4xxcsSbcsCYm8Xi7,www.paypal.me/truetrailh3
TRUE,186,Skid Mark Hash,November 5 2026,18:30,Off Campus,"8216 104 St, Edmonton, AB, T6E 2C7",Spring Loaded & Limp Noodle,,8,"Multi-line
description",https://maps.app.goo.gl/abc,www.paypal.me/truetrailh3
TRUE,188,Sexy Hares Needed,December 3 2026,18:30,TBD,,Sexy Hares Needed,,8,More Detrails to cum!,,www.paypal.me/truetrailh3
FALSE,191,Draft,January 14 2027,18:30,TBD,,TBD,,8,,,
`;

describe("findSheetUrl", () => {
  it("extracts the published-CSV URL from the homepage script", () => {
    const html = `<script>const SHEET_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRi_x-Y/pub?gid=0&amp;single=true&amp;output=csv";</script>`;
    expect(findSheetUrl(html)).toBe("https://docs.google.com/spreadsheets/d/e/2PACX-1vRi_x-Y/pub?gid=0&single=true&output=csv");
    expect(findSheetUrl("<html></html>")).toBeUndefined();
  });
});

describe("parseTrueTrailCsv", () => {
  const events = parseTrueTrailCsv(CSV, URL);

  it("keeps published rows only, handling ISO and prose dates", () => {
    expect(events.map((e) => [e.runNumber, e.date])).toEqual([
      [177, "2026-07-02"],
      [186, "2026-11-05"],
      [188, "2026-12-03"],
    ]);
  });

  it("maps venue, address, hares, cost and maps link", () => {
    expect(events[1]).toEqual({
      date: "2026-11-05",
      kennelTags: ["tth3-ab"],
      runNumber: 186,
      title: "Skid Mark Hash",
      hares: "Limp Noodle, Spring Loaded",
      location: "Off Campus",
      locationStreet: "8216 104 St, Edmonton, AB, T6E 2C7",
      locationUrl: "https://maps.app.goo.gl/abc",
      startTime: "18:30",
      cost: "$8",
      description: "Multi-line description",
      sourceUrl: URL,
    });
  });

  it("drops 'Sexy Hares Needed' and TBD placeholders", () => {
    expect(events[2]).toMatchObject({ runNumber: 188, title: undefined, hares: undefined, location: undefined });
  });
});
