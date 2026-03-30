/**
 * One-time backfill: fix stale hares CTA text, duplicate location segments,
 * and redundant locationCity values flagged by the daily audit.
 *
 * Usage:
 *   npx tsx scripts/backfill-audit-fixes.ts          # dry run (default)
 *   npx tsx scripts/backfill-audit-fixes.ts --apply   # apply changes
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import pg from "pg";
import { sanitizeHares, sanitizeLocation, suppressRedundantCity } from "../src/pipeline/merge";

const dryRun = !process.argv.includes("--apply");

const CTA_PATTERN = /^(?:tbd|tba|tbc|n\/a|sign[\s\u00A0]*up!?|volunteer|needed|required)$/i;
const REGION_APPENDED_RE = /,\s*[A-Z]{2}(?:\s+\d{5})?$/;

async function main() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(dryRun ? "DRY RUN -- no changes will be made\n" : "APPLYING changes\n");

  // --- Fix 1: Hares CTA text ---
  console.log("=== Hares CTA Text ===");
  const eventsWithHares = await prisma.event.findMany({
    where: {
      haresText: { not: null },
      status: "CONFIRMED",
    },
    select: { id: true, haresText: true },
  });

  let haresFixed = 0;
  for (const ev of eventsWithHares) {
    if (!ev.haresText) continue;
    const cleaned = sanitizeHares(ev.haresText);
    if (cleaned !== ev.haresText) {
      if (dryRun) {
        console.log(`  [dry] haresText: "${ev.haresText}" -> ${cleaned === null ? "null" : `"${cleaned}"`}`);
      } else {
        await prisma.event.update({
          where: { id: ev.id },
          data: { haresText: cleaned },
        });
      }
      haresFixed++;
    }
  }
  console.log(`  ${dryRun ? "Would fix" : "Fixed"} ${haresFixed} hares values.\n`);

  // --- Fix 2: Location duplicate segments (re-sanitize) ---
  console.log("=== Location Duplicate Segments ===");
  const eventsWithLocation = await prisma.event.findMany({
    where: {
      locationName: { not: null },
      status: "CONFIRMED",
    },
    select: { id: true, locationName: true },
  });

  let locationFixed = 0;
  for (const ev of eventsWithLocation) {
    if (!ev.locationName) continue;
    const cleaned = sanitizeLocation(ev.locationName);
    if (cleaned !== ev.locationName) {
      if (dryRun) {
        console.log(`  [dry] locationName: "${ev.locationName}" -> ${cleaned === null ? "null" : `"${cleaned}"`}`);
      } else {
        await prisma.event.update({
          where: { id: ev.id },
          data: { locationName: cleaned },
        });
      }
      locationFixed++;
    }
  }
  console.log(`  ${dryRun ? "Would fix" : "Fixed"} ${locationFixed} location values.\n`);

  // --- Fix 3: Redundant locationCity ---
  console.log("=== Redundant Location City ===");
  const eventsWithCity = await prisma.event.findMany({
    where: {
      locationName: { not: null },
      locationCity: { not: null },
      status: "CONFIRMED",
    },
    select: { id: true, locationName: true, locationCity: true },
  });

  let cityFixed = 0;
  for (const ev of eventsWithCity) {
    if (!ev.locationName || !ev.locationCity) continue;
    if (!REGION_APPENDED_RE.test(ev.locationName)) continue;
    const cityName = ev.locationCity.split(",")[0].trim();
    if (cityName && !ev.locationName.includes(cityName)) {
      if (dryRun) {
        console.log(`  [dry] locationCity: "${ev.locationName}" + "${ev.locationCity}" -> null`);
      } else {
        await prisma.event.update({
          where: { id: ev.id },
          data: { locationCity: null },
        });
      }
      cityFixed++;
    }
  }
  console.log(`  ${dryRun ? "Would fix" : "Fixed"} ${cityFixed} redundant city values.\n`);

  console.log(`\nTotal: ${haresFixed + locationFixed + cityFixed} fixes ${dryRun ? "(dry run)" : "applied"}.`);
  if (dryRun && (haresFixed + locationFixed + cityFixed) > 0) {
    console.log("Run with --apply to make changes.");
  }

  await prisma.$disconnect();
  pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
