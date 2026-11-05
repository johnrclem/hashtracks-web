-- Oregon Hashing Calendar: route sibling Oregon kennels instead of dropping them.
--
-- #2693 made this aggregator strict (unmatched titles are dropped). Its sibling
-- kennels each have their own calendar, but those only reach back to 2024-2025,
-- while this calendar holds their 2018+ history. Add explicit sibling patterns:
-- eh3-or, stumph3, dwh3, coh3, swh3-or, okh3, ph4, n2h3, salemh3. OH3 stays first
-- so OH3-led joint trails remain oh3, and bare "SH3" is left unrouted because
-- Stumptown and Salem both use it. The N2H3/Kahuna skipPatterns are removed,
-- since those runs are routed to n2h3/okh3 and merge dedupes by (kennel, date)
-- against their own calendars (trust 8 > 7). Also links the 9 kennels so the
-- source-kennel guard admits them.
--
-- Takes effect on the next scrape (365-day window). The 2018+ history needs a
-- separate, approved wide pass (scripts/backfill-gcal-history.ts).
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts matches.

BEGIN;

UPDATE "Source"
SET config = (config - 'skipPatterns')
      || jsonb_build_object('kennelPatterns', '[["(?:Cherry City.*OH3)|(?:OH3.*Cherry City)",["cch3-or","oh3"]],["^[^A-Za-z0-9]*OH3\\b|OH3 Full Moon","oh3"],["TGIF|Friday.*Pubcrawl","tgif"],["Cherry City|Cherry Cherry City","cch3-or"],["^[^A-Za-z0-9]*(?:EH3|EH2)\\b|Eugene (?:H3|Hash|Tutu)","eh3-or"],["^[^A-Za-z0-9]*(?:Stumptown|Stumptowm|StumpH3)\\b","stumph3"],["Dead Whores|^[^A-Za-z0-9]*DWH(?:3|ash)?\\b","dwh3"],["Central Oregon|^[^A-Za-z0-9]*COH3\\b","coh3"],["^[^A-Za-z0-9]*SWH3\\b","swh3-or"],["^[^A-Za-z0-9]*(?:OKH3|Oregon Kahuna|Kahuna|Ka3na|Katuna|Kah-Two-Na|Ka-Three-Na)\\b","okh3"],["^[^A-Za-z0-9]*(?:PH4|Portland Humpin)","ph4"],["^[^A-Za-z0-9]*(?:N2H3|NNH3|No Name)\\b","n2h3"],["^[^A-Za-z0-9]*SalemH3\\b|Salem H3","salemh3"]]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Oregon Hashing Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (config->'kennelPatterns' IS DISTINCT FROM '[["(?:Cherry City.*OH3)|(?:OH3.*Cherry City)",["cch3-or","oh3"]],["^[^A-Za-z0-9]*OH3\\b|OH3 Full Moon","oh3"],["TGIF|Friday.*Pubcrawl","tgif"],["Cherry City|Cherry Cherry City","cch3-or"],["^[^A-Za-z0-9]*(?:EH3|EH2)\\b|Eugene (?:H3|Hash|Tutu)","eh3-or"],["^[^A-Za-z0-9]*(?:Stumptown|Stumptowm|StumpH3)\\b","stumph3"],["Dead Whores|^[^A-Za-z0-9]*DWH(?:3|ash)?\\b","dwh3"],["Central Oregon|^[^A-Za-z0-9]*COH3\\b","coh3"],["^[^A-Za-z0-9]*SWH3\\b","swh3-or"],["^[^A-Za-z0-9]*(?:OKH3|Oregon Kahuna|Kahuna|Ka3na|Katuna|Kah-Two-Na|Ka-Three-Na)\\b","okh3"],["^[^A-Za-z0-9]*(?:PH4|Portland Humpin)","ph4"],["^[^A-Za-z0-9]*(?:N2H3|NNH3|No Name)\\b","n2h3"],["^[^A-Za-z0-9]*SalemH3\\b|Salem H3","salemh3"]]'::jsonb OR config ? 'skipPatterns');

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'mig_20261105_oregon_sk_' || k."kennelCode", s.id, k.id
FROM "Source" s
JOIN "Kennel" k ON k."kennelCode" IN ('eh3-or', 'stumph3', 'dwh3', 'coh3', 'swh3-or', 'okh3', 'ph4', 'n2h3', 'salemh3')
WHERE s.name = 'Oregon Hashing Calendar' AND s.type::text = 'GOOGLE_CALENDAR'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
