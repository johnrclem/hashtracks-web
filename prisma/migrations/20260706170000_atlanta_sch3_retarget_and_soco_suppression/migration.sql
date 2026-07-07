-- Atlanta Hash Board cluster Deep Dive — companion data migration.
--
-- (1) Southern Comfort H3 (sch3-atl): retarget the dead source URL + fix the
--     broken CTA, and suppress the recurring audit alerts that have no code/data
--     fix (it is a legit STATIC_SCHEDULE kennel with no live enrichment source).
-- (2) Southern Coven H3 (soco-h3): remove the now-stale event-improbable-time
--     suppression (#2054) — the board scraper is live, and the 03:48 artifact is
--     fixed in the adapter + cleared on the canonical.
--
-- DATA-ONLY (no schema change). Vercel runs `migrate deploy` but never `db seed`,
-- so the Source url/description corrections that also live in
-- prisma/seed-data/sources.ts are applied here too. Idempotent guards throughout.

BEGIN;

-- ─── Southern Comfort H3 (sch3-atl): retarget dead source URL + fix CTA ──────────
-- board.atlantahash.com/viewforum.php?f=3 returns "forum does not exist" (#2514);
-- SCH3 has no board forum (f=11 is the DISTINCT Southern Coven), no Meetup, no
-- HashRego kennel feed, and no active FB page (#2515, verified 2026-07-06). Its
-- only live homepage is the static onin.com/sc club page. Point the (fetch-less
-- STATIC_SCHEDULE) source there and drop the broken board CTA.
UPDATE "Source"
SET "url" = 'https://onin.com/sc/',
    "config" = jsonb_set(
      "config",
      '{defaultDescription}',
      '"Alternate Friday evening trail in southwest Atlanta. Club info at onin.com/sc."'
    ),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "name" = 'SCH3 Static Schedule'
  AND "url" = 'https://board.atlantahash.com/viewforum.php?f=3';

-- Rewrite the broken "Check Atlanta Hash Board for details" CTA on the already-
-- generated skeleton events (#2513 / #2514 — flagged as a broken CTA on all 21).
UPDATE "Event" e
SET "description" = 'Alternate Friday evening trail in southwest Atlanta. Club info at onin.com/sc.',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE e."kennelId" = k."id"
  AND k."kennelCode" = 'sch3-atl'
  AND e."description" = 'Alternate Friday evening trail. Check Atlanta Hash Board for details.';

-- Suppress the recurring sch3-atl audit alerts with no code/data fix.
INSERT INTO "AuditSuppression" (id, "kennelCode", rule, reason, "createdBy", "createdAt")
VALUES
  ('sup_2514_sch3_dead_source_url', 'sch3-atl', 'dead-source-url',
   'Retargeted to the live onin.com/sc club page (#2514). SCH3 has no board forum (f=3 does not exist; f=11 is the distinct Southern Coven), no Meetup/HashRego/FB feed (#2515, verified 2026-07-06). STATIC_SCHEDULE needs no fetch URL — suppress.',
   'migration:20260706170000', NOW() AT TIME ZONE 'UTC'),
  ('sup_2513_sch3_stale_title', 'sch3-atl', 'stale-default-title',
   'Inherent to a STATIC_SCHEDULE kennel with no live source (#2513): events are honest biweekly-Friday skeletons ("SCH3 Biweekly Run"). No per-event titles exist to extract. Suppress until a live source is onboarded.',
   'migration:20260706170000', NOW() AT TIME ZONE 'UTC'),
  ('sup_2515_sch3_coverage_gap', 'sch3-atl', 'source-coverage-gap',
   'No live enrichable source exists for Southern Comfort H3 after research (#2515): onin.com/sc is static, no board forum, no Meetup, no HashRego kennel feed, no active FB page (verified 2026-07-06). Suppress until one surfaces.',
   'migration:20260706170000', NOW() AT TIME ZONE 'UTC'),
  ('sup_2517_sch3_geodata', 'sch3-atl', 'location-geodata-not-backfilled',
   'False premise (#2517): the heatmap "20 distinct coordinates" are the SAME "Atlanta, GA" centroid (33.7501,-84.3885) repeated on all 21 skeleton events — not real per-event geodata. Nothing to reverse-geocode. Suppress.',
   'migration:20260706170000', NOW() AT TIME ZONE 'UTC')
ON CONFLICT ("kennelCode", rule) DO NOTHING;

-- ─── Southern Coven H3 (soco-h3): drop the now-stale improbable-time suppression ──
-- #2054's suppression claimed "the board scraper is dead — un-rescrapeable". The
-- board is in fact LIVE and HEALTHY (the Atlanta Hash Board source succeeds daily),
-- and the flagged 03:48 on the 2026-06-19 event was a phpBB edit-notice artifact,
-- now (a) prevented by the adapter's edit-notice strip and (b) cleared on the
-- canonical (scripts/backfill-atlanta-fixups.ts). Remove the obsolete suppression.
DELETE FROM "AuditSuppression"
WHERE "kennelCode" = 'soco-h3'
  AND rule = 'event-improbable-time';

COMMIT;
