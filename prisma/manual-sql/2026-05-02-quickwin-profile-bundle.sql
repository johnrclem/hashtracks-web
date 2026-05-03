-- Kennel-row corrections that the seed merge logic (prisma/seed.ts:298-303
-- only fills NULL fields) cannot apply against existing non-null values.
-- Run manually against prod after the seed-update PR lands.
-- Closes #996 (c2h3 schedule + description), #1133 (butterworth-h3 day/time/desc),
--        #1150 (fwh3 description), #1153 (fth3 frequency + description),
--        #1156 (duhhh time + description), #1173 (glasgowh3 description),
--        #1182 (bristol-grey website + description), #1187 (eh3-or description),
--        #1191 (fdtdd frequency + description), #1196 (gal-h3 frequency + description),
--        #1202 (ffmh3 description).

BEGIN;

-- Sanity: refuse to update anything if any target kennelCode is missing.
DO $$
DECLARE
  missing text[];
  code text;
BEGIN
  FOREACH code IN ARRAY ARRAY[
    'c2h3','butterworth-h3','fwh3','fth3','duhhh','glasgowh3',
    'bristol-grey','eh3-or','fdtdd','gal-h3','ffmh3'
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

-- #996 c2h3 — source ICS RRULE is BIWEEKLY (FREQ=WEEKLY;INTERVAL=2;BYDAY=TH).
UPDATE "Kennel"
SET "scheduleFrequency" = 'Biweekly',
    "description" = 'Bi-weekly Thursday-evening hash in Corpus Christi, with occasional Saturday runs.'
WHERE "kennelCode" = 'c2h3';

-- #1133 butterworth-h3 — corrected day/time per malaysiahash.com directory.
UPDATE "Kennel"
SET "scheduleDayOfWeek" = 'Wednesday',
    "scheduleTime" = '6:00 PM',
    "description" = 'Founded 29 May 1980 by Peter ''Jonsi'' Jones as a daughter kennel of Penang H3, Butterworth H3 is the men-only mainland-Penang hash. Weekly Wednesday-evening trails through Seberang Perai and the mainland Penang hinterland.'
WHERE "kennelCode" = 'butterworth-h3';

-- #1150 fwh3 — replace one-liner with full kennel paragraph from dfwhhh.org/Kennels.
UPDATE "Kennel"
SET "description" = 'Biweekly Saturday-afternoon hash in the DFW area, founded March 31, 1987. A-to-B, A-to-A, or A-to-A'' trails of 3-5 miles with variable shiggy; a beer stop on trail and a strict "done is done" after circle.'
WHERE "kennelCode" = 'fwh3';

-- #1153 fth3 — kennel runs monthly per foothillflyers.org, not "Irregular".
UPDATE "Kennel"
SET "scheduleFrequency" = 'Monthly',
    "description" = 'Foothill H3 is a monthly "No Frills" hash — bring your own beer, wine, munchies, and folding chair; there is no run fee. Trails favor shiggy and single-track in the hills and can be set anywhere in Southern California at the hares'' choice. Founded August 25, 1991 in Upland, CA by Dog Boner and Deep Stroke.'
WHERE "kennelCode" = 'fth3';

-- #1156 duhhh — meet time is 6:30 PM (pack-off 7 PM); replace stub description.
UPDATE "Kennel"
SET "scheduleTime" = '6:30 PM',
    "description" = 'Weekly Wednesday-evening hash in downtown Dallas, founded August 4, 2009. Meet 6:30 PM, pack off 7 PM; A-to-A trails ending at a low-key bar with food. 3-5 mile trails with light shiggy.'
WHERE "kennelCode" = 'duhhh';

-- #1173 glasgowh3 — expand description with founding history.
UPDATE "Kennel"
SET "description" = 'Founded on 26 August 1985 by Roger McIlroy, Glasgow Hash House Harriers (GH3) was the first Scottish hash to have a website. They run every Monday at 7 PM from pubs and locations in and around Glasgow. Notable hosted events include UK Nash Hash 99 and the Commonwealth Hash 2014.'
WHERE "kennelCode" = 'glasgowh3';

-- #1182 bristol-grey — point at the kennel-specific intro page (root is a shared
-- landing page for BRIS/GREY/BOGS) and replace stub description.
UPDATE "Kennel"
SET "website" = 'https://bristolhash.org.uk/bghintro.php',
    "description" = 'Founded in 1988 by engineers working on a shopping mall project, Bristol Greyhound Hash House Harriers (GREY) is named after a pub in central Bristol. Runs take place from carefully-selected pubs within about ten miles of the city centre, every Monday at 7:00 PM, and are designed to last between an hour and an hour and a quarter.'
WHERE "kennelCode" = 'bristol-grey';

-- #1187 eh3-or — prepend the kennel banner tagline to the existing description.
UPDATE "Kennel"
SET "description" = 'A drinking club with a running problem. Eugene''s weekly Sunday hash with a 30-strong pack. Trails run 3-6 miles. Also hosts Friday evening Hashy Hours.'
WHERE "kennelCode" = 'eh3-or';

-- #1191 fdtdd — kennel only meets on Friday the 13th (~2-3x/year), not monthly.
UPDATE "Kennel"
SET "scheduleFrequency" = 'Irregular',
    "description" = 'Phoenix''s Friday-the-13th-only hash. Convenes when the calendar permits — typically two to three times a year. "The most evil hash in all of Phoenix" with horror-movie-themed runs.'
WHERE "kennelCode" = 'fdtdd';

-- #1196 gal-h3 — calendar shows weekly Monday 7:30 PM cadence, not "Irregular".
UPDATE "Kennel"
SET "scheduleFrequency" = 'Weekly',
    "description" = 'BYOB Monday-night hash on the LA Westside (Culver City / Mar Vista / Santa Monica). Small, casual, no run fee — bring your own beer.'
WHERE "kennelCode" = 'gal-h3';

-- #1202 ffmh3 — replace stub description with founding-history paragraph.
UPDATE "Kennel"
SET "description" = 'Frankfurt''s full moon pub crawl hash, started in August 1999 and reloaded in January 2014. Meets the Friday closest to each full moon, year-round.'
WHERE "kennelCode" = 'ffmh3';

COMMIT;
