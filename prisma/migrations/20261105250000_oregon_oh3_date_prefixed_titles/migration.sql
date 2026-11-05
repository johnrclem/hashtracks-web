-- Oregon Hashing Calendar: route numbered OH3 runs whose summary does not start
-- with "OH3" ("Saturday Oct 9th OH3 # 1207 ...", "#1157 OH3 ...").
--
-- The anchored OH3 pattern missed them and strict routing (#2693) dropped them,
-- so reconcile cancelled 27 real OH3 runs during the 2026-11-05 history backfill
-- and 11 more were never ingested. The new pattern goes right after TGIF (index
-- 3), so TGIF/OH3 joint pub crawls stay tgif. A full-archive old-vs-new diff
-- showed no already-routed event changing kennel.
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts matches.

UPDATE "Source"
SET config = jsonb_insert(config, '{kennelPatterns,3}', '["\\bOH3\\s*#\\s*\\d|#\\s*\\d+\\s+OH3\\b","oh3"]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Oregon Hashing Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND config->'kennelPatterns'->2 = '["TGIF|Friday.*Pubcrawl","tgif"]'::jsonb
  AND NOT (config->'kennelPatterns' @> '[["\\bOH3\\s*#\\s*\\d|#\\s*\\d+\\s+OH3\\b","oh3"]]'::jsonb);
