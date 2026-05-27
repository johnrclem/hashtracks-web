/**
 * One-shot cleanup for #1676 — Moooouston H3 dormant 2021 RRULE.
 *
 * The Houston Hash umbrella Google Calendar (`hashvoice` gmail) contains a
 * 2021-09-27 `FREQ=WEEKLY` VEVENT with SUMMARY="Moooouston H3 -" (trailing
 * dash placeholder, hits the #756 trailing-dash fallback) and no UNTIL.
 * Materialized 52 future + 54 past placeholder Mondays sharing the same
 * sourceUrl prefix; real titled Moooouston trails ("Moooouston H3 -
 * Cowtastrophe", etc.) are distinct VEVENTs with a different eid.
 *
 * Discovery (prod DB, 2026-05-26): 106 rows under eid `NnNyamlkajU2cGhqZWI5`,
 * all runNumber NULL / haresText empty / locationName empty.
 *
 *   npm run tsx scripts/cleanup-moooouston-projections.ts           # preview
 *   npm run tsx scripts/cleanup-moooouston-projections.ts -- --apply
 */
import "dotenv/config";
import { cleanupDormantProjections } from "./lib/dormant-projection-cleanup";

const APPLY = process.argv.includes("--apply");

cleanupDormantProjections(
  {
    kennelCode: "moooouston-h3",
    issues: [1676],
    sourceUrlPrefixes: ["https://www.google.com/calendar/event?eid=NnNyamlkajU2cGhqZWI5"],
  },
  APPLY,
).catch(async (err) => {
  console.error(err);
  process.exit(1);
});
