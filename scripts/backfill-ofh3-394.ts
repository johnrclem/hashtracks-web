/**
 * One-shot: restore OFH3 Trail #394 (2026-01-10) — issue #1822.
 *
 * The event already exists in prod but was CANCELLED (it aged past the OFH3
 * source's 90-day scrape window — ~140 days back from the 2026-05-30 audit — so
 * a normal re-scrape never re-includes it, and the pre-#1821 adapter never set
 * its runNumber). This script re-confirms it and stamps runNumber=394.
 *
 * Durable: a 90-day scrape can't reach 2026-01-10, so reconcile/merge won't
 * touch this past event again. Idempotent — re-running is a no-op once fixed.
 *
 *   set -a && source ../<main>/.env && set +a   # prod DATABASE_URL
 *   npx tsx scripts/backfill-ofh3-394.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const TARGET_DATE = "2026-01-10";
const NEXT_DATE = "2026-01-11"; // exclusive upper bound = next midnight UTC
const RUN_NUMBER = 394;

async function main() {
  const events = await prisma.event.findMany({
    where: {
      eventKennels: { some: { kennel: { kennelCode: "ofh3" } } },
      // Half-open [TARGET, NEXT) so a row at exactly 23:59:59Z (or with
      // fractional ms) is not missed by a 23:59:59Z upper bound.
      dateUtc: { gte: new Date(`${TARGET_DATE}T00:00:00Z`), lt: new Date(`${NEXT_DATE}T00:00:00Z`) },
    },
    select: { id: true, status: true, runNumber: true, title: true, haresText: true },
  });

  if (events.length === 0) {
    console.error(`✗ No OFH3 event found on ${TARGET_DATE}. Aborting (expected the CANCELLED #394 row).`);
    process.exitCode = 1;
    return;
  }
  if (events.length > 1) {
    console.error(`✗ Expected exactly one OFH3 event on ${TARGET_DATE}, found ${events.length}. Aborting.`);
    process.exitCode = 1;
    return;
  }

  const e = events[0];
  console.log(`Found: id=${e.id} status=${e.status} run=${e.runNumber ?? "—"} "${e.title}" hares=${e.haresText ?? ""}`);

  if (e.status === "CONFIRMED" && e.runNumber === RUN_NUMBER) {
    console.log("✓ Already CONFIRMED with runNumber 394 — nothing to do.");
    return;
  }

  await prisma.event.update({
    where: { id: e.id },
    data: { status: "CONFIRMED", runNumber: RUN_NUMBER },
  });
  console.log(`✓ Restored OFH3 #${RUN_NUMBER} (${TARGET_DATE}) → CONFIRMED, runNumber=${RUN_NUMBER}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
