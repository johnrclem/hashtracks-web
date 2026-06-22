-- Profile + audit corrections: #2256 (SF H3 logo + contact), #2001/#2117 (Capital H3
-- improbable-time suppression), #1416 (AH4 website).
--
-- DATA-ONLY. `ensureKennelRecords` only NULL-fills and Vercel never seeds, so value
-- changes are applied here. Idempotent guards throughout.

BEGIN;

-- ─── #2256 SF H3 (sfh3): logo + hare-line contact email ─────────────────────────
-- Source header exposes a stable, token-free logo (verified 200 image/png); the only
-- public contact the source surfaces is the hare-raiser address. Set the logo (value
-- correction) and fill the contact email when empty (don't stomp an admin edit).
UPDATE "Kennel"
SET "logoUrl" = 'https://www.sfh3.com/local/images/newlogo-square-172-sharpened.png', "updatedAt" = NOW()
WHERE "kennelCode" = 'sfh3'
  AND "logoUrl" IS DISTINCT FROM 'https://www.sfh3.com/local/images/newlogo-square-172-sharpened.png';

UPDATE "Kennel"
SET "contactEmail" = 'hareraiser@sfh3.com', "updatedAt" = NOW()
WHERE "kennelCode" = 'sfh3' AND "contactEmail" IS NULL;

-- ─── #2001 / #2117 Capital H3 (capital-h3-au): suppress event-improbable-time ────
-- The source GCal already carries timezone=Australia/Sydney and extracts times correctly
-- (545 @ 18:00, 62 @ 15:00, …). Exactly one event (#2404, 2026-07-19) was authored at
-- 03:00 in the calendar — an upstream data-entry error, not a pipeline bug, and re-scrape
-- would just re-ingest it. Suppress the recurring flag for this kennel+rule.
INSERT INTO "AuditSuppression" (id, "kennelCode", rule, reason, "createdBy", "createdAt")
VALUES (
  'sup_2001_capital_improbable_time',
  'capital-h3-au',
  'event-improbable-time',
  'Adapter correct; source data-entry error (#2001/#2117). The GCal already sets timezone=Australia/Sydney and times extract correctly; a single event (Trail #2404, 2026-07-19) was authored at 03:00 in the source calendar. Not a pipeline bug — suppress.',
  'migration:20260622120200',
  NOW()
)
ON CONFLICT ("kennelCode", rule) DO NOTHING;

-- ─── #1416 AH4 (ah4): reachable website (HTTP-only policy) ───────────────────────
-- https://board.atlantahash.com hangs from every network we test; the HTTP root loads
-- on residential connections and is the canonical reachable surface. Plain <a href> HTTP
-- links carry no mixed-content risk. (The dead board source is tracked in #2054.)
UPDATE "Kennel"
SET "website" = 'http://atlantahash.com', "updatedAt" = NOW()
WHERE "kennelCode" = 'ah4' AND "website" IS DISTINCT FROM 'http://atlantahash.com';

COMMIT;
