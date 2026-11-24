-- Scrape 21 more Hash Rego accounts for kennels' special events
-- (docs/kennel-external-ids-plan.md section 5, PR C).
--
-- Many kennels use Hash Rego only for weekends, campouts, dress runs and
-- parties. These accounts were confirmed against their kennels (KennelDiscovery
-- LINKED) and had events in the scrape window on 2026-11-23. Links the Hash Rego
-- source to each kennel with the account slug the scraper fetches.
-- prisma/seed-data/sources.ts carries the same list (kennelCodes and
-- kennelSlugMap).
--
-- Held back: mh3-mn (No Wimps is 2027-01-15 on the calendar, 01-16 on Hash
-- Rego, so it would show twice) and soh4 (its Holiday Party would overwrite the
-- same-day trail from its website at equal trust).
--
-- Checked read-only on 2026-11-23: all 21 kennels exist, none had a Hash Rego
-- link, and none has an upcoming confirmed event without a raw event, so the
-- first reconcile can't cancel anything. A dry merge on a local copy of prod
-- created 26 events and updated 7, with no same-day duplicates.
--
-- Idempotent: an existing link keeps any slug it already has.

BEGIN;
SET LOCAL lock_timeout = '5s';

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId", "externalSlug")
SELECT 'sk_hrspecial_' || t.code, s.id, k.id, t.slug
FROM (VALUES
  ('bh4', 'BigHumpH3'),
  ('clh3-sd', 'CLH3'),
  ('ctrh3', 'CTrH3'),
  ('eph3', 'EPH3'),
  ('fth3', 'Foothill'),
  ('gatr-h3', 'GATRH3'),
  ('gsh3', 'GStrH3'),
  ('ih3', 'IH3'),
  ('jhav-h3', 'jHavH3'),
  ('lbh3', 'LBH3'),
  ('mh3-tn', 'MemphisH3'),
  ('pch3', 'PCH3'),
  ('pfh3', 'PFH3'),
  ('rch3', 'RCH3-OH'),
  ('rumson', 'Rumson'),
  ('rvah3', 'RH3'),
  ('savh3', 'SavH3'),
  ('sdh3', 'SDH3'),
  ('summit', 'SummitH3'),
  ('tbh3-fl', 'TBH3'),
  ('twh3', 'TH3')
) AS t(code, slug)
JOIN "Source" s ON s.type = 'HASHREGO'::"SourceType" AND s.name = 'Hash Rego'
JOIN "Kennel" k ON k."kennelCode" = t.code
ON CONFLICT ("sourceId", "kennelId") DO UPDATE
  SET "externalSlug" = EXCLUDED."externalSlug"
  WHERE "SourceKennel"."externalSlug" IS NULL;

COMMIT;
