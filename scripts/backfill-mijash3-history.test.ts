import { describe, it, expect } from "vitest";
import {
  parseRunNumber,
  parseDateAndTheme,
  extractField,
  cleanFieldValue,
} from "./backfill-mijash3-history";

const REF = new Date("2026-05-30T00:00:00Z");

describe("parseRunNumber", () => {
  it.each([
    ["Run - 1998 - 28th December 2025 New years Run", "x", 1998],
    ["Run 1673 - 29 Dec 2019", "x", 1673],
    ["Run -1835 - 24th December 2022 The Christmas Run", "x", 1835],
    ["", "2025/12/29/run-1998-28th-december-2025-new-years-run", 1998], // slug fallback
  ])("parses %s -> %i", (title, urlId, expected) => {
    expect(parseRunNumber(title, urlId)).toBe(expected);
  });

  it("returns undefined when no run number present", () => {
    expect(parseRunNumber("Gallery photos", "x")).toBeUndefined();
  });
});

describe("parseDateAndTheme", () => {
  it("parses full-month date + trailing theme", () => {
    expect(parseDateAndTheme("Run - 1998 - 28th December 2025 New years Run", "x", REF)).toEqual({
      date: "2025-12-28",
      theme: "New years Run",
    });
  });

  it("parses abbreviated-month date with no theme", () => {
    expect(parseDateAndTheme("Run 1673 - 29 Dec 2019", "x", REF)).toEqual({
      date: "2019-12-29",
      theme: undefined,
    });
  });

  it("does not mistake the run number for the date", () => {
    // Strips the leading "Run -1835 -" so 1835 can't be read as a day/year.
    expect(parseDateAndTheme("Run -1835 - 24th December 2022 The Christmas Run", "x", REF)).toEqual({
      date: "2022-12-24",
      theme: "The Christmas Run",
    });
  });

  it("falls back to the slug date when the title lacks one", () => {
    const r = parseDateAndTheme("Run 1659", "/runreports-2019/2019/10/1/run-1659-29-sep-2019", REF);
    expect(r.date).toBe("2019-09-29");
  });

  it("returns null date when nothing parseable", () => {
    expect(parseDateAndTheme("Gallery upload", "no-date-here", REF).date).toBeNull();
  });
});

describe("extractField", () => {
  const BODY = "Number: 1987 Date: Sunday 12th October 2025 Hares: Pearl Necklace & Dogface Location: Voltacado Visitors: none Pack size: 30";

  it("captures a labelled value bounded by the next label", () => {
    expect(extractField(BODY, ["Hares", "Hare"])).toBe("Pearl Necklace & Dogface");
    expect(extractField(BODY, ["Location"])).toBe("Voltacado");
  });

  it("ignores a narrative mention with no field separator", () => {
    const prose = "It was great. The hares had laid on cheese and grapes for the weary pack.";
    expect(extractField(prose, ["Hares", "Hare"])).toBeUndefined();
  });

  it("stops location at a 'Hashers' run-on", () => {
    expect(extractField("Location: La Cala Number of Hashers: 18", ["Location"])).toBe("La Cala");
  });

  it("rejects placeholder values", () => {
    expect(extractField("Hares: No data Location: x", ["Hares"])).toBeUndefined();
  });
});

describe("cleanFieldValue", () => {
  it.each([
    ["Yogi and Bad Weasel.It all started rather well", "Yogi and Bad Weasel"],
    ["– Little Big Horn", "Little Big Horn"],
    ["; Sir Flakey", "Sir Flakey"],
    ["La Cala.", "La Cala"],
    ["Voltacado", "Voltacado"],
    ["Sir Flakey and Stiffanny. 44 Runners", "Sir Flakey and Stiffanny"],
    // Abbreviations: the period is NOT a sentence boundary — value survives.
    ["St. Anthony Church", "St. Anthony Church"],
    ["Dr. Foo.It all started", "Dr. Foo"],
  ])("cleans %j -> %j", (raw, expected) => {
    expect(cleanFieldValue(raw)).toBe(expected);
  });
});
