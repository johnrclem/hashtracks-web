import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Source } from "@/generated/prisma/client";
import { parseDate, inferStartTime, parseCSV, buildEventFromSheetRow, parseSheetStartTimeCell, GoogleSheetsAdapter } from "./adapter";
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

  it("uses defaultTitle without run number when both are empty", () => {
    const config = {
      sheetId: "test",
      columns: { runNumber: 0, date: 1, hares: 2, location: 3 },
      kennelTagRules: { default: "MH3" },
      defaultTitle: "MH3",
    };
    const row = ["", "2026-04-01", "Some Hare", "Munich"];
    const result = buildEventFromSheetRow(row, config as GoogleSheetsConfig, "https://example.com", "2026-04-01");
    expect(result).toBeNull();
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
