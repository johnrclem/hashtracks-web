-- 26.2H3 historical event backfill (#490).
-- 6 past events sourced from sfh3.com/runs?kennel=22, scraped + verified in-session
-- on 2026-04-07. Each event is inserted directly into Event (no RawEvent row) since
-- this is a one-shot historical import. Run numbers preserved where present;
-- titles for unnumbered events derived from the source's directions text
-- ("World Premiere" / "World Finale"). Cost is dropped (no field on Event yet — see #491).

-- Use a CTE to resolve the kennelId once and inline it in each insert.
WITH k AS (SELECT id FROM "Kennel" WHERE "kennelCode" = '262h3')

INSERT INTO "Event" (
  id, "kennelId", date, "dateUtc", timezone,
  "runNumber", title, description, "haresText",
  "locationName", latitude, longitude,
  "startTime", "sourceUrl", "trustLevel", status,
  "isManualEntry", "createdAt", "updatedAt"
)
SELECT
  -- ── 2025-06-14 — Run #6 ──
  'cmp262h3hist01' || k.id, k.id,
  '2025-06-14T12:00:00Z'::timestamp, '2025-06-14T17:00:00Z'::timestamp, 'America/Los_Angeles',
  6,
  '26.2H3 Run #6',
  E'You will hate yourself if you miss this one. Also, you will hate yourself if you don''t. The Hares already hate themselves. Zero sum.\n\nDirections: NEW INFORMATION: the wee folk that prefer the half-serving of this event, please make your way to the end of the N-Judah line, and await further instructions. Beer will be provided. Do not expect service until 1pm. Bring your courage. And get your living trust notarized.',
  'The Usual Suspects',
  'Sue Bierman Park, Clay and Drumm', 37.79560852, -122.39625549,
  '10:00', 'https://www.sfh3.com/runs/5800', 5, 'CONFIRMED'::"EventStatus",
  true, NOW(), NOW()
FROM k
UNION ALL
SELECT
  -- ── 2023-07-22 — Run #5 ──
  'cmp262h3hist02' || k.id, k.id,
  '2023-07-22T12:00:00Z'::timestamp, '2023-07-22T17:00:00Z'::timestamp, 'America/Los_Angeles',
  5,
  '26.2H3 Run #5',
  E'This surely will be the last of its kind. Do not miss this event.\n\nDirections: Take public transit. Or hire a limo. Rent an electric wheelchair. We''re saying: there''s no reason to drive to this thing.',
  E'Lost in Foreskin, Who''s Your Daddy, Little Douche Poop',
  'Vaillancourt Fountain', 37.79560089, -122.39600372,
  '10:00', 'https://www.sfh3.com/runs/4413', 5, 'CONFIRMED'::"EventStatus",
  true, NOW(), NOW()
FROM k
UNION ALL
SELECT
  -- ── 2020-10-17 — Run #4.0 ──
  'cmp262h3hist03' || k.id, k.id,
  '2020-10-17T12:00:00Z'::timestamp, '2020-10-17T17:00:00Z'::timestamp, 'America/Los_Angeles',
  4,
  '26.2H3 Run #4.0',
  E'This is the last ever. Really. It''s so dumb. No one wants to do this any more.\n\nDirections: There will be support personnel, sag wagon, and more beer checks than anyone wants or deserves. $10 gets you a Sag Wagon and Beer Checks. Another $10 gets you a lovely and useful commemorative bandana ($15/a pair ..you''re sweaty and really need two). This is not a Facebook event. Look here for updates.',
  'LIF, WYD, & LDP',
  'Sue Bierman Park, end of Clay Street', 37.79560089, -122.39600372,
  '10:00', 'https://www.sfh3.com/runs/2568', 5, 'CONFIRMED'::"EventStatus",
  true, NOW(), NOW()
FROM k
UNION ALL
SELECT
  -- ── 2018-06-09 — Run #3 ──
  'cmp262h3hist04' || k.id, k.id,
  '2018-06-09T12:00:00Z'::timestamp, '2018-06-09T17:00:00Z'::timestamp, 'America/Los_Angeles',
  3,
  '26.2H3 Run #3',
  E'Directions: This is the absolute Final Final for the 26.2 Hash House Harriers. Following the whole trail qualifies you for membership emeritus and commemorative shirt. There will be a minimum of 6 Beer Checks, fully staffed and supplied. Bag wagon available. Those of you who wish to do a Half-Marathon Hash, it''ll start @12:30ish, so take the L, K, or M out to Forest Hill Muni and look for either a) hares, or b) hounds, or c) marks.. if you find none of the these, you''re too early and gotta wait for them. There will be a Bag Wagon there by 12:30 or so, so have a cold one and chill.',
  'LIF & WYD & LDP',
  'Justin Herman Plaza at the foot of Clay Street', 37.79560089, -122.39600372,
  '10:00', 'https://www.sfh3.com/runs/2186', 5, 'CONFIRMED'::"EventStatus",
  true, NOW(), NOW()
FROM k
UNION ALL
SELECT
  -- ── 2016-07-16 — World Finale (no run #) ──
  'cmp262h3hist05' || k.id, k.id,
  '2016-07-16T12:00:00Z'::timestamp, '2016-07-16T17:00:00Z'::timestamp, 'America/Los_Angeles',
  NULL,
  '26.2H3 World Finale',
  E'Directions: This is the World Finale of the 26.2 Hash House Harriers. Following the whole trail qualifies you for membership emeritus and commemorative shirt. There will be a minimum of 6 Beer Checks, fully staffed and supplied. Bag wagon available. Those of you who wish to do a Half-Marathon Hash, it''ll start @12:30ish, so take the N-Judah outbound to La Playa and look for either a) hares, or b) hounds, or c) marks.. if you find none of the these, you''re too early and gotta wait for them. Have a beer at Pittsburgh''s Pub on Judah. Maybe the hares will drop in for a quick one. On on.',
  'LIF, WYD, Fixed Queer & Little Douche Poop',
  'Vaillancourt Fountain, near Ferry Bldg', 37.79550171, -122.39800262,
  '10:00', 'https://www.sfh3.com/runs/1579', 5, 'CONFIRMED'::"EventStatus",
  true, NOW(), NOW()
FROM k
UNION ALL
SELECT
  -- ── 2014-05-31 — World Premiere (no run #) ──
  'cmp262h3hist06' || k.id, k.id,
  '2014-05-31T12:00:00Z'::timestamp, '2014-05-31T17:00:00Z'::timestamp, 'America/Los_Angeles',
  NULL,
  '26.2H3 World Premiere',
  E'Directions: This is the World Premiere of the 26.2 Hash House Harriers. Following the whole trail qualifies you for membership and commemorative shirt. There will be a minimum of 3 Beer Checks, fully staffed and supplied. Bag wagon available. Those of you who wish to do a Half-Marathon Hash, it''ll start @12:30ish, so take the N-Judah outbound to La Playa and look for either a) hares, or b) hounds, or c) marks.. if you find none of the these, you''re too early and gotta wait for them. Have a beer at Pittsburgh''s Pub on Judah. Maybe the hares will drop in for a quick one. On on.',
  'LIF & WYD',
  'Vaillancourt Fountain, near Ferry Bldg', 37.79550171, -122.39499664,
  '10:00', 'https://www.sfh3.com/runs/1342', 5, 'CONFIRMED'::"EventStatus",
  true, NOW(), NOW()
FROM k
ON CONFLICT (id) DO NOTHING;
