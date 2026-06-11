/**
 * One-shot historical backfill for Lisbon H3 (lh3-pt).
 *
 * The live Harrier Central adapter (`harrier-central/adapter.ts`) reads HC's
 * `getEvents` API, which is FUTURE-ONLY — so past runs never reach canonical
 * Events through the normal scrape. (See memory
 * `reference_harrier_central_getevents_future_only`.) The full archive HC holds
 * is server-rendered on the hashruns.org public UI as JSON in the Next.js flight
 * data (`self.__next_f`).
 *
 * IMPORTANT COVERAGE NOTE: HC only holds LH3 from ~run #975 (Dec 2024) onward —
 * the kennel joined Harrier Central recently. `hashruns.org/LH3-PT/runs` exposes
 * runs #975→latest; per-run pages for older runs (e.g. /LH3-PT/500) 404. The
 * deep pre-HC archive (#1–#974, 1987→2024) is NOT in Harrier Central and is not
 * recoverable from this source — tracked as a follow-up to #2037. This script
 * therefore recovers ~40 genuinely-past runs (#975→just-before-today), which is
 * everything HC actually has, not the ~1000 the audit extrapolated from the run
 * number.
 *
 * The script fetches the SSR page LIVE (live-verification rule) and parses the
 * flight-data event objects. `reportAndApplyBackfill` partitions strictly on
 * `date < today (Europe/Lisbon)` so only past runs are written, and dedupes by
 * fingerprint on every re-run. Rows bind to the live "Lisbon H3 Harrier Central"
 * source (same data provider — provenance-correct; no separate archive source).
 *
 * Parsing + mapping live in the shared `hashruns-ssr-backfill` helper (extracted
 * in #2119 so Porto Invicta reuses the same logic).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-lh3-pt-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-lh3-pt-history.ts
 *
 * Requires the "Lisbon H3 Harrier Central" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { hashrunsSsrBackfill } from "./lib/hashruns-ssr-backfill";

hashrunsSsrBackfill({
  slug: "LH3-PT",
  kennelTag: "lh3-pt",
  kennelTimezone: "Europe/Lisbon",
  sourceName: "Lisbon H3 Harrier Central",
  // Mirror the live adapter's title synthesis so backfilled titles match what HC
  // would have produced (placeholder slots → "Lisbon H3 #N"). Same shape as the
  // seed config for this source.
  titleConfig: {
    defaultTitle: "Lisbon H3",
    staleTitleAliases: ["Placeholder event for LH3"],
  },
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
