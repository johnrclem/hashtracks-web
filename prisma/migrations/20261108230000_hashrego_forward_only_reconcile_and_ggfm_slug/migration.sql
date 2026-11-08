-- Prepare the Hash Rego source for reconcile to start running.
--
-- Until now any failed kennel page skipped reconcile for the whole source, so
-- it never ran. scrape.ts now narrows reconcile to the kennels that were read.
--
-- 1. upcomingOnly: the index lists upcoming events but can keep a recently
--    started row, which would make a finished run after it look removed.
--    Live 2026-11-08: 1 of 41 index rows was already past-dated.
-- 2. GGFM's Hash Rego account is GGFMH3 (KennelDiscovery; hashrego.com returns
--    200 for GGFMH3 and 404 for GGFM). The wrong slug failed on every scrape.
--
-- Reconcile risk checked read-only 2026-11-08: running the real reconcile code
-- against prod with this config would cancel 0 events.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- prisma/seed-data/sources.ts. Idempotent. Touches only the ggfm link: prod's
-- other Hash Rego links differ from the seed and are left as they are.

BEGIN;

UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || '{"upcomingOnly": true}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Hash Rego' AND type = 'HASHREGO'::"SourceType"
  AND config->'upcomingOnly' IS DISTINCT FROM 'true'::jsonb;

UPDATE "SourceKennel" sk
SET "externalSlug" = 'GGFMH3'
FROM "Source" s, "Kennel" k
WHERE sk."sourceId" = s.id AND sk."kennelId" = k.id
  AND s.name = 'Hash Rego' AND s.type = 'HASHREGO'::"SourceType"
  AND k."kennelCode" = 'ggfm'
  AND sk."externalSlug" = 'GGFM';

COMMIT;
