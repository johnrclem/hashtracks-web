/**
 * One-shot historical backfill for IRH3 (Iron Rule Hash House Harriers, San Diego).
 * Issue #1425.
 *
 * `https://sdh3.com/history.shtml` lists every San Diego–area hash since 2007.
 * Filtering for `(Iron Rule)` gives the IRH3 archive (~39 events Jan 2024 →
 * Aug 2025 alone, 462 total back to Dec 2006). HashTracks tracked only events
 * from Aug 21 2025 onward before this backfill because the live SDH3 source
 * uses a 90-day reconcile window and the back catalog can never enter via a
 * wider hareline scrape (same reasoning as HAH3 / #1314).
 *
 * Strategy:
 *   1. Fetch history.shtml via `fetchSDH3Page` (UTF-8-forced).
 *   2. Reuse `parseHistoryEvents` from the SDH3 adapter — it already handles
 *      the `<ol><li>date: <a>title (Kennel)</a></li>` shape and routes the
 *      `(Iron Rule)` parenthetical to `irh3-sd` via `kennelNameMap`.
 *   3. Defense-in-depth filter: keep only `kennelTags[0] === "irh3-sd"`.
 *   4. `runBackfillScript` partitions to past-only (date < today
 *      America/Los_Angeles), routes through the merge pipeline.
 *
 * Idempotency:
 *   The merge pipeline dedupes RawEvents by `(sourceId, fingerprint)`. The
 *   fingerprint is deterministic over the parsed payload, so a second apply
 *   pass is a no-op on every row.
 *
 * Why attribute to "SDH3 Hareline":
 *   That source already has the 10-kennel SourceKennel link including
 *   irh3-sd (see prisma/seed-data/sources.ts kennelCodes array), so the
 *   merge pipeline's per-event source-kennel guard accepts the rows.
 *   Reconcile risk is zero — historical events are far outside the 90-day
 *   reconcile window, so future live scrapes won't cancel them.
 *
 * Coverage limit:
 *   The history page only carries date + start time + title + kennel; hares /
 *   location / description / cost / trail type fields stay null on backfilled
 *   rows. That's expected and documented in #1425.
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-irh3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-irh3-history.ts
 *   Env:       DATABASE_URL
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { fetchSDH3Page, parseHistoryEvents } from "@/adapters/html-scraper/sdh3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "SDH3 Hareline";
const KENNEL_CODE = "irh3-sd";
const KENNEL_TIMEZONE = "America/Los_Angeles";
const HISTORY_URL = "https://sdh3.com/history.shtml";

async function fetchEvents(): Promise<RawEventData[]> {
  console.log(`Fetching ${HISTORY_URL}`);
  const page = await fetchSDH3Page(HISTORY_URL);
  if (!page.ok) {
    throw new Error(`History fetch failed: ${page.result.errors.join("; ")}`);
  }

  // Hand parseHistoryEvents a one-key kennelNameMap: only "(Iron Rule)" rows
  // become events with kennelTag = "irh3-sd". Other parentheticals fall off
  // because parseHistoryEvents requires a kennelNameMap match to emit a row.
  const events = parseHistoryEvents(
    page.html,
    {
      kennelCodeMap: {},
      kennelNameMap: { "Iron Rule": KENNEL_CODE },
    },
    "https://sdh3.com",
  );

  // Defense in depth — parseHistoryEvents already filters by kennelNameMap.
  const irh3Events = events.filter((e) => e.kennelTags[0] === KENNEL_CODE);
  irh3Events.sort((a, b) => a.date.localeCompare(b.date));
  console.log(`  Parsed ${events.length} total history rows; ${irh3Events.length} are IRH3.`);
  return irh3Events;
}

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Walking SDH3 history.shtml for Iron Rule entries",
  fetchEvents,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
