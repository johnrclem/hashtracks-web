-- WS4 alert triage (Nov 2026): source-config fixes.
--
-- 1. Sacramento H3 Squarespace Events: upcomingOnly. Squarespace's events JSON
--    pages past events by `publishOn` (offset = last item's publishOn) but orders
--    them by `startDate`. Runs published later than older runs fall between pages:
--    on 2026-11-05 page 2 jumped from 2026-06-05 to 2026-03-14, so runs #1719–#1730
--    (2026-03-18 .. 2026-06-03) left the walk and reconcile cancelled 14 of them
--    (EXCESSIVE_CANCELLATIONS alert). The runs still exist on the site. Every run is
--    first captured from the complete upcoming list, so the past-page gap only
--    matters to reconcile. Restoring the 14 is a separate, dry-run-first one-shot.
-- 2. BoiseH3 Website: upcomingOnly. The home page shows only the next hash. (The
--    source had never ingested a run: the unanchored /eh3\.org/ registry pattern
--    matched boiseh3.org and ran the Edmonton adapter — fixed in code.)
-- 3. West of England Hash Run List: skipKennelTags ["BOGS"]. BOGS rows are covered by
--    the BOGS H3 Run List source (#1004); here they raised SOURCE_KENNEL_MISMATCH on
--    every scrape since 2026-05-26.
-- 4. Princeton NJ Hash Calendar: skipPatterns for the recurring Rumson / Summit
--    reminders. A null defaultKennelTag does not drop them — they fuzzy-resolve to
--    rumson / summit and raised SOURCE_KENNEL_MISMATCH every scrape since 2026-05-27.
-- 5. ONH3 Google Calendar: strictKennelRouting. The calendar doubles as a member's
--    personal calendar; non-run entries surfaced as UNMATCHED_TAGS samples.
-- 6. Boston Hash Calendar: route "PTT H3"/"PTTH3" → pink-taco, "MOOOOOOM" → bos-moon,
--    and a bare "Misman meeting" → boh3 (like "BH3 Misman meeting"). Validated against
--    the full 1,640-item calendar archive: only those 7 titles change routing.
-- 7. HK H3 Homepage: runNumberAnchor {2988, 2026-09-07}. The homepage block has no
--    date and stays up for weeks after its run; dating it "next Monday" stamped #2979
--    on 9 Mondays and #2988 on 10. A run number behind the anchor's prediction for the
--    coming Monday now means "stale", and nothing is emitted.
-- 8. Taiwan H3 Harrier Central (#2757): titleStripPatterns drops a "- SIGN UP FOR …"
--    call to action from event names ("TwH³ 2682 - SIGN UP FOR THE FUCKING BUS!!!").
--
-- DATA-ONLY, idempotent. prisma/seed-data/sources.ts carries the same values.

UPDATE "Source"
SET config = jsonb_set(
      CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END,
      '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Sacramento H3 Squarespace Events'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

UPDATE "Source"
SET config = jsonb_set(
      CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END,
      '{upcomingOnly}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'BoiseH3 Website'
  AND type::text = 'HTML_SCRAPER'
  AND (config->'upcomingOnly') IS DISTINCT FROM 'true'::jsonb;

UPDATE "Source"
SET config = jsonb_set(CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END, '{skipKennelTags}', '["BOGS"]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'West of England Hash Run List'
  AND type::text = 'HTML_SCRAPER'
  AND (jsonb_typeof(config) IS DISTINCT FROM 'object' OR NOT config ? 'skipKennelTags');

UPDATE "Source"
SET config = jsonb_set(CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END, '{skipPatterns}',
      '["^Rumson Hash House Harriers\\b", "^Summit HHH\\b", "^SHHH\\b"]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Princeton NJ Hash Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (jsonb_typeof(config) IS DISTINCT FROM 'object' OR NOT config ? 'skipPatterns');

UPDATE "Source"
SET config = jsonb_set(CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END, '{strictKennelRouting}', 'true'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'ONH3 Google Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND (config->'strictKennelRouting') IS DISTINCT FROM 'true'::jsonb;

UPDATE "Source"
SET config = jsonb_set(CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END, '{kennelPatterns}', '[["Boston Ball\\s*Buster|\\bBall\\s*Buster\\b|BoBBH3|B3H4|BBH3", "bobbh3"], ["Beantown", "beantown"], ["Pink Taco|PT2H3|PTT\\s*H3|\\bTaco\\b", "pink-taco"], ["\\bZigZag\\b|Zig Zag|ZZH3", "zigzag"], ["\\bE4B\\b|Eager\\s*4\\s*Beaver", "e4b"], ["Boston Moo[mn]|Full Moon|\\bMo{2,}[mn]\\b", "bos-moon"], ["Boston H3|Boston Hash|BoH3|BH3", "boh3"], ["^Misman meeting\\b", "boh3"]]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Boston Hash Calendar'
  AND type::text = 'GOOGLE_CALENDAR'
  AND ((config->'kennelPatterns') IS NULL OR NOT (config->'kennelPatterns') @> '[["^Misman meeting\\b", "boh3"]]'::jsonb);

UPDATE "Source"
SET config = jsonb_set(
      CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END,
      '{runNumberAnchor}', '{"runNumber": 2988, "date": "2026-09-07"}'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'HK H3 Homepage'
  AND type::text = 'HTML_SCRAPER'
  AND (jsonb_typeof(config) IS DISTINCT FROM 'object' OR NOT config ? 'runNumberAnchor');

UPDATE "Source"
SET config = jsonb_set(CASE WHEN jsonb_typeof(config) = 'object' THEN config ELSE '{}'::jsonb END, '{titleStripPatterns}', '["\\s*-\\s*sign up\\b.*$"]'::jsonb),
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Taiwan H3 Harrier Central'
  AND type::text = 'HARRIER_CENTRAL'
  AND (jsonb_typeof(config) IS DISTINCT FROM 'object' OR NOT config ? 'titleStripPatterns');
