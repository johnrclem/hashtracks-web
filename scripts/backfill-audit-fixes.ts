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

async function main() {
  // Default to strict TLS validation; set BACKFILL_ALLOW_SELF_SIGNED_CERT=1
  // for local Railway proxy dev. Previously the logic was inverted and
  // disabled validation in production.
  const allowSelfSigned = process.env.BACKFILL_ALLOW_SELF_SIGNED_CERT === "1";
  const pool = new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: !allowSelfSigned },
  });
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
    if (suppressRedundantCity(ev.locationName, ev.locationCity) === null) {
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
