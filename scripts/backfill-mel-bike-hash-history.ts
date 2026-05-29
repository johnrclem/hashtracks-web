/**
 * One-shot historical backfill for Melbourne Bike Hash (#1752).
 *
 * HashTracks tracked only 4 bike-hash events (the recent `#132-#134` rows the
 * live Meetup adapter caught while upcoming); the committed Meetup history
 * batches carry ~48 bike-hash events back to 2021. This replays them through
 * the merge pipeline. See `scripts/lib/mel-meetup-history-backfill.ts`.
 *
 * Matcher: bike-hash titles take several shapes the live source's
 * `^\s*Bike\s+hash\b` pattern does NOT all catch —
 *   "Bike hash ride #132", "Bike Hash#75", "Bike Ride #88"   (all start "Bike")
 *   "Ride #130 New Year, Old Favourites"                      ("Ride #N" form)
 * so we match a leading "Bike" OR a leading numbered "Ride #N".
 *
 * Usage:
 *   Dry run:   npx tsx scripts/backfill-mel-bike-hash-history.ts
 *   Apply:     BACKFILL_APPLY=1 npx tsx scripts/backfill-mel-bike-hash-history.ts
 *   Env:       DATABASE_URL
 */

import { backfillMelMeetupKennel } from "./lib/mel-meetup-history-backfill";

/** True for bike-hash titles: leading "Bike …" or a leading numbered "Ride #N".
 *  The "Ride #N" check is procedural (strip "ride", then leading spaces/#, then
 *  require a digit) rather than `/^ride\s*#?\s*\d/` — the adjacent `\s*#?\s*`
 *  quantifiers trip Sonar S5852's backtracking-shape check. */
export function isBikeHashTitle(title: string): boolean {
  const t = title.trimStart();
  if (/^bike\b/i.test(t)) return true;
  if (!/^ride\b/i.test(t)) return false;
  const rest = t.slice("ride".length).replace(/^[\s#]+/, "");
  return rest.length > 0 && rest[0] >= "0" && rest[0] <= "9";
}

if (process.argv[1]?.endsWith("backfill-mel-bike-hash-history.ts")) {
  backfillMelMeetupKennel({
    kennelCode: "melbourne-bike-hash",
    matcher: isBikeHashTitle,
    label: "Replaying Melbourne New Moon Meetup batches for Bike Hash entries",
  }).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
