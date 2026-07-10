import { describe, it, expect } from "vitest";
import {
  parseMaconEntry,
  parseMaconTime,
  parseMaconLocation,
  parseMaconHares,
} from "./macon-hash";

const SRC = "https://mgh4.com/page/next-hash";

// Real paragraph text as cheerio's .text() yields it (NBSP =  ).
const W3H3_TEXT =
  "W3H3 Wednesday,  October 29, 2025, Weedeater is laying a trail starting at Washington Park, Macon.  In at 6:30, out at 7.  Bring the usual stuff.  ";
const MGH4_TEXT =
  "MGH4, Saturday, July 19, 2025.  Weedeater's birthday trail.  Meet at 5650 Arkwright Rd.  Congregate at 1:30, out at 2.  Bring a chair and a bathing suit.";
const INTRO_TEXT =
  "Note: We are having trouble getting people to hare trails. The second someone steps up, the details will be posted here, so please check back often.";

describe("parseMaconTime", () => {
  it("prefers pack-off (out at) over gather and PM-normalizes", () => {
    expect(parseMaconTime("In at 6:30, out at 7")).toBe("19:00");
    expect(parseMaconTime("Congregate at 1:30, out at 2")).toBe("14:00");
  });
  it("falls back to gather time when there is no out time", () => {
    expect(parseMaconTime("In at 6:30. Bring stuff.")).toBe("18:30");
  });
});

describe("parseMaconLocation", () => {
  it("extracts the place after starting-at / meet-at", () => {
    expect(parseMaconLocation("starting at Washington Park, Macon. In at 6")).toBe(
      "Washington Park, Macon",
    );
    expect(parseMaconLocation("Meet at 5650 Arkwright Rd. Congregate at 1:30")).toBe(
      "5650 Arkwright Rd",
    );
  });
  it("does not truncate a mid-string abbreviation (St. / Rd.)", () => {
    expect(parseMaconLocation("Meet at St. Andrews Park. In at 6")).toBe(
      "St. Andrews Park",
    );
  });
});

describe("parseMaconHares", () => {
  it("reads 'X is laying' and a leading possessive", () => {
    expect(parseMaconHares("Weedeater is laying a trail")).toBe("Weedeater");
    expect(parseMaconHares("Weedeater's birthday trail")).toBe("Weedeater");
  });
  it("captures a multi-hare list before 'are laying'", () => {
    expect(parseMaconHares("Weedeater and Hash Trash are laying a trail")).toBe(
      "Weedeater and Hash Trash",
    );
  });
});

describe("parseMaconEntry", () => {
  it("routes a W3H3 paragraph to w3h3-ga with full fields", () => {
    expect(parseMaconEntry(W3H3_TEXT, SRC)).toMatchObject({
      date: "2025-10-29",
      kennelTags: ["w3h3-ga"],
      startTime: "19:00",
      location: "Washington Park, Macon",
      hares: "Weedeater",
      sourceUrl: SRC,
    });
  });

  it("routes an MGH4 paragraph to mgh4 with full fields", () => {
    expect(parseMaconEntry(MGH4_TEXT, SRC)).toMatchObject({
      date: "2025-07-19",
      kennelTags: ["mgh4"],
      startTime: "14:00",
      location: "5650 Arkwright Rd",
      hares: "Weedeater",
    });
  });

  it("returns null for the non-run intro paragraph", () => {
    expect(parseMaconEntry(INTRO_TEXT, SRC)).toBeNull();
  });

  it("returns null for a labeled paragraph with no parseable date", () => {
    expect(parseMaconEntry("W3H3 hareline: when we have hares", SRC)).toBeNull();
  });
});
