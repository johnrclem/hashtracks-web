/**
 * One-shot historical backfill for Bicester H3 (bicester-h3).
 *
 * The live iCal feed (`?eventDisplay=list`) is upcoming-only; the past
 * archive is reached via the TEC REST API
 * (`/wp-json/tribe/events/v1/events?start_date=2018-01-01&per_page=50&page=N`),
 * frozen here (2026-08-14 pull) — 418 past runs #2294 (28 Jan 2018) ->
 * #2694 (10 Aug 2026).
 *
 * The site has THREE description/title eras, all handled when freezing:
 *  - 2018-era: `description = "<p># NNNN</p>"`, `title` = bare venue name.
 *  - 2019-2025-era: `title = "#NNNN Hare is <name>."`, run number + hare in
 *    the title; venue/hare also available via the structured `venue`/
 *    `organizer` API fields.
 *  - 2026-era (matches the live iCal SUMMARY): `title = "Trail # NNNN -
 *    <hare> - <venue>"`, `description` empty; hare extracted from the
 *    dash-delimited title when `organizer` is empty (mirrors the live
 *    source's `titleHarePattern` config).
 *  - Two 2023 outlier titles ("Trail 2530 Hares – ...", "Trail 2549a Ryde
 *    area – ...") omit the "#" entirely — matched by a title-starts-with-
 *    "Trail <digits>" fallback.
 *  - 🔴 Run number extraction reads TITLE before DESCRIPTION and always
 *    HTML-unescapes first: an early pass matched digits out of an
 *    HTML-entity-encoded apostrophe in free-text description prose
 *    ("Runner Bean&#8217;s first trail" -> a bogus "#8217" match) before
 *    entities were decoded. Decode first, prefer the structured title.
 *  - One genuine run-number regression survives in the source (#2425 on
 *    2020-07-06 followed by #2409 on 2020-07-13) — no independently
 *    verifiable correction exists, so it ships as scraped (Douliu/Prague
 *    faithful-data precedent).
 *
 * Binds to "Bicester H3 Events (The Events Calendar iCal)"
 * (upcomingOnly:true -> reconcile never cancels these once loaded).
 *
 *   Dry run:  npx tsx scripts/backfill-bicester-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-bicester-h3-history.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/bicester-h3-history.json";

runBackfillScript({
  sourceName: "Bicester H3 Events (The Events Calendar iCal)",
  kennelTimezone: "Europe/London",
  label: "Loading frozen Bicester H3 (bicester-h3) TEC REST archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("bicester-h3-history.json is empty — expected ~418 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
