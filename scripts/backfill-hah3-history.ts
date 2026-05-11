/**
 * One-shot historical backfill for HAH3 (Half-Assed Hash, San Diego).
 * Issue #1314.
 *
 * `https://sdh3.com/history.shtml` lists every San Diego–area hash since 2007.
 * Filtering for `(Half-Assed)` gives ~186 events; HashTracks tracked only 13
 * before this backfill (earliest 2025-06-14) because the live SDH3 source
 * uses a 90-day reconcile window and the back catalog can never enter via
 * a wider hareline scrape (#1314 walks through this in detail).
 *
 * Strategy:
 *   1. Fetch history.shtml via `fetchSDH3Page` (UTF-8-forced, #1315).
 *   2. Reuse `parseHistoryEvents` from the SDH3 adapter — it already handles
 *      the `<ol><li>date: <a>title (Kennel)</a></li>` shape and routes the
 *      `(Half-Assed)` parenthetical to `hah3-sd` via `kennelNameMap`.
 *   3. Defense-in-depth filter: keep only `kennelTags[0] === "hah3-sd"`.
 *   4. `runBackfillScript` partitions to past-only (date < today
 *      America/Los_Angeles), routes through the merge pipeline.
 *
 * Idempotency:
 *   The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)` (WS5
 *   composite unique constraint). The fingerprint is deterministic over the
 *   parsed payload, so a second apply pass is a no-op on every row.
 *
 * Why attribute to "SDH3 Hareline":
 *   That source already has the 10-kennel SourceKennel link including
 *   hah3-sd, so the merge pipeline's per-event source-kennel guard accepts
 *   the rows. Reconcile risk is zero — historical events are far outside
 *   the 90-day reconcile window, so future live scrapes won't cancel them.
 *
 * Coverage limit:
 *   The history page only carries date + title + kennel; hares / cost /
 *   trail type / dog friendly / pre-lube fields stay null on backfilled
 *   rows. That's expected and documented in #1314.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-hah3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-hah3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { fetchSDH3Page, parseHistoryEvents } from "@/adapters/html-scraper/sdh3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "SDH3 Hareline";
const KENNEL_CODE = "hah3-sd";
const KENNEL_TIMEZONE = "America/Los_Angeles";
const HISTORY_URL = "https://sdh3.com/history.shtml";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching ${HISTORY_URL}`);
  const page = await fetchSDH3Page(HISTORY_URL);
  if (!page.ok) {
    throw new Error(`History fetch failed: ${page.result.errors.join("; ")}`);
  }

  // Hand parseHistoryEvents a one-key kennelNameMap: only "(Half-Assed)" rows
  // become events with kennelTag = "hah3-sd". Other parentheticals fall off
  // because parseHistoryEvents requires a kennelNameMap match to emit a row.
  const events = parseHistoryEvents(
    page.html,
    {
      kennelCodeMap: {},
      kennelNameMap: { "Half-Assed": KENNEL_CODE },
    },
    "https://sdh3.com",
  );

  // Defense in depth — parseHistoryEvents already filters by kennelNameMap.
  const hahEvents = events.filter((e) => e.kennelTags[0] === KENNEL_CODE);
  hahEvents.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  Parsed ${events.length} total history rows; ${hahEvents.length} are HAH3.`);
  return hahEvents;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking SDH3 history.shtml for Half-Assed Hash entries",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
