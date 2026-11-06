import { createHash } from "crypto";

/**
 * One-way key for a Strava activity ID.
 *
 * Strava's API Policy (effective 2026-06-01, §6.2) forbids keeping Strava Data
 * beyond a 7-day cache. A user's "dismiss this suggestion" decision has to last
 * longer than that, so it is stored against this hash instead of the raw ID. A
 * freshly fetched activity is re-keyed and compared; the key alone reveals nothing.
 *
 * Must stay byte-identical to the SQL backfill in
 * prisma/migrations/20261106190000_strava_transient_cache/migration.sql:
 *   encode(sha256(convert_to('strava-activity:' || id, 'UTF8')), 'hex')
 */
export function stravaActivityKey(stravaActivityId: string): string {
  return createHash("sha256")
    .update(`strava-activity:${stravaActivityId}`, "utf8")
    .digest("hex");
}
