-- GCal / iCal defect sweep, part 1: hares and venues (2026-11-28).
-- Refs #2941 #2995 #3028 #3059 #3120 #3124 #3157 #3158.
--
-- The adapter and merge fixes in this PR reach runs inside each source's scrape window,
-- and the daily audit heals stored hares and venues from 7 days back to 90 ahead. This
-- covers the rest. Every statement is guarded by the value it replaces, so a re-run is a no-op.
-- 1. Source configs for four sources (seed changes reach prod only through a migration).
-- 2. Hares that say a run is a pick-up hash ("Pick-Up Hash!": 24 BARH3 rows and 5 on four other
--    kennels in the 2026-11-24 copy) name no hare: clear them.
-- 3. 32 venues that kept a "(" or a half markdown link after the URL inside it was
--    stripped ("Montgomery Park (", "[800 Race St](") get the text without it.
-- 4. Perth #2950 (16 Nov, out of the feed now): hares "Horse and Pitt", not the run's theme.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Charm City H3 iCal Feed: #2941: allow an emoji before the HARES / WHERE labels.
UPDATE "Source"
SET config = config || '{"harePatterns":["(?:^|\\n)[^\\n\\w]{0,8}Hares?\\s*[:~]\\s*([^\\n]+)"],"locationPatterns":["(?:^|\\n)[^\\n\\w]{0,8}Where:\\s*([^\\n]+)","(?:^|\\n)[^\\n\\w]{0,8}Start:\\s*([^\\n]+)","(?:^|\\n)[^\\n\\w]{0,8}Location:\\s*([^\\n]+)","(?:^|\\n)\\s*Location\\s*\\n\\s*([^\\n]+)"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Charm City H3 iCal Feed' AND type = 'ICAL_FEED'::"SourceType"
  AND config->'harePatterns' = '["(?:^|\\n)\\s*Hares?\\s*[:~]\\s*([^\\n]+)"]'::jsonb
  AND config->'locationPatterns' = '["(?:^|\\n)\\s*Where:\\s*([^\\n]+)","(?:^|\\n)\\s*Start:\\s*([^\\n]+)","(?:^|\\n)\\s*Location:\\s*([^\\n]+)","(?:^|\\n)\\s*Location\\s*\\n\\s*([^\\n]+)"]'::jsonb;

-- DeMon H3 Google Calendar: #3120: also read "HARES:" and moon-hash "Wolves - <names>" lines.
UPDATE "Source"
SET config = config || '{"harePatterns":["(?:^|\\n)\\s*WHO\\s*\\(?(?:hares?)?\\)?\\s*:?\\s*(.+)","(?:^|\\n)[^\\n\\w]{0,8}(?:Hares?|Wolves)\\s*[-–:]\\s*(.+)"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'DeMon H3 Google Calendar' AND type = 'GOOGLE_CALENDAR'::"SourceType"
  AND config->'harePatterns' = '["(?:^|\\n)\\s*WHO\\s*\\(?(?:hares?)?\\)?\\s*:?\\s*(.+)"]'::jsonb;

-- Perth H3 Hareline: #3028: stop the title hares at " : <theme>".
UPDATE "Source"
SET config = config || '{"titleHarePattern":"^Run\\s*(?:#\\s*)?\\d+\\s*[-–]\\s*([^@:]+?)\\s*(?:[@:].*)?$"}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Perth H3 Hareline' AND type = 'ICAL_FEED'::"SourceType"
  AND config->'titleHarePattern' = '"^Run\\s*(?:#\\s*)?\\d+\\s*-\\s*([^@]+?)\\s*(?:@.*)?$"'::jsonb;

-- Colorado Springs H3 Calendar: #3059: default "PPH4 Trail" title, hares from "Our great hare X will".
UPDATE "Source"
SET config = config || '{"defaultTitles":{"kimchi-h3":"Kimchi H3 Trail","pph4":"PPH4 Trail"},"preferDefaultTitleOverDescription":true,"harePatterns":["(?:^|\\n)[^\\n\\w]{0,8}Hares?\\s*:\\s*(.+)","\\bour\\s+(?:great\\s+|fearless\\s+)?hares?\\s+([A-Z][\\w''’-]*(?:\\s+(?:&|and)\\s+[A-Z][\\w''’-]*)?)\\s+will\\b"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Colorado Springs H3 Calendar' AND type = 'GOOGLE_CALENDAR'::"SourceType"
  AND config->'defaultTitles' = '{"kimchi-h3":"Kimchi H3 Trail"}'::jsonb
  AND config->'preferDefaultTitleOverDescription' IS NULL
  AND config->'harePatterns' IS NULL;

UPDATE "Event" SET "haresText" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "haresText" ~* '^pick[[:space:]-]?up[[:space:]]+hash([!.]*$|[[:space:]]*[-–—(])';

UPDATE "Event" e SET "locationName" = v.loc, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM jsonb_to_recordset(
$locs$[
{"id":"cmlyt4607001r04jpd2txolha","old":"Patuxent Ponds Park, 1081 Patuxent Rd, Odenton, MD 21113, United States (","loc":"Patuxent Ponds Park, 1081 Patuxent Rd, Odenton, MD 21113, United States"},
{"id":"cmmz0etao008604k09pn8djzr","old":"4234 N Interstate Ave, Portland, OR 97217, On-Start is in the * *BAR* * (","loc":"4234 N Interstate Ave, Portland, OR 97217, On-Start is in the * *BAR* *"},
{"id":"cmn0talk9000704jvmk2ze6ve","old":"Pigeon Point Park (","loc":"Pigeon Point Park"},
{"id":"cmn0ti4ym001004k4p6oyq79g","old":"Harvey Manning Trailhead, SE Cougar Mountain Drive, Renton (47.541007, -122.096222 (","loc":"Harvey Manning Trailhead, SE Cougar Mountain Drive, Renton"},
{"id":"cmn0ti6cq001k04k4uvf7vf3d","old":"Cedar Park Play Area (","loc":"Cedar Park Play Area"},
{"id":"cmn0tjn1400mg04k4ez49min7","old":"Amy Yee Tennis Center (","loc":"Amy Yee Tennis Center"},
{"id":"cmn0tjql400nu04k4u1dqmm0l","old":"Marsh Park, Kirkland (","loc":"Marsh Park, Kirkland"},
{"id":"cmn0tkoru013404k49r8ssobx","old":"Near Philip Arnold Park in southeast Renton (","loc":"Near Philip Arnold Park in southeast Renton"},
{"id":"cmn0tm4xo01rk04k4jgm45jmy","old":"Hillwood Park (","loc":"Hillwood Park"},
{"id":"cmn0tmhx601xk04k4igu5cjad","old":"12718 1st Ave NE, Seattle, WA 98125 (","loc":"12718 1st Ave NE, Seattle, WA 98125"},
{"id":"cmn0tni6l02ey04k4m1vcbqq9","old":"The surreal world of the Seattle Japanese Garden (","loc":"The surreal world of the Seattle Japanese Garden"},
{"id":"cmng9keqj002l04l55njp2cqm","old":"Gold Bar Elementary School 10524 46 St NW (","loc":"Gold Bar Elementary School 10524 46 St NW"},
{"id":"cmngj4z95002u04l7ma2w7273","old":"Across the street from Vessel NOLA, [3835 Iberville St New Orleans, LA](","loc":"Across the street from Vessel NOLA, 3835 Iberville St New Orleans, LA"},
{"id":"cmngj4zbz002y04l7664o87pe","old":"Annunciation Rec Center, [800 Race St, New Orleans, LA 70130](","loc":"Annunciation Rec Center, 800 Race St, New Orleans, LA 70130"},
{"id":"cmo3cvtr7000s04l47wyhbbmo","old":"Parkplatz at Paul-Linke Str. 3, 70195 Botnang (","loc":"Parkplatz at Paul-Linke Str. 3, 70195 Botnang"},
{"id":"cmogky7a30011hthnri589txi","old":"Reynolds Pond Trailhead, Bend, OR (","loc":"Reynolds Pond Trailhead, Bend, OR"},
{"id":"cmoglcitt003fp6hn451wyab0","old":"The big yellow thing you can see from the freeway (","loc":"The big yellow thing you can see from the freeway"},
{"id":"cmoglf05700ejp6hnuelufgi4","old":"Silo Park, 9300 E Orchard Rd, Greenwood Village, CO 80111 (","loc":"Silo Park, 9300 E Orchard Rd, Greenwood Village, CO 80111"},
{"id":"cmohq993400o5fahn88s3vzke","old":"Crown Hill Park (","loc":"Crown Hill Park"},
{"id":"cmpex9vm4003pdohno71edqlu","old":"Parking lot behind the St. George’s Church on Minden Road, Dempsey Hill. (","loc":"Parking lot behind the St. George’s Church on Minden Road, Dempsey Hill"},
{"id":"cmpn0grta018h04jr7xyw1ntn","old":"5378 Reeve Road, Mazomanie WI (","loc":"5378 Reeve Road, Mazomanie WI"},
{"id":"cmpn0gsbk018p04jrtanpaa1f","old":"De Volis Park, 4300 De Volis Pkwy, Madison, WI 53711, USA (","loc":"De Volis Park, 4300 De Volis Pkwy, Madison, WI 53711, USA"},
{"id":"cmpng74vl011pzqhn68inlub1","old":"Hartman Park, Redmond WA 98052 (","loc":"Hartman Park, Redmond WA 98052"},
{"id":"cmpng7drp012zzqhno2e5ny6d","old":"Medina Park (","loc":"Medina Park"},
{"id":"cmpng8qfr01azzqhna7djp85z","old":"Northish side of Lawton Park in Magnolia (","loc":"Northish side of Lawton Park in Magnolia"},
{"id":"cmpoo3z1400cb04l5bf20oeh5","old":"Boulevard Crossing Park (","loc":"Boulevard Crossing Park"},
{"id":"cmqzkcqhw00cc5chnhj33mx9r","old":"Parking lot of Sommerrain S-Bahn station on Masurenstrasse, Stuttgart (","loc":"Parking lot of Sommerrain S-Bahn station on Masurenstrasse, Stuttgart"},
{"id":"cmqzkex4q00ug5chn7arqf9kn","old":"Leonhardspl. 10, 70182 Stuttgart, Germany (","loc":"Leonhardspl. 10, 70182 Stuttgart, Germany"},
{"id":"cmqzkezu500v25chn2d0keapc","old":"Parking Lot in „bei Hohe Warte, 70469 Stuttgart“ (","loc":"Parking Lot in „bei Hohe Warte, 70469 Stuttgart“"},
{"id":"cmvh3y8bg000b04l3hknv4977","old":"Bownwood park and Ormewood (","loc":"Bownwood park and Ormewood"},
{"id":"cmw44trpk0092s2hnl65vepjy","old":"Meet up on W Barclay Dr behind the Best Western Ponderosa Lodge (","loc":"Meet up on W Barclay Dr behind the Best Western Ponderosa Lodge"},
{"id":"cmwiz8szy00qc08jsle5c3htf","old":"Montgomery Park (","loc":"Montgomery Park"}
]$locs$
) AS v(id text, old text, loc text)
WHERE e.id = v.id AND e."locationName" = v.old;

UPDATE "Event" SET "haresText" = 'Horse and Pitt', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmpe6xmea000n04l8fji79s48' AND "haresText" = 'Horse and Pitt : 4 seasons summer run with WCH3';

COMMIT;
