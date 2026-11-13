-- WS1: repoint the Barnes Hash Hare Line source after the club's site move.
--
-- Nov 2026: barnesh3.com moved to GitHub Pages. www.barnesh3.com/HareLine.htm
-- now redirects to https://barnesh3.com/HareLine.htm, which is a 404 (and
-- https://www.barnesh3.com serves a certificate for the wrong host), so every
-- scrape fails. The hare line is now https://barnesh3.com/hareline/, rendered
-- from the club's published Google Sheet; BarnesHashAdapter was rewritten to
-- read that sheet via the site's /config.js. The registry still routes on
-- barnesh3.com, so only the URL changes.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so the live
-- row is converged here; prisma/seed-data carries the same value.
--
-- Idempotent: guarded on the old HareLine.htm URL (any scheme, host or case),
-- so a re-run or a later admin edit is a no-op.

UPDATE "Source"
SET url = 'https://barnesh3.com/hareline/',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Barnes Hash Hare Line'
  AND type::text = 'HTML_SCRAPER'
  AND url ILIKE '%barnesh3.com/hareline.htm%';
