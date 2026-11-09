-- Harrier Central title clean-up from the Nov 7-8 audit.
--   Abuja H3 (#2793): strip a leading "Run#680:" / "RUN 815 -"; a bare "Run#684" falls
--   back to "Abuja H3 Trail #684".
--   Big Lik H3 (#2817): also match "UN#728" with no space before the "#".
-- DATA-ONLY and idempotent. prisma/seed-data/sources.ts carries the same values.

UPDATE "Source"
SET config = config || '{"defaultTitle": "Abuja H3 Trail", "titleStripPatterns": ["^run\\s*#?\\s*\\d+\\s*[:\\-–]?\\s*"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Abuja H3 Harrier Central' AND type = 'HARRIER_CENTRAL';

UPDATE "Source"
SET config = config || '{"titleStripPatterns": ["^un\\s*#\\s*\\d+[\\s-]*"]}'::jsonb,
    "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'Big Lik H3 Harrier Central' AND type = 'HARRIER_CENTRAL';
