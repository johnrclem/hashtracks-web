-- One-shot canonical Event fixes for audit issues whose rows sit outside the
-- recurring scrape window (a re-scrape cannot correct them). DATA-ONLY,
-- idempotent: every UPDATE is guarded on the bad value it replaces.
-- Prod-data-specific: the hard-coded Event ids exist only in prod, so on a
-- local/empty DB these statements update 0 rows (by design).

-- #2392 Tacoma H3: founding year "1987" leaked into hares on the yearly
-- "TH3 Analversary (1987)" rows (forward fix shipped in #2449).
UPDATE "Event" e SET "haresText" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId" AND k."kennelCode" = 'th3-wa'
  AND e.title ILIKE 'TH3 Analversary%' AND e."haresText" = '1987';

-- #2393 / #2474: orphan trailing "#" left after the run number was stripped
-- ("TH3 #", "Taint H3 #"). Forward fix (sanitizeTitle) shipped in #2449.
UPDATE "Event" e SET title = regexp_replace(e.title, '\s*#\s*$', ''), "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM "Kennel" k
WHERE k.id = e."kennelId"
  AND ((k."kennelCode" = 'th3-wa' AND e.title = 'TH3 #')
    OR (k."kennelCode" = 'taint-h3' AND e.title = 'Taint H3 #'));

-- #2476 TGIF, #2682 H5: stale endTime earlier than startTime. The source end
-- crosses midnight (dropped by the adapter), so the old value was never cleared.
UPDATE "Event" SET "endTime" = NULL, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id IN ('cmoo1z2x7001i04k4socqouoi', 'cmmruq595003s04i8kjyuhyne')
  AND "endTime" IS NOT NULL AND "endTime" < "startTime";

-- #2643 Wasatch: run number was corrected to #1151 but the synthesized title
-- still reads #1152.
UPDATE "Event" SET title = 'Wasatch H3 Trail #1151', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmnwb4wum006g04jx4nqykvlt' AND "runNumber" = 1151 AND title = 'Wasatch H3 Trail #1152';

-- #2652 Stuttgart: hare label stored as the title.
UPDATE "Event" SET title = 'Stuttgart H3 Trail #' || "runNumber", "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id IN ('cmnx79ul4000204jv8dqxrzmi', 'cmrad3a2j001f04i9te80ydw6') AND title LIKE 'Hare:%'
  AND "runNumber" IS NOT NULL;

-- #2533 CH4 #370: "Thunder and friends" was split and reordered.
UPDATE "Event" SET "haresText" = 'Thunder and friends', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmnev54rw006z04l5f6kknedz' AND "haresText" = 'friends, Thunder';

-- #2680 SWH3: directions + phone number captured as the location.
UPDATE "Event" SET "locationName" = '7700 Perry Creek Rd, Raleigh, NC 27616', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmssaw2wg000p04kv5gqft5kj' AND "locationName" LIKE '7700 Perry Creek Rd%also known as%';

-- #2597 Halve Mein #829: street address from the "Google:" directions cell.
UPDATE "Event" SET "locationStreet" = '154 Sacandaga Road, Scotia, NY 12302', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE id = 'cmn98cmap001604l7gpscbmnh' AND "locationStreet" IS NULL;
