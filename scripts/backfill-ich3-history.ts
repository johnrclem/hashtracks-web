/**
 * One-shot historical backfill for ICH3 (Iron City Hash House Harriers,
 * Pittsburgh). Issue #1339.
 *
 * Drives the `Iron City H3 iCal Feed` source with a 1500-day window. The
 * iCal adapter derives its lookback from `source.scrapeDays`, so a wider
 * window pulls past events as well as future ones. The seed already carries
 * `scrapeDays: 1500` (post-#1339), but the prod cron honors `Source.scrapeDays`
 * from the DB row — only refreshed when `npx prisma db seed` runs. This
 * script bypasses the wait by driving the adapter directly.
 *
 * Per the issue body the feed exposes ~40+ past events back to mid-2024.
 * The wide window also picks up the upcoming `IC-Lite#25` event that's been
 * missing — same kennel, just a different series prefix mapped to `ich3` via
 * the source's `defaultKennelTag`.
 *
 * No iCal-backfill helper exists (vs. scripts/lib/gcal-backfill.ts), so this
 * inlines the same shape: uniqueness-guard on source name, fetch with explicit
 * `days`, partition (we keep BOTH past and future here — the upcoming
 * IC-Lite#25 case is part of the close criteria), route through
 * `processRawEvents`.
 *
 * Idempotent: `processRawEvents` dedupes by (sourceId, fingerprint).
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-ich3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-ich3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { ICalAdapter } from "@/adapters/ical/adapter";
import { todayInTimezone } from "@/lib/timezone";
import { logPerKennelTally, mergeAndReport } from "./lib/backfill-reporting";

const SOURCE_NAME = "Iron City H3 iCal Feed";
const WINDOW_DAYS = 1500;
const TIMEZONE = "America/New_York";
/**
 * URL override — see seed comment at prisma/seed-data/sources.ts:1188. The
 * historical seeded URL (`?post_type=tribe_events&ical=1&eventDisplay=list`)
 * returns HTTP 200 + Content-Length: 0 when the kennel has no upcoming
 * events; the `events/list/?eventDisplay=past&ical=1` form returns past
 * events as proper VCALENDAR. The seed URL is INTENTIONALLY left at the
 * upcoming variant — it'll start working again once the kennel schedules
 * new events, and the past-tab URL doesn't surface upcoming events for the
 * live cron. This script-only override exists so the historical backfill
 * can pull past events independently of live-cron URL semantics.
 */
const FEED_URL_OVERRIDE = "https://ironcityh3.com/events/list/?eventDisplay=past&ical=1";

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  const todayIso = todayInTimezone(TIMEZONE);
  console.log(`ICH3 iCal historical backfill: source="${SOURCE_NAME}"`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Window: ± ${WINDOW_DAYS} days. Today (${TIMEZONE}): ${todayIso}`);

  try {
    const sources = await prisma.source.findMany({ where: { name: SOURCE_NAME } });
    if (sources.length === 0) {
      throw new Error(`Source "${SOURCE_NAME}" not found in DB. Run prisma db seed first.`);
    }
    if (sources.length > 1) {
      throw new Error(
        `Multiple sources named "${SOURCE_NAME}" found (${sources.length}). Aborting to avoid writing to the wrong one.`,
      );
    }
    const source = sources[0];

    console.log("\nFetching iCal feed...");
    const adapter = new ICalAdapter();
    // Shallow copy with the working URL — see FEED_URL_OVERRIDE comment above.
    const sourceWithOverride = { ...source, url: FEED_URL_OVERRIDE };
    if (source.url !== FEED_URL_OVERRIDE) {
      console.log(`  URL override: ${source.url} → ${FEED_URL_OVERRIDE}`);
    }
    const result = await adapter.fetch(sourceWithOverride, { days: WINDOW_DAYS });
    if (result.errors && result.errors.length > 0) {
      console.warn(`  Adapter reported ${result.errors.length} non-fatal error(s):`);
      for (const e of result.errors.slice(0, 5)) console.warn(`    ${e}`);
    }
    console.log(`  Adapter returned ${result.events.length} events.`);

    const past = result.events.filter((e) => e.date < todayIso);
    const future = result.events.filter((e) => e.date >= todayIso);
    console.log(`  Past: ${past.length} | Upcoming: ${future.length}`);

    // Per-kennel tally — primarily `ich3`, but logs distinct tags in case
    // the kennel map gains siblings later.
    logPerKennelTally(result.events);

    const sortedAll = [...result.events].sort((a, b) => a.date.localeCompare(b.date));
    if (sortedAll.length > 0) {
      console.log(`\nDate range: ${sortedAll[0].date} → ${sortedAll.at(-1)!.date}`);
      console.log("Samples (oldest, middle, newest):");
      const sampleIdx = [0, Math.floor(sortedAll.length / 2), sortedAll.length - 1];
      for (const i of sampleIdx) {
        const e = sortedAll[i];
        console.log(
          `  #${e.runNumber ?? "?"} ${e.date} | ${e.title ?? "—"} | hares=${e.hares ?? "—"} | loc=${e.location ?? "—"}`,
        );
      }
    }

    if (!apply) {
      console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
      return;
    }
    if (result.events.length === 0) {
      console.log("\nNothing to insert.");
      return;
    }

    // Defensive: before writing past events, ensure the live source has
    // `upcomingOnly: true` in its config so the next live cron tick won't
    // reconcile-cancel everything we're about to insert. The seed already
    // declares this (see seed comment), but the prod DB only picks it up
    // after `npx prisma db seed` runs — this update bridges the gap.
    // Idempotent: a subsequent seed run will overwrite back to the same value.
    const existingConfig = (source.config as Record<string, unknown> | null) ?? {};
    if (existingConfig.upcomingOnly === true) {
      console.log(`  Source.config.upcomingOnly already true — skipping config update.`);
    } else {
      const newConfig = { ...existingConfig, upcomingOnly: true };
      await prisma.source.update({
        where: { id: source.id },
        data: { config: newConfig },
      });
      console.log(`  Set Source.config.upcomingOnly=true on "${source.name}" (prevents reconcile-cancel of backfilled past events).`);
    }

    await mergeAndReport(source.id, result.events);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
