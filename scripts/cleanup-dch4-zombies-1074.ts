/**
 * One-shot cleanup for issue #1074 — DCH4 zombie upcoming events.
 *
 * DCH4 post titles often omit the year ("DCH4 Trail# 2294 - 12/20 @ 5pm"). The
 * adapter previously defaulted the year to the *current* year, so an old
 * December run that resurfaced in a later post was stamped into a *future*
 * December (#2294 → 2026-12-20). That zombie outranked the real latest run
 * (#2310, May 2026) and drove the kennel's "Latest Run" header to 2294.
 *
 * The adapter fix in this PR (publish-date-anchored year inference,
 * `inferDch4Year`) stops new occurrences, but the existing zombie is a future
 * row the reconciler won't touch (HTML_SCRAPER reconcile against a wider window
 * would cancel legitimate past runs). This script removes it in place.
 *
 * Signature (re-runnable, not id-pinned): a future-dated DCH4 event with a
 * run number <= the highest *past* run number. A genuine future WordPress run
 * always has a higher number than every past run, so this only matches
 * mis-dated rows. We require a non-null runNumber on purpose: the dch4.org
 * WordPress title regex always yields one, whereas the Hash Rego source
 * (seeded for dch4) emits run-number-less registrations/campouts — those are
 * legitimate future events and must NOT be swept up (Codex review). Co-hosted
 * events primary-owned by another kennel (e.g. the DCFMH3 "Super Cold Moon"
 * full-moon trail) are already scoped out by Event.kennelId.
 *
 * Run:
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-dch4-zombies-1074.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-dch4-zombies-1074.ts --apply
 */
import { cascadeDeleteEvents } from "./lib/cascade-delete";
import { backfillLastEventDates } from "@/pipeline/backfill-last-event";
import { runOneShot, findKennelId } from "./lib/one-shot";

void runOneShot(async ({ prisma, apply }) => {
  const kennelId = await findKennelId(prisma, "dch4");
  if (!kennelId) return;

  const now = new Date();
  // Highest run number among PAST events — a real future run must exceed it.
  const pastAgg = await prisma.event.aggregate({
    where: { kennelId, date: { lte: now }, runNumber: { not: null } },
    _max: { runNumber: true },
  });
  const maxPastRun = pastAgg._max.runNumber ?? 0;
  console.log(`Highest past DCH4 run number: #${maxPastRun}`);

  const future = await prisma.event.findMany({
    where: { kennelId, date: { gt: now } },
    select: { id: true, runNumber: true, date: true, title: true },
    orderBy: { date: "asc" },
  });

  const zombies = future.filter((e) => e.runNumber != null && e.runNumber <= maxPastRun);
  console.log(`Future DCH4 events: ${future.length}; zombies (run# present and <= #${maxPastRun}): ${zombies.length}`);
  for (const e of zombies) {
    console.log(
      `  DELETE  ${e.id}  ${e.date.toISOString().slice(0, 10)}  run=${e.runNumber ?? "—"}  ${JSON.stringify(e.title)}`,
    );
  }

  if (apply && zombies.length > 0) {
    const deleted = await cascadeDeleteEvents(prisma, zombies.map((e) => e.id));
    console.log(`\n✓ Deleted ${deleted} zombie event(s).`);
    const touched = await backfillLastEventDates();
    console.log(`✓ Recomputed lastEventDate for ${touched} kennel(s).`);
  } else if (!apply) {
    console.log("\nRun with --apply to commit changes.");
  }
});
