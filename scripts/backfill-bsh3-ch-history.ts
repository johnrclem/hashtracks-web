/**
 * One-shot historical backfill for Basel-Stadt H3 (bsh3-ch, Basel, Switzerland).
 *
 * The live HTML_SCRAPER source only emits a recent + forward window; the Meetup source
 * starts at run #377 (Apr 2025). basel.harrier.eu.org/hareline.php lists every run back to
 * Run #1 (1996-01-13). On 2026-11-18 the list and each of the 376
 * `runs.php?run=N` detail pages (#1–#376, 1996-01-13 → 2025-03-08) were fetched once with the
 * adapter's own `parseHarelineRow` / `parseDetailPage` / `buildBaselEvent`, so the frozen rows
 * match what the live scrape emits. #377+ are Meetup-covered / in the adapter's window.
 *
 * Fill, date gaps and the PII re-scan result are recorded in the PR body. Phone numbers and
 * e-mail addresses were scrubbed from every free-text field (the adapter's `scrubContacts`).
 *
 * Binds to "Basel-Stadt H3 Hareline" (upcomingOnly:true → reconcile never cancels these).
 *
 *   Dry run:  npx tsx scripts/backfill-bsh3-ch-history.ts
 *   Apply:    BACKFILL_ALLOW_SELF_SIGNED_CERT=1 BACKFILL_APPLY=1 npx tsx scripts/backfill-bsh3-ch-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/bsh3-ch-history.json";

runBackfillScript({
  sourceName: "Basel-Stadt H3 Hareline",
  kennelTimezone: "Europe/Zurich",
  label: "Loading frozen Basel-Stadt H3 (bsh3-ch) hareline archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("bsh3-ch-history.json is empty — expected 376 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
