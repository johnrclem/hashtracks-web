import { NextResponse } from "next/server";
import { withCronRun } from "@/lib/cron-run";
import { purgeExpiredStravaCache } from "@/lib/strava/sync";
import { STRAVA_CACHE_TTL_HOURS } from "@/lib/strava/constants";

/**
 * Daily purge of the transient Strava activity cache.
 *
 * Strava's API Policy (effective 2026-06-01) allows Strava Data, including
 * location, only in a cache of at most 7 days (§6.2, §5.7). It also requires
 * deletions made on Strava to reach us within 48 hours (§6.3). Every logbook
 * visit re-fetches the cache. This cron removes rows nobody re-fetched within
 * STRAVA_CACHE_TTL_HOURS, which covers users who stopped visiting and
 * activities that aged out of the 90-day lookback.
 *
 * Triggered by Vercel Cron (GET) or QStash (POST) or manually with
 * Bearer CRON_SECRET.
 */
export const POST = withCronRun("cron:strava-cache-purge", async () => {
  const result = await purgeExpiredStravaCache();
  console.log(
    `[strava-cache-purge] deleted ${result.deleted} cached activities fetched before ${result.olderThan.toISOString()}`,
  );
  return NextResponse.json({
    data: {
      deleted: result.deleted,
      olderThan: result.olderThan.toISOString(),
      ttlHours: STRAVA_CACHE_TTL_HOURS,
    },
  });
});

/** Vercel Cron triggers GET requests. */
export const GET = POST;
