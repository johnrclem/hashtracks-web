-- Route Hash Rego's joint "AH4_PLH3" account to Pinelake H3 (#2501).
--
-- Pinelake (ph3-atl) has no Hash Rego account (hashrego.com/kennels/PLH3/ is a
-- 404). Its joint trails with Atlanta H4 are posted by the shared AH4_PLH3
-- account ("Atlanta & Pine Lake", created 2026-03-22), e.g.
-- ah4_plh3-heavy-metal-rainbow-dress-2026. The Atlanta Hash Board files those
-- joint trails under Pinelake, so the Hash Rego source does the same.
--
-- The adapter fetches only accounts that have a SourceKennel externalSlug, and
-- tags each event with the detail page's host display name, so this needs:
--   1. a Hash Rego ↔ ph3-atl link with externalSlug 'AH4_PLH3', and
--   2. aliases "Atlanta & Pine Lake" (detail page) and "AH4_PLH3" (index
--      fallback) on ph3-atl so the tag resolves.
-- Reconcile risk checked read-only 2026-11-06: none of ph3-atl's 6 CONFIRMED
-- events within ±91 days lacks a RawEvent from another source, so linking
-- ph3-atl to Hash Rego cannot cancel any of them.
--
-- DATA-ONLY (Vercel runs `migrate deploy`, never `db seed`). Mirrors
-- prisma/seed-data/{sources,aliases}.ts. Idempotent. Touches only the
-- ph3-atl link: prod's other Hash Rego links differ from the seed and are left
-- as they are.

BEGIN;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId", "externalSlug")
SELECT 'sk_hashrego_ph3_atl', s.id, k.id, 'AH4_PLH3'
FROM "Source" s, "Kennel" k
WHERE s.name = 'Hash Rego' AND s.type = 'HASHREGO'::"SourceType"
  AND k."kennelCode" = 'ph3-atl'
ON CONFLICT ("sourceId", "kennelId") DO UPDATE
  SET "externalSlug" = EXCLUDED."externalSlug"
  WHERE "SourceKennel"."externalSlug" IS DISTINCT FROM EXCLUDED."externalSlug";

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_ph3atl_hr_' || t.n, k.id, t.alias
FROM "Kennel" k,
     (VALUES (1, 'Atlanta & Pine Lake'), (2, 'AH4_PLH3'), (3, 'Pine Lake H3')) AS t(n, alias)
WHERE k."kennelCode" = 'ph3-atl'
ON CONFLICT ("kennelId", alias) DO NOTHING;

COMMIT;
