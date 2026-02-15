/**
 * Import hare roster JSON into KennelHasher records.
 * Reads the output of scrape-hashnyc-hares.ts and creates roster entries.
 *
 * Usage:
 *   npx tsx scripts/import-hare-roster.ts
 *   npx tsx scripts/import-hare-roster.ts --file path/to/roster.json
 *   npx tsx scripts/import-hare-roster.ts --dry-run
 *
 * Requires DATABASE_URL in .env or .env.local
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { readFileSync, existsSync } from "fs";
import { resolve } from "path";

const DEFAULT_PATH = resolve(__dirname, "../data/hashnyc-hare-roster.json");

interface HareEntry {
  name: string;
  timesSeen: number;
  variants?: string[];
}

interface KennelRoster {
  count: number;
  hares: HareEntry[];
}

interface RosterFile {
  scrapedAt: string;
  totalEvents: number;
  eventsWithHares: number;
  totalUniqueHares: number;
  kennels: Record<string, KennelRoster>;
  possibleDuplicates: unknown[];
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const fileIdx = args.indexOf("--file");
  const filePath = fileIdx !== -1 ? resolve(args[fileIdx + 1]) : DEFAULT_PATH;

  if (!existsSync(filePath)) {
    console.error(`Roster file not found: ${filePath}`);
    console.error("\nRun the scraper first:");
    console.error("  npx tsx scripts/scrape-hashnyc-hares.ts");
    process.exit(1);
  }

  console.log(`Reading roster from: ${filePath}`);
  const roster: RosterFile = JSON.parse(readFileSync(filePath, "utf-8"));
  console.log(`  Scraped: ${roster.scrapedAt}`);
  console.log(`  Events: ${roster.totalEvents} (${roster.eventsWithHares} with hares)`);
  console.log(`  Unique hares: ${roster.totalUniqueHares}`);
  console.log(`  Kennels: ${Object.keys(roster.kennels).join(", ")}`);

  if (dryRun) {
    console.log("\n[DRY RUN] Would import to database — no changes made.");
    for (const [kennel, data] of Object.entries(roster.kennels)) {
      console.log(`  ${kennel}: ${data.count} hares`);
    }
    return;
  }

  // Initialize Prisma
  const { PrismaClient } = await import("../src/generated/prisma/client.js");
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
  const prisma = new PrismaClient({ adapter });

  let totalCreated = 0;
  let totalSkipped = 0;

  for (const [kennelShortName, data] of Object.entries(roster.kennels)) {
    // Look up kennel by shortName
    const kennel = await prisma.kennel.findUnique({
      where: { shortName: kennelShortName },
      select: { id: true },
    });

    if (!kennel) {
      console.warn(`  ⚠ Kennel "${kennelShortName}" not found in database — skipping ${data.count} hares`);
      totalSkipped += data.count;
      continue;
    }

    // Look up roster group for this kennel
    const rosterGroupKennel = await prisma.rosterGroupKennel.findUnique({
      where: { kennelId: kennel.id },
      select: { groupId: true },
    });

    if (!rosterGroupKennel) {
      console.warn(`  ⚠ Kennel "${kennelShortName}" has no RosterGroup — skipping ${data.count} hares`);
      totalSkipped += data.count;
      continue;
    }

    const rosterGroupId = rosterGroupKennel.groupId;

    // Get existing roster entries (case-insensitive dedup)
    const existing = await prisma.kennelHasher.findMany({
      where: { rosterGroupId },
      select: { hashName: true, nerdName: true },
    });

    const existingNames = new Set<string>();
    for (const e of existing) {
      if (e.hashName) existingNames.add(e.hashName.toLowerCase());
      if (e.nerdName) existingNames.add(e.nerdName.toLowerCase());
    }

    // Filter to new names only
    const newHares = data.hares.filter(
      (h) => !existingNames.has(h.name.toLowerCase()),
    );

    if (newHares.length === 0) {
      console.log(`  ${kennelShortName}: 0 new (all ${data.count} already in roster)`);
      totalSkipped += data.count;
      continue;
    }

    // Create new KennelHasher entries
    const result = await prisma.kennelHasher.createMany({
      data: newHares.map((h) => ({
        rosterGroupId,
        kennelId: kennel.id,
        hashName: h.name,
      })),
    });

    const skipped = data.count - newHares.length;
    totalCreated += result.count;
    totalSkipped += skipped;
    console.log(`  ${kennelShortName}: ${result.count} created, ${skipped} already existed`);
  }

  console.log(`\nDone! Created ${totalCreated} roster entries (${totalSkipped} skipped as duplicates)`);
  await prisma.$disconnect();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
