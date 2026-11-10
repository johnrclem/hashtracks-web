-- Alert fixes (2026-11-10): two Hash Rego events were blocked as UNMATCHED_TAGS.
--   * Party Gras! 2027 (2027-02-19..21): Hash Rego's T3H3 account is named
--     "Tuesday, Tuesday, Tuesday" (the commas form of t3h3-va's name).
--   * FCH3 Weekend 2027 (2027-06-25): the detail page's host is "Flour City Hash House
--     Harriers", flour-city's fullName, which the resolver never matches.
--
-- The adapter fetches only accounts with a SourceKennel externalSlug, and tags each event
-- with the detail page's host display name, so t3h3-va needs a Hash Rego link with
-- externalSlug 'T3H3' as well as the alias. Linking can't cancel existing t3h3-va runs:
-- Hash Rego reconciles forward-only (upcomingOnly) and every Tidewater-fed run keeps a
-- RawEvent from the Tidewater source.
--
-- DATA-ONLY, idempotent. Mirrors prisma/seed-data/{sources,aliases}.ts. Touches only the
-- t3h3-va link; prod's other Hash Rego links are left as they are.

BEGIN;

INSERT INTO "SourceKennel" (id, "sourceId", "kennelId", "externalSlug")
SELECT 'sk_hashrego_t3h3_va', s.id, k.id, 'T3H3'
FROM "Source" s, "Kennel" k
WHERE s.name = 'Hash Rego' AND s.type = 'HASHREGO'::"SourceType"
  AND k."kennelCode" = 't3h3-va'
ON CONFLICT ("sourceId", "kennelId") DO UPDATE
  SET "externalSlug" = EXCLUDED."externalSlug"
  WHERE "SourceKennel"."externalSlug" IS DISTINCT FROM EXCLUDED."externalSlug";

INSERT INTO "KennelAlias" (id, "kennelId", alias)
SELECT t.id, k.id, t.alias
FROM "Kennel" k
JOIN (VALUES ('ka_t3h3va_hr_commas', 't3h3-va', 'Tuesday, Tuesday, Tuesday'),
             ('ka_flourcity_fullname', 'flour-city', 'Flour City Hash House Harriers'))
       AS t(id, code, alias) ON k."kennelCode" = t.code
ON CONFLICT ("kennelId", alias) DO NOTHING;

COMMIT;
