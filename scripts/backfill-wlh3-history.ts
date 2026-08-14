/**
 * One-shot historical backfill for West London H3 (wlh3) — #2618.
 *
 * westlondonhash.com's "Previous runs" archive (https://westlondonhash.com/previous-runs/,
 * WP category id 12, "1 2 3 … 44" paginated on the site) is a genuine deep archive —
 * NOT reachable by widening the live "West London Hash Website" adapter's scrape
 * window (that adapter only returns the upcoming window at /runs/; widening it is
 * unsafe per the partial-enumeration rule — reconcile would cancel every row the
 * adapter doesn't re-emit).
 *
 * The archive was pulled once via the site's WordPress REST API
 * (`westlondonhash.com/wp-json/wp/v2/posts?categories=12&per_page=100&page=N`,
 * 652 posts total as of 2026-08-12) and frozen into
 * `scripts/data/wlh3-history.json` — committed as data, no live parser, per the
 * H7 / Asunción lesson (a throwaway Node/Python extractor did the parsing; it is
 * NOT committed).
 *
 * 644 rows survive parsing (6 posts had no extractable date and were dropped),
 * spanning 2011-02-09 -> 2026-08-06. Only 295/644 have a run number in the post
 * title (title format is inconsistent pre-2019: many posts are titled just
 * "12 March 2020 Earlsfield" with no "Run Number NNNN" prefix) — those rows are
 * included with `runNumber` omitted rather than dropped, since date + venue +
 * hare is still real recoverable history and `runNumber` is optional on
 * RawEventData. Year-less dates (a handful of older posts date only by day+month)
 * were resolved to whichever candidate year is closest to the post's publish
 * date (mirrors the closest-to-publish convention used for other year-less blog
 * sources).
 *
 * Data-quality scrubs applied during extraction (see the throwaway extractor,
 * not committed — logic summarized here for reviewers):
 *   - Posts whose title/lead sentence says "cancelled" were dropped entirely
 *     (not a real trail).
 *   - Two WP posts for run #1923 / 2023-02-23 were the SAME event described
 *     twice (no A/B/day-2 marker distinguishing them) -- collapsed to the
 *     richer of the two rather than emitted as a same-day double-header.
 *   - Run #2056 / 2025-08-21 genuinely IS a same-day double-header ("2056-A
 *     Official Nash Hash Red Dress Run" vs "2056-B ... South Kenton") -- both
 *     rows kept; they differ on title so they will NOT collapse in the merge
 *     pipeline (see the same-day-double-header pitfall).
 *   - Source-side typos flagged in #2618 (archive skips #2090, one entry
 *     mis-dated "19th March 2016" for what is clearly a 2026 run, /runs/
 *     repeating #2110) are preserved faithfully, not "fixed" -- they are
 *     upstream data quirks, not adapter/extraction bugs.
 *   - `description` intentionally omitted (kept scope to title/hares/location/
 *     startTime -- the fields the issue specifically asked for; the free-text
 *     WP post bodies are logistics prose, not per-event narrative worth the
 *     added parsing risk for a one-shot).
 *
 * Binds to the live "West London Hash Website" source for provenance. That
 * source is a plain scrapeDays=90-ish upcoming-window HTML_SCRAPER with no
 * `upcomingOnly` flag today -- per the archive-source pitfall, a backfill must
 * NOT bind to a live source whose reconcile window could reach back far enough
 * to see these rows as "not returned by the current scrape" and cancel them.
 * WS1 needs to add a dedicated **disabled, upcomingOnly:true** archive Source
 * row ("West London Hash Previous-Runs Archive", kennelCodes: ["wlh3"]) for
 * this backfill to bind to -- see the PR body handoff. Do NOT bind this script
 * to the live "West London Hash Website" source name.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-wlh3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-wlh3-history.ts
 *
 * Requires the "West London Hash Previous-Runs Archive" source to exist first
 * (WS1 handoff — see PR body). Will fail loud with a clear error until then.
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";
import history from "./data/wlh3-history.json";

const SOURCE_NAME = "West London Hash Previous-Runs Archive";
const KENNEL_TIMEZONE = "Europe/London";

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading frozen West London H3 (wlh3) previous-runs archive",
  fetchEvents: async () => {
    const events = history as RawEventData[];
    if (events.length === 0) {
      throw new Error("wlh3-history.json is empty — expected ~644 frozen runs. Aborting.");
    }
    return events;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
