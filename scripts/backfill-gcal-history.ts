/**
 * One-shot wide-window historical backfill for GOOGLE_CALENDAR sources whose
 * recurring `scrapeDays` is intentionally bounded (#2009 PGH H3, #1989 Pedal
 * Files).
 *
 * WHY OUT-OF-BAND (and not just a big recurring scrapeDays)
 * ---------------------------------------------------------
 * `scrapeSource` feeds the SAME `days` into both the adapter fetch AND
 * `reconcileStaleEvents` (reconcile.ts:147 → `timeMax = now + days`). The Google
 * Calendar adapter caps its future fetch at 365 days (`futureHorizonDays`), so a
 * permanently-large `scrapeDays` would let reconcile cancel sole-source events in
 * the unfetched `[now+365d, now+9999d]` gap, and would re-fetch + reconcile the
 * entire ~900-event archive every 6h. So recurring `scrapeDays` stays at 365 and
 * the deep archive is pulled here in a SINGLE pass.
 *
 * A single wide pass is safe: the adapter returns a SUPERSET of every narrower
 * fetch, so every CONFIRMED candidate in reconcile's window (including the
 * historical events the same run just merged in) is matched — nothing orphaned,
 * nothing cancelled. We call `scrapeSource` WITHOUT `force` so (a) the RawEvent
 * audit trail is preserved (force deletes it) and (b) reconcile actually runs
 * (it's gated on `!force`), letting us assert `cancelled === 0` as a real
 * regression check rather than a vacuous one.
 *
 * Targets (run PGH only AFTER WS1's PGH run-number parser fix is on main — see
 * the #2009 caveat; otherwise the `Hash NNNN:` variants re-import malformed):
 *   - "Pedal Files Bash Google Calendar"  (2018-03 → present, ~56→130 events)
 *   - "Pittsburgh Hash Calendar"          (2008-12 → present, ~900 events)
 *
 * Usage:
 *   eval "$(fnm env)" && fnm use 20
 *   set -a && source .env && set +a   # GOOGLE_CALENDAR_API_KEY + prod DATABASE_URL
 *   npx tsx scripts/backfill-gcal-history.ts                                  # dry-run (lists targets)
 *   npx tsx scripts/backfill-gcal-history.ts --execute                        # backfill all targets
 *   npx tsx scripts/backfill-gcal-history.ts --execute --source "Pedal Files Bash Google Calendar"
 *
 * IMPORTANT: .env must point at Railway prod for the backfill to land there.
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { scrapeSource } from "@/pipeline/scrape";

const EXECUTE = process.argv.includes("--execute");
const sourceFlagIdx = process.argv.indexOf("--source");
const SOURCE_FILTER = sourceFlagIdx >= 0 ? process.argv[sourceFlagIdx + 1] : undefined;

const BACKFILL_DAYS = 9999;

const TARGETS = [
  "Pedal Files Bash Google Calendar",
  "Pittsburgh Hash Calendar",
];

async function main() {
  if (!process.env.GOOGLE_CALENDAR_API_KEY) {
    throw new Error("GOOGLE_CALENDAR_API_KEY not set — `set -a && source .env` first.");
  }
  console.log(`\n=== backfill-gcal-history ===`);
  console.log(`Mode: ${EXECUTE ? "EXECUTE (will scrape + merge into the DB)" : "DRY-RUN"}`);
  console.log(`Window: days=${BACKFILL_DAYS} (future side still capped at 365 by the adapter)\n`);

  const names = SOURCE_FILTER ? [SOURCE_FILTER] : TARGETS;
  let hadError = false;

  for (const name of names) {
    const source = await prisma.source.findFirst({ where: { name } });
    if (!source) {
      console.error(`✗ Source "${name}" not found — skipping.`);
      hadError = true;
      continue;
    }
    if (source.type !== "GOOGLE_CALENDAR") {
      console.error(`✗ Source "${name}" is ${source.type}, not GOOGLE_CALENDAR — skipping.`);
      hadError = true;
      continue;
    }

    if (!EXECUTE) {
      console.log(`  • would backfill "${name}" (id=${source.id}) with days=${BACKFILL_DAYS}`);
      continue;
    }

    console.log(`\n→ Backfilling "${name}" (id=${source.id})…`);
    const result = await scrapeSource(source.id, { days: BACKFILL_DAYS });
    console.log(
      `  success=${result.success} eventsFound=${result.eventsFound} ` +
        `created=${result.created} updated=${result.updated} ` +
        `skipped=${result.skipped} cancelled=${result.cancelled}`,
    );
    if (result.errors.length > 0) {
      console.error(`  errors: ${result.errors.join("; ")}`);
      hadError = true;
    }
    // A wide pass must never cancel: the fetch is a superset of any narrower one,
    // so an existing CONFIRMED canonical going orphaned means a real fetch/merge
    // regression — fail loud rather than let the archive get silently CANCELLED.
    if (result.cancelled > 0) {
      console.error(
        `  ⚠ ${result.cancelled} event(s) CANCELLED during a wide backfill pass — ` +
          `this should be 0. Investigate before trusting the run.`,
      );
      hadError = true;
    }
  }

  if (!EXECUTE) {
    console.log(`\nDry-run complete. Re-run with --execute to backfill.`);
  }
  if (hadError) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
