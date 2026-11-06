-- Harrier Central / Meetup source fixes (Nov 2026 audit triage, HC + Meetup slice).
--
-- 1. upcomingOnly for the forward-only HC / Meetup sources the 20261105220000 sweep
--    did not cover. HC getEvents is future-only; logged-out Meetup returns upcoming
--    plus ~10 recent past events. Without the flag, reconcile cancels every in-window
--    past run that drops out of the fetch. Prod at authoring: Steel City 4, WSH3
--    (Winterthur) 4, Asheville 4, Savannah 4, BSSH3 1, Charleston Heretics 1,
--    Cleveland 1 past runs cancelled after their dates. Restoring them is a separate,
--    dry-run-first one-shot.
-- 2. Newcastle H3 (#2590): HC's placeholder title is "Placeholder event for NH3"
--    (the short name), not the "…NH3-GB" alias seeded, so it leaked as a title.
-- 3. Aberdeen H3 (#2583): strip the "AH3 Run N - … - Hares: …" shape that repeats
--    run #, venue and hares already shown in their own fields.
-- 4. Richmond H3 Meetup (#2413): route the sisters' short title forms (TMFM / TFMH3 /
--    BIB) and drop POHO H3 / Sassy H3 posts (untracked kennels) instead of filing
--    them under rvah3 — needed before the gql2 history backfill.
-- 5. Two new config-only sources, shipped DISABLED until a prod scrape check:
--    Plympton H3 Google Calendar (#2594, plympton-h3 + titsh3) and
--    Sembach H3 Hare Line Sheet (#2603).
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same values.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(COALESCE(config, '{}'::jsonb), '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb
  AND (name, type::text) IN (
    ('Steel City H3 Harrier Central', 'HARRIER_CENTRAL'),
    ('Shanghai H3 Harrier Central', 'HARRIER_CENTRAL'),
    ('Morgantown H3 Harrier Central', 'HARRIER_CENTRAL'),
    ('Winterthur & Schaffhausen H3 Meetup', 'MEETUP'),
    ('Asheville H3 Meetup', 'MEETUP'),
    ('BSSH3 Meetup', 'MEETUP'),
    ('Carolina Trash H3 Meetup', 'MEETUP'),
    ('Charleston Heretics Meetup', 'MEETUP'),
    ('cHARLOTtesville H3 Meetup', 'MEETUP'),
    ('Cleveland H4 Meetup', 'MEETUP'),
    ('Fort Eustis H3 Meetup', 'MEETUP'),
    ('Savannah H3 Meetup', 'MEETUP')
  );

UPDATE "Source"
SET config = jsonb_set(
      config, '{staleTitleAliases}',
      '["Placeholder event for NH3", "Placeholder event for NH3-GB"]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Newcastle H3 Harrier Central'
  AND type::text = 'HARRIER_CENTRAL'
  AND NOT (config->'staleTitleAliases') @> '["Placeholder event for NH3"]'::jsonb;

UPDATE "Source"
SET config = config
      || jsonb_build_object(
           'titleStripPatterns', jsonb_build_array('^AH3\s+Run\s+\d+[\s-]*', '[\s-]*\bHares?:.*$'),
           'staleTitleAliases', jsonb_build_array('Placeholder event for AH3', 'TBA')),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Aberdeen H3 Harrier Central'
  AND type::text = 'HARRIER_CENTRAL'
  AND NOT config ? 'titleStripPatterns';

UPDATE "Source"
SET config = config || jsonb_build_object(
      'kennelPatterns', jsonb_build_array(
        jsonb_build_array('\b(?:BIBH3|BIB|Belle Isle)\b', 'bibh3'),
        jsonb_build_array('\b(?:TMFMH3|TMFM|TFMH3?|Titanic)\b', 'tmfmh3'),
        jsonb_build_array('\bChain Gang\b', 'chain-gang-hhh')),
      'skipTitlePatterns', jsonb_build_array('\bPOHO', '\bSassy\b')),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Richmond H3 Meetup'
  AND type::text = 'MEETUP'
  AND NOT config ? 'skipTitlePatterns';

INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "healthStatus", "createdAt", "updatedAt"
)
VALUES (
  'mig_20261106_plympton_gcal',
  'Plympton H3 Google Calendar',
  'ph3hareraising@gmail.com',
  'GOOGLE_CALENDAR'::"SourceType",
  jsonb_build_object(
    'calendarId', 'ph3hareraising@gmail.com',
    'defaultKennelTag', 'plympton-h3',
    'kennelPatterns', jsonb_build_array(
      jsonb_build_array('^Plympton Hash House Harriers\b', 'plympton-h3'),
      jsonb_build_array('^TIT''?s\b', 'titsh3')),
    'strictKennelRouting', true,
    'titleStripPatterns', jsonb_build_array(
      '^Plympton Hash House Harriers\s*(?:#\d+)?\s*-?\s*',
      '^TIT''?s\s*')
  ),
  7, 'daily', 1500,
  false, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
),
(
  'mig_20261106_sembach_sheet',
  'Sembach H3 Hare Line Sheet',
  'https://docs.google.com/spreadsheets/d/1tC2GdrJJU2WNJYyIsuBbjuyQPUO1IDTaaYZGr9j_Zzg/export?format=csv',
  'GOOGLE_SHEETS'::"SourceType",
  jsonb_build_object(
    'sheetId', '1tC2GdrJJU2WNJYyIsuBbjuyQPUO1IDTaaYZGr9j_Zzg',
    'csvUrl', 'https://docs.google.com/spreadsheets/d/1tC2GdrJJU2WNJYyIsuBbjuyQPUO1IDTaaYZGr9j_Zzg/export?format=csv',
    'skipRows', 1,
    'columns', jsonb_build_object('date', 2, 'startTime', 3, 'hares', 8, 'extraHares', jsonb_build_array(9), 'description', 7),
    'kennelTagRules', jsonb_build_object('default', 'sembach-h3'),
    'upcomingOnly', true
  ),
  7, 'daily', 365,
  false, 'UNKNOWN'::"SourceHealth", NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'mig_20261106_sk_' || s.id || '_' || k."kennelCode", s.id, k.id
FROM "Source" s
JOIN "Kennel" k ON (s.name, k."kennelCode") IN (
  ('Plympton H3 Google Calendar', 'plympton-h3'),
  ('Plympton H3 Google Calendar', 'titsh3'),
  ('Sembach H3 Hare Line Sheet', 'sembach-h3')
)
WHERE s.type::text IN ('GOOGLE_CALENDAR', 'GOOGLE_SHEETS')
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

COMMIT;
