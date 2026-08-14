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
 * pattern). All 177 posts survive as rows (no genuine literal duplicates once
 * dates are correct — see below). 27/177 carry a run number in the post title —
 * German kennel's title convention is far less consistent than most HC kennels
 * ("SLYRONMAN part Drei!!!", "WORLD PEACE THROUGH BEER!!! Sembach HASH" have no
 * run number at all) — those rows are still included with `runNumber` omitted
 * (date + title + hares/location is still real recoverable history).
 *
 * **`date` is NOT the WordPress publish date** (an earlier draft of this backfill
 * used publish date directly — CAUGHT IN REVIEW, since these posts are almost
 * always pre-announcements published days-to-weeks before the actual trail: the
 * publish-date draft had e.g. a post titled "Sembach Hash – 23 May 15 835 Red
 * Dress Run" published 2015-05-10 landing under date `2015-05-10` instead of the
 * true trail date `2015-05-23` — 13 days wrong, and would never have merged with
 * the correctly-dated post-2023 Harrier Central rows for the same kennel). The
 * real trail date is extracted from the post body's own "When: ..." field first
 * (140/177 rows — formats vary wildly: "25 Oct, 2014 @ 1400", "Saturday, 19th of
 * September 1230", "1600 (4pm wanks) 2 June 2018", etc., all parsed via a
 * day+month(+year) regex tried in both orders); when "When:" is absent or
 * unparseable, an explicit date embedded in the TITLE is tried next (7/177 rows,
 * e.g. "12 Aug 17"); only when NEITHER yields a date does the row fall back to
 * WordPress publish date (30/177 rows — genuinely no other date signal exists in
 * those posts, e.g. "Sembach Full Moon (__|__)"). A 2-digit or bare 4-digit
 * "year" captured immediately after a day+month match is validated against the
 * post's publish year (rejected and re-inferred if implausible) — the raw
 * "When:" text frequently has a TIME value (e.g. "1230", "1900", "1400") sitting
 * right where a year would otherwise be, and an early version of this regex
 * mis-parsed several of those military times as years before this guard was
 * added.
 *
 * Fields: `hares` from the post body's "Hares: ..."/"Hare: ..." line, `location`
 * from the "Where: ..." line, both regex-extracted up to the FIRST of every
 * label this site's posts actually use (When/Where/Why/What/Who/How/Bring/Time/
 * Location/Destructions/Special Destructions/Hash Cash/Cost/Theme/Notes/Hares/
 * Starting point) — an earlier draft only terminated at the one or two labels
 * the initial test sample happened to contain, which let stray "Why:"/"Bring:"/
 * "Who:"/"Hares:" text bleed into the neighboring field (e.g. a `location` value
 * that ran on into "... Why: Do we need a reason? See you wankers there…or
 * not…who cares!"). Also fixed: a non-greedy capture with a 2-character minimum
 * would overrun an EMPTY field straight into the next label's content (e.g.
 * "Where: Who: Just Ashley..." with nothing filled in for Where) — the minimum
 * is now 0, with blank/whitespace-only captures treated as absent. Verified
 * comprehensively (not spot-checked) across all 177 rows: 0 residual label
 * leaks in `hares` or `location`.
 *
 * Same-date, different-title rows are genuine same-day multi-trail events
 * (regular Saturday trail + Full Moon trail on the same date is common at this
 * kennel) and are kept distinct — they will not collapse in the merge pipeline
 * since they differ on title. With correct per-row dates there are no remaining
 * same-date SAME-title collisions to collapse (the 3 "duplicates" collapsed in
 * an earlier draft turned out to be mis-dated distinct posts that only looked
 * identical because they'd been incorrectly bucketed under the same publish
 * date — restored to distinct rows now that each has its own real date).
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
      throw new Error("sembach-h3-website-history.json is empty — expected ~177 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
