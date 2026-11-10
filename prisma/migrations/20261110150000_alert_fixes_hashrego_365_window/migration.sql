-- Hash Rego: widen the daily scrape window from 90 to 365 days.
--
-- Kennels mostly use Hash Rego to announce big events (campouts, weekends, Party Gras),
-- often 6+ months out. With 90 days, Party Gras! 2027 (Feb 19-21) and FCH3 Weekend 2027
-- (Jun 25) stayed invisible until a one-off 365-day scrape on 2026-11-10. A 365-day run
-- reads ~4 more detail pages (~5 s total) and cancelled nothing.
--
-- baselineResetAt: the wider window lifts the per-scrape event count (~1 -> ~6) and lowers
-- the location fill rate (far-off events have no venue yet). Restarting the health baseline
-- keeps that step change from raising EVENT_COUNT_ANOMALY / FIELD_FILL_DROP alerts; the
-- open FIELD_FILL_DROP left by the one-off run clears at the next scrape.
--
-- DATA-ONLY, idempotent. Mirrors prisma/seed-data/sources.ts.

UPDATE "Source"
SET "scrapeDays" = 365,
    "baselineResetAt" = NOW() AT TIME ZONE 'UTC',
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Hash Rego' AND type = 'HASHREGO'::"SourceType" AND "scrapeDays" <> 365;
