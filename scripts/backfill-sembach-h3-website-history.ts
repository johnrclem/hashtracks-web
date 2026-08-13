/**
 * One-shot historical backfill for Sembach H3 (sembach-h3) — #2604, WEBSITE PHASE.
 *
 * This is a companion to the already-shipped `scripts/backfill-sembach-h3-history.ts`
 * (Harrier Central global-runs pull), NOT a replacement. That HC-sourced backfill
 * only reaches back to run #1163 / 2023-07-01 — Harrier Central's hashruns.org feed
 * has no data before a kennel migrated onto HC, regardless of founding year (same
 * limit documented for Fengyuan/Pranburi/Plympton). Confirmed live 2026-08-12: the
 * global-runs feed's earliest Sembach row is #1163.
 *
 * sembach-hash.de (the kennel's own WordPress site) fills part of the pre-HC gap:
 * its "events" post category (WP category id 1) runs from 2014-10-19 through
 * 2025-08-06 — i.e. runs roughly #820 through #1250, overlapping the HC window at
 * the tail end. It does NOT reach back to the kennel's 1999 founding or run #1;
 * #1–#~819 (1999–2014) have no known enumerable source (the site's own "History"
 * page at sembach-hash.de/history-2/ is prose, not a structured run log).
 *
 * Pulled once via `sembach-hash.de/wp-json/wp/v2/posts?categories=1&per_page=100`
 * (177 posts) and frozen into `scripts/data/sembach-h3-website-history.json` — no
 * live parser committed (throwaway extractor, not committed, per the H7/Asunción
 * pattern). 174 rows survive after collapsing 3 literal duplicate WP posts
 * (identical date + title). Only 27/174 carry a run number in the post title —
 * German kennel's title convention is far less consistent than most HC kennels
 * ("SLYRONMAN part Drei!!!", "WORLD PEACE THROUGH BEER!!! Sembach HASH" have no
 * run number at all) — those rows are still included with `runNumber` omitted
 * (date + title + hares/location is still real recoverable history).
 *
 * Fields: `hares` from the post body's "Hares: ..." line, `location` from the
 * "Where: ..." line, both regex-extracted up to the next "What:"/"How:"/"When:"
 * label (the site's own post format). Left `undefined` where the post lacks the
 * label entirely (older/informal posts).
 *
 * Same-date, different-title rows are genuine same-day multi-trail events
 * (regular Saturday trail + Full Moon trail on the same date is common at this
 * kennel) and are kept distinct — they will not collapse in the merge pipeline
 * since they differ on title. Same-date, IDENTICAL-title WP posts (3 found, e.g.
 * two "Sembach Saturday Trail" posts both on 2020-09-10) were collapsed to one
 * row during extraction.
 *
 * Overlap with the existing HC-sourced canonical events (~2023-07 to 2025-08) is
 * NOT pre-filtered here — the merge pipeline matches by kennel+date across
 * sources and will enrich the existing (higher-trust HC) canonical event rather
 * than duplicate it; this is normal multi-source merge behavior, not something
 * this script needs to special-case.
 *
 * Binds to a dedicated archive source, NOT the live "Sembach H3 Harrier Central"
 * source (that source's binding is already spoken for by the companion HC
 * backfill and, more importantly, is a *live* GOOGLE recurring source — binding
 * a second frozen dataset to it would be confusing provenance, not a safety bug,
 * but WS1 should add a second dedicated **disabled, upcomingOnly:true** archive
 * row: "Sembach H3 Website Archive" (kennelCodes: ["sembach-h3"]) — see the PR
 * body handoff.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-sembach-h3-website-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-sembach-h3-website-history.ts
 *
 * Requires the "Sembach H3 Website Archive" source to exist first (WS1 handoff).
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/sembach-h3-website-history.json";

const SOURCE_NAME = "Sembach H3 Website Archive";
const KENNEL_TIMEZONE = "Europe/Berlin";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen Sembach H3 (sembach-h3) website archive (pre-HC era)",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("sembach-h3-website-history.json is empty — expected ~174 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
