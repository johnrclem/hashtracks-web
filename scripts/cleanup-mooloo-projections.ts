/**
 * One-shot cleanup for #1673 — Mooloo H3 STATIC_SCHEDULE over-projection.
 *
 * The static-schedule source (`https://www.sporty.co.nz/mooloohhh`,
 * `FREQ=WEEKLY;INTERVAL=2;BYDAY=MO`) was previously expanded with an
 * audit-driven wide window, materializing 25 future + 26 past placeholder
 * biweekly Mondays titled "Mooloo H3 Run" with no run number / no hares.
 * Mooloo's actual cadence is host-driven (kennel newsletter says "every
 * 2nd Monday or whenever you feel like setting a trail"), so the real
 * source of truth is the HTML_SCRAPER at `/UpCumming-Runs` which currently
 * publishes exactly one upcoming run at a time (Run #1886).
 *
 * **Title-equals guard is critical here**: the static-schedule and the
 * HTML_SCRAPER share the same parent domain. The HTML_SCRAPER's sourceUrl
 * is `https://www.sporty.co.nz/mooloohhh/UpCumming-Runs` (different prefix),
 * but for defense-in-depth we ALSO require `title = 'Mooloo H3 Run'` — the
 * static-schedule `defaultTitle`. Real titled trails like "Mooloo H3 Trail
 * #1886" are excluded.
 *
 * Discovery (prod DB, 2026-05-26): 51 rows under sourceUrl
 * `https://www.sporty.co.nz/mooloohhh` with title "Mooloo H3 Run", all
 * runNumber/haresText NULL.
 *
 * Post-cleanup expectation: the new `futureHorizonDays = 365` default cap in
 * the static-schedule adapter (this PR) means future scrapes will materialize
 * at most ~26 biweekly Mondays. If that's still too aggressive for Mooloo's
 * host-driven cadence, a follow-up PR can set `config.futureHorizonDays: 90`
 * on the source row.
 *
 *   npm run tsx scripts/cleanup-mooloo-projections.ts           # preview
 *   npm run tsx scripts/cleanup-mooloo-projections.ts -- --apply
 */
import "dotenv/config";
import { cleanupDormantProjections } from "./lib/dormant-projection-cleanup";

const APPLY = process.argv.includes("--apply");

cleanupDormantProjections(
  {
    kennelCode: "mooloo-h3",
    issues: [1673],
    // STATIC_SCHEDULE root URL (not a GCal eid). The HTML_SCRAPER lives at
    // /UpCumming-Runs which has a distinct sourceUrl prefix.
    sourceUrlPrefixes: ["https://www.sporty.co.nz/mooloohhh"],
    titleEquals: "Mooloo H3 Run",
    // Defense in depth: the static-schedule URL is a prefix of the HTML
    // scraper URL, so `startsWith` could in principle catch HTML-scraper
    // rows. Explicitly exclude them so the script is safe even if a future
    // newsletter post happens to produce a title that matches the default.
    excludeSourceUrlContains: "/UpCumming-Runs",
    // One-shot time bound: the new 365d cap (this PR) means every cron
    // scrape post-merge materializes ~26 legitimate biweekly Mondays under
    // the same sourceUrl + title + null-runNumber signature. Without this
    // guard, a re-run after merge would delete those legitimate projections.
    // The cutoff is "before any post-PR cron scrape" — choose a date strictly
    // after the cleanup ran for the legacy cohort (2026-05-26 22:30 UTC).
    createdBefore: new Date("2026-05-27T00:00:00Z"),
  },
  APPLY,
).catch(async (err) => {
  console.error(err);
  process.exit(1);
});
