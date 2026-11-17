/** Fixtures shared by the G17 unit tests and the backfill end-to-end test. */

export const wrap = (body: string) => `BEGIN;\nSET LOCAL lock_timeout = '5s';\n${body}\nCOMMIT;\n`;

/** A sample onboarding migration that also creates the disabled archive source (design 6.5). */
export const SAMPLE_ARCHIVE_ONBOARDING = wrap(`
INSERT INTO "Region" (id, name, slug, country, level, timezone, abbrev, "colorClasses", "pinColor", "createdAt", "updatedAt")
VALUES ('rgn_g17_test', 'G17 Testville', 'g17-testville', 'Croatia', 'METRO'::"RegionLevel", 'Europe/Zagreb', 'G17', 'bg-blue-200 text-blue-800', '#2563eb', NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT DO NOTHING;
UPDATE "Region" m SET "parentId" = c.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Region" c WHERE m.name = 'G17 Testville' AND c.name = 'Croatia' AND m."parentId" IS DISTINCT FROM c.id;
INSERT INTO "Kennel" (id, "kennelCode", "shortName", "fullName", slug, region, "regionId", country, "createdAt", "updatedAt")
VALUES ('knl_g17_test', 'g17-test', 'G17 Test H3', 'G17 Test Hash House Harriers', 'g17-test-h3', 'G17 Testville', 'rgn_g17_test', 'Croatia', NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT DO NOTHING;
INSERT INTO "Source" (id, name, url, type, "trustLevel", enabled, "createdAt", "updatedAt")
VALUES ('src_g17_live', 'G17 Test Sheet', 'https://docs.google.com/spreadsheets/d/g17testsheetid0000000000', 'GOOGLE_SHEETS'::"SourceType", 7, true, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "Source" (id, name, url, type, config, "trustLevel", enabled, "archiveOnly", "createdAt", "updatedAt")
VALUES ('src_g17_archive', 'G17 Test H3 run history', 'https://docs.google.com/spreadsheets/d/g17testsheetid0000000000', 'GOOGLE_SHEETS'::"SourceType", '{"upcomingOnly": true}'::jsonb, 7, false, true, NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC')
ON CONFLICT (name, type) DO NOTHING;
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_g17_archive', 'src_g17_archive', 'knl_g17_test'
WHERE NOT EXISTS (SELECT 1 FROM "SourceKennel" WHERE "sourceId" = 'src_g17_archive' AND "kennelId" = 'knl_g17_test');
`);
