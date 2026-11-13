-- WS4 (2026-11-12): data leaks from Google Calendar / iCal sources found by the
-- kennel audits. Source.config changes mirror prisma/seed-data/sources.ts; the
-- new kennel mirrors prisma/seed-data/{kennels,aliases}.ts. Adapter code fixes
-- that need no config (LDS "See calendar details", GCal summary "<br>") ship in
-- the same PR. Every data repair below targets rows a re-scrape can't fix
-- (merge keeps existing values when a field is now dropped, and archive rows
-- sit outside the feeds' windows).
--
--  1. Source configs: Devon Lunatics "vytbc" placeholder; Isca H3 hares and
--     maps-shortlink venues (#2910); Hill Country routes the weekly Humpin Hash
--     to its own kennel; Cheltenham & Cotswold description boilerplate (#2890),
--     synthetic end times (#2891) and login-walled links (#2892); Chichester
--     "Rin NNNN" run numbers (#2896).
--  2. New dormant kennel hoth3-humpin ("HOTH3 Humpin Hash"), with aliases and
--     links to both Hill Country sources.
--  3. Re-attribute the 567 weekly Wednesday "HOTH3 Humpin Hash" runs (2010-2021,
--     from the frozen calendar archive) from hoth3 to hoth3-humpin, and replace
--     the literal "<br>" in 13 of their titles.
--  4. LDS H3: clear the "See calendar details" location on 5 upcoming runs.
--  5. Berlin H3 / Full Moon: drop the "Hash Cash … / Location URL: …" block the
--     retired iCal feed appended to 14 descriptions; placeholder-only
--     remainders ("details cuming") are cleared.
--  6. Devon Lunatics: the 2 "vytbc - …" titles.
--  7. Isca H3: 41 placeholder runs titled "Website: www.iscah3.uk".
--  8. Cheltenham & Cotswold: the same description / end time / link fixes on
--     all 36 stored runs.
--  9. Chichester H3 archive: 21 runs whose hare is "Hash Flash" (#2895), 7 runs
--     with a venue or note in hares, and 6 socials titled as trails (#2897).
--
-- DATA-ONLY, idempotent (every UPDATE is guarded on the old value).

BEGIN;

-- 1. Source configs: merge each patch into the existing config.
UPDATE "Source"
SET config = COALESCE(config, '{}'::jsonb) || t.patch,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (VALUES
  ('Devon Lunatics H3 Google Calendar', 'GOOGLE_CALENDAR', '{"titleStripPatterns":["^Devon Lunatics H3\\s*-\\s*","^vytbc\\b\\s*-?\\s*"],"titleHarePattern":"\\bvytbc\\s*-\\s*([^-]+?\\s(?:&|and)\\s[^-]+)$"}'::jsonb),
  ('Isca H3 Google Calendar', 'GOOGLE_CALENDAR', '{"titleHarePattern":["\\bHares?\\b(?!\\s+(?:&|and)\\s+Hounds\\b):?\\s+((?:(?!\\s-\\s)[^.:()])+?)[.!]*$","^Isca H3\\s*-\\s*\\S.*?\\s-\\s+(?!OD\\b|[^-.]*\\b(?:party|birthdays?|picnic|bbq|swim|trail|run|hash)\\b)([^-.:()]+?\\s(?:&|and)\\s[^-.:()]+?)[.!]*$","\\.\\s+(?!OD\\b|[^.!]*\\b(?:party|birthdays?|fancy|dress|christmas|xmas|awards?|night|byob?|joint|trail|run|hash|theme|\\d+(?:st|nd|rd|th))\\b)([^.!?]+?)(?=[.!?](?:\\s|$)|$)"],"titleStripPatterns":["^Isca H3\\s*-\\s*","\\.\\s*$"],"titleLocationPattern":"^Isca H3\\s*-\\s*(?:AGPU\\s*-\\s*)?([^.]+?)(?:\\.\\s|\\.?$)","titleLocationFillOnly":true,"summaryIsCanonicalTitle":true}'::jsonb),
  ('Hill Country H3 Google Calendar', 'GOOGLE_CALENDAR', '{"kennelPatterns":[["^(?:HOTH3|HOT)\\s+Humpin","hoth3-humpin"],["^Heart of Texas\\b|^HOTH3\\b","hoth3"],["^Hill Country\\b|^HCH3\\b","hch3"]]}'::jsonb),
  ('Cheltenham & Cotswold H3 iCal Feed', 'ICAL_FEED', '{"descriptionStripPatterns":["^Hare\\(s\\):","^Map:\\s*https?://","^https?://c2h3\\.co\\.uk/\\S*$"],"ignoreEndTime":true,"sourceUrlOverride":"https://c2h3.co.uk/upcoming-runs/"}'::jsonb),
  ('Chichester H3 iCal Feed', 'ICAL_FEED', '{"runNumberPatterns":["R[ui]n (\\d+)\\b"]}'::jsonb)
) AS t(name, type, patch)
WHERE "Source".name = t.name AND "Source".type::text = t.type
  AND NOT (COALESCE("Source".config, '{}'::jsonb) @> t.patch);

-- 2. The Humpin Hash kennel (Killeen, TX region exists since 20261107100000_onboard_hch3).
INSERT INTO "Kennel" (
  id, "kennelCode", "shortName", slug, "fullName", region, "regionId", country,
  website, "scheduleDayOfWeek", "scheduleTime", "scheduleFrequency", "scheduleNotes",
  description, "createdAt", "updatedAt"
)
SELECT 'knl_hoth3_humpin', 'hoth3-humpin', 'HOTH3 Humpin Hash', 'hoth3-humpin-hash',
       'Heart of Texas H3 Humpin'' Hash', 'Killeen, TX', r.id, 'USA',
       'https://hch3.net/heart_of_texas_h3.htm', 'Wednesday', '7:00 PM', 'Weekly',
       'Wednesdays at 7 PM around Killeen / Harker Heights / Copperas Cove, 2010–2021. No runs listed since October 2021.',
       'Heart of Texas H3''s weekly Wednesday-evening hash in the Killeen area, run from December 2010 to October 2021. Currently dormant.',
       NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
FROM "Region" r
WHERE r.name = 'Killeen, TX'
ON CONFLICT ("kennelCode") DO NOTHING;

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT 'ka_hoth3-humpin_' || t.n, k.id, t.alias
FROM "Kennel" k
JOIN (VALUES (1, 'HOTH3 Humpin Hash'), (2, 'HOT Humpin Hash'), (3, 'Humpin Hash'),
             (4, 'Heart of Texas Humpin Hash')) AS t(n, alias) ON true
WHERE k."kennelCode" = 'hoth3-humpin'
ON CONFLICT ("kennelId", alias) DO NOTHING;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_' || s.id || '_hoth3-humpin', s.id, k.id
FROM "Source" s, "Kennel" k
WHERE s.name IN ('Hill Country H3 Google Calendar', 'Hill Country H3 Calendar Archive')
  AND s.type = 'GOOGLE_CALENDAR'::"SourceType"
  AND k."kennelCode" = 'hoth3-humpin'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 3. Re-attribute the Humpin runs (re-attribute, never delete), then fix "<br>" titles.
CREATE TEMP TABLE ws4_humpin ON COMMIT DROP AS
SELECT e.id
FROM "Event" e
JOIN "Kennel" k ON k.id = e."kennelId"
WHERE k."kennelCode" = 'hoth3'
  AND e.title ~ '^(HOTH3|HOT)\s*(<br\s*/?>)?\s*Humpin';

-- Same as scripts/lib/event-reassign.ts: when the target is already a co-host,
-- drop the old row and make the target primary; otherwise re-point the row.
DELETE FROM "EventKennel" ek
USING "Kennel" ok, "Kennel" nk
WHERE ok."kennelCode" = 'hoth3' AND nk."kennelCode" = 'hoth3-humpin'
  AND ek."kennelId" = ok.id
  AND ek."eventId" IN (SELECT id FROM ws4_humpin)
  AND EXISTS (SELECT 1 FROM "EventKennel" x WHERE x."eventId" = ek."eventId" AND x."kennelId" = nk.id);

UPDATE "EventKennel" ek
SET "isPrimary" = true
FROM "Kennel" nk
WHERE nk."kennelCode" = 'hoth3-humpin' AND ek."kennelId" = nk.id
  AND ek."eventId" IN (SELECT id FROM ws4_humpin) AND ek."isPrimary" = false;

UPDATE "EventKennel" ek
SET "kennelId" = nk.id
FROM "Kennel" nk, "Kennel" ok
WHERE nk."kennelCode" = 'hoth3-humpin' AND ok."kennelCode" = 'hoth3'
  AND ek."kennelId" = ok.id
  AND ek."eventId" IN (SELECT id FROM ws4_humpin);

UPDATE "Event" e
SET "kennelId" = nk.id, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" nk
WHERE nk."kennelCode" = 'hoth3-humpin'
  AND e.id IN (SELECT id FROM ws4_humpin);

UPDATE "Event" e
SET title = btrim(regexp_replace(e.title, '\s*<br\s*/?>\s*', ' ', 'gi')),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" IN ('hoth3', 'hoth3-humpin', 'hch3')
  AND e.title ~* '<br\s*/?>';

UPDATE "Kennel" k
SET "lastEventDate" = sub.max_date, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (
  SELECT e."kennelId", MAX(e.date) AS max_date
  FROM "Event" e
  WHERE e.status != 'CANCELLED' AND e."isManualEntry" != true AND e."isCanonical" = true
  GROUP BY e."kennelId"
) sub
WHERE sub."kennelId" = k.id AND k."kennelCode" = 'hoth3-humpin'
  AND k."lastEventDate" IS DISTINCT FROM sub.max_date;

-- 4. LDS H3: "See calendar details" is a pointer, not a venue.
UPDATE "Event" e
SET "locationName" = NULL, "locationAddress" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'lds-h3'
  AND e."locationName" = 'See calendar details';

-- 5. Berlin: strip the iCal template's trailing "Hash Cash: …\nLocation URL: …".
UPDATE "Event" e
SET description = CASE
      WHEN btrim(regexp_replace(e.description, '\s*(Hash Cash:[^\n]*\n)?Location URL:[^\n]*$', ''))
           ~* '^(details\M.{0,30}|more info coming soon\.*|)$' THEN NULL
      ELSE btrim(regexp_replace(e.description, '\s*(Hash Cash:[^\n]*\n)?Location URL:[^\n]*$', ''))
    END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" IN ('berlinh3', 'bh3fm')
  AND e.description ~ 'Location URL:[^\n]*$';

-- 6. Devon Lunatics: "vytbc" = venue yet to be confirmed.
UPDATE "Event" e
SET title = 'AGPU', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'dlh3-gb' AND e.title = 'vytbc - AGPU';

UPDATE "Event" e
SET title = 'Devon Lunatics H3', "haresText" = COALESCE(e."haresText", 'Buzby & Night Screecher'),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'dlh3-gb' AND e.title = 'vytbc - Buzby & Night Screecher';

-- 7. Isca H3: placeholder rows whose title came from the description boilerplate.
UPDATE "Event" e
SET title = 'Isca H3 Trail', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'isca-h3' AND e.title = 'Website: www.iscah3.uk';

-- 8. Cheltenham & Cotswold: mirror descriptionStripPatterns / ignoreEndTime / sourceUrlOverride.
UPDATE "Event" e
SET description = NULLIF(btrim(regexp_replace(regexp_replace(e.description,
      '^[ \t]*(Hare\(s\):[^\n]*|Map:[ \t]*https?://[^\n]*|https?://c2h3\.co\.uk/[^\s]*[ \t]*(?=\n|$))\n?', '', 'gn'),
      '\n{3,}', E'\n\n', 'g'), E' \t\n'), ''),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'c2h3-gb'
  AND e.description ~ '(^|\n)[ \t]*(Hare\(s\):|Map:[ \t]*https?://|https?://c2h3\.co\.uk/)';

UPDATE "Event" e
SET "endTime" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'c2h3-gb' AND e."endTime" IS NOT NULL;

UPDATE "Event" e
SET "sourceUrl" = 'https://c2h3.co.uk/upcoming-runs/', "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'c2h3-gb'
  AND e."sourceUrl" ~ '^https?://c2h3\.co\.uk/(runs|events)/';

-- 9a. Chichester archive (#2895): hares from the stored source Hares column.
UPDATE "Event" e
SET "haresText" = t.hares, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (VALUES
  ('cmw50u66t00qfgjhnu8jtf3t5', 'Alan ''Hash Flash'' & Amanda the Panda'),
  ('cmw50u90h00r9gjhnuzpwex4j', 'Alan ''Hash Flash & Amanda ''The Panda'''),
  ('cmw50ubtf00s1gjhn144knn5t', 'Graham ''Old Faithful'' & Pru ''Rasta'' assisted by Alan ''Hash Flash'' & Amanda ''The Panda'''),
  ('cmw50udd300shgjhnq6l4o9w1', 'Hash Flash & Amanda the Panda'),
  ('cmw50ueod00svgjhnsf5tdjny', 'Hash Flash & Amanda the Panda'),
  ('cmw50ugdz00tdgjhnoszm6ki4', 'Hash Flash & The Panda'),
  ('cmw50uiy900u3gjhn0k9gw8s0', 'The Panda & Hash Flash'),
  ('cmw50ul8e00upgjhni518l8pe', 'Hash Flash & The Panda'),
  ('cmw50up0100vrgjhnxcgi799b', 'Hash Flash & Amanda the Panda'),
  ('cmw50urjd00whgjhn6p29304l', 'Hash Flash & The Panda'),
  ('cmw50uvvk00xngjhnogozbzk4', 'Hash Flash & Amanda the Panda'),
  ('cmw50uxyt00y9gjhnctdukg6d', 'Hash Flash & The Panda'),
  ('cmw50v1eg00z7gjhnr9rp7yxy', 'Hash Flash & Amanda the Panda'),
  ('cmw50v3l900zvgjhntl2vsxzo', 'Hash Flash & Panda'),
  ('cmw50v7on0111gjhnhpkqi4ia', 'Panda & Hash Flash'),
  ('cmw50vbyk0125gjhnxbmrb9hp', 'Hash Flash & Panda'),
  ('cmw50vhdk013ngjhnpdam163s', 'Hash Flash, Amanda the Panda & Isla'),
  ('cmw50vipt013zgjhnyzwf5hy0', 'Hash Flash & Panda'),
  ('cmw50vm0w014vgjhntylepgau', 'Hash Flash & The Panda'),
  ('cmw50vnnu015bgjhnswfcocbd', 'Hash Flash & The Panda'),
  ('cmw50votq015ngjhnvd758og9', 'Hash Flash & Panda')
) AS t(id, hares)
WHERE e.id = t.id AND e."haresText" IS NULL;

-- 9b. Chichester archive (#2897): venue names and notes stored as hares.
UPDATE "Event" e
SET "haresText" = t.hares, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k, (VALUES
  ('2009-05-10'::date, 'Bika & Kermit, Behind Pub', 'Bika & Kermit'),
  ('2013-09-07'::date, 'British Legion Club, Hayling', NULL),
  ('2013-11-01'::date, 'Southbourne Village Hall- see notices', NULL),
  ('2013-11-23'::date, 'Southbourne Village Hall- see notices', NULL),
  ('2014-12-16'::date, 'Snake Charmer et al will be in attendance', NULL),
  ('2019-02-06'::date, 'Rainbow Inn', NULL),
  ('2019-10-16'::date, 'Rainbow Inn', NULL)
) AS t(day, old_hares, hares)
WHERE k.id = e."kennelId" AND k."kennelCode" = 'ch3-gb'
  AND e.date::date = t.day AND e."haresText" = t.old_hares;

-- 9c. Chichester archive (#2897): socials stored with the default trail title.
UPDATE "Event" e
SET title = t.title, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k, (VALUES
  ('2013-03-21'::date, 'Quiz Night'),
  ('2013-12-26'::date, 'Pagham Pram Race'),
  ('2014-12-16'::date, 'Social (no run)'),
  ('2016-02-09'::date, 'Quiz Night'),
  ('2016-09-04'::date, 'Get Active Day'),
  ('2019-02-06'::date, 'Quiz Night')
) AS t(day, title)
WHERE k.id = e."kennelId" AND k."kennelCode" = 'ch3-gb'
  AND e.date::date = t.day AND e.title = 'Chichester H3 Trail' AND e."runNumber" IS NULL;

COMMIT;
