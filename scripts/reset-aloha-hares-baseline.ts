/**
 * One-shot: set `Source.baselineResetAt = NOW()` on "Aloha H3 Google Calendar"
 * to resolve the FIELD_FILL_DROP hares alert (#2133, 71% → 15%, −56pp).
 *
 * Verdict: metric false-positive (dilution), NOT a real regression. Cycle-23's
 * Aloha wide-window backfill (#2093, the PHH "Pau Hana Hui" routing widen) pulled
 * the full 2011→present archive via a one-shot `days: 9999` pass. That single
 * scrape recorded a fill rate over the entire archive — most historical events
 * (esp. the bare "Pau Hana Hui" socials) carry no hares — which tripped the
 * rolling-baseline FIELD_FILL_DROP comparison.
 *
 * Prod-fresh evidence (scripts/live-verify-gcal-round3.ts, this PR):
 *   • recurring 365-day fetch  → hares fill 71% (99/139)  ← what the 6h cron sees
 *   • wide 9999-day fetch      → hares fill 15% (384/2564) ← the #2093 dilution
 * The recurring scrape — the only window that runs on a schedule — is healthy at
 * 71%, exactly the pre-#2093 baseline. The 15% exists ONLY in the wide archive
 * pass. So there is no extraction regression; the alert is an artifact of the
 * one-shot backfill batch.
 *
 * Setting the boundary to NOW cuts the rolling baseline so the next scrape sees
 * no prior rows in window and the FIELD_FILL_DROP comparison short-circuits; the
 * baseline then re-accumulates around the honest recurring ~71% rate. We do NOT
 * inject synthesized hare fallbacks — `computeFillRates` runs on `RawEventData`
 * pre-merge (`src/pipeline/fill-rates.ts`), so padding it would permanently blind
 * the raw-layer metric to future real source regressions — and we stay out of
 * `hare-extraction.ts` entirely.
 *
 * Usage:
 *   npx tsx scripts/reset-aloha-hares-baseline.ts                 # dry run (default)
 *   npx tsx scripts/reset-aloha-hares-baseline.ts --apply         # apply against prod
 *   npx tsx scripts/reset-aloha-hares-baseline.ts --apply --force # re-set even if already set
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { SourceType } from "@/generated/prisma/client";
import { runBaselineReset } from "./lib/reset-baseline";

runBaselineReset({
  sourceName: "Aloha H3 Google Calendar",
  sourceType: SourceType.GOOGLE_CALENDAR,
  alertNumber: 2133,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
