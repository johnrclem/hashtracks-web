-- Oregon Hashing Calendar: strict kennel routing + emoji-tolerant OH3 pattern.
--
-- The calendar is a regional aggregator. With defaultKennelTag "oh3" and no
-- strictKennelRouting, every sibling kennel's run (Eugene EH3, Stumptown,
-- Dead Whores, Central Oregon, SWH3, OBGYN, Beaver, Kahuna, PH4 …) and
-- template junk ("start comment- choose your preferred fields …") was filed
-- under OH3. The 2026-11-05 wide backfill extended that back to 2018
-- (~1,090 rows); scripts/cleanup-oregon-calendar-misroutes.ts removes them.
-- strictKennelRouting drops any title matching no pattern
-- (google-calendar/adapter.ts resolveKennelTagFromSummary). The OH3 pattern
-- now tolerates a leading emoji/punctuation ("🍀OH3 #1185", "🌕 OH3 #1187").
-- Live check (365d window): oh3 70 → 50 past rows, upcoming unchanged (24).
--
-- DATA-ONLY, idempotent: rewrites only the OH3 pattern entry and sets the flag,
-- and only when not already converged. prisma/seed-data/sources.ts matches.

BEGIN;

UPDATE "Source"
SET config = jsonb_set(
      jsonb_set(config, '{strictKennelRouting}', 'true'::jsonb),
      '{kennelPatterns}',
      (
        SELECT jsonb_agg(
                 CASE WHEN p->>0 = '^OH3\b|OH3 Full Moon'
                      THEN jsonb_build_array('^[^A-Za-z0-9]*OH3\b|OH3 Full Moon', p->1)
                      ELSE p END
                 ORDER BY ord)
        FROM jsonb_array_elements(config->'kennelPatterns') WITH ORDINALITY AS t(p, ord)
      )
    ),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Oregon Hashing Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (
    (config->'strictKennelRouting') IS DISTINCT FROM 'true'::jsonb
    OR config->'kennelPatterns' @> '[["^OH3\\b|OH3 Full Moon"]]'::jsonb
  );

COMMIT;
