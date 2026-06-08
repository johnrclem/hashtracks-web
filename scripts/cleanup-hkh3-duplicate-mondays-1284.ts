/**
 * One-shot cleanup for issue #1284 — HK H3 duplicate-Monday enrichment.
 *
 * hkhash.com's homepage shows a single "Next H4 Run" block with no explicit
 * date. The adapter dates it to the next Monday, but the homepage has been
 * stale at "Run Number 2969" for weeks, so successive weekly scrapes stamped
 * #2969 (+ "Hollywood Park Road") onto multiple consecutive Mondays — a
 * duplicate run number across several canonical events.
 *
 * The adapter fix in this PR (HK-timezone + 18:00 run-time aware
 * `nextMondayOnOrAfter`) stops it from stamping an already-past Monday, but the
 * existing duplicates must be reset. This reverts every hkh3 event whose run
 * number is shared across ≥2 dates back to the generic STATIC_SCHEDULE
 * placeholder, so the next scrape re-enriches only the single true upcoming
 * Monday. (A non-updating homepage can still re-stamp a stale number — that's a
 * documented source-freshness limitation.)
 *
 * Re-runnable: matches only run numbers that currently appear on >1 date.
 *
 * Run:
 *   Dry-run: set -a && source .env && set +a && BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-hkh3-duplicate-mondays-1284.ts
 *   Apply:   BACKFILL_ALLOW_SELF_SIGNED_CERT=1 npx tsx scripts/cleanup-hkh3-duplicate-mondays-1284.ts --apply
 */
import { runOneShot, findKennelId } from "./lib/one-shot";

// Generic STATIC_SCHEDULE placeholder values (observed on un-enriched Mondays).
const GENERIC_TITLE = "HK H3 Weekly Run";
const GENERIC_LOCATION = "Hong Kong";

runOneShot(async ({ prisma, apply }) => {
  const kennelId = await findKennelId(prisma, "hkh3");
  if (!kennelId) return;

  const events = await prisma.event.findMany({
    where: { kennelId, runNumber: { not: null } },
    select: { id: true, runNumber: true, date: true, title: true, locationName: true },
    orderBy: { date: "asc" },
  });

  // Run numbers that appear on more than one distinct date = duplicated.
  const datesByRun = new Map<number, Set<string>>();
  for (const e of events) {
    const run = e.runNumber;
    if (run == null) continue; // the query excludes nulls; this narrows the type
    const day = e.date.toISOString().slice(0, 10);
    let days = datesByRun.get(run);
    if (!days) {
      days = new Set();
      datesByRun.set(run, days);
    }
    days.add(day);
  }
  const dupRuns = new Set([...datesByRun].filter(([, days]) => days.size > 1).map(([run]) => run));
  const toReset = events.filter((e) => e.runNumber != null && dupRuns.has(e.runNumber));

  const dupLabel = [...dupRuns].map((r) => "#" + r).join(", ") || "(none)";
  console.log(`Duplicated run numbers: ${dupLabel}`);
  console.log(`Events to reset to generic placeholder: ${toReset.length}`);
  for (const e of toReset) {
    console.log(
      `  RESET  ${e.id}  ${e.date.toISOString().slice(0, 10)}  #${e.runNumber}  ${JSON.stringify(e.title)} / ${JSON.stringify(e.locationName)}`,
    );
  }

  if (apply && toReset.length > 0) {
    await prisma.event.updateMany({
      where: { id: { in: toReset.map((e) => e.id) } },
      // Revert to the generic placeholder; null the enrichment-only fields so
      // the next scrape re-fills the true upcoming Monday cleanly.
      data: {
        runNumber: null,
        title: GENERIC_TITLE,
        locationName: GENERIC_LOCATION,
        locationStreet: null,
        locationAddress: null,
        locationCity: null,
        latitude: null,
        longitude: null,
        description: null,
      },
    });
    console.log(`\n✓ Reset ${toReset.length} event(s) to the generic placeholder.`);
  } else if (!apply) {
    console.log("\nRun with --apply to commit changes.");
  }
});
