-- Repair the Hash Rego links (docs/kennel-directory-mapping-review.md, R1).
--
-- DATA-ONLY. Ships in the same release as the code change (R2) that stops the
-- discovery sync from auto-linking and re-writing MATCHED slugs; without it the
-- next sync would put the wrong slugs straight back.
--
-- 1. Point each kennel's HASHREGO link at its own Hash Rego account. Fuzzy
--    auto-matches at 0.95-0.99 (2026-03-03) had replaced them with other
--    kennels' accounts (e.g. dch4 -> Seattle "Harriettes", sch3-atl -> Fort
--    Walton Beach "SCH3"). The seed mapped ch3 to "CH3", which is Charlotte, NC;
--    Chicago's account is "ChiH3". philly-h3 moves from the "Philly Events"
--    account to "PhillyH3" (Philadelphia Hash House Harriers), per owner.
-- 2. gfh3 (Great Falls, VA): Hash Rego "GFH3" is Great Falls, MT. Remove the
--    link and hide the kennel (0 events, no other source), per owner.
-- 3. Dismiss the wrong auto-matched discovery rows, plus the Portland Green
--    Dress Run event accounts and the sister-kennel accounts, so no tool
--    reads them as links. DISMISSED is terminal: the sync never re-scores it.
--    PhillyH3's row is linked to philly-h3, and the 12 suggested (MATCHED)
--    rows whose account the scraper already fetches are marked LINKED, so
--    nothing scraped sits in the suggestion queue. processedBy stays NULL.
-- 4. Alias the scraped accounts' Hash Rego display names that the resolver
--    can't match today (it never reads Kennel.fullName), so their detail-page
--    events aren't dropped as unmatched or caught by the global /moon/
--    pattern. Drop oh3's "PDXGDRH3" alias: that event account is dismissed.
--
-- Idempotent; safe to re-apply. prisma/seed-data/sources.ts and aliases.ts
-- carry the same state.

BEGIN;
SET LOCAL lock_timeout = '5s';

-- 1. Correct slugs on existing links.
UPDATE "SourceKennel" sk
SET "externalSlug" = t.slug
FROM (VALUES
  ('dch4', 'DCH4'),
  ('wsh3', 'WSH3'),
  ('noh3', 'NOH3'),
  ('sch3-atl', 'SoCoH3'),
  ('mh3-wv', 'MOTOWNH3'),
  ('chh3', 'CHH3'),
  ('oh3', 'OregonH3'),
  ('ch3', 'ChiH3'),
  ('philly-h3', 'PhillyH3')
) AS t(code, slug), "Kennel" k, "Source" s
WHERE s.type = 'HASHREGO'::"SourceType"
  AND sk."sourceId" = s.id
  AND k.id = sk."kennelId"
  AND k."kennelCode" = t.code
  AND sk."externalSlug" IS DISTINCT FROM t.slug;

-- 2. gfh3: drop the Montana account and hide the kennel.
DELETE FROM "SourceKennel" sk
USING "Source" s, "Kennel" k
WHERE s.type = 'HASHREGO'::"SourceType"
  AND sk."sourceId" = s.id
  AND k.id = sk."kennelId"
  AND k."kennelCode" = 'gfh3';

UPDATE "Kennel" SET "isHidden" = true
WHERE "kennelCode" = 'gfh3' AND "isHidden" = false;

-- 3. Discovery rows.
UPDATE "KennelDiscovery"
SET status = 'DISMISSED'::"DiscoveryStatus",
    "processedAt" = NOW() AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "externalSource" = 'HASHREGO'
  AND "externalSlug" IN ('Harriettes', 'SCH3', 'Noh', 'SoulH3', 'MFM', 'HHSuck', 'PDXGDR', 'PDXGDRH3', 'PhillyHash')
  AND status <> 'DISMISSED'::"DiscoveryStatus";

UPDATE "KennelDiscovery" d
SET status = 'LINKED'::"DiscoveryStatus",
    "matchedKennelId" = k.id,
    "processedAt" = NOW() AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE d."externalSource" = 'HASHREGO'
  AND d."externalSlug" = 'PhillyH3'
  AND k."kennelCode" = 'philly-h3'
  AND (d.status <> 'LINKED'::"DiscoveryStatus" OR d."matchedKennelId" IS DISTINCT FROM k.id);

UPDATE "KennelDiscovery" d
SET status = 'LINKED'::"DiscoveryStatus",
    "processedAt" = NOW() AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE d."externalSource" = 'HASHREGO'
  AND d.status = 'MATCHED'::"DiscoveryStatus"
  AND d."matchedKennelId" = k.id
  AND (k."kennelCode", d."externalSlug") IN (
    ('dch4', 'DCH4'), ('gh3-gd', 'GndH3'), ('hch3', 'HCH3'), ('hellgate-h3', 'HellgateH3'),
    ('hoboh3', 'HOBO'), ('hoth3', 'HOTH3'), ('mobh3', 'MOBH3'), ('oxford-h3', 'OxfordH3'),
    ('sgh3', 'SHH3'), ('ssh3-wa', 'SouthH3'), ('sbh3-ph', 'SubicH3'), ('blhhh', 'TBLH3')
  );

-- 4. Display-name aliases.
INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_hr_repair_' || t.code, k.id, t.alias
FROM (VALUES
  ('dch4', 'DC Harriettes and Harriers Hash House'),
  ('mh3-wv', 'Morgantown Hash House Harriers'),
  ('noh3', 'New Orleans Hash House Harriers'),
  ('oh3', 'Oregon Hash House Harriers'),
  ('philly-h3', 'Philadelphia Hash House Harriers'),
  ('blhhh', 'The Big Lik Hash House Harriers'),
  ('dcfmh3', 'DC Full mOOn Hash House Harriers'),
  ('ggfm', 'Greater Gotham Full Moon Hash'),
  ('hoboh3', 'Tidewater HOBO Hash House Harriers'),
  ('mrh3', 'Mutha Rucker Hash House Harriers'),
  ('oxford-h3', 'Oxford Hash House Harrirers'),
  ('vbfmh3', 'Virginia Beach Full Moon Hash House Harriers')
) AS t(code, alias)
JOIN "Kennel" k ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

DELETE FROM "KennelAlias" a
USING "Kennel" k
WHERE a."kennelId" = k.id AND k."kennelCode" = 'oh3' AND a.alias = 'PDXGDRH3';

COMMIT;
