-- Site moves for the Bangkok Hash trio and New Taipei Hash (Nov 2026 rebuilds).
--
-- bangkokhash.com: the Joomla sub-sites moved from
--   https://www.bangkokhash.com/<sub>/index.php  →  https://bangkokhash.com/<sub>/
-- (www now 301s to the apex) and the run data moved into the shared HashWebApp
-- backend (POST /HashWebApp/Runs/05_Hareline/ViewHL_Server.php + the
-- ViewNextRunDirections.php iframe). BangkokHashAdapter was rewritten for it;
-- the registry still routes on /bangkokhash\.com/.
--
-- newtaipeihash.com: run_site_<YYYY>.htm now 301s to
-- https://nth3.taipeihash.com.tw, a rebuilt site with a public JSON API
-- (/api/runs, /api/runs/this-week). NewTaipeiHashAdapter was rewritten for it
-- and the registry routes nth3.taipeihash.com.tw ahead of the Taipei H3
-- pattern. The Big5 legacy year-page scrape is gone.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- rows are converged here; prisma/seed-data carries the same values so a later
-- seed is a no-op. Source.config is unchanged (Bangkok keeps `subSite`, New
-- Taipei keeps `upcomingOnly: true`).
--
-- Idempotent: each UPDATE is guarded on the audited stale value, so re-runs and
-- later admin edits are no-ops.

BEGIN;

-- 1. Source URLs.
UPDATE "Source"
SET url = 'https://bangkokhash.com/thursday/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Bangkok Thursday Hash'
  AND type::text = 'HTML_SCRAPER'
  AND url = 'https://www.bangkokhash.com/thursday/index.php';

UPDATE "Source"
SET url = 'https://bangkokhash.com/fullmoon/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Bangkok Full Moon Hash'
  AND type::text = 'HTML_SCRAPER'
  AND url = 'https://www.bangkokhash.com/fullmoon/index.php';

UPDATE "Source"
SET url = 'https://bangkokhash.com/siamsunday/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Siam Sunday Hash'
  AND type::text = 'HTML_SCRAPER'
  AND url = 'https://www.bangkokhash.com/siamsunday/index.php';

UPDATE "Source"
SET url = 'https://nth3.taipeihash.com.tw/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'New Taipei Hash Run List'
  AND type::text = 'HTML_SCRAPER'
  AND url = 'http://www.newtaipeihash.com/run_site_2026.htm';

-- 2. Kennel websites.
UPDATE "Kennel"
SET website = 'https://bangkokhash.com/thursday/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bth3'
  AND website = 'https://www.bangkokhash.com/thursday/index.php';

UPDATE "Kennel"
SET website = 'https://bangkokhash.com/fullmoon/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'bfmh3'
  AND website = 'https://www.bangkokhash.com/fullmoon/index.php';

UPDATE "Kennel"
SET website = 'https://bangkokhash.com/siamsunday/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 's2h3'
  AND website = 'https://www.bangkokhash.com/siamsunday/index.php';

UPDATE "Kennel"
SET website = 'https://nth3.taipeihash.com.tw/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'nth3-tw'
  AND website = 'http://www.newtaipeihash.com';

COMMIT;
