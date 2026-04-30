/**
 * One-shot historical backfill for CRH3 (#1122).
 *
 * Five runs are missing from HashTracks because their blog post titles
 * don't match the adapter's RUN_TITLE_RE pattern (no "CRH3#NNN" prefix
 * or non-standard wording). The current adapter uses a strict regex to
 * avoid false positives on run reports — loosening it for these would
 * be too risky, so we insert them via this script instead.
 *
 * Each entry was live-verified against chiangraihhh.blogspot.com via
 * the Blogger API on 2026-04-30. Dates are the Saturday/Sunday the run
 * actually happened (canonical, from the blog post body or title).
 *
 * Usage:
 *   npx tsx scripts/backfill-crh3-history.ts                  # dry run
 *   BACKFILL_APPLY=1 npx tsx scripts/backfill-crh3-history.ts # apply
 *
 * Idempotent: routes through `processRawEvents` which short-circuits
 * on existing fingerprints.
 */

import "dotenv/config";
import { runBackfillScript } from "./lib/backfill-runner";
import type { RawEventData } from "@/adapters/types";

const SOURCE_NAME = "Chiang Rai H3 Blog";
const KENNEL_TIMEZONE = "Asia/Bangkok";
const KENNEL_TAG = "crh3";

const HISTORICAL_EVENTS: RawEventData[] = [
  {
    date: "2025-07-12",
    kennelTags: [KENNEL_TAG],
    title: "CR H3 #211 Saturday 12 July",
    runNumber: 211,
    startTime: "15:00",
    sourceUrl: "https://chiangraihhh.blogspot.com/2025/07/cr-h3-211-saturday-12-july.html",
  },
  {
    date: "2025-09-07",
    kennelTags: [KENNEL_TAG],
    title: "Chiang Mai Male Oustation and CR H3 # 213",
    description: "Joint Chiang Mai male hash outstation at Pong Sali Arboretum. Males only this Sunday; trail repeats Sat 13 Sept for full kennel.",
    runNumber: 213,
    hares: "Sirgin",
    cost: "350 baht (drinkers) / 200 baht (non)",
    startTime: "16:00",
    sourceUrl: "https://chiangraihhh.blogspot.com/2025/09/chiang-mai-male-oustation-and-cr-h3-213.html",
  },
  {
    date: "2025-09-13",
    kennelTags: [KENNEL_TAG],
    title: "Chiang Rai Hash House Harriers Meet #214 next Saturday 13th September at 4.30PM.",
    runNumber: 214,
    startTime: "16:30",
    sourceUrl: "https://chiangraihhh.blogspot.com/2025/09/",
  },
  {
    date: "2025-11-22",
    kennelTags: [KENNEL_TAG],
    title: "CRH3 # 216 is on Saturday 22nd November 3.30 for 4.00.",
    runNumber: 216,
    startTime: "16:00",
    sourceUrl: "https://chiangraihhh.blogspot.com/2025/11/",
  },
  {
    date: "2026-01-17",
    kennelTags: [KENNEL_TAG],
    title: "CRH3 Saturday 17 January",
    runNumber: 218,
    startTime: "15:00",
    sourceUrl: "https://chiangraihhh.blogspot.com/2026/01/",
  },
];

runBackfillScript({
  sourceName: SOURCE_NAME,
  kennelTimezone: KENNEL_TIMEZONE,
  label: "Loading CRH3 historical runs",
  fetchEvents: async () => HISTORICAL_EVENTS,
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
