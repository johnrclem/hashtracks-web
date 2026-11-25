-- WS4 week 1 (next-round plan v3.2): dispositions for the failing enabled sources.
--   1. Pause the five HashStats archive sources (owner decision D2, 25 Nov 2026).
--      hashingstats.com stopped answering on 4 Nov; the rebuilt hashstats.org has no
--      /listhashes2 endpoint. replacedById stays NULL: this is a pause, not a
--      replacement, so their RawEvents keep protecting the history they hold.
--   2. Pause Kampong H3 and Seletar H3: hash.org.sg's nameservers (ns*.temasek.net)
--      stop resolving on 19 Nov, so neither host has an address. Re-enable when DNS returns.
--   3. Dayton H3: daytonhhh.org dropped The Events Calendar (Tribe REST route is gone,
--      403/404). The kennel now publishes through hashstats.org's iCal feed, so a new
--      ICAL_FEED source replaces the Tribe source (replacedById set).
--   4. Point three sources at the URLs their sites moved to (each old URL 301s or 404s).
-- The reason and date of each pause sit in Source.config (pausedReason/pausedAt).
-- Open alerts on the paused or retired sources can't auto-resolve once they stop
-- scraping, so they are resolved here.
BEGIN;
SET LOCAL lock_timeout = '5s';

UPDATE "Source"
SET enabled = false,
    config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
      'pausedReason', 'hashingstats.com unreachable since 2026-11-04; hashstats.org has no listhashes2 API (D2). Recheck weekly.',
      'pausedAt', '2026-11-25'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE type = 'HTML_SCRAPER'::"SourceType"
  AND name IN ('SCH4 HashStats', 'QCH4 HashStats', 'LVH3 HashStats',
               'SCH4BASH HashStats', 'SWOT HashStats')
  AND "replacedById" IS NULL
  AND enabled;

UPDATE "Source"
SET enabled = false,
    config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
      'pausedReason', 'hash.org.sg nameservers (ns*.temasek.net) do not resolve since 2026-11-19. Re-enable when DNS returns; recheck weekly.',
      'pausedAt', '2026-11-25'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE type = 'HTML_SCRAPER'::"SourceType"
  AND name IN ('Kampong H3 Website', 'Seletar H3 PWA')
  AND "replacedById" IS NULL
  AND enabled;

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'src_dayton_h3_hashstats_ical', 'Dayton H3 HashStats iCal',
  'https://hashstats.org/calendar.ics?k=dh3',
  'ICAL_FEED'::"SourceType",
  '{"defaultKennelTag": "dh3-oh", "timezone": "America/New_York", "titleStripPrefixAliases": ["Dayton H3"], "harePatterns": ["^Hares?:\\s*(.+)$"], "costPatterns": ["^Cost:\\s*(.+)$"]}'::jsonb,
  8, 'daily', 180, true, 'UNKNOWN'::"SourceHealth",
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_dayton_h3_hashstats_ical', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name = 'Dayton H3 HashStats iCal' AND s.type = 'ICAL_FEED'::"SourceType"
  AND k."kennelCode" = 'dh3-oh'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

UPDATE "Source" old
SET enabled = false,
    "replacedById" = new.id,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Source" new
WHERE old.name = 'Dayton H3 Events Calendar' AND old.type = 'HTML_SCRAPER'::"SourceType"
  AND new.name = 'Dayton H3 HashStats iCal' AND new.type = 'ICAL_FEED'::"SourceType"
  AND (old.enabled OR old."replacedById" IS DISTINCT FROM new.id);

UPDATE "Source" SET url = 'https://www.sh3.link/upcoming-runs/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Sydney H3 Hareline' AND type = 'HTML_SCRAPER'::"SourceType"
  AND url = 'https://www.sh3.link/?page_id=9470';

UPDATE "Source" SET url = 'https://www.taipeihash.com.tw/runs', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Taipei Hash Run List' AND type = 'HTML_SCRAPER'::"SourceType"
  AND url = 'https://www.taipeihash.com.tw/run_site.php';

UPDATE "Source" SET url = 'https://big-hump.com/hareline.html', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Big Hump H3 Hareline' AND type = 'HTML_SCRAPER'::"SourceType"
  AND url = 'http://www.big-hump.com/hareline.php';

UPDATE "Alert" a
SET status = 'RESOLVED', "resolvedAt" = NOW() AT TIME ZONE 'UTC',
    details = COALESCE(a.details, '') || ' [Resolved: source paused or replaced — WS4 week 1, 2026-11-25]',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Source" s
WHERE a."sourceId" = s.id
  AND s.type = 'HTML_SCRAPER'::"SourceType"
  AND s.name IN ('SCH4 HashStats', 'QCH4 HashStats', 'LVH3 HashStats', 'SCH4BASH HashStats',
                 'SWOT HashStats', 'Kampong H3 Website', 'Seletar H3 PWA',
                 'Dayton H3 Events Calendar')
  AND NOT s.enabled
  AND a.status IN ('OPEN', 'ACKNOWLEDGED');

COMMIT;
