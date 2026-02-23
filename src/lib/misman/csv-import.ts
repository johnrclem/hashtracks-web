/**
 * CSV attendance import — pure logic for parsing and resolving attendance data.
 *
 * Expected format: matrix where rows = hasher names, columns = dates/trail numbers.
 * Cell values indicate attendance status (X/P/H combinations).
 *
 * Reuses parseCSV from the Google Sheets adapter.
 */

import { parseCSV } from "@/adapters/google-sheets/adapter";
import { fuzzyNameMatch } from "@/lib/fuzzy";

export interface CSVImportConfig {
  kennelId: string;
  rosterGroupId: string;
  importedBy: string;
  nameColumn: number;
  dataStartColumn: number;
  headerRow: number;
  dataStartRow: number;
  fuzzyThreshold: number;
  cellMarkers: {
    attended: string[];
    paid: string[];
    hare: string[];
  };
}

export const DEFAULT_CELL_MARKERS = {
  attended: ["X", "x", "1", "\u2713", "true", "yes", "Y", "y"],
  paid: ["P", "p", "$", "paid"],
  hare: ["H", "h", "hare"],
};

export interface HasherMatch {
  csvName: string;
  kennelHasherId: string;
  matchType: "exact" | "fuzzy";
  matchScore: number;
}

export interface EventMatch {
  columnIndex: number;
  columnHeader: string;
  eventId: string;
  date: string;
}

export interface AttendanceImportRecord {
  kennelHasherId: string;
  eventId: string;
  attended: boolean;
  paid: boolean;
  hared: boolean;
}

export interface CSVImportResult {
  matchedHashers: HasherMatch[];
  unmatchedHashers: string[];
  matchedEvents: EventMatch[];
  unmatchedColumns: string[];
  records: AttendanceImportRecord[];
  duplicateCount: number;
}

export interface ParsedCSV {
  rows: string[][];
  headers: string[];
  hasherNames: string[];
  dataRows: { name: string; cells: string[] }[];
}

/**
 * Parse an attendance CSV matrix.
 */
export function parseAttendanceCSV(
  csvText: string,
  config: Pick<CSVImportConfig, "nameColumn" | "dataStartColumn" | "headerRow" | "dataStartRow">,
): ParsedCSV {
  const allRows = parseCSV(csvText);
  if (allRows.length === 0) {
    return { rows: allRows, headers: [], hasherNames: [], dataRows: [] };
  }

  const headerRow = allRows[config.headerRow] || [];
  const headers = headerRow.slice(config.dataStartColumn);

  const dataRows: { name: string; cells: string[] }[] = [];
  const hasherNames: string[] = [];

  for (let i = config.dataStartRow; i < allRows.length; i++) {
    const row = allRows[i];
    const name = (row[config.nameColumn] || "").trim();
    if (!name) continue;

    hasherNames.push(name);
    dataRows.push({
      name,
      cells: row.slice(config.dataStartColumn),
    });
  }

  return { rows: allRows, headers, hasherNames, dataRows };
}

/**
 * Interpret a cell value as attendance flags.
 */
export function parseCellValue(
  value: string,
  markers: CSVImportConfig["cellMarkers"],
): { attended: boolean; paid: boolean; hared: boolean } {
  const v = value.trim();
  if (!v) return { attended: false, paid: false, hared: false };

  const vLower = v.toLowerCase();

  // Check if any marker matches
  const isAttended = markers.attended.some((m) => vLower === m.toLowerCase());
  const isPaid = markers.paid.some((m) => vLower === m.toLowerCase());
  const isHare = markers.hare.some((m) => vLower === m.toLowerCase());

  // Any match means they attended
  const attended = isAttended || isPaid || isHare;

  return { attended, paid: isPaid, hared: isHare };
}

export interface RosterEntry {
  id: string;
  hashName: string | null;
  nerdName: string | null;
}

/** Find an exact case-insensitive match for a name in the roster. */
function findExactHasherMatch(name: string, roster: RosterEntry[]): RosterEntry | undefined {
  const nameLower = name.toLowerCase().trim();
  return roster.find(
    (r) =>
      (r.hashName && r.hashName.toLowerCase().trim() === nameLower) ||
      (r.nerdName && r.nerdName.toLowerCase().trim() === nameLower),
  );
}

/** Find the best fuzzy match for a name in the roster above the given threshold. */
function findFuzzyHasherMatch(
  name: string,
  roster: RosterEntry[],
  threshold: number,
): { entry: RosterEntry; score: number } | null {
  let bestMatch: { entry: RosterEntry; score: number } | null = null;
  for (const entry of roster) {
    const scores: number[] = [];
    if (entry.hashName) scores.push(fuzzyNameMatch(name, entry.hashName));
    if (entry.nerdName) scores.push(fuzzyNameMatch(name, entry.nerdName));
    const bestScore = Math.max(0, ...scores);
    if (bestScore >= threshold && (!bestMatch || bestScore > bestMatch.score)) {
      bestMatch = { entry, score: bestScore };
    }
  }
  return bestMatch;
}

/**
 * Match CSV hasher names to KennelHasher records.
 */
export function matchHasherNames(
  csvNames: string[],
  roster: RosterEntry[],
  threshold: number,
): { matched: HasherMatch[]; unmatched: string[] } {
  const matched: HasherMatch[] = [];
  const unmatched: string[] = [];

  for (const name of csvNames) {
    const exact = findExactHasherMatch(name, roster);
    if (exact) {
      matched.push({ csvName: name, kennelHasherId: exact.id, matchType: "exact", matchScore: 1 });
      continue;
    }

    const fuzzy = findFuzzyHasherMatch(name, roster, threshold);
    if (fuzzy) {
      matched.push({ csvName: name, kennelHasherId: fuzzy.entry.id, matchType: "fuzzy", matchScore: fuzzy.score });
    } else {
      unmatched.push(name);
    }
  }

  return { matched, unmatched };
}

export interface EventLookup {
  id: string;
  date: Date;
  runNumber: number | null;
  kennelId: string;
}

/**
 * Match column headers to Event records.
 * Attempts date matching first, then run number matching.
 */
export function matchColumnHeaders(
  headers: string[],
  events: EventLookup[],
  dataStartColumn: number,
): { matched: EventMatch[]; unmatched: string[] } {
  const matched: EventMatch[] = [];
  const unmatched: string[] = [];

  for (let i = 0; i < headers.length; i++) {
    const header = headers[i].trim();
    if (!header) continue;

    const columnIndex = dataStartColumn + i;

    // Try parsing as a date
    const dateMatch = tryParseDate(header);
    if (dateMatch) {
      const event = events.find((e) => {
        const eventDate = e.date.toISOString().slice(0, 10);
        return eventDate === dateMatch;
      });
      if (event) {
        matched.push({
          columnIndex,
          columnHeader: header,
          eventId: event.id,
          date: dateMatch,
        });
        continue;
      }
    }

    // Try parsing as a run number
    const runNum = parseInt(header.replace(/^#/, ""), 10);
    if (!isNaN(runNum)) {
      const event = events.find((e) => e.runNumber === runNum);
      if (event) {
        matched.push({
          columnIndex,
          columnHeader: header,
          eventId: event.id,
          date: event.date.toISOString().slice(0, 10),
        });
        continue;
      }
    }

    unmatched.push(header);
  }

  return { matched, unmatched };
}

/**
 * Try to parse various date formats into YYYY-MM-DD.
 * Handles: M/D/YY, M-D-YY, M/D/YYYY, YYYY-MM-DD
 */
function tryParseDate(input: string): string | null {
  const trimmed = input.trim();

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // M/D/YY or M-D-YY or M/D/YYYY or M-D-YYYY
  const parts = trimmed.split(/[/-]/);
  if (parts.length === 3) {
    const month = parseInt(parts[0], 10);
    const day = parseInt(parts[1], 10);
    let year = parseInt(parts[2], 10);
    if (isNaN(month) || isNaN(day) || isNaN(year)) return null;

    if (year < 100) year += 2000;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;

    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  return null;
}

/**
 * Build the full import result from parsed CSV, matched hashers, and matched events.
 *
 * Cell index i in dataRows corresponds to absolute column (dataStartColumn + i),
 * matching the columnIndex used by matchColumnHeaders.
 */
export function buildImportRecords(
  parsed: ParsedCSV,
  hasherMatches: HasherMatch[],
  eventMatches: EventMatch[],
  markers: CSVImportConfig["cellMarkers"],
  dataStartColumn: number,
  existingAttendance: Set<string>,
): { records: AttendanceImportRecord[]; duplicateCount: number } {
  const hasherMap = new Map(
    hasherMatches.map((m) => [m.csvName.toLowerCase().trim(), m.kennelHasherId]),
  );
  // Map absolute column index → eventId
  const eventColMap = new Map(
    eventMatches.map((m) => [m.columnIndex, m.eventId]),
  );

  const records: AttendanceImportRecord[] = [];
  let duplicateCount = 0;

  for (const row of parsed.dataRows) {
    const hasherId = hasherMap.get(row.name.toLowerCase().trim());
    if (!hasherId) continue;

    for (let i = 0; i < row.cells.length; i++) {
      const absoluteCol = dataStartColumn + i;
      const eventId = eventColMap.get(absoluteCol);
      if (!eventId) continue;

      const flags = parseCellValue(row.cells[i], markers);
      if (!flags.attended) continue;

      // Check for duplicates
      const key = `${hasherId}:${eventId}`;
      if (existingAttendance.has(key)) {
        duplicateCount++;
        continue;
      }

      records.push({
        kennelHasherId: hasherId,
        eventId,
        attended: true,
        paid: flags.paid,
        hared: flags.hared,
      });
    }
  }

  return { records, duplicateCount };
}
