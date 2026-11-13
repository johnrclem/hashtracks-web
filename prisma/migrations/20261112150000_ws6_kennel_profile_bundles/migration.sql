-- WS6 kennel profile bundles (Nov 2026 audit sweep): 22 kennels, every value checked live on
-- 2026-11-12 against the kennel's own site/FB/calendar or a re-fetched Half-Mind / HHH Genealogy listing.
-- Mirrors prisma/seed-data/kennels.ts. Data-only and idempotent: each column is written only while it
-- still holds the value prod had when this was written (NULL for fills), so a manual admin edit made in
-- the meantime survives and a re-run is a no-op (the WHERE needs at least one column still in that state).

-- #2794 Abuja H3: first run 15 Nov 1997 (HHH Genealogy + Half-Mind #930; HC run #700 on 2022-11-25 is the "Silver Jubilee"). Founder from the same two sources.
UPDATE "Kennel"
SET
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 1997 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Tony ''Hash Mouth'' Bowles (co-founder Brian Smith)' ELSE "founder" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'abujah3'
  AND ("foundedYear" IS NULL
    OR "founder" IS NULL);

-- Audit finding (Agana H3): guamhash.com WHEN/WHERE block — 3:45 PM show / 4:00 PM map, and the kennel's general Gmail address.
UPDATE "Kennel"
SET
    "scheduleNotes" = CASE WHEN "scheduleNotes" IS NULL THEN 'Show at 3:45 PM; the trail map is posted at 4:00 PM.' ELSE "scheduleNotes" END,
    "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN 'guamhash@gmail.com' ELSE "contactEmail" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'ah3-gu'
  AND ("scheduleNotes" IS NULL
    OR "contactEmail" IS NULL);

-- #2797 Barbados Bike H3: Half-Mind #765 (founder, first hash 2016-03-27, parent Barbados H3, "last Sunday of each month", helmet + mountain bike) + the BBH3 hareline page + FB group "Barbados Bike Hash House Harriers".
UPDATE "Kennel"
SET
    "scheduleFrequency" = CASE WHEN "scheduleFrequency" IS NULL THEN 'Monthly' ELSE "scheduleFrequency" END,
    "scheduleNotes" = CASE WHEN "scheduleNotes" IS NULL THEN 'Last Sunday of the month (the occasional exception, such as a pre-Christmas ride).' ELSE "scheduleNotes" END,
    "website" = CASE WHEN "website" IS NULL THEN 'https://hashcruise2020.simplesite.com/313623591' ELSE "website" END,
    "facebookUrl" = CASE WHEN "facebookUrl" IS NULL THEN 'https://www.facebook.com/groups/776267715843858/' ELSE "facebookUrl" END,
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 2016 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Francie ''China Brush'' Ammon' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'barbados-h3' ELSE "parentKennelCode" END,
    "description" = CASE WHEN "description" = 'Barbados Bike H3 — the Barbados bike hash (''bike bash''), a mountain-bike sibling of the Barbados Hash House Harriers, riding around Christ Church / Bridgetown, Barbados.' THEN 'Barbados Bike H3 — the Barbados bike hash (''bike bash''), a mountain-bike sibling of the Barbados Hash House Harriers, riding around Christ Church / Bridgetown, Barbados, on the last Sunday of each month. Helmet and mountain bike required.' ELSE "description" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bbh3'
  AND ("scheduleFrequency" IS NULL
    OR "scheduleNotes" IS NULL
    OR "website" IS NULL
    OR "facebookUrl" IS NULL
    OR "foundedYear" IS NULL
    OR "founder" IS NULL
    OR "parentKennelCode" IS NULL
    OR "description" = 'Barbados Bike H3 — the Barbados bike hash (''bike bash''), a mountain-bike sibling of the Barbados Hash House Harriers, riding around Christ Church / Bridgetown, Barbados.');

-- #2823 Bucharest Full Moon H3: own FB group "Bucharest Full Moon H3" (Half-Mind #1052) replaces the sister kennel's page; IG + WhatsApp from the shared carrd; logo = carrd image07 badge, self-hosted.
UPDATE "Kennel"
SET
    "facebookUrl" = CASE WHEN "facebookUrl" = 'https://www.facebook.com/BucharestHashHouseHarriersandHarrierettes' THEN 'https://www.facebook.com/groups/526499763230605' ELSE "facebookUrl" END,
    "instagramHandle" = CASE WHEN "instagramHandle" IS NULL THEN 'bucharest_hash' ELSE "instagramHandle" END,
    "whatsappUrl" = CASE WHEN "whatsappUrl" IS NULL THEN 'https://chat.whatsapp.com/FqSN2eIcR2U9UoxpM6Tha0' ELSE "whatsappUrl" END,
    "logoUrl" = CASE WHEN "logoUrl" IS NULL THEN '/kennel-logos/bfmh3-ro.jpg' ELSE "logoUrl" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bfmh3-ro'
  AND ("facebookUrl" = 'https://www.facebook.com/BucharestHashHouseHarriersandHarrierettes'
    OR "instagramHandle" IS NULL
    OR "whatsappUrl" IS NULL
    OR "logoUrl" IS NULL);

-- #2847 Bucharest H3: WhatsApp from the carrd; founder + parent (Warsaw) from Half-Mind #1051. Founded year stays 1986 (carrd). No logo: Half-Mind's c1051 is a 2025 Brewfest graphic.
UPDATE "Kennel"
SET
    "whatsappUrl" = CASE WHEN "whatsappUrl" IS NULL THEN 'https://chat.whatsapp.com/FqSN2eIcR2U9UoxpM6Tha0' ELSE "whatsappUrl" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Leo Henneberry' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'warsaw-h3' ELSE "parentKennelCode" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bh3-ro'
  AND ("whatsappUrl" IS NULL
    OR "founder" IS NULL
    OR "parentKennelCode" IS NULL);

-- #2818 Big Lik H3: FB page "Incirlik Hash House Harriers" + a description from its About text. Hash cash (currency unknown) and aliases left out.
UPDATE "Kennel"
SET
    "facebookUrl" = CASE WHEN "facebookUrl" IS NULL THEN 'https://www.facebook.com/IncirlikH3/' ELSE "facebookUrl" END,
    "description" = CASE WHEN "description" IS NULL THEN 'Big Lik Hash House Harriers (Incirlik H3) — the İncirlik hash near Adana, Turkey. A social club that runs, sings and drinks beer on fortnightly Saturday trails, always welcoming new members.' ELSE "description" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'blhhh'
  AND ("facebookUrl" IS NULL
    OR "description" IS NULL);

-- #2822 BoiseH3: Half-Mind #247 (first hash 1988-03-28, founder Dave & Karma). Parent Third Herd H3 is not in HashTracks.
UPDATE "Kennel"
SET
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 1988 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Dave & Karma' ELSE "founder" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'boiseh3'
  AND ("foundedYear" IS NULL
    OR "founder" IS NULL);

-- #2800 Basel-Stadt H3: kennel site (website, logo, On-Sec role address from the RSS feed, /lists/, "GM 1996-2003 (Runs #1 - #94)") + Half-Mind #1073 (founders, first hash 1996-01-13).
UPDATE "Kennel"
SET
    "website" = CASE WHEN "website" IS NULL THEN 'https://basel.harrier.eu.org/' ELSE "website" END,
    "logoUrl" = CASE WHEN "logoUrl" IS NULL THEN '/kennel-logos/bsh3-ch.gif' ELSE "logoUrl" END,
    "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN 'onsec-bsh3@harrier.eu.org' ELSE "contactEmail" END,
    "mailingListUrl" = CASE WHEN "mailingListUrl" IS NULL THEN 'https://basel.harrier.eu.org/lists/' ELSE "mailingListUrl" END,
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 1996 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Richard ''Jammies'' Rader (co-founders Mel ''Mad Max'' Byron, Martin ''Mealticket'' Palmer)' ELSE "founder" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bsh3-ch'
  AND ("website" IS NULL
    OR "logoUrl" IS NULL
    OR "contactEmail" IS NULL
    OR "mailingListUrl" IS NULL
    OR "foundedYear" IS NULL
    OR "founder" IS NULL);

-- #2893 Cheltenham & Cotswold H3: c2h3.co.uk "established … by PMW and Basil" (Half-Mind #1110: PMW = Mike Wallace; parent Little Sai Wan H3).
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Mike ''PMW'' Wallace & Basil' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'lsw-h3' ELSE "parentKennelCode" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'c2h3-gb'
  AND ("founder" IS NULL
    OR "parentKennelCode" IS NULL);

-- #2862 Cambridge H3: ch3.co.uk /contacts (enquiries@) and /Hashtory (Howard Taylor); parent Bangkok H3 per Half-Mind #1104.
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Howard Taylor' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'bkk-h3' ELSE "parentKennelCode" END,
    "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN 'enquiries@ch3.co.uk' ELSE "contactEmail" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'cambridge-h3'
  AND ("founder" IS NULL
    OR "parentKennelCode" IS NULL
    OR "contactEmail" IS NULL);

-- #2865 Cebu H3: cebuhash.wordpress.com history page — founders by hash name.
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Pothole, Stubbles & Mrs. Stubbles' ELSE "founder" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'cebu-h3'
  AND ("founder" IS NULL);

-- #2898 Chichester H3: chihhh.org.uk contacts (Joint Masters, Hare Razor; updated 10 Nov 2026) + latest.php subscribe form; founders + parent Kuala Lumpur H3 from Half-Mind #1112.
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Phil Spooner (co-founder Andrew Tarry)' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'motherh3' ELSE "parentKennelCode" END,
    "gm" = CASE WHEN "gm" IS NULL THEN 'Cock Burns & Bika' ELSE "gm" END,
    "hareRaiser" = CASE WHEN "hareRaiser" IS NULL THEN 'Bambi' ELSE "hareRaiser" END,
    "mailingListUrl" = CASE WHEN "mailingListUrl" IS NULL THEN 'https://www.chihhh.org.uk/latest.php' ELSE "mailingListUrl" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'ch3-gb'
  AND ("founder" IS NULL
    OR "parentKennelCode" IS NULL
    OR "gm" IS NULL
    OR "hareRaiser" IS NULL
    OR "mailingListUrl" IS NULL);

-- #2915 City of Exeter H3: blog header WhatsApp + intro-page address; founder from Half-Mind #1114.
UPDATE "Kennel"
SET
    "whatsappUrl" = CASE WHEN "whatsappUrl" IS NULL THEN 'https://chat.whatsapp.com/FJSBEQQ7eHA29uhwELBlVS' ELSE "whatsappUrl" END,
    "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN 'info@cityofexeterh3.org.uk' ELSE "contactEmail" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Mike ''Groucho'' Rock' ELSE "founder" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'coeh3'
  AND ("whatsappUrl" IS NULL
    OR "contactEmail" IS NULL
    OR "founder" IS NULL);

-- Audit finding (DA2B): Half-Mind #1121 (first hash 2007-06-02, founder, parent Isca H3) + FB group "Devon A To B Hash".
UPDATE "Kennel"
SET
    "facebookUrl" = CASE WHEN "facebookUrl" IS NULL THEN 'https://www.facebook.com/groups/268975896556665/' ELSE "facebookUrl" END,
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 2007 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Richard ''Cathusalem'' Padmore' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'isca-h3' ELSE "parentKennelCode" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'da2b'
  AND ("facebookUrl" IS NULL
    OR "foundedYear" IS NULL
    OR "founder" IS NULL
    OR "parentKennelCode" IS NULL);

-- Audit finding (Devonport H3): Half-Mind #1539 (first hash 1980-11-01, founders); logo = Half-Mind footprints, the same motif as the FB avatar, self-hosted.
UPDATE "Kennel"
SET
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 1980 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Tony ''Black Traka'' Morrell (co-founder Clive ''Beast of Bahai'' Olberry)' ELSE "founder" END,
    "logoUrl" = CASE WHEN "logoUrl" IS NULL THEN '/kennel-logos/devonport-h3.jpg' ELSE "logoUrl" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'devonport-h3'
  AND ("foundedYear" IS NULL
    OR "founder" IS NULL
    OR "logoUrl" IS NULL);

-- Audit finding (Dayton H3): daytonhhh.org (founder, Mailchimp list, site icon self-hosted); parent Little Rock H3 per Half-Mind #376.
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Geoff ''Little Tooter'' Jumper' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'lrh3' ELSE "parentKennelCode" END,
    "mailingListUrl" = CASE WHEN "mailingListUrl" IS NULL THEN 'https://eepurl.com/be8tcf' ELSE "mailingListUrl" END,
    "logoUrl" = CASE WHEN "logoUrl" IS NULL THEN '/kennel-logos/dh3-oh.png' ELSE "logoUrl" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'dh3-oh'
  AND ("founder" IS NULL
    OR "parentKennelCode" IS NULL
    OR "mailingListUrl" IS NULL
    OR "logoUrl" IS NULL);

-- Audit finding (Devon Lunatics H3): dlh3.org.uk ("every full moon", mailto) + the kennel GCal (10th Birthday Hash 2020-10-31, 100th Hash 2018-11-23 → 2010); founder + parent Teign Valley H3 per Half-Mind #1122.
UPDATE "Kennel"
SET
    "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN 'devonlunaticshashhouseharriers@gmail.com' ELSE "contactEmail" END,
    "scheduleFrequency" = CASE WHEN "scheduleFrequency" = 'Monthly' THEN 'Full Moon' ELSE "scheduleFrequency" END,
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 2010 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Stuart ''Rambo'' Bondi' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'tvh3' ELSE "parentKennelCode" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'dlh3-gb'
  AND ("contactEmail" IS NULL
    OR "scheduleFrequency" = 'Monthly'
    OR "foundedYear" IS NULL
    OR "founder" IS NULL
    OR "parentKennelCode" IS NULL);

-- Audit finding (Grenada H3): founder per grenadahash.com /about-us/, co-founder per Half-Mind #48.
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Paul ''Rigor Mortis'' Slinger (co-founder John Kelly)' ELSE "founder" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'gh3-gd'
  AND ("founder" IS NULL);

-- Audit finding (H5 Hare & Hounds): h5hashers.org.uk header logo (self-hosted), footer info@ address, "Join Our Mailing List" page.
UPDATE "Kennel"
SET
    "logoUrl" = CASE WHEN "logoUrl" IS NULL THEN '/kennel-logos/h5-gb.png' ELSE "logoUrl" END,
    "contactEmail" = CASE WHEN "contactEmail" IS NULL THEN 'info@h5hashers.org.uk' ELSE "contactEmail" END,
    "mailingListUrl" = CASE WHEN "mailingListUrl" IS NULL THEN 'https://www.h5hashers.org.uk/news.shtml' ELSE "mailingListUrl" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'h5-gb'
  AND ("logoUrl" IS NULL
    OR "contactEmail" IS NULL
    OR "mailingListUrl" IS NULL);

-- Audit finding (Hannover H3): hannoverhash.de (website; hareline "every second Sunday and every last Sunday of the month") + Half-Mind #1011 (first hash 1984-12-27, founder).
UPDATE "Kennel"
SET
    "website" = CASE WHEN "website" IS NULL THEN 'https://www.hannoverhash.de/' ELSE "website" END,
    "scheduleFrequency" = CASE WHEN "scheduleFrequency" IS NULL THEN 'Twice monthly' ELSE "scheduleFrequency" END,
    "scheduleNotes" = CASE WHEN "scheduleNotes" = 'Cadence unconfirmed (two Harrier Central runs so far); per-event dates and times come from Harrier Central.' THEN 'Second and last Sunday of the month; per-event dates and times come from Harrier Central.' ELSE "scheduleNotes" END,
    "foundedYear" = CASE WHEN "foundedYear" IS NULL THEN 1984 ELSE "foundedYear" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Jürgen ''Old Rock'' Ruder' ELSE "founder" END,
    "description" = CASE WHEN "description" IS NULL THEN 'Hannover Hash House Harriers — ''a drinking club with a running problem'', hashing in and around Hannover since 1984 on the second and last Sunday of each month.' ELSE "description" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hannover-h3'
  AND ("website" IS NULL
    OR "scheduleFrequency" IS NULL
    OR "scheduleNotes" = 'Cadence unconfirmed (two Harrier Central runs so far); per-event dates and times come from Harrier Central.'
    OR "foundedYear" IS NULL
    OR "founder" IS NULL
    OR "description" IS NULL);

-- Audit finding (Hellgate H3): missoulahash.org ("usually meet twice a month … casual pickup hash in between", Wednesday Night Hump Club) + Half-Mind #317 (founder, parent Houston H3).
UPDATE "Kennel"
SET
    "scheduleNotes" = CASE WHEN "scheduleNotes" = 'Mostly the 3rd Saturday of the month; start times vary, roughly 12–4 pm.' THEN 'Organized hash mostly on the 3rd Saturday of the month (start times vary, roughly 12–4 pm), with a casual pickup hash in between. Informal Wednesday Night Hump Club from 5 PM; location varies.' ELSE "scheduleNotes" END,
    "founder" = CASE WHEN "founder" IS NULL THEN 'Brian ''Clark Kunt'' Kerns' ELSE "founder" END,
    "parentKennelCode" = CASE WHEN "parentKennelCode" IS NULL THEN 'h4-tx' ELSE "parentKennelCode" END,
    "description" = CASE WHEN "description" = 'Missoula, Montana''s Hash House Harriers: a drinking club with a running problem. Hellgate meets monthly, mostly on the 3rd Saturday, for a hounds-versus-hares trail around town or up into the mountains. Annual favorites include a Red Dress Run and a summer campout. No running experience needed; virgins and visiting hashers are welcome.' THEN 'Missoula, Montana''s Hash House Harriers: a drinking club with a running problem. Hellgate usually meets twice a month: an organized hounds-versus-hares trail every four weeks or so, mostly on the 3rd Saturday, around town or up into the mountains, with a casual pickup hash in between. Locals also gather for an informal Wednesday Night Hump Club. Annual favorites include a Red Dress Run and a summer campout. No running experience needed; virgins and visiting hashers are welcome.' ELSE "description" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hellgate-h3'
  AND ("scheduleNotes" = 'Mostly the 3rd Saturday of the month; start times vary, roughly 12–4 pm.'
    OR "founder" IS NULL
    OR "parentKennelCode" IS NULL
    OR "description" = 'Missoula, Montana''s Hash House Harriers: a drinking club with a running problem. Hellgate meets monthly, mostly on the 3rd Saturday, for a hounds-versus-hares trail around town or up into the mountains. Annual favorites include a Red Dress Run and a summer campout. No running experience needed; virgins and visiting hashers are welcome.');

-- Audit finding (Heart of Texas H3): $5 from the Hill Country GCal run notes (#501, #503, #504); founders per Half-Mind #447.
UPDATE "Kennel"
SET
    "founder" = CASE WHEN "founder" IS NULL THEN 'Deep Throat (co-founder Rearender)' ELSE "founder" END,
    "hashCash" = CASE WHEN "hashCash" IS NULL THEN '$5' ELSE "hashCash" END,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'hoth3'
  AND ("founder" IS NULL
    OR "hashCash" IS NULL);
