/**
 * One-shot historical backfill for MiHiHuHa (Mile High Humpin' Hash, Denver).
 * Issue #1664.
 *
 * Premise: HashTracks oldest run on file is #416 (2023-04). The primary
 * `huhahareraiser@gmail.com` calendar carries ~44 hand-edited VEVENTs
 * spanning 2016-02-10 (#47) → 2018-09 (#160) — the kennel's pre-aggregator
 * history that no other source preserves.
 *
 * The catch (per the issue body): this calendar also harbors a stale
 * recurring rule that would materialize phantom 2017 weekly trails if the
 * live cron ran with a wide window. So we keep the live source's seeded
 * `scrapeDays: 90` UNTOUCHED and run a one-shot wide-window pull here,
 * filtered to the hand-edited slice only:
 *
 *   1. Date in [2016-01-01, 2018-12-31] — drops everything outside the
 *      known hand-edited era, including future ghost expansions.
 *   2. `runNumber !== undefined` — only events whose title carries an
 *      explicit `#N` survive. The hand-edited rows always do
 *      ("MiHiHuHa #47: Tunnel of Love"); the RRULE-noise rows don't.
 *
 * `runs #161–#415` (2018-10 → 2023-03) have no digital record — Apollo
 * Discord channel history is the only trace, and that's not crawlable
 * without OAuth. Deferred per the issue body.
 *
 * Idempotent: `processRawEvents` dedupes by (sourceId, fingerprint).
 * Bound to source: "Mile High Humpin Hash Calendar".
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-mihihuha-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-mihihuha-history.ts
 *   Env:       DATABASE_URL, GOOGLE_CALENDAR_API_KEY
 */

import "dotenv/config";
import { prisma } from "@/lib/db";
import { GoogleCalendarAdapter } from "@/adapters/google-calendar/adapter";
import type { RawEventData } from "@/adapters/types";
import { mergeAndReport } from "./lib/backfill-reporting";

const SOURCE_NAME = "Mile High Humpin Hash Calendar";
const WINDOW_DAYS = 4000;
const HAND_EDITED_START = "2016-01-01";
const HAND_EDITED_END = "2018-12-31";

/**
 * Hard-coded bare phantom titles emitted by the stale RRULE in the source
 * calendar. The dry-run-against-prod pass on 2026-05-26 found exactly two
 * distinct strings accounting for all 132 noise rows (118x + 14x); every
 * hand-edited event has a unique theme-appended title and survives.
 *
 * Trimmed-and-compared, case-sensitive on purpose — these are the literal
 * SUMMARY strings the calendar emits.
 */
const PHANTOM_TITLES: ReadonlySet<string> = new Set([
  "Mile High Humpin' Hash",
  "MiHiHuHa",
]);

/** Theme-separator markers that signal a hand-edited event whose title
 * carries a sub-name ("Mile High Humpin' Hash - Cream of Tuna",
 * "MiHiHuHa: Chip and Dale"). The phantom-title strings never contain
 * these; including them as a positive signal keeps the filter from being
 * fail-open against unknown future RRULE-noise variants. */
const THEME_SEPARATORS: readonly string[] = [" - ", " — ", " – ", ": ", " | "];

function hasThemeSeparator(title: string): boolean {
  return THEME_SEPARATORS.some((sep) => title.includes(sep));
}

/**
 * Filter the wide-window adapter output down to the hand-edited 2016-2018
 * slice. Pure function so the test can exercise it in isolation.
 *
 * Conditions (all must hold):
 *   - Date in the known hand-edited era [2016-01-01, 2018-12-31].
 *   - Title is NOT one of the two bare RRULE-phantom strings.
 *   - At least one POSITIVE hand-edited signal: a parsed run number, named
 *     hares, a populated location, or a theme separator in the title. Pure
 *     date+title-suffix events with no other content are dropped.
 *
 * The positive-signal requirement makes the filter fail-CLOSED: if a future
 * RRULE-noise variant escapes the phantom set (e.g. a typo'd "MiHiHuHa  "
 * with trailing whitespace, or a new bare title we haven't catalogued), it
 * won't slip through unless it also carries a hashing-event fingerprint.
 */
export function filterHandEditedMihiHuHa(events: readonly RawEventData[]): RawEventData[] {
  return events.filter((e) => {
    if (e.date < HAND_EDITED_START || e.date > HAND_EDITED_END) return false;
    const title = (e.title ?? "").trim();
    if (PHANTOM_TITLES.has(title)) return false;
    const hasRunNumber = e.runNumber !== undefined && e.runNumber !== null;
    const hasHares = typeof e.hares === "string" && e.hares.trim().length > 0;
    const hasLocation = typeof e.location === "string" && e.location.trim().length > 0;
    return hasRunNumber || hasHares || hasLocation || hasThemeSeparator(title);
  });
}

async function main(): Promise<void> {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`MiHiHuHa historical backfill: source="${SOURCE_NAME}"`);
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);
  console.log(`Window: ± ${WINDOW_DAYS} days, filtered to ${HAND_EDITED_START}..${HAND_EDITED_END}, RRULE-phantom titles dropped`);

  try {
    // Same uniqueness guard as scripts/lib/backfill-runner.ts — ambiguous
    // source names must abort, never silently bind to the first match.
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

    console.log("\nFetching from Google Calendar API...");
    const adapter = new GoogleCalendarAdapter();
    const result = await adapter.fetch(source, { days: WINDOW_DAYS });
    if (result.errors && result.errors.length > 0) {
      console.warn(`  Adapter reported ${result.errors.length} non-fatal error(s):`);
      for (const e of result.errors.slice(0, 5)) console.warn(`    ${e}`);
    }
    console.log(`  Adapter returned ${result.events.length} events.`);

    const handEdited = filterHandEditedMihiHuHa(result.events);
    console.log(`  After hand-edited filter: ${handEdited.length}`);

    handEdited.sort((a, b) => a.date.localeCompare(b.date));
    if (handEdited.length > 0) {
      console.log(`\nDate range: ${handEdited[0].date} → ${handEdited.at(-1)!.date}`);
      const sampleIdx = [0, Math.floor(handEdited.length / 2), handEdited.length - 1];
      console.log("Samples (oldest, middle, newest):");
      for (const i of sampleIdx) {
        const e = handEdited[i];
        console.log(
          `  #${e.runNumber ?? "?"} ${e.date} | ${e.title ?? "—"} | hares=${e.hares ?? "—"} | loc=${e.location ?? "—"}`,
        );
      }
    }

    if (!apply) {
      console.log("\nDry run complete. Re-run with BACKFILL_APPLY=1 to write to DB.");
      return;
    }
    if (handEdited.length === 0) {
      console.log("\nNothing to insert.");
      return;
    }

    await mergeAndReport(source.id, handEdited);
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1]?.endsWith("backfill-mihihuha-history.ts")) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
