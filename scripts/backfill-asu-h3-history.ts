/**
 * One-shot historical backfill for Asunción H3 (asu-h3).
 *
 * The Asunción H3 adapter (src/adapters/html-scraper/asuncion-h3.ts) is
 * future-only — it emits date >= today so the recurring scrape stays
 * forward-looking. The full 120-run archive (#1 2021-12 → #120 2026-05) would
 * therefore never reach canonical Events.
 *
 * The archive was extracted once (parsed via the adapter's exported postToEvent
 * over the live WordPress.com REST feed) and frozen into
 * `scripts/data/asu-h3-history.json` — committed as data, no parser, per the H7
 * lesson. The rows bind to the live "Asunción H3 WordPress Run Posts" source for
 * provenance (same sourceUrl the recurring adapter scrapes).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row and
 * loads only past events (date < today in kennel timezone).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-asu-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-asu-h3-history.ts
 *
 * Requires the "Asunción H3 WordPress Run Posts" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import asuHistory from "./data/asu-h3-history.json";

const SOURCE_NAME = "Asunción H3 WordPress Run Posts";
const KENNEL_TIMEZONE = "America/Asuncion";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated Asunción H3 WordPress archive",
  fetchEvents: async () => asuHistory as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
