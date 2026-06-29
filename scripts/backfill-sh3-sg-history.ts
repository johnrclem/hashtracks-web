/**
 * One-shot historical backfill for Singapore Sunday H3 (sh3-sg) via Harrier
 * Central.
 *
 * The live HarrierCentralAdapter is future-only, so SG Sunday's past runs never
 * reach canonical Events (#2306). This pulls them from the hashruns.org global
 * past-runs feed (scripts/lib/hc-global-runs.ts), filtered to SG's
 * PublicKennelId, and routes the past slice through merge.
 *
 * IMPORTANT — depth reality: the kennel is at Run #800 (Est. 1994), but HC only
 * holds the runs the kennel actually entered, which is a RECENT subset (~Jan
 * 2026 onward), NOT all 800. This recovers whatever the global feed exposes; the
 * dry-run prints the true #range. No title config (no defaultTitle) → merge
 * synthesizes "Singapore Sunday H3 Trail #N". Source carries upcomingOnly, so
 * reconcile never cancels these. Re-runnable via fingerprint dedup.
 *
 * Usage:
 *   Dry run: npx tsx scripts/backfill-sh3-sg-history.ts
 *   Apply:   BACKFILL_APPLY=1 npx tsx scripts/backfill-sh3-sg-history.ts
 */

import "dotenv/config";
import { runHcKennelBackfill } from "./lib/hc-global-runs";

runHcKennelBackfill({
  sourceName: "Singapore Sunday H3 Harrier Central",
  kennelTag: "sh3-sg",
  publicKennelId: "7cb56a4d-dfe8-4dc3-aacd-6884cd8d3cc1",
  kennelTimezone: "Asia/Singapore",
  historyStart: "2020-01-01", // sweep wide; SG's HC adoption date unknown up front
  config: {}, // no defaultTitle → merge synthesizes the default title
  label: "Sweeping Singapore Sunday H3 Harrier Central global-runs archive",
});
