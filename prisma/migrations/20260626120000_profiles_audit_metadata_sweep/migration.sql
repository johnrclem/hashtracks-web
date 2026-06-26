-- Kennel profile metadata sweep — audit issues #2445/#2443/#2437/#2435/#2433/
-- #2431/#2430/#2419/#2415/#2412/#2402/#2398/#2389/#2383/#2378/#2367/#2359/#2358/
-- #2356/#2354/#2353/#2347/#2343/#2339/#2330/#2321(+#2318)/#2313/#2307/#2303/
-- #2301/#2300/#2286.
--
-- Pure data migration. Fills profile fields the seed merge cannot reach on
-- existing rows (prisma/seed.ts only NULL-fills) and applies three value
-- corrections (SOH4 hash cash, Sydney H3 schedule day, SLOSH schedule time).
-- Runs automatically via `prisma migrate deploy` on Vercel.
--
-- Idempotency:
--   * NULL-fills use COALESCE + a NULLIF(BTRIM(col),'') guard — they only fill
--     if the row is still NULL/empty, so admin-curated values are preserved.
--   * The three value corrections use a CASE that matches the exact stale value,
--     so a re-run (or any admin edit since the audit) is a no-op.
--
-- Seed file (prisma/seed-data/kennels.ts) holds the same canonical strings so a
-- fresh DB lands identical data via `npx prisma db seed`.

BEGIN;

-- Sanity: refuse the migration if any target row is missing.
DO $$
DECLARE
  missing text[];
  code text;
BEGIN
  FOREACH code IN ARRAY ARRAY[
    'wanchai-h3','voodoo-h3','mosh3','vbfmh3','tkdh3','t3h3-va','hoboh3','uh3',
    'twh3','tmfmh3','riyadh-h3','tah3','larrikins-au','suph3','sumo-h3','svh3',
    'sh3-au','suh3','fm-stgt','sh3-de','sph3-fl','sbh3','stlh3','soh4',
    'slosh-h3','sloh3','sh3-sg','sch4','shith3','sgharriets','hanoi-h3'
  ]
  LOOP
    IF NOT EXISTS (SELECT 1 FROM "Kennel" WHERE "kennelCode" = code) THEN
      missing := array_append(missing, code);
    END IF;
  END LOOP;
  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Missing kennelCode(s): %', array_to_string(missing, ', ');
  END IF;
END $$;

-- ── Logo-only fills ──────────────────────────────────────────────────────────

-- #2437 MoSH3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://tidewaterh3.org/assets/images/kennels/MoSH3.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'mosh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2435 VBFMH3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://tidewaterh3.org/assets/images/kennels/vbfmh3.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'vbfmh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2433 TKDH3 (source file is kdh3.png, not tkdh3.png)
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://tidewaterh3.org/assets/images/kennels/kdh3.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'tkdh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2431 T3H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://tidewaterh3.org/assets/images/kennels/t3h3.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 't3h3-va' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2430 HOBO H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://tidewaterh3.org/assets/images/kennels/hobo.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'hoboh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2419 Upstate H3 (https form; the http source URL 301s to the https CDN)
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://static1.squarespace.com/static/571ea6bb40261d7789831023/t/6567e6afcef58d79816747c1/1701308079290/UHHH%2BLogo.jpg?format=1500w'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'uh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2378 Sumo H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://sumoh3.gotothehash.net/wp-content/uploads/2015/08/Sumo_71x100.jpg'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sumo-h3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2367 SVH3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://svh3.com/local/images/svh3/svh3-color-logo-scaled-trimmed.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'svh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2354 Stuttgart FM
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.stuttgarthash.de/images/favicon.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'fm-stgt' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2353 Stuttgart H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.stuttgarthash.de/images/favicon.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sh3-de' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2347 St Pete H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.jollyrogerh3.com/St%20Pete%20H3%20Black%20BR.jpg'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sph3-fl' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2343 Spring Brooks H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.jollyrogerh3.com/SpringBooksH3Logo.jpg'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sbh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2339 STLH3 (Substack CDN; literal $ in path is fine in a SQL string literal)
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://substackcdn.com/image/fetch/$s_!40rR!,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F15a0fce8-e997-43ff-a213-1dd9c50bc650%2Fapple-touch-icon-57x57.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'stlh3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2307 Singapore Sunday H3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.sundayhash.com/wp-content/uploads/2019/08/cropped-S2H3-Logo-New-1-e1565763457227-1.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sh3-sg' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2301 SHITH3
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://shith3.com/img/sohappyits.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'shith3' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- #2300 SG Harriets
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.singaporeharriets.com/wp-content/uploads/2026/05/Harriets-Logo-without-background.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sgharriets' AND NULLIF(BTRIM("logoUrl"), '') IS NULL;

-- ── Founded-year fills ───────────────────────────────────────────────────────

-- #2445 Wanchai H3 (run #2001 "38th Anniversary" → 1988)
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1988), "updatedAt" = NOW()
WHERE "kennelCode" = 'wanchai-h3' AND "foundedYear" IS NULL;

-- #2383 SUPH3 (earliest GCal event 2023)
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 2023), "updatedAt" = NOW()
WHERE "kennelCode" = 'suph3' AND "foundedYear" IS NULL;

-- #2303 Sin City H4 (HashStats: Hash #1 on 1995-09-15)
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1995), "updatedAt" = NOW()
WHERE "kennelCode" = 'sch4' AND "foundedYear" IS NULL;

-- ── Multi-field fills ────────────────────────────────────────────────────────

-- #2415 Tidewater H3: logo + website
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://tidewaterh3.org/assets/images/kennels/th3.png'),
    "website" = COALESCE("website", 'https://tidewaterh3.org/'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'twh3'
  AND (NULLIF(BTRIM("logoUrl"), '') IS NULL OR NULLIF(BTRIM("website"), '') IS NULL);

-- #2412 TMFMH3: website + monthly full-moon Friday schedule
UPDATE "Kennel"
SET "website" = COALESCE("website", 'https://www.rh3.run/'),
    "scheduleDayOfWeek" = COALESCE("scheduleDayOfWeek", 'Friday'),
    "scheduleTime" = COALESCE("scheduleTime", '6:30 PM'),
    "scheduleFrequency" = COALESCE("scheduleFrequency", 'Monthly'),
    "scheduleNotes" = COALESCE("scheduleNotes", 'Monthly full-moon Friday trail.'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'tmfmh3'
  AND (NULLIF(BTRIM("website"), '') IS NULL
    OR NULLIF(BTRIM("scheduleDayOfWeek"), '') IS NULL
    OR NULLIF(BTRIM("scheduleTime"), '') IS NULL
    OR NULLIF(BTRIM("scheduleFrequency"), '') IS NULL
    OR NULLIF(BTRIM("scheduleNotes"), '') IS NULL);

-- #2402 Riyadh H3 (R3H4): contact email + WhatsApp (logo already self-hosted)
UPDATE "Kennel"
SET "contactEmail" = COALESCE("contactEmail", 'info@riyadhhash.com'),
    "whatsappUrl" = COALESCE("whatsappUrl", 'https://wa.me/966549222200'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'riyadh-h3'
  AND (NULLIF(BTRIM("contactEmail"), '') IS NULL OR NULLIF(BTRIM("whatsappUrl"), '') IS NULL);

-- #2398 TAH3: logo + facebook + email (phone has no schema field, dropped)
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.tah3.com/uploads/8/6/6/9/86698234/published/pngwing-com.png?1659321440'),
    "facebookUrl" = COALESCE("facebookUrl", 'https://facebook.com/TornadoAlleyHashHouseHarriers'),
    "contactEmail" = COALESCE("contactEmail", 'tornadoalleyhashers@gmail.com'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'tah3'
  AND (NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL);

-- #2389 Sydney Larrikins: facebook (group) + email + hash cash (logo already set)
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/sydneylarrikins'),
    "contactEmail" = COALESCE("contactEmail", 'scribe@larrikins.org'),
    "hashCash" = COALESCE("hashCash", '$10'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'larrikins-au'
  AND (NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
    OR NULLIF(BTRIM("hashCash"), '') IS NULL);

-- #2443 Voodoo H3: facebook + instagram handle (logo already set)
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/95805992682'),
    "instagramHandle" = COALESCE("instagramHandle", 'voodooh3'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'voodoo-h3'
  AND (NULLIF(BTRIM("facebookUrl"), '') IS NULL OR NULLIF(BTRIM("instagramHandle"), '') IS NULL);

-- #2356 SUH3 (Stockholm Underground): founded + email + logo
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1994),
    "contactEmail" = COALESCE("contactEmail", 'gms@hash.se'),
    "logoUrl" = COALESCE("logoUrl", 'https://hash.se/local/images/apple-touch-icon-sxh3.png'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'suh3'
  AND ("foundedYear" IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
    OR NULLIF(BTRIM("logoUrl"), '') IS NULL);

-- #2313 SLOH3: logo + facebook + email (description already set)
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://sloh3.com/wp-content/uploads/2020/02/sloh3-header-logo-110401b.jpg'),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/pages/San-Luis-Obispo-Hash-House-Harriers/147387341995817'),
    "contactEmail" = COALESCE("contactEmail", 'webmeister@sloh3.com'),
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sloh3'
  AND (NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL);

-- #2286 Hanoi H3: contact email (logo + facebook already set; phones dropped)
UPDATE "Kennel"
SET "contactEmail" = COALESCE("contactEmail", 'truongnhungr1981@yahoo.com'), "updatedAt" = NOW()
WHERE "kennelCode" = 'hanoi-h3' AND NULLIF(BTRIM("contactEmail"), '') IS NULL;

-- ── Value corrections (guarded overwrite on the exact stale value) ───────────

-- #2330 SOH4: hash cash $5 → $7
UPDATE "Kennel"
SET "hashCash" = '$7', "updatedAt" = NOW()
WHERE "kennelCode" = 'soh4' AND "hashCash" = '$5';

-- #2358 Sydney H3: schedule day Tuesday → Monday (+ description/notes wording),
-- plus #2359 logo + facebook + email fills.
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://sh3.link/wp-content/uploads/2010/06/cropped-2500.png'),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/pages/Sydney-Hash-House-Harriers-SH3-The-POSH-Hash/416144158445'),
    "contactEmail" = COALESCE("contactEmail", 'onsecposh@gmail.com'),
    "scheduleDayOfWeek" = CASE WHEN "scheduleDayOfWeek" = 'Tuesday' THEN 'Monday' ELSE "scheduleDayOfWeek" END,
    description = CASE
      WHEN description = 'Sydney''s senior mixed hash kennel, founded in 1967. Runs every Tuesday evening across the Sydney metro and northern beaches. Known affectionately as ''Posh Hash''.'
        THEN 'Sydney''s senior mixed hash kennel, founded in 1967. Runs every Monday evening across the Sydney metro and northern beaches. Known affectionately as ''Posh Hash''.'
      ELSE description
    END,
    "scheduleNotes" = CASE
      WHEN "scheduleNotes" = 'Weekly Tuesday hash around the Sydney metro. Often called ''Posh Hash'' — Sydney''s senior mixed kennel, founded 1967. Trail list posted at sh3.link.'
        THEN 'Weekly Monday hash around the Sydney metro. Often called ''Posh Hash'' — Sydney''s senior mixed kennel, founded 1967. Trail list posted at sh3.link.'
      ELSE "scheduleNotes"
    END,
    "updatedAt" = NOW()
WHERE "kennelCode" = 'sh3-au'
  AND (NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
    OR "scheduleDayOfWeek" = 'Tuesday'
    OR description LIKE '%every Tuesday evening%'
    OR "scheduleNotes" LIKE 'Weekly Tuesday hash%');

-- #2321 (+ #2318 dup) SLOSH: schedule time 11:00 AM → 10:00 AM (+ notes wording),
-- plus logo + facebook + hash cash fills.
UPDATE "Kennel"
SET "logoUrl" = COALESCE("logoUrl", 'https://www.whoremanh3.com/wp-content/uploads/2024/02/SLOSH-300x286.jpg'),
    "facebookUrl" = COALESCE("facebookUrl", 'https://facebook.com/groups/UtahH3'),
    "hashCash" = COALESCE("hashCash", '$7 cash or $6.90 Venmo (virgins free)'),
    "scheduleTime" = CASE WHEN "scheduleTime" = '11:00 AM' THEN '10:00 AM' ELSE "scheduleTime" END,
    "scheduleNotes" = CASE
      WHEN "scheduleNotes" = 'Monthly Sunday runs at 11 AM. Part of the Whoreman H3 umbrella.'
        THEN 'Monthly Sunday runs at 10 AM. Part of the Whoreman H3 umbrella.'
      ELSE "scheduleNotes"
    END,
    "updatedAt" = NOW()
WHERE "kennelCode" = 'slosh-h3'
  AND (NULLIF(BTRIM("logoUrl"), '') IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("hashCash"), '') IS NULL
    OR "scheduleTime" = '11:00 AM'
    OR "scheduleNotes" LIKE '%runs at 11 AM%');

-- Verify the three value corrections actually landed (NULL-fills are guaranteed
-- by COALESCE and need no assertion).
DO $$
DECLARE
  soh4_cash text;
  sh3_day text;
  slosh_time text;
BEGIN
  SELECT "hashCash" INTO soh4_cash FROM "Kennel" WHERE "kennelCode" = 'soh4';
  IF soh4_cash = '$5' THEN
    RAISE EXCEPTION 'soh4 hashCash is still $5 after migration';
  END IF;

  SELECT "scheduleDayOfWeek" INTO sh3_day FROM "Kennel" WHERE "kennelCode" = 'sh3-au';
  IF sh3_day = 'Tuesday' THEN
    RAISE EXCEPTION 'sh3-au scheduleDayOfWeek is still Tuesday after migration';
  END IF;

  SELECT "scheduleTime" INTO slosh_time FROM "Kennel" WHERE "kennelCode" = 'slosh-h3';
  IF slosh_time = '11:00 AM' THEN
    RAISE EXCEPTION 'slosh-h3 scheduleTime is still 11:00 AM after migration';
  END IF;
END $$;

COMMIT;
