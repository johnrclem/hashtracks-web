/**
 * One-shot historical backfill for Porto Invicta H3 (pih3).
 *
 * Same root cause + mechanism as Lisbon (#2048): the live Harrier Central
 * adapter reads HC's `getEvents` API, which is FUTURE-ONLY (see memory
 * `reference_harrier_central_getevents_future_only`), so none of PIH3's past
 * runs reach canonical Events through the normal scrape (#2119: 0 of ~27 past
 * runs ingested). The full archive HC holds is server-rendered on the
 * hashruns.org public UI as JSON in the Next.js flight data.
 *
 * COVERAGE: PIH3 is a young kennel — `hashruns.org/PIH3/runs` exposes the FULL
 * archive from run #1 (2025-01-04) onward (~36 genuinely-past runs as of mid-2026,
 * more than the audit's ~27 estimate). Unlike Lisbon, there is no deeper pre-HC
 * archive to chase.
 *
 * The script fetches the SSR page LIVE (live-verification rule) via the shared
 * `hashruns-ssr-backfill` helper. `reportAndApplyBackfill` partitions strictly
 * on `date < today (Europe/Lisbon)` so only past runs are written, and dedupes
 * by fingerprint on every re-run. Rows bind to the live "Porto Invicta H3 Harrier
 * Central" source (same data provider — provenance-correct).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-pih3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-pih3-history.ts
 *
 * Requires the "Porto Invicta H3 Harrier Central" source to exist (run
 * `npx prisma db seed`) with its `pih3` SourceKennel link.
 */
import "dotenv/config";
import { hashrunsSsrBackfill } from "./lib/hashruns-ssr-backfill";

hashrunsSsrBackfill({
  slug: "PIH3",
  kennelTag: "pih3",
  kennelTimezone: "Europe/Lisbon", // Portugal mainland (Porto) — single national TZ
  sourceName: "Porto Invicta H3 Harrier Central",
  // Mirror the live adapter's title synthesis so backfilled titles match what HC
  // would have produced (placeholder slots → "Porto Invicta H3 #N"). Same shape
  // as the seed config for this source.
  titleConfig: {
    defaultTitle: "Porto Invicta H3",
    staleTitleAliases: ["Placeholder event for PIH3"],
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
