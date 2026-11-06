-- Strava API Policy compliance (policy effective 2026-06-01).
--   §6.2  Strava Data may not be kept in a cache for more than 7 days.
--   §5.7  Geographic location data may not be stored outside that limited cache.
--   §6.3  Deletions made on Strava must be reflected within 48 hours.
--
-- After this migration:
--   * StravaActivity is a transient cache. Each sync stamps "fetchedAt", and
--     /api/cron/strava-cache-purge deletes rows that were not re-fetched recently.
--   * The user's own decisions move out of the cache into durable storage that
--     holds no Strava Data:
--       - "Attendance"."stravaUrlAutoLinked" records that a link came from Strava,
--         so disconnecting clears only those links.
--       - "StravaDismissal" stores dismissals keyed by sha256 of the activity ID
--         (src/lib/strava/activity-key.ts).
--   * The cached athlete profile (name, avatar URL) is no longer retained.
--
-- Additive DDL plus idempotent data copies. Nothing is deleted here: expired
-- cache rows are removed by the purge cron after deploy.

BEGIN;

-- AlterTable
ALTER TABLE "Attendance" ADD COLUMN "stravaUrlAutoLinked" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "StravaActivity" ADD COLUMN "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "StravaDismissal" (
    "id" TEXT NOT NULL,
    "stravaConnectionId" TEXT NOT NULL,
    "activityKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StravaDismissal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StravaActivity_fetchedAt_idx" ON "StravaActivity"("fetchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "StravaDismissal_stravaConnectionId_activityKey_key" ON "StravaDismissal"("stravaConnectionId", "activityKey");

-- AddForeignKey
ALTER TABLE "StravaDismissal" ADD CONSTRAINT "StravaDismissal_stravaConnectionId_fkey" FOREIGN KEY ("stravaConnectionId") REFERENCES "StravaConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Data 1: flag attendances whose link was attached from a Strava match. The link
-- must still be the canonical URL of that activity. A user who later pasted a
-- different URL owns that link, so it stays unflagged.
UPDATE "Attendance" a
SET "stravaUrlAutoLinked" = true
FROM "StravaActivity" s
WHERE s."matchedAttendanceId" = a.id
  AND a."stravaUrl" = 'https://www.strava.com/activities/' || s."stravaActivityId"
  AND a."stravaUrlAutoLinked" = false;

-- Data 2: carry dismissals over as hashed keys.
INSERT INTO "StravaDismissal" ("id", "stravaConnectionId", "activityKey", "createdAt")
SELECT
  'sdm_' || md5(s."stravaConnectionId" || ':' || s."stravaActivityId"),
  s."stravaConnectionId",
  encode(sha256(convert_to('strava-activity:' || s."stravaActivityId", 'UTF8')), 'hex'),
  NOW() AT TIME ZONE 'UTC'
FROM "StravaActivity" s
WHERE s."matchDismissed" = true
ON CONFLICT ("stravaConnectionId", "activityKey") DO NOTHING;

-- Data 3: existing cache rows keep their real last-fetch time, so the purge cron
-- expires them instead of treating them as fetched today.
UPDATE "StravaActivity" SET "fetchedAt" = "updatedAt" WHERE "fetchedAt" <> "updatedAt";

-- Data 4: stop retaining the cached athlete profile.
UPDATE "StravaConnection" SET "athleteData" = NULL WHERE "athleteData" IS NOT NULL;

COMMIT;
