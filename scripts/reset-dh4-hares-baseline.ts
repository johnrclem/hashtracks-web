/**
 * One-shot: set `Source.baselineResetAt = NOW()` on "DH4 Google Calendar" to
 * resolve the FIELD_FILL_DROP hares alert (#2033).
 *
 * Verdict B — metric false-positive, NOT a real regression. PR #2032 (#2000)
 * stopped promoting `(Run/Walk)`-style event-type parentheticals from the title
 * into `haresText`. DH4's calendar titles future placeholder runs as
 * `"DH4 #NNNN Hash Event (Run/Walk)"`; pre-#2000 each of those counted
 * `"Run/Walk"` as a filled hare, inflating the rolling baseline to 91%.
 *
 * Prod evidence (80 most-recent DH4 RawEvents): 0 `(Run/Walk)` garbage remains;
 * 44/80 = 55% carry real hare names ("Dah Gimp", "Noodle", …), all intact; the
 * 36 nulls are genuine no-hare rows (future unannounced runs + non-trail social
 * events like "Drinking Practice"). DH4's real hares come from the GCal
 * description `Hares:` label, never a title parenthetical, so the #2000 strip
 * cannot — and did not — nuke a real hare. 55% is the honest rate.
 *
 * Setting the boundary to NOW cuts the rolling baseline so the next scrape sees
 * no prior rows in window and the FIELD_FILL_DROP comparison short-circuits; the
 * baseline then re-accumulates around the honest post-#2000 rate. We do NOT
 * inject synthesized hare fallbacks — `computeFillRates` runs on `RawEventData`
 * pre-merge (`src/pipeline/fill-rates.ts`), so padding it would permanently
 * blind the raw-layer metric to future real source regressions.
 *
 * Usage:
 *   npx tsx scripts/reset-dh4-hares-baseline.ts           # dry run (default)
 *   npx tsx scripts/reset-dh4-hares-baseline.ts --apply   # apply against prod
 *   npx tsx scripts/reset-dh4-hares-baseline.ts --apply --force  # re-set even if already set
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { SourceType } from "@/generated/prisma/client";
import { runBaselineReset } from "./lib/reset-baseline";

runBaselineReset({
  sourceName: "DH4 Google Calendar",
  sourceType: SourceType.GOOGLE_CALENDAR,
  alertNumber: 2033,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
