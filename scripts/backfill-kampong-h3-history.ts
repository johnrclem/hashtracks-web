/**
 * One-shot historical backfill for Kampong H3 (Singapore).
 * Issue #1364.
 *
 * `https://kampong.hash.org.sg/` publishes a single archive table that lists
 * every Kampong run since Run 1 on 1999-09-18 — ~295 historical events. The
 * live `KampongH3Adapter` only emits current + forward rows so the standard
 * reconcile window can't widen to import history (it would cancel anything
 * the next live scrape stops returning). The fix is a one-shot DB insert
 * that walks the same archive table and routes past rows through
 * `reportAndApplyBackfill`.
 *
 * Strategy:
 *   1. Fetch the homepage HTML via `fetchHTMLPage`.
 *   2. Reuse `parseKampongArchiveTable` from the adapter so the adapter and
 *      backfill agree on row shape (same date regex, same details split).
 *   3. Map each row to a minimal RawEventData: title = "Kampong H3 Run N",
 *      description = the free-form remainder of the row (verbatim hares /
 *      location / theme text — schema-gap #1365 work is deferred),
 *      startTime = 17:30 (kennel default — every run in the archive starts
 *      at 5:30PM SGT, confirmed by the static `Run starts 5:30PM` on the
 *      source page).
 *   4. `reportAndApplyBackfill` partitions to past-only (date < today in
 *      Asia/Singapore) and routes through the merge pipeline.
 *
 * Idempotency:
 *   The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)`. The
 *   fingerprint is deterministic over the parsed payload, so a second apply
 *   pass inserts zero new RawEvents on every row.
 *
 * Why attribute to "Kampong H3 Website":
 *   That source is already SourceKennel-linked to `kampong-h3` per
 *   prisma/seed-data/sources.ts:3434, so the merge pipeline's per-event
 *   source-kennel guard accepts the rows. Reconcile risk is zero —
 *   historical events are far outside the source's 90-day reconcile
 *   window, so future live scrapes won't touch them.
 *
 * Skip manifest enforcement:
 *   Four archive rows have ambiguous source dates (e.g. "February 2001"
 *   with no day; "17 or 24 November 2007"). They're in `KNOWN_SKIPPED_RUNS`
 *   below. Apply mode (BACKFILL_APPLY=1) refuses to run if any newly
 *   unparseable rows appear, forcing the operator to either patch the
 *   parser, update the allowlist after manual review, or backfill the
 *   missing rows by hand. Dry-run mode prints the full skip list and
 *   continues.
 *
 *   This means the backfill imports ~292 of the ~303 archive rows. The
 *   conservative drop avoids inventing source-attested dates (the 3rd
 *   Saturday of the month is a reasonable inference but not authoritative).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-kampong-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-kampong-h3-history.ts
 *   Env:      DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { fetchHTMLPage } from "@/adapters/utils";
import {
  parseKampongArchiveTable,
  KAMPONG_HOMEPAGE_URL,
  KAMPONG_KENNEL_TAG,
  KAMPONG_KENNEL_TIMEZONE,
  KAMPONG_DEFAULT_START_TIME,
} from "@/adapters/html-scraper/kampong-h3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Kampong H3 Website";

/**
 * Run numbers known to have ambiguous source dates (no day-of-month, or
 * "17 or 24" — author was unsure). Verified against the source archive
 * on 2026-05-11. Update this list — and submit a new backfill pass —
 * only after manually reviewing each newly-flagged row.
 */
const KNOWN_SKIPPED_RUNS = new Set<number>([18, 56, 69, 99]);

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching ${KAMPONG_HOMEPAGE_URL}`);
  const page = await fetchHTMLPage(KAMPONG_HOMEPAGE_URL);
  if (!page.ok) {
    throw new Error(`Homepage fetch failed: ${page.result.errors.join("; ")}`);
  }
  const { rows, skipped } = parseKampongArchiveTable(page.$);
  console.log(`  Parsed ${rows.length} rows, ${skipped.length} skipped.`);

  if (skipped.length > 0) {
    console.log("\n  Skipped rows (ambiguous source dates):");
    for (const s of skipped) {
      const known = KNOWN_SKIPPED_RUNS.has(s.runNumber) ? "known" : "UNEXPECTED";
      console.log(`    [${known}] Run ${s.runNumber} (${s.reason}): "${s.cellText}"`);
    }
    const unexpected = skipped.filter((s) => !KNOWN_SKIPPED_RUNS.has(s.runNumber));
    if (unexpected.length > 0 && process.env.BACKFILL_APPLY === "1") {
      throw new Error(
        `Backfill aborted: ${unexpected.length} unexpected skipped row(s) ` +
          `(${unexpected.map((s) => s.runNumber).join(", ")}). ` +
          `Review each, then either patch parseKampongArchiveTable or add the run ` +
          `numbers to KNOWN_SKIPPED_RUNS in scripts/backfill-kampong-h3-history.ts.`,
      );
    }
  }

  return rows.map((r) => ({
    date: r.date,
    kennelTags: [KAMPONG_KENNEL_TAG],
    runNumber: r.runNumber,
    title: `Kampong H3 Run ${r.runNumber}`,
    description: r.detailsRaw ?? undefined,
    startTime: KAMPONG_DEFAULT_START_TIME,
    sourceUrl: KAMPONG_HOMEPAGE_URL,
  }));
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KAMPONG_KENNEL_TIMEZONE,
  label: "Walking Kampong H3 archive table for historical runs",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
