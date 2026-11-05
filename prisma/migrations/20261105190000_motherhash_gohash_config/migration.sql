-- Mother Hash (KL H3) + KL Full Moon goHash config.
--
-- Mother Hash (KL H3): the site moved from Google Sites to goHash.app (Nov 2026).
--
-- motherhash.org now serves goHash's SSR page (`window.__INITIAL_STATE__` at
-- /hareline/upcoming, "powered by gohash.app"), so the registry routes it to
-- the shared GoHashAdapter (same move KL Full Moon made in #2241) and the
-- bespoke Google Sites MotherHashAdapter is removed. GoHashAdapter reads its
-- kennel tag / default start time / hareline path from Source.config, which
-- was NULL for this row.
--
-- upcomingOnly: /hareline/upcoming lists future runs only. Without it,
-- reconcileStaleEvents (±scrapeDays window) would cancel each sole-source run
-- the day after it happens.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- row is converged here; prisma/seed-data/sources.ts carries the same config so
-- a later seed is a no-op.
--
-- Idempotent: only touches the exact name+type row while it has no kennelTag
-- configured (prod value audited 2026-11-05: config IS NULL).

BEGIN;

UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || jsonb_build_object(
      'kennelTag', 'motherh3',
      'startTime', '18:00',
      'harelinePath', '/hareline/upcoming',
      'upcomingOnly', true
    ),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Mother Hash (KL H3) Website'
  AND type::text = 'HTML_SCRAPER'
  AND (config IS NULL OR config->>'kennelTag' IS NULL);

-- KL Full Moon H3 is on the same forward-only goHash view (#2241) but never
-- got upcomingOnly (Penang H3 / Harriets Penang have it) — same reconcile
-- hazard. Audited prod config 2026-11-05: no upcomingOnly key.
UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'KL Full Moon H3 Hareline'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

COMMIT;
