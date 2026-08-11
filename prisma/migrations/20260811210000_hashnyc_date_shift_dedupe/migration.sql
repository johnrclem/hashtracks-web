-- Remove HashNYC trails duplicated by a DATE CHANGE across the HTML -> iCal cutover.
--
-- Second duplicate class from the cutover. The first (20260811130000) was a RELABEL:
-- the same trail carried a different kennel prefix on each site (NASS #304 vs NAWW #396),
-- so it landed on two kennels. This one is a RESCHEDULE: the relaunched site moved a
-- trail to a different day but kept its run number, e.g.
--     LIL #152  2026-09-12 (old HTML site)  ->  2026-09-05 (live feed)
-- The merge pipeline keys on kennel + date, so the moved trail is created as a NEW
-- canonical event on the new date while the old row survives on the old date. Same
-- trail, listed twice, a week apart — and the stale copy can never be refreshed or
-- reconciled away because its only source is the now-disabled HTML scraper.
--
-- Written as a PREDICATE rather than a hard-coded row so any sibling produced by the
-- same cutover is caught too. Scope verified read-only against production before
-- writing: exactly one row matches (lil #152). It deliberately does NOT touch the six
-- other HTML-only future orphans (lil #154/#155, nych3 #2174-#2177) — those run numbers
-- appear nowhere in the feed, which currently stops at LIL #153 / NYC #2173. They are
-- real trails the old site had published further ahead, not duplicates, and when the
-- feed catches up the merge will match them on kennel + date and enrich them in place.
--
-- SAFETY — a row is deleted only when ALL hold:
--   * it is in the future, not CANCELLED, not a manual entry, and has a run number;
--   * it carries no attendance, check-ins, or event links;
--   * its ONLY provenance is the retired HashNYC HTML_SCRAPER (nothing live feeds it);
--   * a twin exists for the SAME kennel + SAME run number on a different date, and that
--     twin IS backed by a non-retired source — so the surviving copy is the live one and
--     the trail can never disappear from the site entirely.
-- Re-running matches nothing (the orphans are gone) and no-ops.

BEGIN;

DO $$
DECLARE
  v_ids       text[];
  v_kennels   text[];
  v_deleted   int;
BEGIN
  SELECT array_agg(e.id), array_agg(DISTINCT e."kennelId")
  INTO v_ids, v_kennels
  FROM "Event" e
  JOIN "Event" t
    ON  t."kennelId"  = e."kennelId"
    AND t."runNumber" = e."runNumber"
    AND t.id         <> e.id
    AND t.status::text <> 'CANCELLED'
    -- the survivor must be fed by something other than the retired scraper
    AND EXISTS (                                                                    -- NOSONAR plsql:S1138
      SELECT 1 FROM "RawEvent" tr
      JOIN "Source" ts ON ts.id = tr."sourceId"
      WHERE tr."eventId" = t.id
        AND NOT (ts.name = 'HashNYC Website' AND ts.type::text = 'HTML_SCRAPER')
    )
  WHERE e.date >= NOW()
    AND e.status::text <> 'CANCELLED'
    AND NOT e."isManualEntry"
    AND e."runNumber" IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM "Attendance" a        WHERE a."eventId"  = e.id)  -- NOSONAR plsql:S1138
    AND NOT EXISTS (SELECT 1 FROM "KennelAttendance" ka WHERE ka."eventId" = e.id)  -- NOSONAR plsql:S1138
    AND NOT EXISTS (SELECT 1 FROM "EventLink" el        WHERE el."eventId" = e.id)  -- NOSONAR plsql:S1138
    AND EXISTS (                                                                    -- NOSONAR plsql:S1138
      SELECT 1 FROM "RawEvent" re
      JOIN "Source" s ON s.id = re."sourceId"
      WHERE re."eventId" = e.id
        AND s.name = 'HashNYC Website' AND s.type::text = 'HTML_SCRAPER'
    )
    AND NOT EXISTS (                                                                -- NOSONAR plsql:S1138
      SELECT 1 FROM "RawEvent" r2
      JOIN "Source" s2 ON s2.id = r2."sourceId"
      WHERE r2."eventId" = e.id
        AND NOT (s2.name = 'HashNYC Website' AND s2.type::text = 'HTML_SCRAPER')
    );

  IF v_ids IS NULL OR array_length(v_ids, 1) IS NULL THEN
    RAISE NOTICE 'No date-shifted HashNYC duplicates found — nothing to do';
    RETURN;
  END IF;

  -- Detach the immutable RawEvents. `processed = true` (NOT false) is deliberate:
  -- false would re-queue them for the merge pipeline and re-create the rows we are
  -- deleting. Keeping the rows preserves the audit trail of the original ingest.
  UPDATE "RawEvent" SET "eventId" = NULL, processed = true WHERE "eventId" = ANY (v_ids);

  UPDATE "Event" SET "parentEventId" = NULL WHERE "parentEventId" = ANY (v_ids);

  DELETE FROM "EventHare"   WHERE "eventId" = ANY (v_ids);
  DELETE FROM "EventKennel" WHERE "eventId" = ANY (v_ids);
  DELETE FROM "Event"       WHERE id        = ANY (v_ids);
  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  -- Recompute the cached lastEventDate for every affected kennel. Mirrors
  -- backfillLastEventDates() in src/pipeline/backfill-last-event.ts exactly — unions
  -- the primary FK with EventKennel co-host secondaries and applies all three display
  -- filters incl. `isCanonical` — so the daily audit cron agrees with us. The outer
  -- LEFT JOIN preserves NULL-reset semantics.
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
    WHERE k2.id = ANY (v_kennels)
  ) sub
  WHERE k.id = sub."kennelId"
    AND k."lastEventDate" IS DISTINCT FROM sub."maxDate";

  RAISE NOTICE 'Deleted % date-shifted HashNYC duplicate(s); live copies retained', v_deleted;
END $$;

COMMIT;
