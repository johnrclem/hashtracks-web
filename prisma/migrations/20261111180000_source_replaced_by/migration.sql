-- Source.replacedById: tell a source superseded for good apart from one paused.
--
-- Both used to be just `enabled = false`. Reconcile (PR #2889) keeps a paused
-- source's runs protected, so a disabled source's RawEvents still shielded runs
-- its replacement never reported. Now the replacement's reconcile may cancel an
-- upcoming run inside its own scrape coverage that only the superseded source
-- listed (src/pipeline/reconcile.ts protectedByOtherSources). Past runs, runs
-- beyond the replacement's furthest row, and reconciles by any other source
-- (e.g. Hash Rego) keep the old protection.
--
-- Linked: disabled sources whose live replacement is documented. Not linked:
-- archive / backfill sources (their RawEvents are the history they protect)
-- and dead sources with no replacement.
--
-- Schema change + idempotent data UPDATE (guarded on the old source being
-- disabled, the link being unset, and the replacement existing and enabled).

ALTER TABLE "Source" ADD COLUMN "replacedById" TEXT;

ALTER TABLE "Source" ADD CONSTRAINT "Source_replacedById_fkey"
  FOREIGN KEY ("replacedById") REFERENCES "Source"("id") ON DELETE SET NULL ON UPDATE CASCADE;

UPDATE "Source" old
SET "replacedById" = rep.id,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (VALUES
  ('Berlin H3 iCal Feed', 'ICAL_FEED', 'Berlin H3 Run API', 'HTML_SCRAPER'),                            -- #2872
  ('HashNYC Website', 'HTML_SCRAPER', 'HashNYC Website', 'ICAL_FEED'),
  ('Burlington H3 Website Hareline', 'HTML_SCRAPER', 'Burlington H3 Google Calendar', 'GOOGLE_CALENDAR'),
  ('Choo-Choo H3 Website', 'HTML_SCRAPER', 'Choo-Choo H3 iCal Feed', 'ICAL_FEED'),
  ('Tidewater H3 Static Schedule', 'STATIC_SCHEDULE', 'Tidewater H3 Website Calendar', 'HTML_SCRAPER'), -- #2416
  ('DCFMH3 Static Schedule (Lunar Anchor)', 'STATIC_SCHEDULE', 'DCFMH3 Google Sites Calendar', 'HTML_SCRAPER'),
  ('Von Tramp H3 Meetup', 'MEETUP', 'Von Tramp H3 Squarespace Events', 'HTML_SCRAPER'),
  ('Von Tramp H3 Facebook Hosted Events', 'FACEBOOK_HOSTED_EVENTS', 'Von Tramp H3 Squarespace Events', 'HTML_SCRAPER'),
  ('SOH4 Facebook Hosted Events', 'FACEBOOK_HOSTED_EVENTS', 'SOH4 Website', 'HTML_SCRAPER'),
  ('BAH3 iCal Feed', 'ICAL_FEED', 'Baltimore Annapolis GCal', 'GOOGLE_CALENDAR')
) AS m(old_name, old_type, new_name, new_type)
JOIN "Source" rep ON rep.name = m.new_name AND rep.type::text = m.new_type AND rep.enabled
WHERE old.name = m.old_name AND old.type::text = m.old_type
  AND NOT old.enabled
  AND old."replacedById" IS NULL;
