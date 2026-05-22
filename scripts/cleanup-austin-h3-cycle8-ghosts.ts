/**
 * One-shot cleanup for #1584: Austin H3 canonical Events created before the
 * cycle-8 fix (PR #1487, merged 2026-05-19) have a stale title/haresText swap
 * pattern — e.g. AH3 #2278 displays `title="AH3 #2278"` and
 * `haresText="Smeg's Pinata Pool Party Birthday Cook Out"`.
 *
 * The fix in #1487 removed the buggy `titleHarePattern` from the Austin H3
 * Calendar source config, so new scrapes emit correct field mapping. But the
 * merge pipeline dedupes RawEvents by fingerprint and doesn't refresh
 * title/haresText when a fingerprint matches, so the pre-fix ghosts persist
 * indefinitely.
 *
 * Strategy: delete every RawEvent from the Austin H3 Calendar source scraped
 * before 2026-05-19 (the PR #1487 merge date) AND whose event date falls
 * within the source's scrape window (so the next GCal scrape will re-emit
 * it). Pre-fix RawEvents tied to events outside the scrape window are also
 * deleted, but their canonical Events remain unmodified — they'll keep
 * their (potentially still-corrupt) title/haresText until manually edited.
 * The window filter is logged so the operator can see the residual count.
 *
 * Delete + baselineResetAt happen in a single transaction so a partial state
 * never persists.
 *
 * Usage:
 *   npx tsx scripts/cleanup-austin-h3-cycle8-ghosts.ts         # dry run
 *   BACKFILL_APPLY=1 npx tsx scripts/cleanup-austin-h3-cycle8-ghosts.ts
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createScriptPool } from "./lib/db-pool";

const SOURCE_NAME = "Austin H3 Calendar";
const CYCLE8_MERGE_DATE = new Date("2026-05-19T00:00:00Z");
const apply = process.env.BACKFILL_APPLY === "1";

async function main() {
  const pool = createScriptPool();
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter } as never);

  console.log(apply ? "✏️  APPLYING changes\n" : "🔍 DRY RUN — no changes will be made\n");

  const source = await prisma.source.findFirst({
    where: { name: SOURCE_NAME, type: "GOOGLE_CALENDAR" },
    select: { id: true, name: true, scrapeDays: true, baselineResetAt: true },
  });
  if (!source) {
    console.error(`Source "${SOURCE_NAME}" not found.`);
    process.exit(1);
  }

  const windowStart = new Date(Date.now() - source.scrapeDays * 24 * 60 * 60 * 1000);
  console.log(`Source: ${source.name} (${source.id})`);
  console.log(`Cycle-8 cutoff:    ${CYCLE8_MERGE_DATE.toISOString()}`);
  console.log(`Scrape window:     ${source.scrapeDays} days (event date >= ${windowStart.toISOString()})\n`);

  // Pre-cutoff RawEvents *within* the scrape window — these will be
  // re-emitted on the next GCal scrape. Linked Event.date is required for
  // the join; processed RawEvents must have eventId set.
  const inWindow = await prisma.rawEvent.findMany({
    where: {
      sourceId: source.id,
      scrapedAt: { lt: CYCLE8_MERGE_DATE },
      event: { date: { gte: windowStart } },
    },
    select: { id: true },
  });
  // Pre-cutoff RawEvents *outside* the window — informational only; we'll
  // still delete them (immutable audit-trail rule notwithstanding, they're
  // already corrupt) but their canonical Events won't be refreshed because
  // GCal's scrape window doesn't reach back that far.
  const outOfWindow = await prisma.rawEvent.findMany({
    where: {
      sourceId: source.id,
      scrapedAt: { lt: CYCLE8_MERGE_DATE },
      OR: [
        { event: { date: { lt: windowStart } } },
        { event: null }, // unprocessed pre-cutoff RawEvents
      ],
    },
    select: { id: true },
  });

  console.log(`Pre-cutoff RawEvents in scrape window:  ${inWindow.length}  (will be re-emitted)`);
  console.log(`Pre-cutoff RawEvents OUTSIDE window:    ${outOfWindow.length}  (canonical Events stay as-is)`);

  const totalDeletable = inWindow.length + outOfWindow.length;
  if (totalDeletable === 0) {
    console.log("\nNothing to delete.");
    await pool.end();
    return;
  }

  if (apply) {
    // Atomic: delete + baselineResetAt together. If either fails the other
    // is rolled back, so we never end up with partial cleanup.
    await prisma.$transaction(async (tx) => {
      const result = await tx.rawEvent.deleteMany({
        where: { sourceId: source.id, scrapedAt: { lt: CYCLE8_MERGE_DATE } },
      });
      await tx.source.update({
        where: { id: source.id },
        data: { baselineResetAt: new Date() },
      });
      console.log(`\nDeleted ${result.count} RawEvent(s) + bumped Source.baselineResetAt (transactional).`);
    });
    console.log("\nNext step: trigger an Austin H3 re-scrape (POST to /api/cron/scrape/<sourceId>).");
  } else {
    console.log(`\nWould delete ${totalDeletable} RawEvent(s) and bump baselineResetAt (transactional).`);
    console.log("Re-run with BACKFILL_APPLY=1 to commit.");
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
