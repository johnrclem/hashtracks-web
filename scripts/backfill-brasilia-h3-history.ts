/**
 * One-shot historical backfill for Brasilia H3 (brasilia-h3) — HashTracks'
 * first Brazil kennel.
 *
 * The Brasilia H3 adapter (src/adapters/html-scraper/brasilia-h3.ts) fetches
 * only a recent window of Blogspot posts, so the full archive (run #154
 * 2019-04 → #338 2026-05) would never reach canonical Events on its own.
 *
 * The archive was extracted once (parsed via the adapter's exported
 * `parseBrasiliaPost` over the live Blogger API feed) and frozen into
 * `scripts/data/brasilia-h3-history.json` — committed as data, no parser, per
 * the H7/Asunción lesson. The rows bind to the live "Brasilia H3 Blogspot
 * Trail Posts" source (same sourceUrl the recurring adapter scrapes).
 *
 * Known source-data quirk: six date pairs collide (the kennel copy-pasted the
 * previous run's date line into the next post — e.g. runs 194/195 both stamped
 * "15th of November" 2020). The rows are stored faithfully; the merge pipeline
 * collapses same (kennel, date) RawEvents into one canonical Event. N+339 is
 * genuinely absent from the blog and is not synthesized.
 *
 * Re-runnable: the backfill runner dedupes by fingerprint and loads only past
 * events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-brasilia-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-brasilia-h3-history.ts
 *
 * Requires the "Brasilia H3 Blogspot Trail Posts" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import brasiliaHistory from "./data/brasilia-h3-history.json";

const SOURCE_NAME = "Brasilia H3 Blogspot Trail Posts";
const KENNEL_TIMEZONE = "America/Sao_Paulo";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated Brasilia H3 Blogspot archive",
  fetchEvents: async () => brasiliaHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  // Set exitCode (not process.exit) so the runner's Prisma disconnect / event
  // loop can drain cleanly before the process terminates.
  process.exitCode = 1;
});
