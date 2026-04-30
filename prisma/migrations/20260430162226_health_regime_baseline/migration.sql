-- Regime-aware health baseline (#1115).
--
-- Adds two columns + one index so rolling-window health checks can
-- detect regime boundaries (config edits / manual code-rollout markers)
-- and avoid firing false-positive FIELD_FILL_DROP / EVENT_COUNT_ANOMALY /
-- EXCESSIVE_CANCELLATIONS alerts when an adapter improves.

-- Source: optional manual reset boundary. Health baselines ignore
-- ScrapeLog rows with startedAt < this timestamp.
ALTER TABLE "Source"
  ADD COLUMN IF NOT EXISTS "baselineResetAt" TIMESTAMP(3);

-- ScrapeLog: SHA-256 hash of Source.config snapshotted at scrape time.
-- Health baselines filter recentSuccessful by this hash. NULL is
-- treated as "matches anything" during the migration backfill window
-- so existing rows still seed baselines until the first post-deploy
-- scrape stamps a current hash.
ALTER TABLE "ScrapeLog"
  ADD COLUMN IF NOT EXISTS "configHash" TEXT;

-- Composite index supporting the baseline query
-- (sourceId, status="SUCCESS", configHash=current OR NULL, startedAt DESC).
CREATE INDEX IF NOT EXISTS "ScrapeLog_sourceId_status_configHash_startedAt_idx"
  ON "ScrapeLog" ("sourceId", "status", "configHash", "startedAt" DESC);
