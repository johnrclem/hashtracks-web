-- Profile corrections: #2571 (DAFT H3 frequency Weekly→Monthly), #2581 (Lune Valley H3
-- hash-cash full-moon/junior rates), #2538 (Aberdeen H3 seasonal schedule note).
--
-- DATA-ONLY. `ensureKennelRecords` only NULL-fills and Vercel never seeds, so value
-- changes to already-populated columns are applied here. `updatedAt` is
-- `timestamp without time zone`, so stamp it with UTC wall-clock. Idempotent guards
-- throughout (IS DISTINCT FROM the new value → re-run touches 0 rows).

BEGIN;

-- ─── #2571 DAFT H3 (dafth3): frequency Weekly → Monthly ──────────────────────────
-- edinburghh3.com + genealogy.gotothehash.net both state monthly (first Tuesday); the
-- captured run history (#692–#696) is ~1 month apart. "Weekly" was a stale default.
UPDATE "Kennel"
SET "scheduleFrequency" = 'Monthly', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'dafth3' AND "scheduleFrequency" IS DISTINCT FROM 'Monthly';

-- ─── #2581 Lune Valley H3 (lvh3-gb): full hash-cash rates ────────────────────────
-- lvh3.org.uk verbatim: first run free, then £3 adults (daytime) / £2 full moon / £1
-- juniors. The prior "£3" captured only the daytime adult rate.
UPDATE "Kennel"
SET "hashCash" = '£3 adults (daytime) / £2 full moon / £1 juniors; first run free', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'lvh3-gb'
  AND "hashCash" IS DISTINCT FROM '£3 adults (daytime) / £2 full moon / £1 juniors; first run free';

-- ─── #2538 Aberdeen H3 (aberdeen-h3): seasonal schedule note ─────────────────────
-- aberdeenhhh.com: "On Sundays at 11am in the winter and on Mondays at 7pm in the
-- summer." The flat Monday/7pm fields stay (current summer default); the note now
-- captures the winter Sunday slot.
UPDATE "Kennel"
SET "scheduleNotes" = 'Seasonal: Mondays 7:00 PM in summer, Sundays 11:00 AM in winter.', "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE "kennelCode" = 'aberdeen-h3'
  AND "scheduleNotes" IS DISTINCT FROM 'Seasonal: Mondays 7:00 PM in summer, Sundays 11:00 AM in winter.';

COMMIT;
