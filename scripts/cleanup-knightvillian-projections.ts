/**
 * One-shot cleanup for #1419 + #1692 — Knightvillian (PorMe H3) dormant RRULE.
 *
 * The `pormeh3hashcash@gmail.com` Google Calendar contains an unbounded
 * `FREQ=WEEKLY` event titled "Knightvillain H3" with no UNTIL clause. Earlier
 * wide-window scrapes materialized 415 future + 28 past placeholder Events
 * (verified 2026-05-26 against the prod DB), all sharing the same dormant
 * series and all carrying runNumber=NULL / haresText=NULL / locationName
 * empty. The handful of real titled Knightvillian trails (#499, #500, etc.)
 * come from a different sourceUrl on the same calendar and are not touched.
 *
 * Discovery query (one-shot, pre-cleanup):
 *   SELECT SUBSTRING(sourceUrl FROM '...eid=[A-Za-z0-9_-]{20}'), COUNT(*)
 *   FROM Event WHERE kennelCode='knightvillian' AND runNumber IS NULL
 *     AND haresText IS NULL/empty GROUP BY ...;
 *   → 443 rows, all under one eid prefix `MG5ybW4zMjhzbjdjOWc0`.
 *
 *   npm run tsx scripts/cleanup-knightvillian-projections.ts           # preview
 *   npm run tsx scripts/cleanup-knightvillian-projections.ts -- --apply
 */
import "dotenv/config";
import { cleanupDormantProjections } from "./lib/dormant-projection-cleanup";

const APPLY = process.argv.includes("--apply");

cleanupDormantProjections(
  {
    kennelCode: "knightvillian",
    issues: [1419, 1692],
    // Dormant weekly RRULE in pormeh3hashcash@gmail.com — single series.
    sourceUrlPrefixes: ["https://www.google.com/calendar/event?eid=MG5ybW4zMjhzbjdjOWc0"],
    // titleEquals defends against a RECURRENCE-ID exception override under
    // the same eid prefix being mis-classified as a phantom (codex PR #1720
    // adversarial review). Every prod-discovered phantom carries this title.
    titleEquals: "Knightvillain H3",
  },
  APPLY,
).catch(async (err) => {
  console.error(err);
  process.exit(1);
});
