/**
 * One-shot cleanup for the Oregon Hashing Calendar Kahuna/OKH3 misattribution
 * reported in #1867.
 *
 * Background:
 *   The shared Oregon Hashing Calendar (GOOGLE_CALENDAR) cross-posts Kahuna H3
 *   (okh3) trails. Before PR (this change) the aggregate had no Kahuna routing
 *   pattern, so every "Kahuna …" / "Kah-Two-Na" / "Ka-Three-Na" title fell
 *   through to `defaultKennelTag: "oh3"` and landed on Oregon H3. okh3 has its
 *   OWN dedicated calendar source, so the PR adds these prefixes to the Oregon
 *   aggregate's `skipPatterns` (same precedent as No Name H3). Future scrapes
 *   no longer create these rows on oh3.
 *
 *   This script repairs the already-ingested canonical Events. okh3's own
 *   calendar does NOT cover these historical 2025 dates (verified), so they are
 *   REASSIGNED to okh3 (not deleted) to preserve the kennel's history — per the
 *   reassign-don't-insert precedent. A row is deleted only if okh3 already has a
 *   confirmed event on the same date (a true duplicate).
 *
 * Why reassignment survives reconcile:
 *   - The Oregon reconciler only considers events whose kennelId is in the
 *     source's linked kennels (oh3/tgif/cch3-or). okh3 is intentionally NOT
 *     linked, so reassigned okh3 events are invisible to it.
 *   - The okh3 reconciler excludes events backed by RawEvents from other
 *     sources; these are backed by the Oregon source, so it won't cancel them.
 *
 * Match by SIGNATURE, not hard-coded ids (a cron in the seed→cleanup gap may
 * re-create rows under new ids; #1867 cleanup must stay idempotent).
 *
 * Targets (ALL conditions must hold):
 *   - current primary kennel = oh3
 *   - title matches an anchored Kahuna/okh3 prefix (the same skip patterns;
 *     a leading-OH3 joint title like "OH3 Full Moon #1333 (Kahuna combo??)"
 *     is therefore NEVER touched)
 *   - zero attendances and no admin lock (adminCancelledAt null)
 *
 * Usage:
 *   Dry run: npx tsx scripts/cleanup-oregon-kahuna-misroute.ts
 *   Apply:   CLEANUP_APPLY=1 npx tsx scripts/cleanup-oregon-kahuna-misroute.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";
import { reassignEventKennel } from "./lib/event-reassign";

const APPLY = process.env.CLEANUP_APPLY === "1";

// Anchored prefixes — mirror the Oregon source `skipPatterns` so the set of
// reassigned events exactly matches the set the adapter now drops.
const KAHUNA_PREFIX = /^(?:Kahuna|Ka3na|Katuna|Kah-Two-Na|Ka-Three-Na)\b/i;

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function main() {
  const kennels = await prisma.kennel.findMany({
    where: { kennelCode: { in: ["oh3", "okh3"] } },
    select: { id: true, kennelCode: true },
  });
  const oh3 = kennels.find((k) => k.kennelCode === "oh3")?.id;
  const okh3 = kennels.find((k) => k.kennelCode === "okh3")?.id;
  if (!oh3 || !okh3) throw new Error("oh3/okh3 kennel ids not found");

  // All oh3-primary events whose title starts with a Kahuna/okh3 prefix.
  const candidates = await prisma.event.findMany({
    where: {
      kennelId: oh3,
      OR: [
        { title: { startsWith: "Kahuna", mode: "insensitive" } },
        { title: { startsWith: "Ka3na", mode: "insensitive" } },
        { title: { startsWith: "Katuna", mode: "insensitive" } },
        { title: { startsWith: "Kah-Two-Na", mode: "insensitive" } },
        { title: { startsWith: "Ka-Three-Na", mode: "insensitive" } },
      ],
    },
    select: {
      id: true, date: true, title: true, runNumber: true, status: true, adminCancelledAt: true,
      eventKennels: { select: { kennelId: true, isPrimary: true } },
      _count: { select: { attendances: true } },
    },
    orderBy: { date: "asc" },
  });

  // Defense-in-depth: re-assert the anchored regex (DB startsWith is a coarse
  // prefilter) and the safety guards.
  const targets = candidates.filter(
    (e) => e.title && KAHUNA_PREFIX.test(e.title) && e._count.attendances === 0 && !e.adminCancelledAt,
  );
  const skipped = candidates.filter((e) => !targets.includes(e));

  console.log(`[cleanup] ${APPLY ? "APPLY" : "DRY-RUN"} — ${targets.length} reassignment target(s), ${skipped.length} skipped`);
  for (const e of skipped) {
    console.log(`  SKIP   ${isoDate(e.date)} "${e.title}" (att=${e._count.attendances}, adminLock=${!!e.adminCancelledAt})`);
  }

  let reassigned = 0;
  let deletedDup = 0;
  let skippedDependent = 0;
  for (const e of targets) {
    const dupOnOkh3 = await prisma.event.findFirst({
      where: { kennelId: okh3, date: e.date, id: { not: e.id } },
      select: { id: true, status: true },
    });

    if (dupOnOkh3) {
      // Only an Event with no dependent rows can be hard-deleted: KennelAttendance
      // and EventHare have RESTRICT FKs (no cascade), so delete() would throw.
      const [kennelAtt, hares] = await Promise.all([
        prisma.kennelAttendance.count({ where: { eventId: e.id } }),
        prisma.eventHare.count({ where: { eventId: e.id } }),
      ]);
      if (kennelAtt > 0 || hares > 0) {
        console.log(`  SKIP   ${isoDate(e.date)} "${e.title}" — dup of okh3 ${dupOnOkh3.id} but has dependent rows (kennelAtt=${kennelAtt}, hares=${hares}); needs manual merge`);
        skippedDependent++;
        continue;
      }
      console.log(`  DELETE ${isoDate(e.date)} "${e.title}" — duplicate of okh3 event ${dupOnOkh3.id}`);
      if (APPLY) {
        await prisma.$transaction([
          prisma.eventLink.deleteMany({ where: { eventId: e.id } }),
          prisma.event.delete({ where: { id: e.id } }), // EventKennel cascades
        ]);
      }
      deletedDup++;
      continue;
    }

    console.log(`  MOVE   ${isoDate(e.date)} "${e.title}" oh3 → okh3 (run=${e.runNumber ?? "—"}, status ${e.status}→CONFIRMED)`);
    if (APPLY) {
      // Shared composite-PK-safe swap (handles the okh3-already-co-host case);
      // same helper the other cross-kennel conflation fixers use.
      await reassignEventKennel(prisma, e.id, oh3, okh3);
      if (e.status !== "CONFIRMED") {
        await prisma.event.update({ where: { id: e.id }, data: { status: "CONFIRMED" } });
      }
    }
    reassigned++;
  }

  console.log(`[cleanup] done — reassigned=${reassigned}, deletedDup=${deletedDup}, skippedDependent=${skippedDependent}${APPLY ? "" : " (dry-run, no writes)"}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
