/**
 * One-shot restore of past runs that reconcile wrongly cancelled after their dates
 * on forward-only HC / Meetup sources (before 20261106040000 set upcomingOnly).
 * Owner-approved list (Nov 2026). Each row is restored only when it is still
 * CANCELLED, not admin-cancelled, and no other CONFIRMED event holds the same
 * kennel + date or kennel + run number.
 *
 *   Dry run:  BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/restore-hc-meetup-stale-cancels-nov-2026.ts
 *   Apply:    BACKFILL_APPLY=1 BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/restore-hc-meetup-stale-cancels-nov-2026.ts
 */
import "dotenv/config";
import { prisma } from "@/lib/db";

const IDS = [
  // Steel City H3 #22–#25
  "cmro87ne5000204l47d4x0hyw",
  "cmrsiu5t0000e04kz55qgizcv",
  "cmtqjegd7002604lcz0ryfhqu",
  "cmtqjege2002804lczss6a0rd",
  // Savannah H3
  "cmnxmv3od000f7bhnryynqi7f",
  "cmnxmv430000h7bhnvnjz99jp",
  "cmnxmv4ib000j7bhnf56h5nw0",
  "cmnxmv4q9000l7bhnobq8nq7c",
  // Asheville H3
  "cmo60ho0c000204jrty9fin0b",
  // Charleston Heretics
  "cmmobxwen001604jvcwcqfzg3",
  // WSH3 (Winterthur)
  "cmpsqigdz001004k0rq02vu5x",
];

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY" : "DRY RUN"}`);
  let restored = 0;
  for (const id of IDS) {
    const ev = await prisma.event.findUnique({
      where: { id },
      select: { id: true, kennelId: true, date: true, runNumber: true, title: true, status: true, adminCancelledAt: true },
    });
    const label = ev ? `${ev.date.toISOString().slice(0, 10)} #${ev.runNumber ?? "—"} ${ev.title ?? ""}` : id;
    if (!ev) { console.log(`  SKIP ${id}: gone`); continue; }
    if (ev.status !== "CANCELLED" || ev.adminCancelledAt) {
      console.log(`  SKIP ${label}: status ${ev.status}${ev.adminCancelledAt ? ", admin-cancelled" : ""}`);
      continue;
    }
    const clash = await prisma.event.findFirst({
      where: {
        kennelId: ev.kennelId,
        status: "CONFIRMED",
        id: { not: ev.id },
        OR: [{ date: ev.date }, ...(ev.runNumber == null ? [] : [{ runNumber: ev.runNumber }])],
      },
      select: { id: true },
    });
    if (clash) { console.log(`  SKIP ${label}: CONFIRMED clash ${clash.id}`); continue; }
    console.log(`  RESTORE ${label}`);
    if (apply) {
      const res = await prisma.event.updateMany({
        where: { id, status: "CANCELLED", adminCancelledAt: null },
        data: { status: "CONFIRMED" },
      });
      restored += res.count;
    }
  }
  console.log(apply ? `\nRestored ${restored}.` : "\nDry run complete.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
