/**
 * Import attendance from a CSV matrix into KennelAttendance records.
 *
 * Expected CSV format:
 *   Name       | 1/15/26 | 1/22/26 | #123
 *   Alice      | X       | XPH     |
 *   Bob        |         | X       | X
 *
 * Usage:
 *   npx tsx scripts/import-attendance-csv.ts --file data/attendance.csv --kennel NYCH3
 *   npx tsx scripts/import-attendance-csv.ts --file data/attendance.csv --kennel NYCH3 --dry-run
 *   npx tsx scripts/import-attendance-csv.ts --file data/attendance.csv --kennel NYCH3 --create-hashers
 *
 * Flags:
 *   --file              Path to CSV file (required)
 *   --kennel            Kennel shortName (required)
 *   --dry-run           Preview without writing to database
 *   --create-hashers    Create new KennelHasher records for unmatched names
 *   --name-column       Column index for hasher names (default: 0)
 *   --data-start-column Column index where data begins (default: 1)
 *   --header-row        Row index for column headers (default: 0)
 *   --data-start-row    Row index where data begins (default: 1)
 *   --fuzzy-threshold   Fuzzy match threshold 0-1 (default: 0.85)
 *
 * Requires DATABASE_URL in .env or .env.local
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

import {
  parseAttendanceCSV,
  matchHasherNames,
  matchColumnHeaders,
  buildImportRecords,
  DEFAULT_CELL_MARKERS,
  type RosterEntry,
  type EventLookup,
} from "../src/lib/misman/csv-import";
import { syncEventHares } from "../src/lib/misman/hare-sync";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const filePath = get("--file");
  const kennel = get("--kennel");

  if (!filePath || !kennel) {
    console.error("Usage: npx tsx scripts/import-attendance-csv.ts --file <path> --kennel <shortName>");
    console.error("\nRequired flags:");
    console.error("  --file              Path to CSV file");
    console.error("  --kennel            Kennel shortName (e.g., NYCH3)");
    console.error("\nOptional flags:");
    console.error("  --dry-run           Preview without writing to database");
    console.error("  --create-hashers    Create roster entries for unmatched names");
    console.error("  --name-column N     Column index for names (default: 0)");
    console.error("  --data-start-column N  Column index where data starts (default: 1)");
    console.error("  --header-row N      Row index for headers (default: 0)");
    console.error("  --data-start-row N  Row index where data starts (default: 1)");
    console.error("  --fuzzy-threshold N Fuzzy match threshold 0-1 (default: 0.85)");
    console.error("  --recorded-by EMAIL Email of importing user (required for DB writes)");
    process.exit(1);
  }

  return {
    filePath: resolve(filePath),
    kennel,
    dryRun: args.includes("--dry-run"),
    createHashers: args.includes("--create-hashers"),
    recordedByEmail: get("--recorded-by"),
    nameColumn: parseInt(get("--name-column") ?? "0", 10),
    dataStartColumn: parseInt(get("--data-start-column") ?? "1", 10),
    headerRow: parseInt(get("--header-row") ?? "0", 10),
    dataStartRow: parseInt(get("--data-start-row") ?? "1", 10),
    fuzzyThreshold: parseFloat(get("--fuzzy-threshold") ?? "0.85"),
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveImportingUser(prisma: any, recordedByEmail: string | undefined): Promise<string> {
  if (recordedByEmail) {
    const user = await prisma.user.findUnique({ where: { email: recordedByEmail }, select: { id: true } });
    if (!user) { console.error(`User with email "${recordedByEmail}" not found in database.`); process.exit(1); }
    console.log(`  Importing as: ${recordedByEmail}`);
    return user.id;
  }
  const firstUser = await prisma.user.findFirst({ select: { id: true, email: true } });
  if (!firstUser) { console.error("No users found in database. Use --recorded-by to specify an email."); process.exit(1); }
  console.log(`  Importing as: ${firstUser.email} (default — use --recorded-by to override)`);
  return firstUser.id;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function createUnmatchedHashers(prisma: any, unmatched: string[], rosterGroupId: string, kennelId: string, dryRun: boolean) {
  const created: Array<{ csvName: string; kennelHasherId: string; matchType: "exact"; matchScore: number }> = [];
  if (dryRun) {
    console.log(`\n[DRY RUN] Would create ${unmatched.length} new roster entries.`);
    return created;
  }
  console.log(`\nCreating ${unmatched.length} new roster entries...`);
  for (const name of unmatched) {
    const newHasher = await prisma.kennelHasher.create({ data: { rosterGroupId, kennelId, hashName: name } });
    created.push({ csvName: name, kennelHasherId: newHasher.id, matchType: "exact", matchScore: 1 });
    console.log(`  Created: ${name}`);
  }
  return created;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function executeImport(prisma: any, records: Array<{ kennelHasherId: string; eventId: string; paid: boolean; hared: boolean }>, recordedByUserId: string, filePath: string) {
  const now = new Date().toISOString();
  const importAuditEntry = { action: "import" as const, timestamp: now, userId: recordedByUserId, details: { source: filePath } };
  const result = await prisma.kennelAttendance.createMany({
    data: records.map((r) => ({ kennelHasherId: r.kennelHasherId, eventId: r.eventId, paid: r.paid, haredThisTrail: r.hared, recordedBy: recordedByUserId, editLog: [importAuditEntry] })),
    skipDuplicates: true,
  });
  console.log(`  Created: ${result.count} attendance records`);
  const eventsWithHares = new Set(records.filter((r) => r.hared).map((r) => r.eventId));
  if (eventsWithHares.size > 0) {
    console.log(`  Syncing EventHare for ${eventsWithHares.size} events...`);
    for (const eventId of eventsWithHares) {
      await syncEventHares(eventId);
    }
  }
}

async function main() {
  const opts = parseArgs();

  if (!existsSync(opts.filePath)) {
    console.error(`File not found: ${opts.filePath}`);
    process.exit(1);
  }

  console.log(`Reading CSV from: ${opts.filePath}`);
  const csvText = readFileSync(opts.filePath, "utf-8");

  // Parse the CSV
  const parsed = parseAttendanceCSV(csvText, {
    nameColumn: opts.nameColumn,
    dataStartColumn: opts.dataStartColumn,
    headerRow: opts.headerRow,
    dataStartRow: opts.dataStartRow,
  });

  console.log(`  Rows: ${parsed.rows.length}`);
  console.log(`  Headers: ${parsed.headers.length} data columns`);
  console.log(`  Hashers: ${parsed.hasherNames.length}`);

  if (parsed.hasherNames.length === 0) {
    console.error("No hasher names found in CSV. Check --name-column and --data-start-row.");
    process.exit(1);
  }

  // Initialize Prisma
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  try {
    // Resolve kennel (shortName is no longer globally unique, use findFirst)
    const kennel = await prisma.kennel.findFirst({
      where: { shortName: opts.kennel },
      select: { id: true, shortName: true },
    });

    if (!kennel) {
      console.error(`Kennel "${opts.kennel}" not found in database.`);
      process.exit(1);
    }

    console.log(`\nKennel: ${kennel.shortName} (${kennel.id})`);

    // Resolve the importing user (needed for recordedBy FK)
    let recordedByUserId: string | null = null;
    if (!opts.dryRun) {
      recordedByUserId = await resolveImportingUser(prisma, opts.recordedByEmail);
    }

    // Get roster group
    const rosterGroupKennel = await prisma.rosterGroupKennel.findUnique({
      where: { kennelId: kennel.id },
      select: { groupId: true },
    });

    if (!rosterGroupKennel) {
      console.error(`Kennel "${opts.kennel}" has no RosterGroup.`);
      process.exit(1);
    }

    const rosterGroupId = rosterGroupKennel.groupId;

    // Fetch roster
    const roster: RosterEntry[] = await prisma.kennelHasher.findMany({
      where: { rosterGroupId },
      select: { id: true, hashName: true, nerdName: true },
    });

    console.log(`  Roster: ${roster.length} hashers`);

    // Match hasher names
    const hasherResult = matchHasherNames(
      parsed.hasherNames,
      roster,
      opts.fuzzyThreshold,
    );

    console.log(`\n--- Hasher Matching ---`);
    console.log(`  Exact matches: ${hasherResult.matched.filter((m) => m.matchType === "exact").length}`);
    console.log(`  Fuzzy matches: ${hasherResult.matched.filter((m) => m.matchType === "fuzzy").length}`);
    console.log(`  Unmatched: ${hasherResult.unmatched.length}`);

    if (hasherResult.unmatched.length > 0) {
      console.log(`  Unmatched names:`);
      for (const name of hasherResult.unmatched) {
        console.log(`    - ${name}`);
      }
    }

    // Show fuzzy matches for review
    const fuzzyMatches = hasherResult.matched.filter((m) => m.matchType === "fuzzy");
    if (fuzzyMatches.length > 0) {
      console.log(`  Fuzzy matches:`);
      for (const m of fuzzyMatches) {
        const rosterEntry = roster.find((r) => r.id === m.kennelHasherId);
        const rosterName = rosterEntry?.hashName || rosterEntry?.nerdName || "?";
        console.log(`    "${m.csvName}" → "${rosterName}" (score: ${m.matchScore.toFixed(2)})`);
      }
    }

    // Fetch events for this kennel (no date limit for imports)
    const events: EventLookup[] = await prisma.event.findMany({
      where: { kennelId: kennel.id },
      select: { id: true, date: true, runNumber: true, kennelId: true },
    });

    console.log(`  Events in DB: ${events.length}`);

    // Match column headers to events
    const eventResult = matchColumnHeaders(
      parsed.headers,
      events,
      opts.dataStartColumn,
    );

    console.log(`\n--- Event Matching ---`);
    console.log(`  Matched columns: ${eventResult.matched.length}`);
    console.log(`  Unmatched columns: ${eventResult.unmatched.length}`);

    if (eventResult.unmatched.length > 0) {
      console.log(`  Unmatched columns:`);
      for (const col of eventResult.unmatched) {
        console.log(`    - ${col}`);
      }
    }

    // Handle creating new hashers for unmatched names
    let allHasherMatches = hasherResult.matched;
    if (opts.createHashers && hasherResult.unmatched.length > 0) {
      const created = await createUnmatchedHashers(prisma, hasherResult.unmatched, rosterGroupId, kennel.id, opts.dryRun);
      allHasherMatches = [...allHasherMatches, ...created];
    }

    // Fetch existing attendance for dedup
    const existingAttendance = await prisma.kennelAttendance.findMany({
      where: {
        event: { kennelId: kennel.id },
      },
      select: { kennelHasherId: true, eventId: true },
    });

    const existingSet = new Set(
      existingAttendance.map((a) => `${a.kennelHasherId}:${a.eventId}`),
    );

    // Build import records
    const { records, duplicateCount } = buildImportRecords(
      parsed,
      allHasherMatches,
      eventResult.matched,
      DEFAULT_CELL_MARKERS,
      opts.dataStartColumn,
      existingSet,
    );

    console.log(`\n--- Import Summary ---`);
    console.log(`  Records to import: ${records.length}`);
    console.log(`  Duplicates skipped: ${duplicateCount}`);
    console.log(`  Paid records: ${records.filter((r) => r.paid).length}`);
    console.log(`  Hare records: ${records.filter((r) => r.hared).length}`);

    if (opts.dryRun) {
      console.log(`\n[DRY RUN] No changes written to database.`);
      await prisma.$disconnect();
      return;
    }

    if (records.length === 0) {
      console.log(`\nNothing to import.`);
      await prisma.$disconnect();
      return;
    }

    // Execute import
    console.log(`\nImporting ${records.length} attendance records...`);
    if (!recordedByUserId) throw new Error("recordedByUserId not resolved");
    await executeImport(prisma, records, recordedByUserId, opts.filePath);

    console.log(`\nDone!`);
    await prisma.$disconnect();
  } catch (error) {
    await prisma.$disconnect();
    throw error;
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
