/**
 * One-shot historical backfill for Seoul H3 (sh3-kr) — HashTracks' first South
 * Korea kennel ("Korea's Mother Hash", men-only, since 1972).
 *
 * The Seoul H3 adapter (src/adapters/html-scraper/seoul-h3.ts) fetches only the
 * single current run from index.php, so the on-site archive (run #2502 2015-06
 * → present, ~380 runs on archive.php) would never reach canonical Events on
 * its own.
 *
 * The archive was extracted once (parsed via the adapter's exported
 * `parseSeoulH3Events` over the live archive.php SSR page) and frozen into
 * `scripts/data/sh3-kr-history.json` — committed as data, no parser, per the
 * H7/Asunción/Brasília frozen-dataset lesson. PII was scrubbed at freeze time:
 * Korean mobile numbers embedded in hare lines (e.g. "(010-7152-6362)") and any
 * email addresses are removed — the merge pipeline's `sanitizeHares` only strips
 * trailing logistics, not mid-string phone numbers. The bulky recap `description`
 * prose was dropped for historical rows; the live adapter still captures it for
 * current runs. Rows bind to the live "Seoul H3 Website" source.
 *
 * Source-data quirks (stored faithfully; merge collapses same (kennel, date)):
 *   - ~9 special runs (anniversary dinners, "the REAL 2850th") carry no run
 *     number — kept with `runNumber` undefined.
 *   - A handful of dates repeat (two runs share 2015-07-11), so date-sorted run
 *     numbers are non-monotonic in a few places. Not synthesized or reordered.
 *
 * Re-runnable: the backfill runner dedupes by fingerprint and loads only past
 * events (date < today in Asia/Seoul); the current/future run stays the live
 * adapter's responsibility.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-sh3-kr-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sh3-kr-history.ts
 *
 * Requires the "Seoul H3 Website" source to exist (run `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import seoulHistory from "./data/sh3-kr-history.json";

runBackfillScript({
  sourceName: "Seoul H3 Website",
  kennelTimezone: "Asia/Seoul",
  label: "Loading curated Seoul H3 archive",
  fetchEvents: async () => seoulHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  // Set exitCode (not process.exit) so the runner's Prisma disconnect / event
  // loop can drain cleanly before the process terminates.
  process.exitCode = 1;
});
