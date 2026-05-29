/**
 * One-shot cleanup for #1708 — Mr. Happy's dormant primary-calendar RRULE.
 *
 * The `mrhappyshhh@gmail.com` Google Calendar carries an unbounded
 * `RRULE:FREQ=WEEKLY;BYDAY=WE` VEVENT (iCalUID
 * `20qb7gao7553kajq5de1s5kra4_R20210304T020000@google.com`, DTSTART
 * 2021-03-03) with no UNTIL. The kennel abandoned it in 2021 and now curates
 * real per-occurrence VEVENTs ("Mr Happy's Hash @<venue>") with distinct UIDs,
 * but Google keeps materializing the dormant series — every future Wednesday
 * shows the stale 2021 title "Mr Happy's 69th Trail". These phantoms fall
 * inside the source's 90-day `scrapeDays` window, so the `futureHorizonDays`
 * cap can't remove them; the adapter now drops them at fetch time via
 * `suppressICalUids` (see google-calendar/adapter.ts + the source config).
 * This script cleans the canonical Events the earlier scrapes already persisted.
 *
 * No shared sourceUrl prefix to anchor on — each materialized instance has a
 * distinct `eid` — so we gate on the stale title (every phantom carries it;
 * the master VEVENT's SUMMARY never changed). Combined with the helper's
 * runNumber-NULL + empty-haresText shape, this uniquely targets the phantoms.
 *
 * ORDERING (important): run `--apply` only AFTER this branch is deployed AND
 * `npx prisma db seed` has landed the `suppressICalUids` config into prod
 * (Vercel deploys schema/code but not seed data — see memory
 * feedback_post_merge_seed_required). Until the adapter is dropping the
 * phantoms at fetch time, the next 6-hourly scrape would just recreate them.
 *
 *   npm run tsx scripts/cleanup-mr-happys-phantom-rrule.ts           # preview
 *   npm run tsx scripts/cleanup-mr-happys-phantom-rrule.ts -- --apply
 */
import "dotenv/config";
import { cleanupDormantProjections } from "./lib/dormant-projection-cleanup";

const APPLY = process.argv.includes("--apply");

cleanupDormantProjections(
  {
    kennelCode: "mrhappy",
    issues: [1708],
    // No sourceUrlPrefixes: the dormant series has no shared eid prefix. The
    // stale title is the discriminator — real curated runs use venue-specific
    // SUMMARYs ("Mr Happy's Hash @Freedom Park"), never this 2021 title.
    titleEquals: "Mr Happy's 69th Trail",
  },
  APPLY,
).catch(async (err) => {
  console.error(err);
  process.exit(1);
});
