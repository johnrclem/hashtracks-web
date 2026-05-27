/**
 * One-shot historical backfill for LDS H3 (Salt Lake City Late Daylight Sucks
 * H3). Issue #1600.
 *
 * The Whoreman H3 Calendar (`4c78e8fc...@group.calendar.google.com`) is the
 * primary public source for four Utah kennels: wasatch-h3, lds-h3, slosh-h3,
 * slut-h3.
 *
 * Critical finding (2026-05-26 dry-run): the Google Calendar API
 * (`GoogleCalendarAdapter`) returns only 52 LDS events for this calendar,
 * but the public ICS feed exposes 74. The 22 missing events (covering
 * #580-#627, Feb-Jul 2024) ARE in the source but only via the ICS endpoint
 * — a known asymmetry between the v3 API and the basic.ics export. This
 * script hits the ICS feed directly via `ICalAdapter` to recover them.
 *
 * The Source row stays typed as `GOOGLE_CALENDAR` (so the live cron keeps
 * working — the API path is good for steady-state freshness, just lossy on
 * historical events). The script constructs an in-memory iCal-shaped
 * Source pointed at the ICS URL and routes the result through
 * `processRawEvents` bound to the real Source ID. Provenance stays honest
 * because the merge pipeline records sourceId, not adapter type.
 *
 * Sibling backfills: per-kennel tally is printed below. The same pass
 * recovers historical context for wasatch-h3 / slosh-h3 / slut-h3 too —
 * explicitly called out in the #1600 issue body as an intended bonus.
 *
 * Idempotent: `processRawEvents` dedupes by (sourceId, fingerprint), so
 * re-runs are no-ops.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-lds-h3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-lds-h3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { ICalAdapter } from "@/adapters/ical/adapter";
import { todayInTimezone } from "@/lib/timezone";
import { logPerKennelTally, mergeAndReport } from "./lib/backfill-reporting";

const SOURCE_NAME = "Whoreman H3 Calendar";
const TIMEZONE = "America/Denver";
const WINDOW_DAYS = 1500;
const ICS_URL =
  "https://calendar.google.com/calendar/ical/4c78e8fc64a9536fa1f839765faf0eb6169e19aaa485fa40cb423795ebdfe7cb%40group.calendar.google.com/public/basic.ics";

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  const todayIso = todayInTimezone(TIMEZONE);
  console.log(`LDS H3 (Whoreman calendar via ICS) historical backfill`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Window: ± ${WINDOW_DAYS} days. Today (${TIMEZONE}): ${todayIso}`);

  try {
    const sources = await prisma.source.findMany({ where: { name: SOURCE_NAME } });
    if (sources.length === 0) throw new Error(`Source "${SOURCE_NAME}" not found in DB.`);
    if (sources.length > 1) {
      throw new Error(`Multiple sources named "${SOURCE_NAME}" found (${sources.length}). Aborting.`);
    }
    const source = sources[0];

    // The seeded source has type=GOOGLE_CALENDAR + a kennel-ID URL. Shim a
    // copy that points at the public ICS feed so ICalAdapter can consume it.
    // The kennelPatterns + defaultKennelTag fields share the same shape
    // across both adapters, so kennel routing works identically. GCal-only
    // config keys are NOT honored by the iCal adapter:
    //   - `strictKennelRouting: true` → ICalAdapter has no equivalent.
    //     Unmatched events bucket into kennelTag "UNKNOWN" rather than
    //     getting dropped, which surfaces as a single Unmatched tag report
    //     from the merge pipeline (acceptable for a one-shot).
    //   - `defaultTitles: { "wasatch-h3": "Wasatch H3 Trail" }` → ICalAdapter
    //     does not substitute default titles, so backfilled Wasatch rows
    //     keep bare titles like "wasatch #1144" instead of the substituted
    //     "Wasatch H3 Trail #1144" the live GCal cron emits. Subsequent live
    //     cron writes will create a sibling RawEvent with the corrected
    //     title (different fingerprint) and the canonical resolution picks
    //     whichever has higher trust/recency. Storage overhead only — not
    //     user-visible.
    const icalShimmedSource = { ...source, url: ICS_URL };

    console.log(`\nFetching ICS from ${ICS_URL.slice(0, 80)}...`);
    const adapter = new ICalAdapter();
    const result = await adapter.fetch(icalShimmedSource, { days: WINDOW_DAYS });
    if (result.errors && result.errors.length > 0) {
      console.warn(`  Adapter reported ${result.errors.length} non-fatal error(s):`);
      for (const e of result.errors.slice(0, 5)) console.warn(`    ${e}`);
    }
    console.log(`  Adapter returned ${result.events.length} events.`);

    const historical = result.events.filter((e) => e.date < todayIso);
    console.log(`  Historical (date < ${todayIso}): ${historical.length}`);

    logPerKennelTally(historical);

    historical.sort((a, b) => a.date.localeCompare(b.date));
    if (historical.length > 0) {
      console.log(`\nDate range: ${historical[0].date} → ${historical.at(-1)!.date}`);
      const sampleIdx = [0, Math.floor(historical.length / 2), historical.length - 1];
      console.log("Samples (oldest, middle, newest):");
      for (const i of sampleIdx) {
        const e = historical[i];
        console.log(
          `  #${e.runNumber ?? "?"} ${e.date} ${e.kennelTags[0]} | ${e.title ?? "—"} | hares=${e.hares ?? "—"}`,
        );
      }
    }

    if (!apply) {
      console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
      return;
    }
    if (historical.length === 0) {
      console.log("\nNothing to insert.");
      return;
    }

    await mergeAndReport(source.id, historical);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
