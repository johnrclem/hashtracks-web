-- Remove the duplicate 2026-11-14 Friendsgiving trail left by the HashNYC cutover,
-- and add the post-state assertion that 20260810120000_cutover_hashnyc_html_to_ical
-- could not carry.
--
-- WHY THIS IS A SEPARATE MIGRATION
-- 20260810120000 was already applied to production by a Vercel preview build of this
-- PR (finished_at 2026-08-11 00:56 UTC) before the follow-up work was written. Applied
-- migrations are immutable — editing that file changes its checksum and makes every
-- later `prisma migrate deploy` fail — so the remaining work lands here instead.
--
-- WHAT WENT WRONG
-- The old HTML site labelled this trail "NASS #304" (-> nah3); the relaunched feed
-- labels the same date + theme "NAWW #396" (-> nawwh3), and carries no NASS events at
-- all any more. Because the merge pipeline keys on kennel + date, the two labels
-- produce two separate canonical events, and 2026-11-14 now shows the SAME trail on
-- both kennel pages:
--   nah3   cmnqpnfgn000b04kylih0euwg  "Friendsgiving 2026 - NASS #304"  (HTML_SCRAPER, retired)
--   nawwh3 cmsnyjezs003r04l73xpbdzti  "Friendsgiving 2026"              (ICAL_FEED, live)
-- The nah3 row is the orphan: its only provenance is the now-disabled HTML source, so
-- nothing will ever refresh it. The nawwh3 row is fed by the live feed. Delete the
-- orphan and keep the live one.
--
-- (The original plan re-homed the nah3 row onto nawwh3 to preserve its Event id. That
-- is moot now — the live feed already created the nawwh3 row before this could ship,
-- so the correct cleanup is a delete, not a move.)
--
-- SAFETY. The delete is heavily guarded and skips with a NOTICE (never an error) unless
-- ALL hold: the row is the expected nah3/2026-11-14/#304 non-manual event; it carries no
-- attendance, check-ins or event links; its ONLY source is the retired HashNYC
-- HTML_SCRAPER; and nawwh3 already holds a live event that day, so the trail can never
-- disappear from the site. Re-running matches nothing and no-ops.

BEGIN;

-- 1. Delete the orphaned nah3 copy of the Friendsgiving trail.
DO $$
DECLARE
  v_event_id  text;
  v_nah3_id   text;
  v_nawwh3_id text;
  v_survivors int;
BEGIN
  SELECT id INTO v_nah3_id   FROM "Kennel" WHERE "kennelCode" = 'nah3';
  SELECT id INTO v_nawwh3_id FROM "Kennel" WHERE "kennelCode" = 'nawwh3';
  IF v_nah3_id IS NULL OR v_nawwh3_id IS NULL THEN
    RAISE NOTICE 'nah3/nawwh3 kennel missing (pre-seed / shadow DB) — skipping Friendsgiving dedupe';
    RETURN;
  END IF;

  -- The live nawwh3 copy must already exist, or we would delete the only record of
  -- the trail. Counted BEFORE the delete and required to be non-zero.
  SELECT count(*) INTO v_survivors
  FROM "Event"
  WHERE "kennelId" = v_nawwh3_id
    AND date::date = DATE '2026-11-14'
    AND status::text <> 'CANCELLED';
  IF v_survivors = 0 THEN
    RAISE NOTICE 'nawwh3 has no live 2026-11-14 event — skipping dedupe so the trail is not lost';
    RETURN;
  END IF;

  SELECT e.id INTO v_event_id
  FROM "Event" e
  WHERE e."kennelId" = v_nah3_id
    AND e.date::date = DATE '2026-11-14'
    AND e."runNumber" = 304
    AND NOT e."isManualEntry"
    AND NOT EXISTS (SELECT 1 FROM "Attendance" a        WHERE a."eventId"  = e.id)  -- NOSONAR plsql:S1138
    AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" ka WHERE ka."eventId" = e.id)  -- NOSONAR plsql:S1138
    AND NOT EXISTS (SELECT 1 FROM "EventLink" el        WHERE el."eventId" = e.id)  -- NOSONAR plsql:S1138
    -- Every RawEvent behind it must come from the retired HTML source. If any other
    -- source also feeds this row, it is not an orphan and must not be deleted.
    AND NOT EXISTS (                                                                -- NOSONAR plsql:S1138
      SELECT 1 FROM "RawEvent" re
      JOIN "Source" s ON s.id = re."sourceId"
      WHERE re."eventId" = e.id
        AND NOT (s.name = 'HashNYC Website' AND s.type::text = 'HTML_SCRAPER')
    );

  IF v_event_id IS NULL THEN
    RAISE NOTICE 'nah3 NASS #304 (2026-11-14) absent, manual, carries user data, or is not HTML-only — skipping dedupe';
    RETURN;
  END IF;

  -- Detach the immutable RawEvents. `processed = true` (NOT false) is deliberate:
  -- false would re-queue them for the merge pipeline and re-create the very row we
  -- are deleting. Keeping them preserves the audit trail of the original ingest.
  UPDATE "RawEvent" SET "eventId" = NULL, processed = true WHERE "eventId" = v_event_id;

  UPDATE "Event" SET "parentEventId" = NULL WHERE "parentEventId" = v_event_id;

  DELETE FROM "EventHare"        WHERE "eventId" = v_event_id;
  DELETE FROM "EventKennel"      WHERE "eventId" = v_event_id;
  DELETE FROM "Event"            WHERE id        = v_event_id;

  RAISE NOTICE 'Deleted orphaned nah3 Friendsgiving copy (2026-11-14 NASS #304); live nawwh3 copy retained';
END $$;

-- 2. Recompute the cached lastEventDate for both kennels.
--
--    Mirrors backfillLastEventDates() in src/pipeline/backfill-last-event.ts exactly,
--    or the daily audit cron would compute a different value and silently "repair"
--    ours: union the primary FK (Event.kennelId) with co-host secondaries
--    (EventKennel.kennelId) — a kennel's newest event can be co-host-only (#1567) —
--    and apply all THREE display filters including `isCanonical = true`. The outer
--    LEFT JOIN preserves NULL-reset semantics for a kennel left with no visible events.
UPDATE "Kennel" k
SET "lastEventDate" = sub."maxDate",
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
FROM (
  SELECT k2.id AS "kennelId", attachment_maxes."maxDate"
  FROM "Kennel" k2
  LEFT JOIN (
    SELECT "kennelId", MAX(date) AS "maxDate"
    FROM (
      SELECT e."kennelId", e.date
      FROM "Event" e
      WHERE e.status != 'CANCELLED' AND e."isManualEntry" != true AND e."isCanonical" = true
      UNION ALL
      SELECT ek."kennelId", e.date
      FROM "EventKennel" ek
      JOIN "Event" e ON e.id = ek."eventId"
      WHERE e.status != 'CANCELLED' AND e."isManualEntry" != true AND e."isCanonical" = true
    ) attachments
    GROUP BY "kennelId"
  ) attachment_maxes ON attachment_maxes."kennelId" = k2.id
  WHERE k2."kennelCode" IN ('nah3', 'nawwh3')
) sub
WHERE k.id = sub."kennelId"
  AND k."lastEventDate" IS DISTINCT FROM sub."maxDate";

-- 3. Verify the cutover's post-state (the assertion 20260810120000 shipped as a
--    non-fatal NOTICE). A partial cutover is worse than none: the legacy source is
--    already disabled, so a missing or under-linked replacement leaves those kennels
--    with NO working source and their events rejected by the merge pipeline's
--    source-kennel guard (SOURCE_KENNEL_MISMATCH). RAISE EXCEPTION rolls this
--    migration back and fails the deploy loudly instead of drifting silently.
--
--    Guarded on the kennels existing, matching 20260603143000_add_vth3_squarespace_source:
--    `prisma migrate dev` replays every migration against an EMPTY shadow database where
--    these seed-created Kennel rows are absent, and an unguarded assertion would hard-fail
--    that replay and block all future migration authoring (several migrations in this repo
--    carry "hand-authored, shadow-DB pass fails" comments from exactly that trap).
--    Asserting against the number of kennels PRESENT rather than a hard-coded 12 also
--    degrades sanely on a partially-seeded DB.
DO $$
DECLARE
  v_source_id       text;
  v_kennels_present int;
  v_linked          int;
BEGIN
  SELECT count(*) INTO v_kennels_present
  FROM "Kennel"
  WHERE "kennelCode" = ANY (ARRAY[
    'nych3', 'brh3', 'nah3', 'knick', 'lil', 'qbk', 'si', 'columbia',
    'harriettes-nyc', 'ggfm', 'nawwh3', 'drinking-practice-nyc'
  ]);

  IF v_kennels_present = 0 THEN
    RAISE NOTICE 'No HashNYC kennels present (pre-seed / shadow DB) — skipping post-state verification';
    RETURN;
  END IF;

  SELECT id INTO v_source_id FROM "Source"
  WHERE name = 'HashNYC Website' AND type::text = 'ICAL_FEED';
  IF v_source_id IS NULL THEN
    RAISE EXCEPTION 'HashNYC ICAL_FEED source missing — cutover incomplete, rolling back';
  END IF;

  SELECT count(*) INTO v_linked FROM "SourceKennel" WHERE "sourceId" = v_source_id;
  IF v_linked < v_kennels_present THEN
    RAISE EXCEPTION 'HashNYC ICAL_FEED linked to % of % present kennels — cutover incomplete, rolling back',
      v_linked, v_kennels_present;
  END IF;
END $$;

COMMIT;
