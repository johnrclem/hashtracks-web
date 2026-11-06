-- #2374 T3H3 (Wellington): the kennel runs on the 1st and 3rd Thursdays (FB
-- Events: #538 Jul 16, #539 Aug 6, #540 Aug 20 ... #545 Nov 5 2026), not the
-- "2nd Thursday monthly" the static rule assumed. Re-point the existing rule
-- to 1st Thursday, add a 3rd-Thursday sibling, and onboard the FB hosted-events
-- page (trust 8) for real titles/venues. DATA-ONLY, idempotent.
-- prisma/seed-data/sources.ts matches.

UPDATE "Source"
SET config = config || jsonb_build_object(
      'rrule', 'FREQ=MONTHLY;BYDAY=1TH',
      'defaultTitle', 'T3H3 Run',
      'defaultDescription', '1st and 3rd Thursday of every month, 6:30 PM. ~5km urban trails accessible by public transport. Check https://www.facebook.com/ThirstyThursdayTaniwhaH3 for each run''s start location.'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'T3H3 Wellington Static Schedule'
  AND type = 'STATIC_SCHEDULE'::"SourceType"
  AND config->>'rrule' IS DISTINCT FROM 'FREQ=MONTHLY;BYDAY=1TH';

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES
(
  'mig_20261106_t3h3nz_static_3th',
  'T3H3 Wellington Static Schedule (3rd Thursday)',
  'https://www.facebook.com/ThirstyThursdayTaniwhaH3#3rd-thursday',
  'STATIC_SCHEDULE'::"SourceType",
  jsonb_build_object(
    'kennelTag', 't3h3-nz',
    'rrule', 'FREQ=MONTHLY;BYDAY=3TH',
    'startTime', '18:30',
    'defaultTitle', 'T3H3 Run',
    'defaultLocation', 'Wellington, NZ',
    'defaultDescription', '1st and 3rd Thursday of every month, 6:30 PM. ~5km urban trails accessible by public transport. Check https://www.facebook.com/ThirstyThursdayTaniwhaH3 for each run''s start location.'
  ),
  3, 'weekly', 90,
  true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
),
(
  'mig_20261106_t3h3nz_fb',
  'T3H3 Wellington Facebook Hosted Events',
  'https://www.facebook.com/ThirstyThursdayTaniwhaH3/upcoming_hosted_events',
  'FACEBOOK_HOSTED_EVENTS'::"SourceType",
  jsonb_build_object(
    'kennelTag', 't3h3-nz',
    'pageHandle', 'ThirstyThursdayTaniwhaH3',
    'timezone', 'Pacific/Auckland',
    'upcomingOnly', true,
    'includePastEvents', true
  ),
  8, 'daily', 90,
  true, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'mig_20261106_t3h3nz_sk_' || s.id, s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name IN ('T3H3 Wellington Static Schedule (3rd Thursday)', 'T3H3 Wellington Facebook Hosted Events')
  AND k."kennelCode" = 't3h3-nz'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;
