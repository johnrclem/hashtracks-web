-- R6 resolver hygiene (docs/kennel-directory-mapping-review.md): the resolver's
-- global regex list is gone; it now applies each source's own
-- config.kennelPatterns. Hash Rego's "Ben Franklin Mob H3" host name was the
-- only live tag that needed the old global `ben franklin|bfm` rule (38 raws,
-- 2026-07..2027-03), so add that rule to the Hash Rego source.
BEGIN;
SET LOCAL lock_timeout = '5s';

-- Idempotent: appends only while the pattern is absent.
UPDATE "Source"
SET config = jsonb_set(
  config,
  '{kennelPatterns}',
  COALESCE(config->'kennelPatterns', '[]'::jsonb) || '[["^Ben Franklin Mob\\b", "bfm"]]'::jsonb
)
WHERE type = 'HASHREGO'
  AND name = 'Hash Rego'
  AND config IS NOT NULL
  AND NOT (COALESCE(config->'kennelPatterns', '[]'::jsonb) @> '[["^Ben Franklin Mob\\b", "bfm"]]'::jsonb);

COMMIT;
