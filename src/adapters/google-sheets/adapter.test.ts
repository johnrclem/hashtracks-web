import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseDate, inferStartTime, parseCSV, buildEventFromSheetRow, parseSheetStartTimeCell, GoogleSheetsAdapter, normalizeGroupFilter, tokenizeGroupCell, cellMatchesFilter, extractEventLabelFromCell } from "./adapter";
import type { GoogleSheetsConfig } from "./adapter";

// Mock safeFetch
vi.mock("@/adapters/safe-fetch", () => ({
  safeFetch: vi.fn(),
}));

const { safeFetch } = await import("@/adapters/safe-fetch");
const mockedSafeFetch = vi.mocked(safeFetch);

// ── parseDate ──

describe("parseDate", () => {
  it("parses M-D-YY with hyphens", () => {
    expect(parseDate("6-15-25")).toBe("2025-06-15");
  });

  it("parses M/D/YYYY with slashes", () => {
    expect(parseDate("7/1/2024")).toBe("2024-07-01");
  });

  it("parses M/DD/YY with slashes", () => {
    expect(parseDate("6/13/22")).toBe("2022-06-13");
  });

  it("handles 2-digit year boundary: 49 → 2049", () => {
    expect(parseDate("1/1/49")).toBe("2049-01-01");
  });

  it("handles 2-digit year boundary: 50 → 1950", () => {
    expect(parseDate("1/1/50")).toBe("1950-01-01");
  });

  it("returns null for empty string", () => {
    expect(parseDate("")).toBeNull();
  });

  it("returns null for invalid input", () => {
    expect(parseDate("abc")).toBeNull();
  });

  it("returns null for month > 12", () => {
    expect(parseDate("13/1/25")).toBeNull();
  });

  it("returns null for day > 31", () => {
    expect(parseDate("1/32/25")).toBeNull();
  });

  it("pads single-digit month and day", () => {
    expect(parseDate("1/5/25")).toBe("2025-01-05");
  });

  it("parses YYYY-MM-DD (ISO 8601)", () => {
    expect(parseDate("2026-03-29")).toBe("2026-03-29");
  });

  it("parses YYYY/MM/DD", () => {
    expect(parseDate("2026/03/07")).toBe("2026-03-07");
  });

  it("strips day-name suffix: YYYY/MM/DD (DayName)", () => {
    expect(parseDate("2026/03/07 (Sat)")).toBe("2026-03-07");
  });

  it("strips day-name suffix for leap year date", () => {
    expect(parseDate("2028/02/29 (Tue)")).toBe("2028-02-29");
  });

  it("returns null for impossible date Feb 30", () => {
    expect(parseDate("2/30/26")).toBeNull();
  });

  it("returns null for impossible date Apr 31", () => {
    expect(parseDate("4/31/26")).toBeNull();
  });

  it("accepts valid leap day Feb 29 2028", () => {
    expect(parseDate("2/29/28")).toBe("2028-02-29");
  });

  it("returns null for non-leap Feb 29", () => {
    expect(parseDate("2/29/26")).toBeNull();
  });

  it("parses D-Mon-YY format (Munich hareline)", () => {
    expect(parseDate("3-Jan-26")).toBe("2026-01-03");
  });

  it("parses DD-Mon-YY format", () => {
    expect(parseDate("20-Dec-25")).toBe("2025-12-20");
  });

  it("parses DD-Mon-YYYY format", () => {
    expect(parseDate("15-Mar-2026")).toBe("2026-03-15");
  });

  it("returns null for invalid D-Mon-YY", () => {
    expect(parseDate("32-Jan-26")).toBeNull();
  });

  // ── "Day-name DD MonthName" (no year) — RS2H3 format ──

  describe("Day-name DD MonthName (no year)", () => {
    // Each row: [today (Y, M-0idx, D), input, expected]. `null` expected = parse failure.
    type Case = readonly [Date, string, string | null];
    const cases: Record<string, Case> = {
      "Thu 7 May → current year": [new Date(Date.UTC(2026, 4, 1)), "Thu 7 May", "2026-05-07"],
      "Mon 14 Sep → end of year, no rollover": [new Date(Date.UTC(2026, 4, 1)), "Mon 14 Sep", "2026-09-14"],
      "Mon 14 Sep → rolls forward when month past": [new Date(Date.UTC(2026, 11, 15)), "Mon 14 Sep", "2027-09-14"],
      "Thu 25 Dec on Jan 1 → previous year (grace)": [new Date(Date.UTC(2026, 0, 1)), "Thu 25 Dec", "2025-12-25"],
      "Mon 25 Dec on Feb 1 → current year (past grace)": [new Date(Date.UTC(2026, 1, 1)), "Mon 25 Dec", "2026-12-25"],
      "Thu 7 May on May 15 → keep current year (in grace)": [new Date(Date.UTC(2026, 4, 15)), "Thu 7 May", "2026-05-07"],
      "trailing whitespace 'Thu 7 May '": [new Date(Date.UTC(2026, 4, 1)), "Thu 7 May ", "2026-05-07"],
      "full month name 'Tuesday 14 September'": [new Date(Date.UTC(2026, 4, 1)), "Tuesday 14 September", "2026-09-14"],
      "impossible day 'Thu 32 May'": [new Date(Date.UTC(2026, 4, 1)), "Thu 32 May", null],
      "unknown month 'Thu 7 Xyz'": [new Date(Date.UTC(2026, 4, 1)), "Thu 7 Xyz", null],
    };

    it.each(Object.entries(cases))("%s", (_label, [today, input, expected]) => {
      expect(parseDate(input, today)).toBe(expected);
    });
  });

  // ── "Mon-DD" (no year) — Hibiscus H3 format ──

  describe("Mon-DD (no year)", () => {
    type Case = readonly [Date, string, string | null];
    const cases: Record<string, Case> = {
      "May-18 on May 15 → current year (in grace)": [new Date(Date.UTC(2026, 4, 15)), "May-18", "2026-05-18"],
      "Dec-5 on Jan 1 → previous year (grace)": [new Date(Date.UTC(2026, 0, 1)), "Dec-5", "2025-12-05"],
      "Jan-5 on Dec 15 → next year (rolls forward)": [new Date(Date.UTC(2026, 11, 15)), "Jan-5", "2027-01-05"],
      "May-1 on May 15 → current year": [new Date(Date.UTC(2026, 4, 15)), "May-1", "2026-05-01"],
      "Jun-30 → current year": [new Date(Date.UTC(2026, 4, 15)), "Jun-30", "2026-06-30"],
      "unknown month 'Xyz-5'": [new Date(Date.UTC(2026, 4, 15)), "Xyz-5", null],
      "impossible day 'Feb-30'": [new Date(Date.UTC(2026, 4, 15)), "Feb-30", null],
    };

    it.each(Object.entries(cases))("%s", (_label, [today, input, expected]) => {
      expect(parseDate(input, today)).toBe(expected);
    });
  });
});

// ── inferStartTime ──

describe("inferStartTime", () => {
  const rules = {
    byDayOfWeek: { Mon: "19:00", Sat: "15:00" },
    default: "14:00",
  };

  it("returns time for matching day of week", () => {
    // 2026-02-16 is a Monday
    expect(inferStartTime("2026-02-16", rules)).toBe("19:00");
  });

  it("returns time for Saturday", () => {
    // 2026-02-14 is a Saturday
    expect(inferStartTime("2026-02-14", rules)).toBe("15:00");
  });

  it("returns default for unmatched day", () => {
    // 2026-02-15 is a Sunday
    expect(inferStartTime("2026-02-15", rules)).toBe("14:00");
  });

  it("returns undefined when no rules", () => {
    expect(inferStartTime("2026-02-14")).toBeUndefined();
  });
});

// ── parseCSV ──

describe("parseCSV", () => {
  it("parses simple unquoted fields", () => {
    expect(parseCSV("a,b,c\n1,2,3")).toEqual([
      ["a", "b", "c"],
      ["1", "2", "3"],
    ]);
  });

  it("handles quoted fields with commas", () => {
    expect(parseCSV('"a,b",c,d')).toEqual([["a,b", "c", "d"]]);
  });

  it("handles escaped double-quotes inside quotes", () => {
    expect(parseCSV('"He said ""hello""",b')).toEqual([['He said "hello"', "b"]]);
  });

  it("handles CRLF line endings", () => {
    expect(parseCSV("a,b\r\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles LF-only line endings", () => {
    expect(parseCSV("a,b\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("filters empty rows", () => {
    expect(parseCSV("a,b\n\nc,d")).toEqual([
      ["a", "b"],
      ["c", "d"],
    ]);
  });

  it("handles trailing comma", () => {
    expect(parseCSV("a,b,")).toEqual([["a", "b"]]);
  });

  it("returns empty array for empty input", () => {
    expect(parseCSV("")).toEqual([]);
  });

  it("handles unquoted empty fields", () => {
    expect(parseCSV("a,,c")).toEqual([["a", "", "c"]]);
  });
});

// ── buildEventFromSheetRow (placeholder stripping + defaultTitle) ──
// Note: PLACEHOLDER_PATTERN tests moved to src/adapters/utils.test.ts (isPlaceholder/stripPlaceholder)

describe("buildEventFromSheetRow", () => {
  const baseConfig = {
    sheetId: "test",
    columns: { runNumber: 0, date: 1, hares: 2, location: 3, title: 4 },
    kennelTagRules: { default: "W3H3" },
  };

  it("strips TBD title to undefined", () => {
    const row = ["100", "3/11/26", "Alice", "Some Park", "TBD"];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.title).toBeUndefined();
  });

  it("strips TBD hares and location", () => {
    const row = ["100", "3/11/26", "tbd", "TBA", "Real Title"];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
    expect(event!.location).toBeUndefined();
    expect(event!.title).toBe("Real Title");
  });

  it("emits runNumber: undefined when columns.runNumber is not configured (Hibiscus pattern)", () => {
    // Hibiscus's sheet has a sequential row counter (1, 2, 3, ...) in col 0
    // that shifts when the kennel adds/removes rows above. Feeding that
    // into runNumber would re-fingerprint events on every sheet edit, so
    // we omit the column entirely and rely on the date column to gate
    // row validity (already filtered upstream by processRows).
    const config = {
      sheetId: "test",
      columns: { date: 1, location: 2, hares: 3 },
      kennelTagRules: { default: "hibiscus-h3" },
    };
    const row = ["1", "May-18", "The Mercant, Albany", "Nature&Teddy"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-05-18");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBeUndefined();
    expect(event!.kennelTags).toEqual(["hibiscus-h3"]);
    expect(event!.hares).toBe("Nature&Teddy");
    expect(event!.location).toBe("The Mercant, Albany");
  });

  it("#1625 falls through to default kennelTag when columns.runNumber is configured but cell is empty", () => {
    // PR #1695 landed the resolver-level fix (adapter.ts:509-522). This locks
    // it in as a direct unit test so a future regression of the empty-#-cell
    // branch surfaces here instead of silently dropping rows like the
    // MASS H3 5th-Birthday (#1639) and MFMH3 12-of-13 unnumbered rows (#1657)
    // it originally affected.
    const config = {
      sheetId: "munich",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3, title: 4 },
      kennelTagRules: { default: "mh3-de" },
    };
    // Empty runNumber cell; everything else valid.
    const row = ["", "3/11/26", "Alice", "Some Park", "5th Birthday"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.kennelTags).toEqual(["mh3-de"]);
    expect(event!.runNumber).toBeUndefined();
    expect(event!.title).toBe("5th Birthday");
  });

  it("#1625 falls through to default kennelTag when columns.runNumber cell is non-numeric", () => {
    // Same relaxation: a non-numeric cell ("TBD", whitespace) is treated as
    // "no run number known" rather than "this row doesn't belong to us".
    const config = {
      sheetId: "munich",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3, title: 4 },
      kennelTagRules: { default: "mh3-de" },
    };
    const row = ["TBD", "3/11/26", "Alice", "Some Park", "Pink Moon"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.kennelTags).toEqual(["mh3-de"]);
    expect(event!.runNumber).toBeUndefined();
  });

  it("drops all-lowercase single-token city shorthands like 'sheperdstown' (#893)", () => {
    // W3H3 sheet row 17 (run #359) has "sheperdstown" in column D — a typo'd
    // city name used as a venue placeholder. Without this fix the geocoder
    // appends the resolved city → "sheperdstown, Shepherdstown, WV" double-render.
    const row = ["359", "3/11/26", "Alice", "sheperdstown", "Trail Title"];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.location).toBeUndefined();
    // locationUrl is gated on location, so it also drops.
    expect(event!.locationUrl).toBeUndefined();
  });

  // #923 Munich H3: explicit startTime column overrides startTimeRules
  // inference. Empty / placeholder cells fall through to rules.
  describe("startTime column (#923)", () => {
    const munichConfig = {
      sheetId: "munich",
      columns: { runNumber: 0, date: 1, hares: 4, location: 5, description: 6, startTime: 3 },
      kennelTagRules: { default: "mh3-de" },
    };
    // [#, Date, Group, Start time, Hared by, Location, Notes]
    const buildRow = (cell3: string, run = "999", date = "25-Apr-26") =>
      [run, date, "MH3", cell3, "Hare1", "Treffpunkt", ""];

    it.each([
      ["24-hour 'HH:MM' verbatim", "15:00", "15:00"],
      ["single-digit hour normalized to zero-padded", "9:30", "09:30"],
      ["12-hour 'H:MM pm' format converted", "7:00 pm", "19:00"],
    ])("extracts startTime from column: %s", (_label, cell, expected) => {
      const event = buildEventFromSheetRow(buildRow(cell), munichConfig, "https://example.com", "2026-04-25");
      expect(event!.startTime).toBe(expected);
    });

    it("falls through to startTimeRules when cell is empty/TBD", () => {
      const config = { ...munichConfig, startTimeRules: { default: "19:00" } };
      const event = buildEventFromSheetRow(buildRow("TBD"), config, "https://example.com", "2026-04-25");
      expect(event!.startTime).toBe("19:00");
    });

    it("undefined when neither column nor rules supply a value", () => {
      const event = buildEventFromSheetRow(buildRow(""), munichConfig, "https://example.com", "2026-04-25");
      expect(event!.startTime).toBeUndefined();
    });
  });

  describe("parseSheetStartTimeCell (#923)", () => {
    it("returns undefined for blank, undefined, or TBD", () => {
      expect(parseSheetStartTimeCell(undefined)).toBeUndefined();
      expect(parseSheetStartTimeCell("")).toBeUndefined();
      expect(parseSheetStartTimeCell("TBD")).toBeUndefined();
      expect(parseSheetStartTimeCell("  ")).toBeUndefined();
    });

    it("rejects out-of-range values gracefully", () => {
      expect(parseSheetStartTimeCell("25:00")).toBeUndefined();
      expect(parseSheetStartTimeCell("12:60")).toBeUndefined();
    });

    it("strips trailing seconds component", () => {
      expect(parseSheetStartTimeCell("15:00:00")).toBe("15:00");
    });
  });

  it("preserves capitalized one-word venue names (no false-positive on 'Subway')", () => {
    // Capitalized one-word values could be real venues — the heuristic
    // intentionally skips them. Capitalized city shorthands like
    // "Charlestown" would still pass through to the geocoder; that's
    // a downstream redundancy-suppression concern, out of scope here.
    const row = ["359", "3/11/26", "Alice", "Subway", "Trail Title"];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event!.location).toBe("Subway");
  });

  it("preserves multi-word lowercase venue names (heuristic only fires on single-token)", () => {
    const row = ["359", "3/11/26", "Alice", "the old star", "Trail Title"];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event!.location).toBe("the old star");
  });

  it("preserves real venue names with apostrophes/hyphens but spaces", () => {
    const row = ["359", "3/11/26", "Alice", "Joe's Tavern", "Trail Title"];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event!.location).toBe("Joe's Tavern");
  });

  // #1579: OKissMe H3 layout splits venue/city from full street address across
  // two columns. Either column may be blank — the adapter must populate
  // `location` and `locationStreet` independently, and combine them when
  // building the maps query.
  describe("columns.address (#1579)", () => {
    const okConfig = {
      sheetId: "okissme",
      // [#, Date, Hares, Location, Address, Theme]
      columns: { runNumber: 0, date: 1, hares: 2, location: 3, address: 4 },
      kennelTagRules: { default: "okissme-h3" },
    };

    it("location only → location populated, locationStreet undefined", () => {
      const row = ["53", "5/22/26", "Fire in the Hole", "Orlando", ""];
      const event = buildEventFromSheetRow(row, okConfig, "https://example.com", "2026-05-22");
      expect(event!.location).toBe("Orlando");
      expect(event!.locationStreet).toBeUndefined();
      expect(event!.locationUrl).toContain("Orlando");
    });

    it("address only → locationStreet populated, location undefined", () => {
      const row = ["52", "5/15/26", "Slip", "", "West Oaks Mall-West, Ocoee, FL 34761"];
      const event = buildEventFromSheetRow(row, okConfig, "https://example.com", "2026-05-15");
      expect(event!.location).toBeUndefined();
      expect(event!.locationStreet).toBe("West Oaks Mall-West, Ocoee, FL 34761");
      // googleMapsSearchUrl percent-encodes the query, so spaces → %20.
      expect(event!.locationUrl).toContain("West%20Oaks%20Mall-West");
    });

    it("both populated → both flow through, locationUrl combines them", () => {
      const row = ["54", "5/29/26", "Whip It Out", "Orlando", "123 Lake Eola Dr"];
      const event = buildEventFromSheetRow(row, okConfig, "https://example.com", "2026-05-29");
      expect(event!.location).toBe("Orlando");
      expect(event!.locationStreet).toBe("123 Lake Eola Dr");
      // Maps query joins venue + street ("Orlando, 123 Lake Eola Dr") and
      // googleMapsSearchUrl percent-encodes ", " → "%2C%20".
      expect(event!.locationUrl).toContain("Orlando%2C%20123%20Lake%20Eola%20Dr");
    });

    it("both blank → both undefined, no maps URL", () => {
      const row = ["55", "6/5/26", "Hare", "", ""];
      const event = buildEventFromSheetRow(row, okConfig, "https://example.com", "2026-06-05");
      expect(event!.location).toBeUndefined();
      expect(event!.locationStreet).toBeUndefined();
      expect(event!.locationUrl).toBeUndefined();
    });

    it("address column strips TBD/TBA placeholders", () => {
      const row = ["56", "6/12/26", "Hare", "Orlando", "TBD"];
      const event = buildEventFromSheetRow(row, okConfig, "https://example.com", "2026-06-12");
      expect(event!.location).toBe("Orlando");
      expect(event!.locationStreet).toBeUndefined();
    });
  });

  it("applies defaultTitle with run number when title is placeholder", () => {
    const config = { ...baseConfig, defaultTitle: "Wild & Wonderful Wednesday Trail" };
    const row = ["42", "3/11/26", "Alice", "Park", "TBD"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Wild & Wonderful Wednesday Trail #42");
  });

  it("applies bare defaultTitle when no run number", () => {
    // This config uses a specialRunMap that produces no runNumber
    const config = {
      ...baseConfig,
      columns: { ...baseConfig.columns, specialRun: 5 },
      kennelTagRules: { default: "W3H3", specialRunMap: { "special": "W3H3" } },
      defaultTitle: "Wednesday Trail",
    };
    const row = ["", "3/11/26", "", "", "tbd", "special"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Wednesday Trail");
  });

  it("explicit title overrides defaultTitle", () => {
    const config = { ...baseConfig, defaultTitle: "Fallback Title" };
    const row = ["100", "3/11/26", "Alice", "Park", "Halloween Hash"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Halloween Hash");
  });

  it("uses defaultTitle when title column is not configured", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3 },
      kennelTagRules: { default: "MH3" },
      defaultTitle: "MH3",
    };
    const row = ["932", "2026-04-01", "Some Hare", "Munich"];
    const result = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-04-01");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("MH3 #932");
  });

  it("keeps row + falls back to bare defaultTitle when runNumber column is configured but cell is empty (#1625)", () => {
    // Pre-#1625: resolveKennelTagFromSheetRow returned null on empty `#`
    // cells when columns.runNumber was configured, dropping legitimate
    // unnumbered events (MASS H3 5th Birthday #1639, MFMH3 #1657). Post-fix:
    // row is kept with runNumber=undefined; defaultTitle renders without a
    // run-number suffix.
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3 },
      kennelTagRules: { default: "MH3" },
      defaultTitle: "MH3",
    };
    const row = ["", "2026-04-01", "Some Hare", "Munich"];
    const result = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-04-01");
    expect(result).not.toBeNull();
    expect(result!.runNumber).toBeUndefined();
    expect(result!.title).toBe("MH3");
    expect(result!.kennelTags).toEqual(["MH3"]);
  });

  it("keeps row + emits runNumber: undefined when runNumber column is configured but cell is empty (#1625, no defaultTitle)", () => {
    // Same fall-through path as above, but without a defaultTitle.
    // Row still ingests; title stays undefined.
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3 },
      kennelTagRules: { default: "massh3" },
    };
    const row = ["", "6/27/26", "Poor me, water!", "Höllriegelskreuth"];
    const event = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-06-27");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBeUndefined();
    expect(event!.kennelTags).toEqual(["massh3"]);
    expect(event!.hares).toBe("Poor me, water!");
    expect(event!.location).toBe("Höllriegelskreuth");
  });

  it("keeps row + emits runNumber: undefined when runNumber cell is non-numeric (#1625)", () => {
    // Non-numeric cells (e.g. notes, placeholder dashes) take the same
    // fall-through path as empty cells.
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3 },
      kennelTagRules: { default: "test-h3" },
    };
    const row = ["-", "2026-04-01", "Some Hare", "Park"];
    const event = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-04-01");
    expect(event).not.toBeNull();
    expect(event!.runNumber).toBeUndefined();
  });

  // ── extraHares (multi-column hare merging — KH3 Hare1/Hare2 layout) ──

  it("merges extraHares column into hares when both populated", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, extraHares: [3], location: 4, title: 5 },
      kennelTagRules: { default: "kh3" },
    };
    const row = ["100", "3/11/26", "ONE HUNG LO", "LASTMAN", "Kwai Fong", ""];
    const event = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    // Sorted alphabetically for fingerprint stability
    expect(event!.hares).toBe("LASTMAN / ONE HUNG LO");
  });

  it("uses primary hare alone when extraHares cell is empty", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, extraHares: [3], location: 4, title: 5 },
      kennelTagRules: { default: "kh3" },
    };
    const row = ["101", "3/18/26", "TIMBITS", "", "", ""];
    const event = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-03-18");
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("TIMBITS");
  });

  it("returns undefined hares when both primary and extra cells empty", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, extraHares: [3], location: 4, title: 5 },
      kennelTagRules: { default: "kh3" },
    };
    const row = ["102", "3/25/26", "", "", "", ""];
    const event = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-03-25");
    expect(event).not.toBeNull();
    expect(event!.hares).toBeUndefined();
  });

  it("strips placeholder values from extraHares cells", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, extraHares: [3], location: 4, title: 5 },
      kennelTagRules: { default: "kh3" },
    };
    const row = ["103", "4/1/26", "TIMBITS", "TBD", "", ""];
    const event = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-04-01");
    expect(event).not.toBeNull();
    expect(event!.hares).toBe("TIMBITS");
  });

  it.each([
    ["Bring a dry bag", undefined, "rejects instruction verb 'bring'"],
    ["Check the website for details", undefined, "rejects instruction verb 'check'"],
    ["Halloween Hash", "Halloween Hash", "keeps legitimate title"],
  ])("instruction-title guard: %s → %s (%s)", (titleInput, expected, _desc) => {
    const row = ["100", "3/11/26", "Alice", "Park", titleInput];
    const event = buildEventFromSheetRow(row, baseConfig, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    if (expected === undefined) {
      expect(event!.title).toBeUndefined();
    } else {
      expect(event!.title).toBe(expected);
    }
  });

  it("falls back to defaultTitle when instruction-like title is rejected", () => {
    const config = { ...baseConfig, defaultTitle: "Summit" };
    const row = ["2413", "3/11/26", "Alice", "Liberty Tavern", "Bring a dry bag"];
    const event = buildEventFromSheetRow(row, config, "https://example.com", "2026-03-11");
    expect(event).not.toBeNull();
    expect(event!.title).toBe("Summit #2413");
  });

  it("title is undefined when column not configured and no defaultTitle", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3 },
      kennelTagRules: { default: "TestH3" },
    };
    const row = ["100", "2026-04-01", "Some Hare", "Park"];
    const result = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-04-01");
    expect(result).not.toBeNull();
    expect(result!.title).toBeUndefined();
  });
});

// ── GoogleSheetsAdapter integration tests (skipRows, gid, csvUrl) ──

function makeSource(overrides?: Partial<Source>): Source {
  return {
    id: "src-sheets",
    name: "Test Sheet",
    url: "https://docs.google.com/spreadsheets/d/test-sheet",
    type: "GOOGLE_SHEETS",
    trustLevel: 5,
    scrapeFreq: "weekly",
    scrapeDays: 90,
    config: null,
    isActive: true,
    lastScrapeAt: null,
    lastScrapeStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    lastStructureHash: null,
    ...overrides,
  } as Source;
}

function mockFetchResponse(body: string, ok = true, status = 200) {
  return {
    ok,
    status,
    statusText: ok ? "OK" : "Error",
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    headers: new Headers(),
  } as Response;
}

// Today-relative date string for test rows that land within the ±90 day window
const todayParts = new Date().toISOString().slice(0, 10).split("-");
const testDateMDY = `${Number(todayParts[1])}/${Number(todayParts[2])}/${todayParts[0]}`;

const sheetConfig = {
  sheetId: "abc123",
  columns: { runNumber: 0, date: 1, hares: 2, location: 3, title: 4 },
  kennelTagRules: { default: "TestH3" },
};

describe("GoogleSheetsAdapter.fetch — skipRows", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "test-key");
    mockedSafeFetch.mockReset();
  });

  it("skips title rows before the header row", async () => {
    // CSV has 1 title row, then header, then data
    const csv = [
      "My Kennel Title Row,,,",
      "Run#,Date,Hares,Location,Title",
      `100,${testDateMDY},Alice,Central Park,Fun Run`,
    ].join("\n");

    // Tab discovery returns one tab
    mockedSafeFetch
      .mockResolvedValueOnce(mockFetchResponse(
        JSON.stringify({ sheets: [{ properties: { title: "2026" } }] }),
      ))
      .mockResolvedValueOnce(mockFetchResponse(csv));

    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: { ...sheetConfig, skipRows: 1 } as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBe(1);
    expect(result.events[0].kennelTags[0]).toBe("TestH3");
    expect(result.events[0].runNumber).toBe(100);
    expect(result.events[0].title).toBe("Fun Run");
  });

  it("works without skipRows (backward compat)", async () => {
    const csv = [
      "Run#,Date,Hares,Location,Title",
      `100,${testDateMDY},Alice,Central Park,Fun Run`,
    ].join("\n");

    mockedSafeFetch
      .mockResolvedValueOnce(mockFetchResponse(
        JSON.stringify({ sheets: [{ properties: { title: "2026" } }] }),
      ))
      .mockResolvedValueOnce(mockFetchResponse(csv));

    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: sheetConfig as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe("Fun Run");
  });
});

describe("GoogleSheetsAdapter.fetch — gid", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "test-key");
    mockedSafeFetch.mockReset();
  });

  it("uses export?format=csv&gid=X URL and skips tab discovery", async () => {
    const csv = [
      "Run#,Date,Hares,Location,Title",
      `200,${testDateMDY},Bob,Pike Place,Rain Run`,
    ].join("\n");

    // Only one fetch — the CSV. No Sheets API call for tab discovery.
    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: { ...sheetConfig, gid: 12345 } as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe("Rain Run");

    // Verify the URL used
    const fetchedUrl = mockedSafeFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toBe(
      "https://docs.google.com/spreadsheets/d/abc123/export?format=csv&gid=12345",
    );
    // Only 1 fetch call (no Sheets API tab discovery)
    expect(mockedSafeFetch).toHaveBeenCalledTimes(1);
  });

  it("combines gid with skipRows", async () => {
    const csv = [
      "Title banner row,,,,",
      "Run#,Date,Hares,Location,Title",
      `300,${testDateMDY},Carol,Rainier,Mountain Hash`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: { ...sheetConfig, gid: 99, skipRows: 1 } as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe("Mountain Hash");
  });
});

describe("GoogleSheetsAdapter.fetch — csvUrl", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "test-key");
    mockedSafeFetch.mockReset();
  });

  it("fetches from csvUrl directly and skips tab discovery", async () => {
    const csv = [
      "Run#,Date,Hares,Location,Title",
      `400,${testDateMDY},Dave,Capitol Hill,Pub Crawl`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const csvUrl = "https://docs.google.com/spreadsheets/d/e/XXXXX/pub?output=csv";
    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: { ...sheetConfig, csvUrl } as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe("Pub Crawl");
    expect(result.events[0].kennelTags[0]).toBe("TestH3");

    // Verify it fetched from the csvUrl directly
    const fetchedUrl = mockedSafeFetch.mock.calls[0][0] as string;
    expect(fetchedUrl).toBe(csvUrl);
    // Only 1 fetch call (direct CSV, no tab discovery)
    expect(mockedSafeFetch).toHaveBeenCalledTimes(1);

    // diagnosticContext should include csvUrl
    expect(result.diagnosticContext).toEqual({ csvUrl });
  });

  it("combines csvUrl with skipRows", async () => {
    const csv = [
      "Banner row,,,,",
      "Notes row,,,,",
      "Run#,Date,Hares,Location,Title",
      `500,${testDateMDY},Eve,Fremont,Trail Run`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const csvUrl = "https://example.com/pub?output=csv";
    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: { ...sheetConfig, csvUrl, skipRows: 2 } as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events.length).toBe(1);
    expect(result.events[0].title).toBe("Trail Run");
    expect(result.events[0].runNumber).toBe(500);
  });

  it("returns error when csvUrl fetch fails", async () => {
    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse("", false, 403));

    const csvUrl = "https://example.com/pub?output=csv";
    const adapter = new GoogleSheetsAdapter();
    const source = makeSource({
      config: { ...sheetConfig, csvUrl } as unknown as null,
    });
    const result = await adapter.fetch(source);

    expect(result.events).toEqual([]);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain("403");
  });
});

// ── #1542 group_filter: shared multi-kennel sheets ──

describe("normalizeGroupFilter (#1542)", () => {
  it("returns null when filter is undefined", () => {
    expect(normalizeGroupFilter(undefined)).toBeNull();
  });

  it("returns null when filter is an empty array", () => {
    expect(normalizeGroupFilter([])).toBeNull();
  });

  it("returns null when filter contains only blank strings", () => {
    expect(normalizeGroupFilter(["", "   "])).toBeNull();
  });

  it("wraps a bare string into a single-item lowercased set", () => {
    const set = normalizeGroupFilter("MH3");
    expect(set).not.toBeNull();
    expect(set?.has("mh3")).toBe(true);
    expect(set?.size).toBe(1);
  });

  it("accepts multi-value arrays and trims/lowercases each", () => {
    const set = normalizeGroupFilter([" MH3 ", "Mfmh3"]);
    expect(set?.size).toBe(2);
    expect(set?.has("mh3")).toBe(true);
    expect(set?.has("mfmh3")).toBe(true);
  });
});

describe("tokenizeGroupCell (#1542)", () => {
  it("returns [] for undefined / empty / whitespace cells", () => {
    expect(tokenizeGroupCell(undefined)).toEqual([]);
    expect(tokenizeGroupCell("")).toEqual([]);
    expect(tokenizeGroupCell("   ")).toEqual([]);
  });

  it("returns a single lowercased token for a plain value", () => {
    expect(tokenizeGroupCell("MH3")).toEqual(["mh3"]);
    expect(tokenizeGroupCell("  Mfmh3 ")).toEqual(["mfmh3"]);
  });

  it("splits multi-value cells on /, comma, semicolon", () => {
    expect(tokenizeGroupCell("MH3 / BNH")).toEqual(["mh3", "bnh"]);
    expect(tokenizeGroupCell("MH3,MFMH3")).toEqual(["mh3", "mfmh3"]);
    expect(tokenizeGroupCell("MH3; BNH; Hashathon")).toEqual(["mh3", "bnh", "hashathon"]);
  });

  it("does NOT substring-match (MH3FAKE stays MH3FAKE, not MH3)", () => {
    expect(tokenizeGroupCell("MH3FAKE")).toEqual(["mh3fake"]);
  });
});

describe("cellMatchesFilter (#1592)", () => {
  const mh3 = new Set(["mh3"]);

  it.each([
    // Cycle-10 #1542 token-equality cases (must keep working)
    ["MH3", true, "bare token"],
    ["mh3", true, "lowercased"],
    ["  MH3 ", true, "whitespace-padded"],
    ["MH3 / BNH", true, "co-host via /-split"],
    ["MH3,MFMH3", true, "comma-split keeps host"],
    ["MH3; BNH; Hashathon", true, "semicolon-split keeps host"],
    ["MH3/ Hashathon", true, "slash-split with trailing label"],
    ["BNH / MH3", true, "host listed second via token-equality"],
    ["BNH / MH3 - Birthday", true, "host-prefix sub-label in second token"],
    ["MASS H3, MH3 Spec", true, "comma-split with host-prefix in second token"],
    // #1592 host-prefix relaxation
    ["MH3 Spec", true, "space-separated sub-label"],
    ["MH3 - Birthday", true, "hyphen-delimited sub-label"],
    ["MH3 (Hashathon)", true, "paren-delimited sub-label"],
    ["MH3: Anniversary", true, "colon-delimited sub-label"],
    ["MH3.5", true, "period-delimited sub-label"],
    // Cycle-10 rejection guarantees (must STILL reject after the relaxation)
    ["MH3FAKE", false, "substring no-match (next char ASCII letter)"],
    ["MH3event", false, "ASCII letter continuation"],
    ["MH3α", false, String.raw`Greek-letter continuation (Unicode \p{L})`],
    ["MH3Ａvent", false, "fullwidth ASCII continuation"],
    ["MH3٨", false, String.raw`Arabic-Indic digit continuation (Unicode \p{N})`],
    ["MH3́FAKE", false, String.raw`combining-acute continuation (Unicode \p{M})`],
    ["MH3‍Birthday", false, String.raw`zero-width joiner continuation (Unicode \p{Cf})`],
    ["MH3_v2", false, "underscore continuation"],
    ["MFMH3", false, "sibling kennel (different prefix)"],
    ["MASS H3", false, "sibling kennel"],
    ["BNH", false, "deferred per #1542"],
    ["", false, "empty cell"],
    ["   ", false, "whitespace-only cell"],
  ])("filter \"mh3\" on cell %j → %s (%s)", (cell, expected) => {
    expect(cellMatchesFilter(cell, mh3)).toBe(expected);
  });

  it("supports multi-value filter sets (host + co-host)", () => {
    const set = new Set(["mh3", "bnh"]);
    expect(cellMatchesFilter("BNH", set)).toBe(true);
    expect(cellMatchesFilter("BNH - co-host", set)).toBe(true);
    expect(cellMatchesFilter("MASS H3", set)).toBe(false);
  });

  it("multi-token filter values (e.g. \"MASS H3\") still match exactly", () => {
    const set = new Set(["mass h3"]);
    expect(cellMatchesFilter("MASS H3", set)).toBe(true);
    expect(cellMatchesFilter("MASS H3 / Special", set)).toBe(true);
    expect(cellMatchesFilter("MASS H3 - 5th Birthday", set)).toBe(true);
    expect(cellMatchesFilter("MASSH3", set)).toBe(false); // no space → no prefix match
    expect(cellMatchesFilter("MH3", set)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(cellMatchesFilter(undefined, mh3)).toBe(false);
  });
});

describe("extractEventLabelFromCell (#1624)", () => {
  const mh3 = new Set(["mh3"]);

  it.each([
    // Whole-token equality → no label (the cell IS the host kennel, nothing trailing)
    ["MH3", undefined, "whole-token equality"],
    ["mh3", undefined, "lowercased whole-token equality"],
    ["  MH3 ", undefined, "padded whole-token equality"],
    // Host-prefix mode with separators
    ["MH3 - Birthday", "Birthday", "hyphen separator preserves casing"],
    ["MH3 — Bayern Nash Hash", "Bayern Nash Hash", "em-dash separator"],
    ["MH3 – Pink Moon", "Pink Moon", "en-dash separator"],
    ["MH3: Anniversary", "Anniversary", "colon separator"],
    ["MH3 Spec", "Spec", "space-only separator"],
    ["MH3 | Spec", "Spec", "pipe separator"],
    // Co-host cells — label sits on the matched token, not the co-host one
    ["BNH / MH3 - Birthday", "Birthday", "co-host first, host-prefix second"],
    ["MASS H3, MH3 Spec", "Spec", "comma-split co-host with host-prefix in second token"],
    // Cells that should not produce a label
    ["MH3 / BNH", undefined, "co-host on the other side, no trailing label"],
    ["MH3,MFMH3", undefined, "comma-split without trailing label"],
    ["MFMH3", undefined, "sibling kennel that doesn't match the filter"],
    ["MH3FAKE", undefined, "substring no-match continuation"],
    ["", undefined, "empty cell"],
    ["   ", undefined, "whitespace-only cell"],
  ])("filter \"mh3\" on cell %j → %s (%s)", (cell, expected, _label) => {
    expect(extractEventLabelFromCell(cell, mh3)).toBe(expected);
  });

  it("returns undefined for an undefined cell", () => {
    expect(extractEventLabelFromCell(undefined, mh3)).toBeUndefined();
  });

  it("preserves trailing whitespace handling (trimmed both sides)", () => {
    expect(extractEventLabelFromCell("MH3 -   Pink Moon   ", mh3)).toBe("Pink Moon");
  });

  it("returns undefined when the trailing portion is empty after stripping the separator", () => {
    expect(extractEventLabelFromCell("MH3 - ", mh3)).toBeUndefined();
  });
});

describe("GoogleSheetsAdapter.fetch — groupFilter (#1542)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "test-key");
    mockedSafeFetch.mockReset();
  });

  it("keeps only rows whose Group cell matches groupFilter", async () => {
    // Mirrors the Munich H3 sheet layout: # | Date | Group | Start | Hares | Location | Notes
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Half Monty,Englischer Garten,MH3 trail`,
      `27,${testDateMDY},MASS H3,15:00,Bushy G,Munich,MASS H3 trail (sibling)`,
      `264,${testDateMDY},MFMH3,21:00,Moose Diver,Olympic Park,Full Moon (sibling)`,
      `,${testDateMDY},BNH,12:00,Various,Region,Joint Bayern Nash`,
      `931,${testDateMDY},MH3,17:00,Banana Beater,Marienplatz,MH3 trail`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
    expect(result.events.map((e) => e.runNumber)).toEqual([930, 931]);
    expect(result.events.every((e) => e.kennelTags[0] === "mh3-de")).toBe(true);
  });

  it("#1784 emits BOTH same-day MH3 runs (incl. 'MH3/ Hashathon' co-host) with distinct run numbers, skips siblings + date typos", async () => {
    // Reproduces the live Munich sheet on the Jun-20 double-header day: a
    // Munich-area MH3 run (#938) AND the Hashathon co-host run (#939, Group
    // "MH3/ Hashathon") share one date. The tokenizer routes the co-host cell
    // to mh3-de, so the adapter emits BOTH with distinct run numbers; WS1's
    // merge same-day double-header support keeps them as two canonical events.
    // The MFMH3 sibling is filtered out, and a date-typo row (18-Jul-02 →
    // year 2002, far past) is dropped rather than producing a phantom.
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `938,${testDateMDY},MH3,17:00,Loose Nutz & Motörmouth,,Munich-area trail`,
      `939,${testDateMDY},MH3/ Hashathon,,Muddy Rucker,Gerlaser Forsthaus,Hashathon Weekend`,
      `264,${testDateMDY},MFMH3,19:00,Moose Diver,Olympic Park,Full Moon sibling`,
      `941,18-Jul-02,MH3,17:00,,,date typo → far past`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    // Both Jun-20 MH3 runs survive with distinct run numbers; sibling + typo dropped.
    expect(result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([938, 939]);
    expect(result.events.every((e) => e.kennelTags[0] === "mh3-de")).toBe(true);
    expect(result.events.every((e) => e.date === result.events[0].date)).toBe(true);
  });

  it("#1624 emits eventLabel: null on whole-token match so a stale prefix label clears (Codex review)", async () => {
    // A row that previously read "MH3 - Birthday" leaves a label on the
    // canonical Event. If the source reverts to plain "MH3", the adapter
    // OWNS the field for filtered rows and must explicit-clear the stale
    // label. extractEventLabelFromCell returns undefined on whole-token
    // equality, but processRows converts it to null so the merge pipeline
    // writes `eventLabel = null` rather than preserving the old badge.
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Half Monty,Englischer Garten,plain host`,
      `931,${testDateMDY},MH3- Birthday,17:00,Banana Beater,Marienplatz,labeled`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events).toHaveLength(2);
    const byRun = new Map(result.events.map((e) => [e.runNumber, e.eventLabel]));
    expect(byRun.get(930)).toBeNull(); // whole-token match → explicit clear
    expect(byRun.get(931)).toBe("Birthday"); // host-prefix match → label
  });

  it("matches case-insensitively after trimming whitespace", async () => {
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY}, mh3 ,15:00,Half Monty,Englischer Garten,trimmed`,
      `931,${testDateMDY},Mh3,17:00,Banana Beater,Marienplatz,mixed case`,
      `27,${testDateMDY},MASS H3,15:00,Bushy G,Munich,sibling`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
    expect(result.events.map((e) => e.runNumber)).toEqual([930, 931]);
  });

  it("skips rows with an empty Group cell when groupFilter is configured", async () => {
    // An unlabeled row is ambiguous — preserve the kennel's run list integrity
    // rather than risk a silent cross-kennel leak (#1542).
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Half Monty,Munich,kept`,
      `931,${testDateMDY},,17:00,Mystery,Unknown,dropped`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(1);
    expect(result.events[0].runNumber).toBe(930);
  });

  it("supports multi-value filter (host kennel + co-host alias)", async () => {
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Half Monty,Munich,host`,
      `940,${testDateMDY},BNH,12:00,Various,Region,co-host (MH3 hosting)`,
      `27,${testDateMDY},MASS H3,15:00,Bushy G,Munich,sibling`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: ["MH3", "BNH"],
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
    expect(result.events.map((e) => e.runNumber)).toEqual([930, 940]);
  });

  it("keeps multi-value cells when one token matches (MH3 / Hashathon)", async () => {
    // Live Munich sheet has rows like "MH3/ Hashathon" — those are real MH3
    // events with a co-host annotation, not sibling-kennel rows.
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `939,${testDateMDY},MH3/ Hashathon,15:00,BirdBrian,Bavaria,host annotation`,
      `940,${testDateMDY},MH3 / BNH,12:00,Various,Munich,joint trail`,
      `27,${testDateMDY},MASS H3,15:00,Bushy G,Munich,sibling only — drop`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
    expect(result.events.map((e) => e.runNumber)).toEqual([939, 940]);
  });

  it("MFMH3 sibling config: no runNumber column captures all rows (#1591)", async () => {
    // Path B sibling onboarding: the shared Munich sheet has 1 MFMH3 row
    // with an explicit run number (#264) and ~12 with empty # cells. This
    // test covers the legacy "drop columns.runNumber entirely" config
    // shape; #1625 + #1657 fix the resolver so the seed config now sets
    // `columns.runNumber: 0` again — see "MFMH3 with runNumber column"
    // test below for the post-fix shape that captures #264.
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `,${testDateMDY},MFMH3,19:00,Cumming Numb,Nomannenplatz,(empty # — kept)`,
      `264,${testDateMDY},MFMH3,19:00,Moose Diver,Hundingstr.,Pink Moon — # ignored`,
      `930,${testDateMDY},MH3,15:00,Half Monty,Munich,sibling host — must drop`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MFMH3",
      kennelTagRules: { default: "mfmh3" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
    expect(result.events.every((e) => e.kennelTags[0] === "mfmh3")).toBe(true);
    expect(result.events.every((e) => e.runNumber === undefined)).toBe(true);
  });

  it("MFMH3 with runNumber column captures #264 AND keeps empty-# rows (#1657, #1625)", async () => {
    // Post-#1625 fix: configuring columns.runNumber: 0 alongside groupFilter
    // captures the one numbered MFMH3 row (#264 Pink Moon) without dropping
    // the unnumbered rows. This mirrors the real seed config shape and
    // simultaneously closes #1657 (lost runNumber) and unblocks the
    // analogous #1639 (MASS H3 5th Birthday) ingestion path.
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `,${testDateMDY},MFMH3,19:00,Cumming Numb,Nomannenplatz,(empty # — kept)`,
      `264,${testDateMDY},MFMH3,19:00,Moose Diver,Hundingstr. 8,Pink Moon`,
      `930,${testDateMDY},MH3,15:00,Half Monty,Munich,sibling host — must drop`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MFMH3",
      kennelTagRules: { default: "mfmh3" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
    expect(result.events.every((e) => e.kennelTags[0] === "mfmh3")).toBe(true);
    const runNumbers = result.events.map((e) => e.runNumber);
    expect(runNumbers).toContain(264);
    expect(runNumbers).toContain(undefined);
  });

  it("keeps host-prefix cells without a /-separator (#1592)", async () => {
    // The cycle-10 token-equality matcher dropped cells like "MH3 - Birthday"
    // because the whole-token check sees them as a single unknown token.
    // #1592 relaxes this: filter token as a prefix + non-alphanumeric next
    // char keeps the row attributed to the host kennel.
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Half Monty,Munich,plain host`,
      `931,${testDateMDY},MH3 - Birthday,15:00,Anal Weiss,Munich,host with sub-label`,
      `932,${testDateMDY},MH3 Spec,17:00,Birdbrian,Munich,host with sub-label`,
      `933,${testDateMDY},MFMH3,21:00,Moose Diver,Olympic Park,sibling — must still drop`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(3);
    expect(result.events.map((e) => e.runNumber)).toEqual([930, 931, 932]);
  });

  it("fails fast when groupFilter is set but columns.group is missing", async () => {
    // Silent skip on this misconfig would re-introduce sibling-kennel
    // conflation. The adapter must surface it as an error instead.
    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, hares: 4, location: 5, description: 6, startTime: 3 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events).toEqual([]);
    expect(result.errors[0]).toContain("groupFilter configured without columns.group");
    // No CSV fetch should have occurred — we reject before hitting the network.
    expect(mockedSafeFetch).not.toHaveBeenCalled();
  });

  it("backwards-compatible: no groupFilter → existing behavior unchanged", async () => {
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Half Monty,Munich,row1`,
      `27,${testDateMDY},MASS H3,15:00,Bushy G,Munich,row2`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      // no groupFilter — all rows pass through
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.length).toBe(2);
  });
});

// ── #1844 ampersand-safe regression guardrails ──
// An audit claimed OKissMe rows whose Theme contains "&" were dropped. They
// are NOT: the hand-rolled CSV parser treats "&" as a literal character and
// never HTML-decodes or splits on it. These fixtures pin that behavior so a
// future parser change can't regress it, and confirm a "&"-bearing row still
// routes correctly under a Munich-style groupFilter.
describe("GoogleSheetsAdapter.fetch — ampersand themes are not dropped (#1844)", () => {
  beforeEach(() => {
    vi.stubEnv("GOOGLE_CALENDAR_API_KEY", "test-key");
    mockedSafeFetch.mockReset();
  });

  it("ingests an OKissMe-shaped row whose Theme contains '&' with the verbatim title", async () => {
    // OKissMe layout: Number,Date,Time,Location,Address,Primary Hare,Other Hare,Theme
    const csv = [
      "Number,Date,Time,Location,Address,Primary Hare,Other Hare,Theme",
      `51,${testDateMDY},11:00 AM,Orlando,,Eat A Puss,,Birthday Girls & Ides of March - Toga Hash`,
      `52,${testDateMDY},11:00 AM,Orlando,,Slip,,No ampersand here`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "okissme",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, location: 3, address: 4, hares: 5, title: 7 },
      kennelTagRules: { default: "okissme-h3" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    // The ampersand row is NOT dropped; both rows ingest.
    expect(result.events.map((e) => e.runNumber).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([51, 52]);
    const run51 = result.events.find((e) => e.runNumber === 51);
    expect(run51!.title).toBe("Birthday Girls & Ides of March - Toga Hash");
  });

  it("keeps a '&'-bearing MH3 row under groupFilter and still drops the sibling kennel", async () => {
    // The ampersand sits in both the routing-relevant fields (hares + notes)
    // of a filtered MH3 row. tokenizeGroupCell/cellMatchesFilter route on the
    // Group cell only, so the "&" is irrelevant to routing — the MH3 row stays
    // and the MASS H3 sibling is still filtered out (no PR #1623 regression).
    const csv = [
      "#,Date,Group,Start time,Hared by,Location,Notes",
      `930,${testDateMDY},MH3,15:00,Loose Nutz & Motörmouth,Englischer Garten,Beer & Pretzels trail`,
      `27,${testDateMDY},MASS H3,15:00,Bushy G,Munich,MASS H3 sibling`,
    ].join("\n");

    mockedSafeFetch.mockResolvedValueOnce(mockFetchResponse(csv));

    const config: GoogleSheetsConfig = {
      sheetId: "munich",
      csvUrl: "https://example.com/pub?output=csv",
      columns: { runNumber: 0, date: 1, group: 2, startTime: 3, hares: 4, location: 5, description: 6 },
      groupFilter: "MH3",
      kennelTagRules: { default: "mh3-de" },
    };
    const adapter = new GoogleSheetsAdapter();
    const result = await adapter.fetch(makeSource({ config: config as unknown as null }));

    expect(result.events.map((e) => e.runNumber)).toEqual([930]);
    expect(result.events[0].hares).toBe("Loose Nutz & Motörmouth");
    expect(result.events[0].description).toBe("Beer & Pretzels trail");
    expect(result.events[0].kennelTags[0]).toBe("mh3-de");
  });
});
