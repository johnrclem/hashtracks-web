-- Cut hashnyc.com over from HTML_SCRAPER to ICAL_FEED.
--
-- hashnyc.com relaunched on a new "hash-attendance" app. The `table.past_hashes` /
-- `table.future_hashes` layout the bespoke Cheerio HashNYCAdapter scraped is GONE
-- (verified 2026-08-10: neither table appears in the homepage HTML), so the legacy
-- source can no longer see any events. The relaunched site publishes a structured
-- iCal feed at https://hashnyc.com/public/hareline.ics, so the source moves to the
-- shared ICalAdapter. Seed identity is (name, type), so the ICAL_FEED row is a
-- distinct row from the retired HTML_SCRAPER one.
--
-- DATA-ONLY. Vercel runs `prisma migrate deploy`, never `db seed`, so this migration
-- both (1) provisions the replacement ICAL_FEED Source row + its SourceKennel links
-- (mirroring prisma/seed-data/sources.ts) AND (2) disables the legacy HTML_SCRAPER row
-- in the SAME transaction. Doing both here means a deploy never leaves hashnyc.com with
-- no enabled source. A later `db seed` converges the same rows as a no-op.
-- Same shape as 20260622120100_onboard_fool_moon_h3_644 (source/kennel wiring in SQL).
--
-- The config JSONB duplicates the seed's kennelPatterns — unavoidable given "Vercel
-- never runs db seed". Migrations are immutable, so a future routing change is a new
-- migration + seed edit. JSONB escaping: "\\b" in this SQL literal stores as "\b"
-- (backslash + b, a regex word boundary), NOT a JSON backspace — verified through the
-- DB -> config::text -> JSON.parse -> RegExp round-trip.
--
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING (Source + SourceKennel), and the retire
-- UPDATE only touches an *enabled* HTML_SCRAPER row. Safe to re-apply.

BEGIN;

-- 1. Provision the replacement ICAL_FEED source (create if absent; an existing /
--    seed-converged row is left untouched so admin edits aren't stomped).
INSERT INTO "Source" (
  id, name, url, type, config, "trustLevel", "scrapeFreq", "scrapeDays",
  enabled, "createdAt", "updatedAt"
)
VALUES (
  'src_hashnyc_ical_relaunch',
  'HashNYC Website',
  'https://hashnyc.com/public/hareline.ics',
  'ICAL_FEED'::"SourceType",
  '{
    "upcomingOnly": true,
    "kennelPatterns": [
      ["^Knickerbocker\\b|^Knick\\b", "knick"],
      ["^Queens Black Knights\\b|^QBK\\b", "qbk"],
      ["^NAWW(?:H3)?\\b", "nawwh3"],
      ["^New Amsterdam\\b|^NAH3\\b|^NASS\\b", "nah3"],
      ["^Long Island(?:\\s+Lunatics)?\\b|^LIL\\b", "lil"],
      ["^Staten Island\\b|^SI\\b", "si"],
      ["^Drinking Practice\\b", "drinking-practice-nyc"],
      ["^Brooklyn(?:\\s+H3)?\\b|^BrH3\\b|^BKH3\\b", "brh3"],
      ["^Harriettes\\b", "harriettes-nyc"],
      ["^Columbia\\b", "columbia"],
      ["^GGFM\\b", "ggfm"],
      ["^Queens\\b", "qbk"],
      ["^NYC(?:H3)?\\b", "nych3"]
    ],
    "defaultKennelTag": "nych3"
  }'::jsonb,
  8, 'daily', 365, true,
  NOW() AT TIME ZONE 'UTC', NOW() AT TIME ZONE 'UTC'
)
ON CONFLICT (name, type) DO NOTHING;

-- 2. Link the 12 kennels the patterns route to (the merge pipeline's source-kennel
--    guard blocks events for unlinked kennels). Deterministic per-kennel ids so
--    re-runs converge; ON CONFLICT keeps any pre-existing link.
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_hashnyc_ical_' || k."kennelCode", s.id, k.id
FROM "Source" s
JOIN "Kennel" k ON k."kennelCode" = ANY (ARRAY[
  'nych3', 'brh3', 'nah3', 'knick', 'lil', 'qbk', 'si', 'columbia',
  'harriettes-nyc', 'ggfm', 'nawwh3', 'drinking-practice-nyc'
])
WHERE s.name = 'HashNYC Website' AND s.type::text = 'ICAL_FEED'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 3. Retire the legacy HTML_SCRAPER row (only while still enabled -> idempotent).
UPDATE "Source"
SET enabled = false,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'HashNYC Website'
  AND type::text = 'HTML_SCRAPER'
  AND enabled = true;

-- 4. Re-home the 2026-11-14 Friendsgiving trail from nah3 → nawwh3.
--
--    The old HTML site labelled this trail "NASS #304" (→ nah3); the relaunched
--    feed labels the same date + theme "NAWW #396" (→ nawwh3), and the feed
--    carries no NASS events at all any more. Since the merge pipeline keys on
--    kennel + date, leaving the nah3 copy in place would surface the SAME trail
--    twice — once per kennel page — with the nah3 copy orphaned on the retired
--    source. Re-homing (rather than deleting) keeps the Event id, so the incoming
--    iCal RawEvent for nawwh3/2026-11-14 merges into THIS row and enriches it with
--    hares/venue/cost instead of creating a second one. Corroborating signal: the
--    existing row's startTime (14:00) matches the NAWW series exactly.
--
--    The two originating RawEvents stay attached as audit trail (they are
--    processed with an eventId, so the pipeline will not re-ingest them, and their
--    source is disabled by step 3 anyway).
--
--    Fail-safe and idempotent: skipped entirely (with a NOTICE, never an error) if
--    the row is gone, is a manual entry, has picked up any attendance/check-in
--    since this migration was written, or if nawwh3 already holds an event that
--    day — a re-run after the reassign matches nothing and no-ops.
DO $$
DECLARE
  v_event_id  text;
  v_nah3_id   text;
  v_nawwh3_id text;
  v_conflict  int;
BEGIN
  SELECT id INTO v_nah3_id   FROM "Kennel" WHERE "kennelCode" = 'nah3';
  SELECT id INTO v_nawwh3_id FROM "Kennel" WHERE "kennelCode" = 'nawwh3';
  IF v_nah3_id IS NULL OR v_nawwh3_id IS NULL THEN
    RAISE NOTICE 'nah3/nawwh3 kennel missing — skipping Friendsgiving re-home';
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM "Event" e
  WHERE e."kennelId" = v_nah3_id
    AND e.date::date = DATE '2026-11-14'
    AND e."runNumber" = 304
    AND NOT e."isManualEntry"
    AND NOT EXISTS (SELECT 1 FROM "Attendance" a WHERE a."eventId" = e.id)          -- NOSONAR plsql:S1138
    AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" ka WHERE ka."eventId" = e.id); -- NOSONAR plsql:S1138

  IF v_event_id IS NULL THEN
    RAISE NOTICE 'NASS #304 (2026-11-14) absent from nah3, manual, or carries attendance — skipping re-home';
    RETURN;
  END IF;

  SELECT count(*) INTO v_conflict
  FROM "Event" WHERE "kennelId" = v_nawwh3_id AND date::date = DATE '2026-11-14';
  IF v_conflict > 0 THEN
    RAISE NOTICE 'nawwh3 already holds an event on 2026-11-14 — skipping re-home, resolve by hand';
    RETURN;
  END IF;

  -- EventKennel (the multi-kennel join) first, then the denormalized Event.kennelId.
  UPDATE "EventKennel" SET "kennelId" = v_nawwh3_id
  WHERE "eventId" = v_event_id AND "kennelId" = v_nah3_id;

  UPDATE "Event"
  SET "kennelId"  = v_nawwh3_id,
      "runNumber" = 396,
      title       = 'Friendsgiving 2026',
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE id = v_event_id;

  -- Recompute the cached lastEventDate for BOTH kennels (nah3 loses its only
  -- future trail, nawwh3 gains one). Predicate matches src/pipeline/backfill-last-event.ts.
  UPDATE "Kennel" k
  SET "lastEventDate" = (
        SELECT MAX(e.date) FROM "Event" e
        WHERE e."kennelId" = k.id
          AND e.status::text <> 'CANCELLED'
          AND NOT e."isManualEntry"
      ),
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
  WHERE k.id IN (v_nah3_id, v_nawwh3_id);

  RAISE NOTICE 'Re-homed Friendsgiving 2026 (2026-11-14) from nah3 NASS #304 → nawwh3 NAWW #396';
END $$;

-- 5. Sanity NOTICEs (never fail the deploy) so a partial state is visible in the
--    build log and an operator knows to run `db seed`.
DO $$
DECLARE
  v_source_id text;
  v_linked    int;
BEGIN
  SELECT id INTO v_source_id FROM "Source"
  WHERE name = 'HashNYC Website' AND type::text = 'ICAL_FEED';
  IF v_source_id IS NULL THEN
    RAISE NOTICE 'ICAL_FEED "HashNYC Website" row missing after insert — check schema/enum';
  ELSE
    SELECT count(*) INTO v_linked FROM "SourceKennel" WHERE "sourceId" = v_source_id;
    IF v_linked < 12 THEN
      RAISE NOTICE 'HashNYC ICAL_FEED linked to % of 12 kennels — run db seed to reconcile', v_linked;
    END IF;
  END IF;
END $$;

COMMIT;
