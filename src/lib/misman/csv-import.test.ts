import { describe, it, expect } from "vitest";
import {
  parseAttendanceCSV,
  parseCellValue,
  matchHasherNames,
  matchColumnHeaders,
  buildImportRecords,
  DEFAULT_CELL_MARKERS,
  type RosterEntry,
  type EventLookup,
  type HasherMatch,
  type EventMatch,
} from "./csv-import";

describe("parseAttendanceCSV", () => {
  it("parses matrix format correctly", () => {
    const csv = `Name,1/15/26,1/22/26
Mudflap,X,P
Trail Blazer,,X`;

    const result = parseAttendanceCSV(csv, {
      nameColumn: 0,
      dataStartColumn: 1,
      headerRow: 0,
      dataStartRow: 1,
    });

    expect(result.headers).toEqual(["1/15/26", "1/22/26"]);
    expect(result.hasherNames).toEqual(["Mudflap", "Trail Blazer"]);
    expect(result.dataRows).toHaveLength(2);
    expect(result.dataRows[0].name).toBe("Mudflap");
    expect(result.dataRows[0].cells).toEqual(["X", "P"]);
    expect(result.dataRows[1].cells).toEqual(["", "X"]);
  });

  it("handles quoted CSV fields", () => {
    const csv = `Name,Date
"Mud, Flap",X`;

    const result = parseAttendanceCSV(csv, {
      nameColumn: 0,
      dataStartColumn: 1,
      headerRow: 0,
      dataStartRow: 1,
    });

    expect(result.hasherNames).toEqual(["Mud, Flap"]);
  });

  it("skips empty name rows", () => {
    const csv = `Name,1/15/26
Mudflap,X
,
Trail Blazer,X`;

    const result = parseAttendanceCSV(csv, {
      nameColumn: 0,
      dataStartColumn: 1,
      headerRow: 0,
      dataStartRow: 1,
    });

    expect(result.hasherNames).toEqual(["Mudflap", "Trail Blazer"]);
  });

  it("returns empty for empty CSV", () => {
    const result = parseAttendanceCSV("", {
      nameColumn: 0,
      dataStartColumn: 1,
      headerRow: 0,
      dataStartRow: 1,
    });

    expect(result.headers).toEqual([]);
    expect(result.hasherNames).toEqual([]);
  });
});

describe("parseCellValue", () => {
  const markers = DEFAULT_CELL_MARKERS;

  it("recognizes attendance markers", () => {
    expect(parseCellValue("X", markers)).toEqual({ attended: true, paid: false, hared: false });
    expect(parseCellValue("x", markers)).toEqual({ attended: true, paid: false, hared: false });
    expect(parseCellValue("1", markers)).toEqual({ attended: true, paid: false, hared: false });
    expect(parseCellValue("Y", markers)).toEqual({ attended: true, paid: false, hared: false });
  });

  it("recognizes paid markers", () => {
    expect(parseCellValue("P", markers)).toEqual({ attended: true, paid: true, hared: false });
    expect(parseCellValue("$", markers)).toEqual({ attended: true, paid: true, hared: false });
  });

  it("recognizes hare markers", () => {
    expect(parseCellValue("H", markers)).toEqual({ attended: true, paid: false, hared: true });
    expect(parseCellValue("h", markers)).toEqual({ attended: true, paid: false, hared: true });
  });

  it("returns false for empty cells", () => {
    expect(parseCellValue("", markers)).toEqual({ attended: false, paid: false, hared: false });
    expect(parseCellValue("  ", markers)).toEqual({ attended: false, paid: false, hared: false });
  });

  it("returns false for unrecognized values", () => {
    expect(parseCellValue("maybe", markers)).toEqual({ attended: false, paid: false, hared: false });
  });
});

describe("matchHasherNames", () => {
  const roster: RosterEntry[] = [
    { id: "kh_1", hashName: "Mudflap", nerdName: "John Doe" },
    { id: "kh_2", hashName: "Trail Blazer", nerdName: "Jane Smith" },
    { id: "kh_3", hashName: null, nerdName: "Bob Jones" },
  ];

  it("matches exactly on hashName (case-insensitive)", () => {
    const result = matchHasherNames(["mudflap"], roster, 0.85);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].kennelHasherId).toBe("kh_1");
    expect(result.matched[0].matchType).toBe("exact");
    expect(result.unmatched).toHaveLength(0);
  });

  it("matches exactly on nerdName", () => {
    const result = matchHasherNames(["Bob Jones"], roster, 0.85);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].kennelHasherId).toBe("kh_3");
  });

  it("fuzzy matches above threshold", () => {
    const result = matchHasherNames(["Mud Flap"], roster, 0.7);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].matchType).toBe("fuzzy");
    expect(result.matched[0].matchScore).toBeGreaterThanOrEqual(0.7);
  });

  it("reports unmatched hashers below threshold", () => {
    const result = matchHasherNames(["Completely Unknown"], roster, 0.85);
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toEqual(["Completely Unknown"]);
  });
});

describe("matchColumnHeaders", () => {
  const events: EventLookup[] = [
    { id: "ev_1", date: new Date("2026-01-15T12:00:00Z"), runNumber: 2100, kennelId: "k1" },
    { id: "ev_2", date: new Date("2026-01-22T12:00:00Z"), runNumber: 2101, kennelId: "k1" },
  ];

  it("matches column headers as dates", () => {
    const result = matchColumnHeaders(["1/15/26", "1/22/26"], events, 1);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0].eventId).toBe("ev_1");
    expect(result.matched[1].eventId).toBe("ev_2");
  });

  it("matches column headers as run numbers", () => {
    const result = matchColumnHeaders(["#2100", "2101"], events, 1);
    expect(result.matched).toHaveLength(2);
    expect(result.matched[0].eventId).toBe("ev_1");
    expect(result.matched[1].eventId).toBe("ev_2");
  });

  it("reports unmatched columns", () => {
    const result = matchColumnHeaders(["1/15/26", "Unknown Col"], events, 1);
    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toEqual(["Unknown Col"]);
  });

  it("handles YYYY-MM-DD format", () => {
    const result = matchColumnHeaders(["2026-01-15"], events, 1);
    expect(result.matched).toHaveLength(1);
    expect(result.matched[0].eventId).toBe("ev_1");
  });
});

describe("buildImportRecords", () => {
  const parsed = {
    rows: [["Name", "1/15/26", "1/22/26"], ["Mudflap", "X", "P"]],
    headers: ["1/15/26", "1/22/26"],
    hasherNames: ["Mudflap"],
    dataRows: [{ name: "Mudflap", cells: ["X", "P"] }],
  };

  const hasherMatches: HasherMatch[] = [
    { csvName: "Mudflap", kennelHasherId: "kh_1", matchType: "exact", matchScore: 1 },
  ];

  const eventMatches: EventMatch[] = [
    { columnIndex: 1, columnHeader: "1/15/26", eventId: "ev_1", date: "2026-01-15" },
    { columnIndex: 2, columnHeader: "1/22/26", eventId: "ev_2", date: "2026-01-22" },
  ];

  it("builds records from matched data", () => {
    const result = buildImportRecords(
      parsed,
      hasherMatches,
      eventMatches,
      DEFAULT_CELL_MARKERS,
      1,
      new Set(),
    );

    expect(result.records).toHaveLength(2);
    expect(result.records[0]).toEqual({
      kennelHasherId: "kh_1",
      eventId: "ev_1",
      attended: true,
      paid: false,
      hared: false,
    });
    expect(result.records[1]).toEqual({
      kennelHasherId: "kh_1",
      eventId: "ev_2",
      attended: true,
      paid: true,
      hared: false,
    });
  });

  it("skips duplicate attendance records", () => {
    const existing = new Set(["kh_1:ev_1"]);
    const result = buildImportRecords(
      parsed,
      hasherMatches,
      eventMatches,
      DEFAULT_CELL_MARKERS,
      1,
      existing,
    );

    expect(result.records).toHaveLength(1);
    expect(result.records[0].eventId).toBe("ev_2");
    expect(result.duplicateCount).toBe(1);
  });

  it("produces no records for empty cells", () => {
    const emptyParsed = {
      ...parsed,
      dataRows: [{ name: "Mudflap", cells: ["", ""] }],
    };
    const result = buildImportRecords(
      emptyParsed,
      hasherMatches,
      eventMatches,
      DEFAULT_CELL_MARKERS,
      1,
      new Set(),
    );

    expect(result.records).toHaveLength(0);
  });

  it("detects hare markers in cells", () => {
    const hareParsed = {
      ...parsed,
      dataRows: [{ name: "Mudflap", cells: ["H", "X"] }],
    };
    const result = buildImportRecords(
      hareParsed,
      hasherMatches,
      eventMatches,
      DEFAULT_CELL_MARKERS,
      1,
      new Set(),
    );

    expect(result.records[0].hared).toBe(true);
    expect(result.records[1].hared).toBe(false);
  });
});
