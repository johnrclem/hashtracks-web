/**
 * One-shot cleanup for #873: the LSW adapter previously mis-mapped the
 * DESCRIPTION source column (which actually holds an HK district name) to
 * `description` instead of `locationName`. The adapter fix stops new events
 * from getting the wrong shape, but existing events need a repair pass.
 *
 * Provenance guard: we only touch rows where Event.description EXACTLY matches
 * the `description` field of a legacy LSW RawEvent (the old mis-mapped adapter
 * wrote the district name into `description`) linked to that same Event. That
 * proves the text came from the old LSW mis-mapping, not from another source
 * or manual edit, and avoids wiping legitimate descriptions.
 *
 * Repair logic (per-matched event):
 *   - If Event.locationName is empty, move description → locationName.
 *   - If Event.locationName is already set (e.g. re-scraped post-fix), just
 *     clear description so the stale district name stops showing as a second
 *     copy.
 *
 * ORDERING CONSTRAINT: run this BEFORE any force re-scrape of the LSW source.
 * `scrapeSource(..., { force: true })` deletes all prior RawEvents for a
 * source, which is what carries the legacy provenance. Once those are gone
 * this script can no longer repair already-corrupted rows.
 *
 * Runs in dry-run mode by default — pass `--apply` to actually write.
 *   npm run tsx scripts/cleanup-lsw-stale-descriptions.ts           # preview
 *   npm run tsx scripts/cleanup-lsw-stale-descriptions.ts -- --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";

const APPLY = process.argv.includes("--apply");

async function main() {
  const kennel = await prisma.kennel.findFirst({ where: { kennelCode: "lsw-h3" } });
  if (!kennel) {
    console.error("LSW kennel not found — aborting.");
    process.exit(1);
  }

  // Scope by URL to the one legacy LSW adapter that mis-mapped the column.
  // Filtering by kennelId alone would include any future sources linked to the
  // kennel (e.g. a Meetup feed) whose RawEvent.rawData.description might
  // coincidentally match an Event description contributed elsewhere.
  const LEGACY_LSW_URL = "https://www.datadesignfactory.com/lsw/hareline.htm";
  const lswSources = await prisma.source.findMany({
    where: {
      url: LEGACY_LSW_URL,
      kennels: { some: { kennelId: kennel.id } },
    },
    select: { id: true, name: true },
  });
  if (lswSources.length === 0) {
    console.error(`No source matching ${LEGACY_LSW_URL} linked to LSW kennel — aborting.`);
    process.exit(1);
  }

  // Pull LSW-contributed RawEvents with a linked Event + non-null description.
  const rawEvents = await prisma.rawEvent.findMany({
    where: {
      sourceId: { in: lswSources.map((s) => s.id) },
      eventId: { not: null },
      event: { kennelId: kennel.id, description: { not: null } },
    },
    select: {
      rawData: true,
      event: { select: { id: true, description: true, locationName: true } },
    },
  });

  console.log(
    `Scanning ${rawEvents.length} LSW RawEvents linked to Events with populated description.`,
  );

  let moved = 0;
  let cleared = 0;
  let skipped = 0;
  for (const re of rawEvents) {
    if (!re.event) continue;
    const raw = re.rawData as { description?: unknown } | null;
    // Provenance guard: only act when a LEGACY LSW RawEvent snapshot (the old
    // mis-mapped adapter wrote the district name into `description`) matches
    // the Event's current description. Post-fix snapshots carry the text in
    // `location` — we deliberately don't treat that as provenance because a
    // coincidental description from another source or manual edit might match,
    // and `description: null` is irreversible. If a row has no legacy snapshot,
    // we leave it alone.
    const rawDescription = typeof raw?.description === "string" ? raw.description : null;
    if (rawDescription === null || re.event.description !== rawDescription) {
      skipped++;
      continue;
    }

    if (!re.event.locationName) {
      console.log(`  MOVE   ${re.event.id}: description="${re.event.description}" → locationName`);
      if (APPLY) {
        await prisma.event.update({
          where: { id: re.event.id },
          data: { locationName: re.event.description, description: null },
        });
      }
      moved++;
    } else {
      console.log(`  CLEAR  ${re.event.id}: locationName already "${re.event.locationName}", dropping stale description`);
      if (APPLY) {
        await prisma.event.update({
          where: { id: re.event.id },
          data: { description: null },
        });
      }
      cleared++;
    }
  }

  const action = APPLY ? "Updated" : "Would update";
  console.log(
    `\n${action} ${moved} rows (description→locationName), ${cleared} rows (clear duplicate). Skipped ${skipped} non-provenance-match.`,
  );
  if (!APPLY) console.log("Dry-run only. Re-run with --apply to write changes.");
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
