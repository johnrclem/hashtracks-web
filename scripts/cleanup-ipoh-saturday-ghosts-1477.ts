/**
 * One-off cleanup for #1477 Ipoh H3 ghost Saturday events.
 *
 * Before #1477, the Ipoh H3 STATIC_SCHEDULE source had `rrule=FREQ=WEEKLY;BYDAY=SA`
 * and `startTime=17:00`, but the kennel actually runs Mondays @ 6:00 PM
 * (malaysiahash.com directory entry). Every event the adapter ever emitted
 * fell on the wrong day AND wrong time — pure placeholders, never a real run.
 *
 * After the seed change in #1477 lands and `npx prisma db seed` runs:
 *  - The Source.config is updated to `BYDAY=MO` / `startTime=18:00`.
 *  - The next scrape will emit fresh Monday@18:00 events going forward.
 *  - But the existing Saturday@17:00 canonical Events + their RawEvents stay in
 *    place — reconcile won't notice (the new schedule emits non-overlapping
 *    dates), the wrong-day events would persist forever on the kennel page,
 *    and the heatmap would keep counting them as real locations.
 *
 * This script removes them. Filter is tight enough to be safe:
 *  - kennel.kennelCode = "ipoh-h3"
 *  - Event.date day-of-week = Saturday (the wrong-config fingerprint)
 *  - Event.startTime = "17:00" (matches the wrong startTime exactly)
 *
 * Both past and upcoming Saturdays are deleted. The issue (#1477) calls past
 * cleanup "optional" but documents that the events are entirely fictional and
 * poison the kennel-page heatmap (30 fake locations). Since all upstream
 * Ipoh events come from this one STATIC_SCHEDULE source and the fingerprint
 * uniquely identifies the bug, full cleanup is safe.
 *
 * Uses cascadeDeleteEvents for FK-safe removal (unlinks RawEvents +
 * processed=false so they stay as audit trail, deletes EventHare/Attendance/
 * KennelAttendance + Event rows). Matches the admin bulkDeleteEvents() flow.
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a
 *   npx tsx scripts/cleanup-ipoh-saturday-ghosts-1477.ts            # dry-run
 *   npx tsx scripts/cleanup-ipoh-saturday-ghosts-1477.ts --execute  # delete
 *
 * IMPORTANT: .env must point at Railway prod for deletions to take effect.
 * Dry-run prints counts and a sample of doomed events without writing.
 */

import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";
import { cascadeDeleteEvents } from "./lib/cascade-delete";

const EXECUTE = process.argv.includes("--execute");
const KENNEL_CODE = "ipoh-h3";
const WRONG_DAY_OF_WEEK = 6; // Saturday (Date.getUTCDay() — 0=Sun, 6=Sat)
const WRONG_START_TIME = "17:00";

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  console.log(EXECUTE ? "✏️  EXECUTE — events will be deleted\n" : "🔍 DRY RUN — no deletions\n");

  const kennel = await prisma.kennel.findUnique({
    where: { kennelCode: KENNEL_CODE },
    select: { id: true, shortName: true },
  });
  if (!kennel) {
    console.error(`✗ Kennel "${KENNEL_CODE}" not found`);
    process.exit(1);
  }

  // Pull all Ipoh events with the wrong-config startTime. Day-of-week filtering
  // happens in JS because Postgres EXTRACT(DOW) is sensitive to the column
  // timezone interpretation and we store dates as UTC noon.
  const candidates = await prisma.event.findMany({
    where: { kennelId: kennel.id, startTime: WRONG_START_TIME },
    select: { id: true, date: true, startTime: true, status: true, title: true },
    orderBy: { date: "asc" },
  });

  const ghosts = candidates.filter((e) => e.date.getUTCDay() === WRONG_DAY_OF_WEEK);
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const past = ghosts.filter((e) => e.date < today);
  const upcoming = ghosts.filter((e) => e.date >= today);

  console.log(`Kennel:           ${kennel.shortName} (${kennel.id})`);
  console.log(`Filter:           startTime="${WRONG_START_TIME}" AND day-of-week=Saturday`);
  console.log(`Candidates:       ${candidates.length} (matching startTime)`);
  console.log(`Ghost matches:    ${ghosts.length} (matching day-of-week + startTime)`);
  console.log(`  - past:         ${past.length}`);
  console.log(`  - upcoming:     ${upcoming.length}`);

  if (ghosts.length > 0) {
    console.log(`\nFirst 5 doomed events (verifying fingerprint match):`);
    for (const e of ghosts.slice(0, 5)) {
      const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][e.date.getUTCDay()];
      console.log(`  ${e.date.toISOString().slice(0, 10)} ${dow} @ ${e.startTime}  [${e.status}]  "${e.title ?? ""}"`);
    }
  }

  if (!EXECUTE) {
    console.log(`\nDry run complete. Re-run with --execute to delete.`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  if (ghosts.length === 0) {
    console.log(`\n✓ Nothing to delete.`);
    await prisma.$disconnect();
    await pool.end();
    return;
  }

  const ids = ghosts.map((e) => e.id);
  const deleted = await cascadeDeleteEvents(prisma, ids);
  console.log(`\n✓ Deleted ${deleted} ghost events.`);

  await prisma.$disconnect();
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
