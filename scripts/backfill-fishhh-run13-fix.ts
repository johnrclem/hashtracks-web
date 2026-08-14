/**
 * One-shot gap-fill for Fengyuan H3 / FISHHH (fishhh) run #13 — #2576.
 *
 * `scripts/backfill-fishhh-history.ts` (already shipped, PR #2545) froze 20 runs
 * from the Harrier Central global-runs archive, but its extraction window missed
 * run #13 ("New Year's Evening Hash", 2023-12-31, sandwiched between the already
 * -captured #12 and #14) — a single dropped row, not a source-side gap. Confirmed
 * live 2026-08-12: `hashruns.org/api/global-runs?isFuture=0&minEventDate=2023-12-01
 * &maxEventDate=2024-01-31` DOES return EventNumber=13 for PublicKennelId
 * b66324a8-80a1-41b6-8c78-3a86111a4de0 (IsCountedRun=1, EventName="New Year's
 * Evening Hash", Hares="Shut the Fedora Up", matching the issue's evidence
 * exactly), so this is fully recoverable from the same feed the original
 * backfill already used.
 *
 * Rather than re-freezing the whole 20-run archive, this is a narrow, dedicated
 * one-shot: sweep a tight window around the known date, keep only this kennel's
 * runs, and hand them to the SAME merge pipeline entry point as every other
 * backfill. `processRawEvents` dedupes the other 20 rows by fingerprint (already
 * in prod), so a re-run only ever adds the missing #13 — safe to run repeatedly.
 *
 * Binds to the EXISTING live "Fengyuan H3 Harrier Central" source (NOT a new
 * archive row) — that source already sets `config.upcomingOnly: true`, so
 * reconcile's timeMin clamps to "now" and this single past row is never at risk
 * of being false-cancelled by the live future-only adapter's recurring scrapes.
 * No new Source row is needed from WS1 for this one.
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-fishhh-run13-fix.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-fishhh-run13-fix.ts
 */
import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import { sweepGlobalRuns, mapRunToRawEvent } from "./lib/hc-global-runs";
import type { RawEventData } from "@/adapters/types";
import type { HarrierCentralConfig } from "@/adapters/harrier-central/adapter";

const SOURCE_NAME = "Fengyuan H3 Harrier Central";
const KENNEL_TIMEZONE = "Asia/Taipei";
const PUBLIC_KENNEL_ID = "b66324a8-80a1-41b6-8c78-3a86111a4de0";
const KENNEL_TAG = "fishhh";
const EXPECTED_RUN_NUMBER = 13;

const HC_CONFIG: HarrierCentralConfig = {
  defaultKennelTag: KENNEL_TAG,
  defaultTitle: "Fengyuan H3",
  staleTitleAliases: ["Placeholder event for FISHHH"],
};

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Sweeping hashruns.org global-runs for the missing FISHHH #13 (2023-12-31)",
  fetchEvents: async () => {
    // Narrow window around the known date — no need to re-sweep the whole
    // 2022-2026 archive for a single-row fix.
    const runs = await sweepGlobalRuns("2023-11-01", "2024-02-28");
    const events = runs
      .filter((r) => r.PublicKennelId === PUBLIC_KENNEL_ID)
      .map((r) => mapRunToRawEvent(r, KENNEL_TAG, HC_CONFIG))
      .filter((e): e is RawEventData => e !== null);

    const target = events.filter((e) => e.runNumber === EXPECTED_RUN_NUMBER);
    if (target.length === 0) {
      throw new Error(
        `Run #${EXPECTED_RUN_NUMBER} not found in the swept window — the source ` +
          `may have changed since #2576 was filed. Aborting rather than silently ` +
          `applying nothing useful.`,
      );
    }
    // Filter to ONLY the target run. The sweep necessarily also returns #11/#12
    // (already in prod from the original 20-run backfill) since the window has
    // to span enough days to reliably catch #13 — but `processRawEvents` matches
    // by fingerprint, not by (kennel, date) identity alone, so re-submitting the
    // neighbors would silently overwrite them if anything about their upstream
    // HC data has drifted since the original freeze (title edit, hare
    // correction, etc.). This is meant to be a single-row gap-fill, not a
    // re-sync of its neighbors, so only #13 is returned.
    console.log(
      `  Swept window yielded ${events.length} row(s) total; ` +
        `filtering to #${EXPECTED_RUN_NUMBER} only (${target.length} row).`,
    );
    return target;
  },
}).catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
