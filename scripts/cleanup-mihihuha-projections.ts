/**
 * One-shot cleanup for #1663 — MiHiHuHa dormant primary-calendar RRULE.
 *
 * The `huhahareraiser@gmail.com` Google Calendar went dormant in 2018 but
 * still contains a 2017-04-27 `RRULE:FREQ=WEEKLY` VEVENT (UID
 * `k4vj3gca6atfkqulmh1ieg7tk0`) with no UNTIL. Google keeps expanding it;
 * earlier scrapes materialized 23 placeholder Mile-High-Humpin' rows in
 * HashTracks, several of which duplicate properly-titled runs (e.g. #598)
 * that arrive via the active Colorado H3 aggregator calendar.
 *
 * Discovery (prod DB, 2026-05-26): 23 rows under eid prefix
 * `azR2ajNnY2E2YXRma3F1` (base64 of the dormant UID), all runNumber NULL /
 * haresText empty / locationName empty.
 *
 *   npm run tsx scripts/cleanup-mihihuha-projections.ts           # preview
 *   npm run tsx scripts/cleanup-mihihuha-projections.ts -- --apply
 */
import "dotenv/config";
import { cleanupDormantProjections } from "./lib/dormant-projection-cleanup";

const APPLY = process.argv.includes("--apply");

cleanupDormantProjections(
  {
    kennelCode: "mihi-huha",
    issues: [1663],
    sourceUrlPrefixes: ["https://www.google.com/calendar/event?eid=azR2ajNnY2E2YXRma3F1"],
    // titleEquals defends against a RECURRENCE-ID exception override under
    // the same eid prefix being mis-classified as a phantom (codex PR #1720
    // adversarial review). All 23 prod-discovered phantoms carry the bare
    // kennel-name title because the dormant calendar's RRULE master VEVENT
    // had no theme set.
    titleEquals: "Mile High Humpin' Hash",
  },
  APPLY,
).catch(async (err) => {
  console.error(err);
  process.exit(1);
});
