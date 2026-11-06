/**
 * One-shot historical backfill for nwh3-moon.
 *
 * The live run sheet on nwh3.net is forward-only. This loads the yearly
 * run-records pages (same nested-<ul> markup), parsed with the adapter's own
 * `parseRunSheet` and frozen 2026-11-05:
 * 196 Moonrakers runs, #560 (29 Nov 2017) → #756 (21 Oct 2026), from moonrakersrecords2017..2026.html (2018 page redirects; 2020/2021 thin — COVID). Source quirk kept as published: run #711 appears on 18 Dec 2024 and 15 Jan 2025 (the 1 Jan 2025 slot was skipped). One Thursday run (#749, moved off its Wednesday).
 * Rows are deduped by (run, date) and limited to dates before 2026-11-05.
 *
 * Binds to "North Wilts Moonrakers Run Sheet" (upcomingOnly:true → reconcile never cancels these once
 * loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-nwh3-moon-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-nwh3-moon-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/nwh3-moon-history.json";

runBackfillScript({
  sourceName: "North Wilts Moonrakers Run Sheet",
  kennelTimezone: "Europe/London",
  label: "Loading frozen nwh3-moon run-records archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("nwh3-moon-history.json is empty — expected 196 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
