-- Source.retiredAt: tell a retired source apart from a paused one.
--
-- Both used to be just `enabled = false`. Reconcile (PR #2889) has to keep a
-- paused source's runs protected, so a disabled source's RawEvents still
-- shielded runs the replacement source never reported. A retired source's
-- RawEvents now never protect (src/pipeline/reconcile.ts protectedByOtherSources).
--
-- Marked retired: disabled sources whose replacement is documented and live.
-- Not marked: archive / backfill sources (their RawEvents are the history they
-- exist to protect) and dead sources with no replacement.
--
-- Schema change + idempotent data UPDATE (guarded on enabled = false and
-- retiredAt IS NULL).

ALTER TABLE "Source" ADD COLUMN "retiredAt" TIMESTAMP(3);

UPDATE "Source"
SET "retiredAt" = NOW() AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE enabled = false
  AND "retiredAt" IS NULL
  AND (name, type::text) IN (
    ('Berlin H3 iCal Feed', 'ICAL_FEED'),                         -- → Berlin H3 Run API (#2872)
    ('HashNYC Website', 'HTML_SCRAPER'),                          -- → HashNYC iCal feed
    ('Burlington H3 Website Hareline', 'HTML_SCRAPER'),           -- → Burlington H3 Google Calendar
    ('Choo-Choo H3 Website', 'HTML_SCRAPER'),                     -- → Choo-Choo H3 iCal Feed
    ('Tidewater H3 Static Schedule', 'STATIC_SCHEDULE'),          -- → Tidewater H3 Website Calendar (#2416)
    ('DCFMH3 Static Schedule (Lunar Anchor)', 'STATIC_SCHEDULE'), -- → DCFMH3 Google Sites Calendar
    ('Von Tramp H3 Meetup', 'MEETUP'),                            -- → Von Tramp H3 Squarespace Events
    ('Von Tramp H3 Facebook Hosted Events', 'FACEBOOK_HOSTED_EVENTS'), -- soft-blocked; Squarespace covers vth3
    ('SOH4 Facebook Hosted Events', 'FACEBOOK_HOSTED_EVENTS'),    -- soft-blocked; SOH4 Website covers soh4
    ('BAH3 iCal Feed', 'ICAL_FEED')                               -- → Baltimore Annapolis GCal
  );
