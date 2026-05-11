/**
 * One-shot cleanup for #1324: the Hangover H3 (`h4`) kennel has two Event
 * rows for `runNumber=198` — one real (2025-01-01 "2025, A New Level" trail
 * at Patuxent River State Park) and one phantom (2024-01-01 with a Crystal
 * City Metro location). Hangover only had runs through ~#196 in late 2024,
 * so a "2025, A New Level" trail can't have happened in January 2024.
 *
 * The phantom row was likely created by an early Ghost-API ingestion that
 * fell back to `post.published_at` against a stale/republished post and
 * inferred wrong year. The current adapter no longer reproduces this — the
 * trail-text date parse wins over `published_at` (hangover.ts:301-306).
 *
 * This script deletes the phantom Event via the shared `cascadeDeleteEvents`
 * helper, which removes EventHare / Attendance / KennelAttendance dependents
 * and unlinks (rather than drops) any RawEvents pointing at the phantom so
 * the audit trail survives. We target the row by `(kennelId, runNumber=198,
 * date < 2025-01-01)` rather than by event id so the script is re-runnable
 * and explicit about the criteria.
 *
 * Runs in dry-run mode by default — pass `--apply` to write.
 *   npm run tsx scripts/cleanup-hangover-phantom-198.ts           # preview
 *   npm run tsx scripts/cleanup-hangover-phantom-198.ts -- --apply
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const APPLY = process.argv.includes("--apply");

async function main() {
  const kennel = await prisma.kennel.findFirst({ where: { kennelCode: "h4" } });
  if (!kennel) {
    console.error("Hangover (h4) kennel not found — aborting.");
    process.exit(1);
  }

  type Row = { id: string; date: Date; locationName: string | null; title: string | null };
  const phantoms: Row[] = await prisma.event.findMany({
    where: {
      kennelId: kennel.id,
      runNumber: 198,
      date: { lt: new Date("2025-01-01T00:00:00Z") },
    },
    select: { id: true, date: true, locationName: true, title: true },
  });

  console.log(`Found ${phantoms.length} phantom Event row(s) for h4 runNumber=198 with date<2025-01-01.`);
  for (const e of phantoms) {
    console.log(
      `  DELETE  ${e.id}  date=${e.date.toISOString().slice(0, 10)}  title=${JSON.stringify(e.title)}  locationName=${JSON.stringify(e.locationName)}`,
    );
  }

  if (APPLY && phantoms.length > 0) {
    // Use the shared cascade helper so EventHare / Attendance / KennelAttendance
    // dependents (which lack onDelete: Cascade) are removed in the right order
    // and RawEvent audit history is preserved (unlinked + reset processed=false)
    // rather than dropped — matches `deleteEventsCascade()` in admin actions.
    const deleted = await cascadeDeleteEvents(prisma, phantoms.map((e: Row) => e.id));
    console.log(`\nDeleted ${deleted} Event row(s) (dependents removed, RawEvent history unlinked).`);
  } else if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write changes.");
  }

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
