-- Close the cross-worker race window in merge.ts by adding
-- @@unique([sourceId, fingerprint]) on RawEvent (issue #1286).
--
-- Without this constraint, two concurrent QStash workers scraping the
-- same source can both miss the dedup prefetch (PR #1280) and both
-- insert the same row. Pre-deploy cleanup collapsed 7,697 historical
-- dupes (PR #1341 / scripts/dedup-rawevent-fingerprint.ts). The
-- defensive WITH-DELETE below is a no-op when there are no remaining
-- duplicate groups; it catches any race-window dupes that landed
-- between the pre-deploy script run and this migration's deploy.
--
-- Survivor selection mirrors the script's pickSurvivor algorithm:
--   1. Linked rows beat unlinked (eventId IS NOT NULL ranks first).
--   2. Among linked siblings, most-recent scrapedAt wins.
--   3. Among unlinked siblings, OLDEST scrapedAt wins.
--   4. id ASC is the deterministic final tiebreaker (matches the
--      script's localeCompare-based JS tiebreak so a partial
--      script run + this migration's defensive sweep agree on the
--      survivor).
--
-- Lock the table for the duration of the migration so concurrent QStash
-- workers can't INSERT a fresh duplicate between the DELETE and the
-- CREATE UNIQUE INDEX (which would fail with a unique-violation and roll
-- back the whole migration). ACCESS EXCLUSIVE is what CREATE INDEX takes
-- anyway; acquiring it up-front folds a few hundred ms of would-be
-- writer-blocking into a single contiguous window. Released on
-- COMMIT/ROLLBACK of the implicit migration transaction.
LOCK TABLE "RawEvent" IN ACCESS EXCLUSIVE MODE;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY "sourceId", "fingerprint"
      ORDER BY
        CASE WHEN "eventId" IS NOT NULL THEN 0 ELSE 1 END ASC,
        CASE WHEN "eventId" IS NOT NULL THEN "scrapedAt" END DESC NULLS LAST,
        CASE WHEN "eventId" IS NOT NULL THEN NULL ELSE "scrapedAt" END ASC NULLS LAST,
        id ASC
    ) AS rn
  FROM "RawEvent"
)
DELETE FROM "RawEvent" WHERE id IN (SELECT id FROM ranked WHERE rn > 1);

-- Drop the standalone fingerprint index. Every RawEvent fingerprint
-- query in the codebase also filters by sourceId (the dedup prefetch in
-- merge.ts at processRawEvents → prefetchExistingByFingerprint), so the
-- new composite unique index below covers them with a leftmost-prefix
-- match. Keeping the standalone index would just be redundant write
-- amplification on every RawEvent insert.
DROP INDEX IF EXISTS "RawEvent_fingerprint_idx";

-- Add the unique constraint (Postgres implements as a unique index).
CREATE UNIQUE INDEX "RawEvent_sourceId_fingerprint_key" ON "RawEvent"("sourceId", "fingerprint");
