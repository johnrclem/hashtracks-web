-- Kennel profile metadata sweep (Quick Win bundle): #2649, #2644, #2633, #2627,
-- #2617, #2613, #2610, #2608, #2578, #2512, #2308. (Companion to the seed-data
-- edits in prisma/seed-data/kennels.ts.)
--
-- Vercel builds run `prisma migrate deploy && next build` and never
-- `prisma db seed`, so seed-only additions do NOT reach prod on deploy. Apply
-- them here so the closed audit issues are actually satisfied in prod (same
-- approach as the earlier profile sweeps: 20260626120000, 20260706120000,
-- 20260707120000).
--
-- Null-fills use COALESCE and a guard so only genuinely empty columns are
-- written — never stomps an admin edit; re-run touches 0 rows.
-- Corrections (#2512, #2308) use an explicit UPDATE because they replace a
-- wrong/stale value rather than filling an empty one — see per-block notes.
-- `updatedAt` is `timestamp without time zone`, so stamp with UTC wall-clock.
--
-- #2516 (Southern Comfort H3) is intentionally NOT included — the issue itself
-- reports that no field is verifiable without a live source; nothing to apply.

BEGIN;

-- #2649 Queens (QBK) — description/schedule-notes + website (hashnyc.com umbrella)
UPDATE "Kennel"
SET "website" = COALESCE("website", 'https://hashnyc.com'),
    "scheduleNotes" = COALESCE("scheduleNotes", 'Random days, random times.'),
    "description" = COALESCE("description", 'Queens Hash House Harriers — Starts near public transit in Queens — Random days, random times.'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'qbk'
  AND (NULLIF(BTRIM("website"), '') IS NULL
    OR NULLIF(BTRIM("scheduleNotes"), '') IS NULL
    OR NULLIF(BTRIM("description"), '') IS NULL);

-- #2644 Wasatch H3 — Utah H3 umbrella Facebook group (foundedYear NOT set — source
-- only says "over 30 years", no exact year to assert)
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://facebook.com/groups/UtahH3'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'wasatch-h3' AND NULLIF(BTRIM("facebookUrl"), '') IS NULL;

-- #2633 WSH3 — organizer contact email (lower confidence: rotates yearly; most
-- recent known value from the 2025 SOEX HashRego event page)
UPDATE "Kennel"
SET "contactEmail" = COALESCE("contactEmail", 'wileyzachary2@gmail.com'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'wsh3' AND NULLIF(BTRIM("contactEmail"), '') IS NULL;

-- #2627 TNTH3 — founded year (edinburghh3.com/tnt-history.html: first trail 11 Apr 1984)
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 1984), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'tnth3' AND "foundedYear" IS NULL;

-- #2617 West London H3 — hash cash + Facebook group + contact email + description
UPDATE "Kennel"
SET "hashCash" = COALESCE("hashCash", '£2 per run (£35/year membership)'),
    "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/groups/1822849584637512'),
    "contactEmail" = COALESCE("contactEmail", 'westlondonh3@gmail.com'),
    "description" = COALESCE("description", 'A highly inclusive group with a diverse and cosmopolitan following, hashing all-year-round every Thursday. Meet at a pub within walking distance of a tube/mainline station for a 4–5 mile, ~1 hour P-trail of chalked Ps from the station.'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'wlh3'
  AND (NULLIF(BTRIM("hashCash"), '') IS NULL
    OR NULLIF(BTRIM("facebookUrl"), '') IS NULL
    OR NULLIF(BTRIM("contactEmail"), '') IS NULL
    OR NULLIF(BTRIM("description"), '') IS NULL);

-- #2613 Warsaw H3 — contact email (mailto in site footer)
UPDATE "Kennel"
SET "contactEmail" = COALESCE("contactEmail", 'WarsawH3@gmail.com'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'warsaw-h3' AND NULLIF(BTRIM("contactEmail"), '') IS NULL;

-- #2610 W3H3 — founded year (Hareline sheet Hash #1 "Inaugural Hash!!!" 06/12/2019)
-- + hareraiser contact email (Hareline sheet header)
UPDATE "Kennel"
SET "foundedYear" = COALESCE("foundedYear", 2019),
    "contactEmail" = COALESCE("contactEmail", 'w3h3hareraiser@gmail.com'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'w3h3'
  AND ("foundedYear" IS NULL OR NULLIF(BTRIM("contactEmail"), '') IS NULL);

-- #2608 Toulouse H3 — contact email (toulousehash.com/hash-contacts/)
UPDATE "Kennel"
SET "contactEmail" = COALESCE("contactEmail", 'contact@toulousehash.com'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'toulouse-h3' AND NULLIF(BTRIM("contactEmail"), '') IS NULL;

-- #2578 Fengyuan H3 (FISHHH) — Facebook Page (confirmed live)
UPDATE "Kennel"
SET "facebookUrl" = COALESCE("facebookUrl", 'https://www.facebook.com/TWFISH3'), "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'fishhh' AND NULLIF(BTRIM("facebookUrl"), '') IS NULL;

-- #2512 SLUT H3 — CORRECTION, not a null-fill. The kennel page shows "Since
-- first known run in 2025" (derived from the earliest ingested event, itself
-- an artifact of a too-narrow scrape window). Atlanta Hash Board's oldest SLUT
-- topic is #247 (Jun 2023); the run numbering implies real history predates
-- the forum. Set foundedYear to the verified floor (2023) so the kennel page
-- stops showing the wrong "2025" hint (the "Since first known run in <year>"
-- copy only renders when foundedYear is NULL). Guarded to correct anything
-- currently NULL or later than the verified floor, without clobbering a more
-- accurate value a human may set later.
UPDATE "Kennel"
SET "foundedYear" = 2023, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'sluth3' AND ("foundedYear" IS NULL OR "foundedYear" > 2023);

-- #2308 SL,UT Discovery — CORRECTION, not a null-fill. The stored slug
-- "sl,ut-discovery" contains a literal comma, which 404s the `/kennels/<slug>`
-- route (Next.js path-segment matching never resolves it, encoded or not).
-- toSlug() already strips commas correctly (src/lib/kennel-utils.ts) — this
-- row predates that fix. Re-slugify to the clean form.
UPDATE "Kennel"
SET "slug" = 'sl-ut-discovery', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'slut-h3' AND "slug" != 'sl-ut-discovery';

COMMIT;
