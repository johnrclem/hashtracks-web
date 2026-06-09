/**
 * One-shot historical backfill for Penang H3 (penangh3).
 *
 * The live adapter scrapes `/hareline/upcoming` (future runs only). The full
 * archive — 204 runs back to Run #1 (1965-04-10, "First Run") — is exposed by
 * the same goHash `__INITIAL_STATE__` blob on `/hareline/past`. Without this
 * script those 60+ years of history never reach canonical Events (#2072).
 *
 * Reuses the adapter's exported `extractInitialState` + `parseGoHashRun`, so the
 * backfill stays in lockstep with the live adapter on field extraction (run #,
 * sorted hares, location, title-without-UUID).
 *
 * `reportAndApplyBackfill` partitions strict `< today` (Asia/Singapore) and
 * routes the past slice through `processRawEvents`, which dedupes by fingerprint
 * on every row — safe to re-run (idempotent).
 *
 * Usage:
 *   Dry run:  npx tsx scripts/backfill-penang-h3-history.ts
 *   Apply:    BACKFILL_APPLY=1 npx tsx scripts/backfill-penang-h3-history.ts
 */

import "dotenv/config";
import { reportAndApplyBackfill } from "./lib/backfill-runner";
import { safeFetch } from "@/adapters/safe-fetch";
import { extractInitialState, parseGoHashRun } from "@/adapters/html-scraper/gohash";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Penang H3 Hareline";
const KENNEL_TIMEZONE = "Asia/Singapore";
const PAST_URL = "https://www.penanghash3.org/hareline/past";
const CONFIG = { kennelTag: "penangh3", startTime: "17:30" } as const;

async function fetchArchive(): Promise<RawEventData[]> {
  const res = await safeFetch(PAST_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 (compatible; HashTracks-Backfill)",
      Accept: "text/html",
    },
  });
  if (!res.ok) {
    throw new Error(`Fetch ${PAST_URL} failed: HTTP ${res.status}`);
  }
  const html = await res.text();

  const state = extractInitialState(html);
  if (!state) {
    throw new Error("__INITIAL_STATE__ not found on /hareline/past — aborting");
  }

  const runs = state.runs?.runs ?? [];
  console.log(`  Found ${runs.length} runs in __INITIAL_STATE__`);

  const events: RawEventData[] = [];
  let skipped = 0;
  for (const run of runs) {
    const event = parseGoHashRun(run, CONFIG, PAST_URL);
    if (event) events.push(event);
    else skipped++;
  }
  console.log(`  Parsed ${events.length} events (${skipped} skipped — missing/bad run_date)`);
  return events;
}

async function main() {
  const apply = process.env.BACKFILL_APPLY === "1";
  console.log(`Mode: ${apply ? "APPLY (will write to DB)" : "DRY RUN (no writes)"}`);

  console.log("\n[1/2] Fetching penanghash3.org/hareline/past archive...");
  const events = await fetchArchive();

  console.log("\n[2/2] Reporting + applying...");
  await reportAndApplyBackfill({
    apply,
    sourceName: SOURCE_NAME,
    events,
    kennelTimezone: KENNEL_TIMEZONE,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
