/**
 * Shared one-shot historical backfill helper for any kennel listed on
 * `https://sdh3.com/history.shtml`.
 *
 * The SDH3 history page is a single static URL with `<ol><li>` entries
 * tagged with `(KennelName)` parentheticals — the SDH3 source already has
 * SourceKennel links for all 10 San Diego–area kennels, so any of them can
 * be backfilled with the same fetch + parse path and a one-key
 * `kennelNameMap` filter.
 *
 * Per-kennel scripts (HAH3, IRH3, …) collapse to a single call into this
 * helper so they share fetch/parse/runner wiring and don't drift apart.
 *
 * Coverage limit: the history page only carries date + start time + title +
 * kennel. Hares / location / description / cost fields stay null on
 * backfilled rows.
 *
 * Idempotency: routes through `runBackfillScript` → `processRawEvents`
 * which dedupes by `(sourceId, fingerprint)`. Re-runs are no-ops.
 */

import { runBackfillScript } from "./backfill-runner";
import { fetchSDH3Page, parseHistoryEvents } from "@/adapters/html-scraper/sdh3";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "SDH3 Hareline";
const KENNEL_TIMEZONE = "America/Los_Angeles";
const HISTORY_URL = "https://sdh3.com/history.shtml";

export interface Sdh3HistoryBackfillParams {
  /** HashTracks kennel code (e.g. "irh3-sd"). Becomes the kennel tag on each RawEvent. */
  kennelCode: string;
  /** The exact text inside the `(...)` parenthetical on the history page (e.g. "Iron Rule"). */
  kennelDisplayName: string;
  /** Short label printed by the runner, e.g. "Walking SDH3 history.shtml for Iron Rule entries". */
  label: string;
}

/**
 * Drive a one-shot SDH3 history backfill for a single SD-area kennel.
 *
 * Hands `parseHistoryEvents` a one-key `kennelNameMap` so only matching
 * parentheticals emit rows — other kennels on the same page fall off
 * automatically because the parser requires a kennelNameMap match.
 */
export function backfillSdh3HistoryKennel(params: Sdh3HistoryBackfillParams): Promise<void> {
  const { kennelCode, kennelDisplayName, label } = params;

  async function fetchEvents(): Promise<RawEventData[]> {
    console.warn(`Fetching ${HISTORY_URL}`);
    const page = await fetchSDH3Page(HISTORY_URL);
    if (!page.ok) {
      throw new Error(`History fetch failed: ${page.result.errors.join("; ")}`);
    }
    const events = parseHistoryEvents(
      page.html,
      {
        kennelCodeMap: {},
        kennelNameMap: { [kennelDisplayName]: kennelCode },
      },
      "https://sdh3.com",
    );
    console.warn(`  Found ${events.length} ${kennelDisplayName} events in history.`);
    return events;
  }

  return runBackfillScript({
    sourceName: SOURCE_NAME,
    kennelTimezone: KENNEL_TIMEZONE,
    label,
    fetchEvents,
  });
}
