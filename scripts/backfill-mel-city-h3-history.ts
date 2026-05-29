/**
 * One-shot historical backfill for Melbourne City H3 (#1755).
 *
 * HashTracks tracked only 1 city-hash event (the recent City Hash Beer
 * Marathon the live adapter caught upcoming); the committed Meetup history
 * batches carry ~19 City H3 events spanning 2023-2024. This replays them
 * through the merge pipeline. See `scripts/lib/mel-meetup-history-backfill.ts`.
 *
 * Matcher: every City H3 title contains "City Hash" in some form —
 *   "City Hash Run#43", "Melbourne City Hash 1st Anniversary Run",
 *   "Beer Run# 26 from Melbourne City Hash"
 * — so a case-insensitive "city hash" substring is the inclusive form (the
 * live source's anchored `^\s*(?:Melbourne\s+)?City\s+Hash\b` misses the
 * "Beer Run#.. from Melbourne City Hash" variant).
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-mel-city-h3-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-mel-city-h3-history.ts
 *   Env:       DATABASE_URL
 */

import { backfillMelMeetupKennel } from "./lib/mel-meetup-history-backfill";

/** True for City H3 titles: contains "city hash" (case-insensitive). */
export function isCityHashTitle(title: string): boolean {
  return /city\s*hash/i.test(title);
}

if (process.argv[1]?.endsWith("backfill-mel-city-h3-history.ts")) {
  backfillMelMeetupKennel({
    kennelCode: "melbourne-city-h3",
    matcher: isCityHashTitle,
    label: "Replaying Melbourne New Moon Meetup batches for City H3 entries",
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
