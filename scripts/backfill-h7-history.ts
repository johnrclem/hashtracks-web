/**
 * One-shot historical backfill for Hamburg H7 (h7).
 *
 * H7 published run announcements on hamburghash.blogspot.com from 2021 until
 * they moved to Harrier Central in mid-2026. HC's getEvents is future-only, so
 * the pre-HC archive (#594-#700, 2021-2026) would never reach canonical Events.
 *
 * The archive was extracted once and hand-curated into a frozen dataset
 * (`scripts/data/h7-history.json`) — no live scrape or parser, since the blog
 * is read-only and the source is now disabled. The rows bind to the disabled
 * "Hamburg H7 Blogspot Archive" Source for provenance (NOT the HC source).
 *
 * Re-runnable: `reportAndApplyBackfill` dedupes by fingerprint on every row.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-h7-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-h7-history.ts
 *
 * Requires the "Hamburg H7 Blogspot Archive" source to exist (run
 * `npx prisma db seed`).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import h7History from "./data/h7-history.json";

const SOURCE_NAME = "Hamburg H7 Blogspot Archive";
const KENNEL_TIMEZONE = "Europe/Berlin";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading curated H7 Blogspot archive",
  fetchEvents: async () => h7History as RawEventData[],
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
