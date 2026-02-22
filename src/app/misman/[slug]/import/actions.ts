"use server";

import { getMismanUser, getRosterGroupId } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  parseAttendanceCSV,
  matchHasherNames,
  matchColumnHeaders,
  buildImportRecords,
  DEFAULT_CELL_MARKERS,
  type RosterEntry,
  type EventLookup,
  type CSVImportConfig,
  type HasherMatch,
} from "@/lib/misman/csv-import";
import type { Prisma } from "@/generated/prisma/client";
import type { AuditLogEntry } from "@/lib/misman/audit";
import { syncEventHares } from "@/lib/misman/hare-sync";

/** Maximum CSV text size (1 MB) to prevent memory exhaustion. */
const MAX_CSV_SIZE_BYTES = 1_000_000;
/** Maximum number of hasher rows allowed in a CSV import. */
const MAX_CSV_ROWS = 10_000;

function validateCSVSize(csvText: string): string | null {
  if (new TextEncoder().encode(csvText).length > MAX_CSV_SIZE_BYTES) {
    return "CSV file is too large (max 1 MB)";
  }
  return null;
}

/**
 * Preview CSV import: parse CSV and return match results without writing to DB.
 */
export async function previewCSVImport(
  kennelId: string,
  csvText: string,
  config: {
    nameColumn: number;
    dataStartColumn: number;
    headerRow: number;
    dataStartRow: number;
    fuzzyThreshold: number;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const sizeError = validateCSVSize(csvText);
  if (sizeError) return { error: sizeError };

  const rosterGroupId = await getRosterGroupId(kennelId);

  // Parse CSV
  const parsed = parseAttendanceCSV(csvText, config);

  if (parsed.hasherNames.length > MAX_CSV_ROWS) {
    return { error: `CSV has too many rows (${parsed.hasherNames.length}). Maximum is ${MAX_CSV_ROWS}.` };
  }

  if (parsed.hasherNames.length === 0) {
    return { error: "No hasher names found in CSV. Check column configuration." };
  }

  // Fetch roster
  const roster: RosterEntry[] = await prisma.kennelHasher.findMany({
    where: { rosterGroupId },
    select: { id: true, hashName: true, nerdName: true },
  });

  // Match hashers
  const hasherResult = matchHasherNames(
    parsed.hasherNames,
    roster,
    config.fuzzyThreshold,
  );

  // Fetch events (no date limit for imports)
  const events: EventLookup[] = await prisma.event.findMany({
    where: { kennelId },
    select: { id: true, date: true, runNumber: true, kennelId: true },
  });

  // Match columns to events
  const eventResult = matchColumnHeaders(
    parsed.headers,
    events,
    config.dataStartColumn,
  );

  // Fetch existing attendance for dedup
  const existingAttendance = await prisma.kennelAttendance.findMany({
    where: { event: { kennelId } },
    select: { kennelHasherId: true, eventId: true },
  });

  const existingSet = new Set(
    existingAttendance.map((a) => `${a.kennelHasherId}:${a.eventId}`),
  );

  // Build records preview
  const { records, duplicateCount } = buildImportRecords(
    parsed,
    hasherResult.matched,
    eventResult.matched,
    DEFAULT_CELL_MARKERS,
    config.dataStartColumn,
    existingSet,
  );

  // Enrich fuzzy matches with roster names for display
  const enrichedHasherMatches = hasherResult.matched.map((m) => {
    const rosterEntry = roster.find((r) => r.id === m.kennelHasherId);
    return {
      ...m,
      rosterName: rosterEntry?.hashName || rosterEntry?.nerdName || "Unknown",
    };
  });

  return {
    data: {
      totalRows: parsed.rows.length,
      hasherCount: parsed.hasherNames.length,
      headerCount: parsed.headers.length,
      matchedHashers: enrichedHasherMatches,
      unmatchedHashers: hasherResult.unmatched,
      matchedEvents: eventResult.matched.map((m) => ({
        columnHeader: m.columnHeader,
        eventId: m.eventId,
        date: m.date,
      })),
      unmatchedColumns: eventResult.unmatched,
      recordCount: records.length,
      duplicateCount,
      paidCount: records.filter((r) => r.paid).length,
      hareCount: records.filter((r) => r.hared).length,
    },
  };
}

/**
 * Execute CSV import: parse CSV, resolve matches, and write to DB.
 */
export async function executeCSVImport(
  kennelId: string,
  csvText: string,
  config: {
    nameColumn: number;
    dataStartColumn: number;
    headerRow: number;
    dataStartRow: number;
    fuzzyThreshold: number;
    createHashers: boolean;
  },
) {
  const user = await getMismanUser(kennelId);
  if (!user) return { error: "Not authorized" };

  const sizeError = validateCSVSize(csvText);
  if (sizeError) return { error: sizeError };

  const rosterGroupId = await getRosterGroupId(kennelId);

  // Parse CSV
  const parsed = parseAttendanceCSV(csvText, config);

  if (parsed.hasherNames.length > MAX_CSV_ROWS) {
    return { error: `CSV has too many rows (${parsed.hasherNames.length}). Maximum is ${MAX_CSV_ROWS}.` };
  }

  if (parsed.hasherNames.length === 0) {
    return { error: "No hasher names found in CSV." };
  }

  // Fetch roster
  const roster: RosterEntry[] = await prisma.kennelHasher.findMany({
    where: { rosterGroupId },
    select: { id: true, hashName: true, nerdName: true },
  });

  // Match hashers
  const hasherResult = matchHasherNames(
    parsed.hasherNames,
    roster,
    config.fuzzyThreshold,
  );

  // Create new hashers for unmatched names if requested
  let allHasherMatches: HasherMatch[] = hasherResult.matched;
  let createdHashers = 0;

  if (config.createHashers && hasherResult.unmatched.length > 0) {
    for (const name of hasherResult.unmatched) {
      const newHasher = await prisma.kennelHasher.create({
        data: {
          rosterGroupId,
          kennelId,
          hashName: name,
        },
      });
      allHasherMatches = [
        ...allHasherMatches,
        {
          csvName: name,
          kennelHasherId: newHasher.id,
          matchType: "exact" as const,
          matchScore: 1,
        },
      ];
      createdHashers++;
    }
  }

  // Fetch events (no date limit)
  const events: EventLookup[] = await prisma.event.findMany({
    where: { kennelId },
    select: { id: true, date: true, runNumber: true, kennelId: true },
  });

  // Match columns
  const eventResult = matchColumnHeaders(
    parsed.headers,
    events,
    config.dataStartColumn,
  );

  // Fetch existing attendance for dedup
  const existingAttendance = await prisma.kennelAttendance.findMany({
    where: { event: { kennelId } },
    select: { kennelHasherId: true, eventId: true },
  });

  const existingSet = new Set(
    existingAttendance.map((a) => `${a.kennelHasherId}:${a.eventId}`),
  );

  // Build records
  const { records, duplicateCount } = buildImportRecords(
    parsed,
    allHasherMatches,
    eventResult.matched,
    DEFAULT_CELL_MARKERS,
    config.dataStartColumn,
    existingSet,
  );

  if (records.length === 0) {
    return {
      data: {
        created: 0,
        duplicateCount,
        createdHashers,
        unmatchedHashers: hasherResult.unmatched.length,
        unmatchedColumns: eventResult.unmatched.length,
      },
    };
  }

  // Create attendance records with audit log
  const now = new Date().toISOString();
  const importAuditEntry: AuditLogEntry = {
    action: "import",
    timestamp: now,
    userId: user.id,
    details: { source: "csv-upload" },
  };

  const result = await prisma.kennelAttendance.createMany({
    data: records.map((r) => ({
      kennelHasherId: r.kennelHasherId,
      eventId: r.eventId,
      paid: r.paid,
      haredThisTrail: r.hared,
      recordedBy: user.id,
      editLog: [importAuditEntry] as unknown as Prisma.InputJsonValue,
    })),
    skipDuplicates: true,
  });

  // Sync EventHare for events with hare records
  const eventsWithHares = new Set(
    records.filter((r) => r.hared).map((r) => r.eventId),
  );

  for (const eventId of eventsWithHares) {
    await syncEventHares(eventId);
  }

  return {
    data: {
      created: result.count,
      duplicateCount,
      createdHashers,
      unmatchedHashers: config.createHashers ? 0 : hasherResult.unmatched.length,
      unmatchedColumns: eventResult.unmatched.length,
    },
  };
}
