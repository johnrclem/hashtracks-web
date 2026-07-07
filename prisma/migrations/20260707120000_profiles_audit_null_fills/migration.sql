-- Profile NULL-fills for the chrome-kennel audit sweep (companion to
-- 20260706120000). Vercel deploys run `prisma migrate deploy && next build` and
-- never `prisma db seed`, so seed-only additions to prisma/seed-data/kennels.ts
-- do NOT reach prod on deploy (ensureKennelRecords only fills these when db seed
-- runs against a null column). Apply them here so the closed audit issues are
-- actually satisfied in prod. (Same approach as the earlier profile sweeps.)
--
-- Idempotent: each column uses COALESCE and the row is guarded so only genuinely
-- empty columns are written — never stomps an admin edit; re-run touches 0 rows.
-- `updatedAt` is `timestamp without time zone`, so stamp with UTC wall-clock.

BEGIN;

-- #2592 Newcastle H3 — founded year
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1994), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'newcastle-h3' AND "foundedYear" IS NULL;

-- #2579 Hua Hin Full Moon H3 — website + socials + contact email
UPDATE "Kennel"
SET "website" = COALESCE("website", 'https://h2fm.site.pro/'),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/HHFMHHH'),
    "instagramHandle" = COALESCE("instagramHandle", 'hua_hin_full_moon_hash'),
    "contactEmail" = COALESCE("contactEmail", 'huahin.fullmoon@gmail.com'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'h2fmh3'
  AND (NULLIF(BTRIM("website"), '') IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("instagramHandle"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL);

-- #2570 DAFT H3 — founded year + founder + website
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1994),
    "founder" = COALESCE("founder", 'Rod ''Animal'' Nisbit'),
    "website" = COALESCE("website", 'https://www.edinburghh3.com/dunfermline--fife-daft-h3.html'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'dafth3'
  AND ("foundedYear" IS NULL
    OR NULLIF(BTRIM("founder"), '') IS NULL
    OR NULLIF(BTRIM("website"), '') IS NULL);

-- #2568 BEER H3 — founded year + Facebook group + founder + description
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 2004),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/1765268473729733'),
    "founder" = COALESCE("founder", 'John ''Overdrive'' Miller'),
    "description" = COALESCE("description", 'Belgrade''s English-speaking hash — a drinking club with a running problem. Trails run roughly every second Sunday with a couple of drink stops and an on-after.'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'beerh3'
  AND ("foundedYear" IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("founder"), '') IS NULL
    OR NULLIF(BTRIM("description"), '') IS NULL);

-- #2566 Brazil Nuts H3 — Facebook group + founded year + website
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/bnhhh/'),
    "foundedYear" = COALESCE("foundedYear", 2000),
    "website" = COALESCE("website", 'https://sites.google.com/site/bnhhhsp'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bnh3'
  AND (NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR "foundedYear" IS NULL
    OR NULLIF(BTRIM("website"), '') IS NULL);

-- #2552 BeerSpoke H3 — Facebook group + founded year
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/beerspokehashhouseharriers/'),
    "foundedYear" = COALESCE("foundedYear", 2017),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'beerspoke-h3'
  AND (NULLIF(BTRIM("facebookUrl"), '') IS NULL OR "foundedYear" IS NULL);

-- #2538 Aberdeen H3 — contact email (seasonal note already set in 20260706120000)
UPDATE "Kennel"
SET "contactEmail" = COALESCE("contactEmail", 'aberdeenh3@gmail.com'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'aberdeen-h3' AND NULLIF(BTRIM("contactEmail"), '') IS NULL;

-- #2502 SLUT H3 — hash cash
UPDATE "Kennel"
SET "hashCash" = COALESCE("hashCash", '$10'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'sluth3' AND NULLIF(BTRIM("hashCash"), '') IS NULL;

-- #2494 Pinelake H3 — hash cash + gather-time note
UPDATE "Kennel"
SET "hashCash" = COALESCE("hashCash", '$10'),
    "scheduleNotes" = COALESCE("scheduleNotes", 'Gather 1:30 PM, on-out 2:00 PM.'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'ph3-atl'
  AND (NULLIF(BTRIM("hashCash"), '') IS NULL OR NULLIF(BTRIM("scheduleNotes"), '') IS NULL);

-- #2525 SoCo — hash cash + founded year
UPDATE "Kennel"
SET "hashCash" = COALESCE("hashCash", '$10 / $15'),
    "foundedYear" = COALESCE("foundedYear", 2023),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'soco-h3'
  AND (NULLIF(BTRIM("hashCash"), '') IS NULL OR "foundedYear" IS NULL);

-- #2483 TTH3 — founded year + Facebook group + contact + payment + logo
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 2019),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/TrueTrailH3'),
    "contactEmail" = COALESCE("contactEmail", 'truetrailh3@gmail.com'),
    "paymentLink" = COALESCE("paymentLink", 'https://www.paypal.me/truetrailh3'),
    "logoUrl" = COALESCE("logoUrl", '/kennel-logos/tth3-ab.jpg'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'tth3-ab'
  AND ("foundedYear" IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
    OR NULLIF(BTRIM("paymentLink"), '') IS NULL
    OR NULLIF(BTRIM("logoUrl"), '') IS NULL);

-- #2480 White House H3 — Facebook group + hash cash
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/1719732354904792'),
    "hashCash" = COALESCE("hashCash", '$10'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'wh4'
  AND (NULLIF(BTRIM("facebookUrl"), '') IS NULL OR NULLIF(BTRIM("hashCash"), '') IS NULL);

-- #2473 Taint — hash cash
UPDATE "Kennel"
SET "hashCash" = COALESCE("hashCash", '$5 (unless otherwise posted)'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'taint-h3' AND NULLIF(BTRIM("hashCash"), '') IS NULL;

-- #2467 Thirstday H3 — logo
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", '/kennel-logos/th3.png'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'th3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2457 Sydney Thirsty H3 — Facebook group + Instagram
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/sydneythirsty'),
    "instagramHandle" = COALESCE("instagramHandle", 'sydneythirsty'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'sth3-au'
  AND (NULLIF(BTRIM("facebookUrl"), '') IS NULL OR NULLIF(BTRIM("instagramHandle"), '') IS NULL);

COMMIT;
