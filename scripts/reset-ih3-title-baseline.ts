/**
 * One-shot: set `Source.baselineResetAt = NOW()` on "IH3 Website Hareline" to
 * resolve the FIELD_FILL_DROP title alert (#1385).
 *
 * PR #1379 intentionally dropped the unconditional `title: "IH3 #N"` placeholder
 * so that `merge.ts` synthesizes `"Ithaca H3 Trail #N"` via `friendlyKennelName`.
 * After deploy, only 1 of 7 events carries a published source title (e.g.
 * `"RAINBOW DRESS RUN"`), and `fill-rates.ts` — which measures
 * `RawEventData.title` *before* merge — drops to 14%. User-visible `Event.title`
 * is unaffected.
 *
 * This is a textbook `baselineResetAt` case (see `prisma/schema.prisma` and
 * `src/pipeline/health.ts`). Setting the boundary to NOW cuts the rolling
 * baseline so the next scrape sees no prior rows in window and the
 * FIELD_FILL_DROP comparison short-circuits. The baseline then re-accumulates
 * around the honest post-#1379 rate.
 *
 * Usage:
 *   npx tsx scripts/reset-ih3-title-baseline.ts           # dry run (default)
 *   npx tsx scripts/reset-ih3-title-baseline.ts --apply   # apply against prod
 *   npx tsx scripts/reset-ih3-title-baseline.ts --apply --force  # re-set even if already set
 *
 * Load env before running (tsx does not auto-load .env):
 *   set -a && source .env && set +a
 */
import "dotenv/config";
import { SourceType } from "@/generated/prisma/client";
import { runBaselineReset } from "./lib/reset-baseline";

runBaselineReset({
  sourceName: "IH3 Website Hareline",
  sourceType: SourceType.HTML_SCRAPER,
  alertNumber: 1385,
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
