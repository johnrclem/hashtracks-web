# HashNYC: HTML scraper → iCal feed cutover (DEFERRED)

**Status:** Ready to apply, on hold. hashnyc.com relaunched a new WordPress site in
mid-2026 that published a clean iCal feed, but as of 2026-07-04 the site **reverted
to the old HTML layout** and the `.ics` endpoint 404s. The current bespoke
`HashNYCAdapter` (`src/adapters/html-scraper/hashnyc.ts`) still works against the old
site and must stay enabled. Resume this cutover when they re-launch and the feed is
live again.

**Trigger to resume:** `curl -sSL https://hashnyc.com/public/hareline.ics` returns a
`BEGIN:VCALENDAR` body (not a WordPress 404 page) with upcoming `VEVENT`s.

## Why iCal over patching the HTML scraper

The relaunched feed is far better structured than scraping HTML — kennel is a reliable
`SUMMARY` prefix, hares + hash cash sit in `DESCRIPTION`, venue is a first-class
`LOCATION`, and Google Maps pins arrive as `maps.app.goo.gl` links. The shared
`ICalAdapter` already handles all of it via config (`kennelPatterns`, default hare /
cost extraction, `LOCATION` → venue). No new adapter code is needed — it's a config
swap plus a retirement migration.

Live feed sample captured at session start (2026-07-03), when the endpoint was up:

```
SUMMARY:NYCH3 #2153
LOCATION:Malt & Mold, 362 Second Ave
DESCRIPTION:Hares: Cheeky Bastard, Just Elizabeth\nHash Cash: $3\nMap: https://maps.app.goo.gl/…
```

The live fetch returned **53 events (2026-05 → 2026-12), 0 errors, 0 unrouted**, split
nych3 21 / brh3 16 / ggfm 7 / lil 5 / nah3 3 / qbk 1.

## Already merged with this work (do NOT redo)

The shared iCal adapter improvements landed independently and are safe/general:

- `src/adapters/ical/adapter.ts` — `MAPS_URL_PATTERN` recognizes `maps.app.goo.gl`;
  a maps-shaped `URL:` property routes to `locationUrl` (preferred over the
  name-search fallback) instead of leaking into `sourceUrl`.
- `src/adapters/ical/adapter.test.ts` — the `describe("ICalAdapter — HashNYC …")`
  block: fixture-based regression coverage for the multi-kennel routing (incl. the
  nawwh3-vs-nah3 ordering) and the map-link support. It runs today and passes.

## To resume the cutover — 2 changes

### 1. Seed: swap the HashNYC source to ICAL_FEED + add a disabled legacy entry

In `prisma/seed-data/sources.ts`, replace the single HTML_SCRAPER "HashNYC Website"
entry with these two (identity is `(name, type)`, so they're distinct rows):

```ts
{
  name: "HashNYC Website",
  url: "https://hashnyc.com/public/hareline.ics",
  type: "ICAL_FEED" as const,
  trustLevel: 8,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: {
    upcomingOnly: true, // forward hareline; receding events aren't cancellations (#1263)
    // Ported from the old adapter's KENNEL_PATTERNS, anchored to SUMMARY start,
    // most-specific first (first match wins): "Queens Black Knights" before
    // generic "Queens"; "NAWW" (nawwh3) distinct from "New Amsterdam" (nah3).
    kennelPatterns: [
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
      ["^NYC(?:H3)?\\b", "nych3"],
    ],
    defaultKennelTag: "nych3",
  },
  kennelCodes: ["nych3", "brh3", "nah3", "knick", "lil", "qbk", "si", "columbia", "harriettes-nyc", "ggfm", "nawwh3", "drinking-practice-nyc"],
},
{
  // Retired legacy HTML scraper — kept disabled so re-seeds hold it disabled and it
  // isn't flagged as a stale source (seed identity is (name, type)).
  name: "HashNYC Website",
  url: "https://hashnyc.com",
  type: "HTML_SCRAPER" as const,
  enabled: false,
  trustLevel: 8,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: { upcomingOnly: true },
  kennelCodes: ["nych3", "brh3", "nah3", "knick", "lil", "qbk", "si", "columbia", "harriettes-nyc", "ggfm", "nawwh3", "drinking-practice-nyc"],
},
```

Keep `src/adapters/html-scraper/hashnyc.ts` — it's still the default HTML_SCRAPER
fallback in `src/adapters/registry.ts` (`HTML_SCRAPER: () => new HashNYCAdapter()`).

### 2. Companion migration: ATOMIC provision + retire (create a new timestamped dir)

Vercel runs `prisma migrate deploy`, never `db seed`, so the migration must both
**create** the replacement ICAL_FEED row + its SourceKennel links **and** disable the
old HTML_SCRAPER row in one transaction — otherwise the deploy disables the working
HTML source and leaves hashnyc with no enabled source until an operator runs the seed.
(This gap was caught by an adversarial review; the fix mirrors
`prisma/migrations/20260622120100_onboard_fool_moon_h3_644/`.)

Create `prisma/migrations/<new-ts>_cutover_hashnyc_html_to_ical/migration.sql`:

```sql
BEGIN;

-- 1. Provision the replacement ICAL_FEED source (create if absent; leave any
--    existing / seed-converged row untouched). Config mirrors the seed row.
--    JSONB escaping note: write "\\b" in the SQL literal → jsonb stores "\b"
--    (backslash+b, a regex word boundary), NOT a JSON backspace. Verified via
--    DB→config::text→JSON.parse→RegExp round-trip (word boundary, no 0x08).
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

-- 2. Link the 12 kennels the feed routes to (merge source-kennel guard).
INSERT INTO "SourceKennel" (id, "sourceId", "kennelId")
SELECT 'sk_hashnyc_ical_' || k."kennelCode", s.id, k.id
FROM "Source" s
JOIN "Kennel" k ON k."kennelCode" = ANY (ARRAY[
  'nych3', 'brh3', 'nah3', 'knick', 'lil', 'qbk', 'si', 'columbia',
  'harriettes-nyc', 'ggfm', 'nawwh3', 'drinking-practice-nyc'
])
WHERE s.name = 'HashNYC Website' AND s.type::text = 'ICAL_FEED'
ON CONFLICT ("sourceId", "kennelId") DO NOTHING;

-- 3. Retire the legacy HTML_SCRAPER row (only while still enabled → idempotent).
UPDATE "Source"
SET enabled = false, "updatedAt" = NOW() AT TIME ZONE 'UTC'
WHERE name = 'HashNYC Website' AND type::text = 'HTML_SCRAPER' AND enabled = true;

COMMIT;
```

(The full authored version also RAISE NOTICEs when the ICAL row / a kennel link /
the legacy row is missing — nice-to-have, not required. See git history of this branch
for the annotated copy if needed.)

## Post-resume validation (all passed on 2026-07-03 dry run)

1. `npm test src/adapters/ical/adapter.test.ts` — HashNYC block green.
2. Live: build a `Source` from the config and run `new ICalAdapter().fetch(source)` —
   confirm non-empty, 0 unrouted, hares/cost/location/run# populated, `maps.app.goo.gl`
   → `locationUrl` (0 leaking into `sourceUrl`). (8 of the 53 events had a map pin.)
3. Apply the migration to the local prod-copy DB (`.claude/rules/local-dev-db.md`):
   confirm it creates 1 source + 12 links, disables the old row, and is idempotent on
   re-run (`INSERT 0 0`). All verified during the original work.
4. `npx tsc --noEmit && npm run lint && npm test`.

## Notes / decisions from the original work

- **Titles:** plain `NYCH3 #2150` (no colon) keeps the summary as the title — same as
  every other iCal source (e.g. SFH3 `GPH3 #1700`); colon events get clean titles
  ("Cold Moon"). Accepted as-is by the owner.
- **Existing canonical Events** (kennel+date keyed) are enriched/re-merged by the iCal
  source, not duplicated; old immutable RawEvents from the HTML source stay as audit.
- **Seed identity is `(name, type)`** and the stale-source reconcile is opt-in
  (`SEED_RECONCILE_DISABLE`), which is why the migration — not the seed — is what
  actually retires the old row in prod.
