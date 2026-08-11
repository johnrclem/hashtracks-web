# HashNYC: HTML scraper → iCal feed cutover

**Status: SHIPPED (2026-08-10).** hashnyc.com now runs a "hash-attendance" app that
publishes a structured iCal feed. The source moved from the bespoke
`HashNYCAdapter` HTML scraper to the shared `ICalAdapter` (config only — no new
adapter code). The legacy HTML_SCRAPER row is retired.

Timeline: the relaunch first appeared in early July 2026 and this cutover was
prepared then, but the site **reverted to the old HTML layout** before it could ship,
so the work was parked in this doc. The relaunch went live for good in August and the
cutover was applied — with the routing re-verified against the live feed, which had
changed shape in the interim (see "Relaunch gotchas").

## Why iCal over patching the HTML scraper

The old scraper parsed `table.past_hashes` / `table.future_hashes`. **Both tables are
gone** from the relaunched site (verified 2026-08-10), so that adapter can no longer
see any events. The feed is also far better structured than the HTML ever was: kennel
is a reliable `SUMMARY` prefix, hares + hash cash are labelled lines in `DESCRIPTION`,
venue is a first-class `LOCATION`, and map pins arrive as `maps.app.goo.gl` links.

```
SUMMARY:NYC #2154
LOCATION:Malt & Mold, 362 Second Ave
DESCRIPTION:Hares: Gabe the Babe\nHash Cash: $3\nMap: https://maps.app.goo.gl/…
```

## What shipped

- `prisma/seed-data/sources.ts` — "HashNYC Website" is now `ICAL_FEED` at
  `https://hashnyc.com/public/hareline.ics` with `kennelPatterns` + `upcomingOnly`,
  plus a disabled legacy `HTML_SCRAPER` entry (seed identity is `(name, type)`, so
  the two rows coexist and a re-seed holds the old one disabled).
- `prisma/migrations/20260810120000_cutover_hashnyc_html_to_ical/` — **atomic**:
  provisions the ICAL_FEED row + its 12 `SourceKennel` links **and** disables the
  legacy row in one transaction. Vercel runs `migrate deploy`, never `db seed`, so a
  disable-only migration would have taken hashnyc dark until someone hand-seeded.
- `src/adapters/ical/adapter.ts` — `maps.app.goo.gl` in `MAPS_URL_PATTERN`, and a
  maps-shaped `URL:` property routes to `locationUrl` instead of `sourceUrl`
  (shipped earlier in #2541).
- `src/adapters/ical/adapter.test.ts` — `describe("ICalAdapter — HashNYC …")`.

`src/adapters/html-scraper/hashnyc.ts` was **kept**: it is still the default
HTML_SCRAPER factory in `src/adapters/registry.ts` for sources with no URL-pattern
match.

## Relaunch gotchas (the reason to re-verify before trusting a saved config)

The feed's labels changed between the July capture and the August launch. Anyone
touching this routing again should re-run the live check rather than trust the
patterns on faith.

| July capture | August (live) | Effect |
|---|---|---|
| `NYCH3 #2150` | `NYC #2154` | "H3" suffix dropped |
| `Brooklyn H3 #1185` | `Brooklyn #1185` | "H3" suffix dropped |
| `NAH3 #391` | `NAWW #391` | **different kennel** |
| — | `QBK #73` | new abbreviation alongside `Queens #249` |

The patterns match both spellings (`^NYC(?:H3)?\b`, `^Brooklyn(?:\s+H3)?\b`) because
historical rows in the DB still carry the legacy form.

**The `NAH3` → `NAWW` change mattered.** Same run number, same date (2026-06-14), same
venue — but `NAH3` routes to `nah3` and `NAWW` routes to `nawwh3`, which are *distinct
kennels*. Prod already held `NAWW #387-393` on `nawwh3` (from the old scraper), so the
August label is the correct one and the July snapshot would have split the series
across two kennels. Ordering rule: **`^NAWW…` must precede `^New Amsterdam|^NAH3|^NASS`**,
and `^Queens Black Knights|^QBK` must precede the generic `^Queens`.

The two New Amsterdam series are genuinely separate and both live:
`nawwh3` = "NAWW #NNN" (monthly, #387-393), `nah3` = "NASS #NNN" (seasonal, #298-304).

### Resolved in the same migration: the 2026-11-14 Friendsgiving duplicate

Prod held `NASS #304` → `nah3` on 2026-11-14 (ingested from the old HTML scraper); the
relaunched feed calls that same date + theme `NAWW #396` → `nawwh3`. Because the merge
pipeline keys on kennel + date, leaving both would have surfaced the **same trail twice**,
once per kennel page, with the `nah3` copy orphaned on a retired source.

Step 4 of the cutover migration **re-homes** that row (`nah3` → `nawwh3`, run 304 → 396,
title → "Friendsgiving 2026") rather than deleting it. Re-homing keeps the `Event` id, so
the incoming iCal RawEvent merges into it and *enriches* it (hares, cost) instead of
creating a second row — and there is never a window where the trail is missing. It
carried no attendance, check-ins, or hares, so nothing was at risk; the migration still
guards on all of those and skips with a NOTICE if any appear before deploy, if the row is
a manual entry, or if `nawwh3` already holds an event that day. Both kennels'
`lastEventDate` are recomputed.

Corroborating signals for treating it as one trail: identical date, identical theme, and
a 14:00 start matching the NAWW series exactly. The feed carries no `NASS` events at all
any more, so the series appears to have been consolidated upstream.

Verified end-to-end on a prod-copy DB: after the migration, running the real
scrape + merge pipeline against the live feed left **exactly one** event on 2026-11-14
(`nawwh3 #396`, enriched with hares + cost, same `Event` id).

## Verification performed (2026-08-10)

- **Live feed:** 62 events, 2026-06-14 → 2026-12-21, **0 errors, 0 unrouted**.
  Distribution nych3 26 / brh3 16 / ggfm 7 / nawwh3 6 / lil 5 / qbk 2 — every routed
  kennel is linked to the source. Coverage: startTime 100%, runNumber 90%, cost 84%,
  hares 53%, location 42%; 19 `maps.app.goo.gl` pins on `locationUrl`, 0 leaking into
  `sourceUrl`. (The verify script reads `kennelPatterns` straight out of the seed, so
  what was tested is what ships.)
- **Migration** applied to a local prod-copy DB: creates 1 source + 12 links, disables
  the legacy row; re-run is a clean no-op (`INSERT 0 0`, `UPDATE 0`).
- **JSONB escaping:** `"\\b"` in the SQL literal stores as `\b` (regex word boundary,
  not a JSON backspace) — confirmed through the DB → `config::text` → `JSON.parse` →
  `RegExp` round-trip, with all routing cases passing off the *stored* config.
- `npx tsc --noEmit && npm run lint && npm test`.

## Notes

- **Titles:** a colon-less summary (`NYC #2154`, `NYC Beer Mile`) is kept verbatim as
  the title — same as every other iCal source (e.g. SFH3's `GPH3 #1700`). Colon events
  get clean titles ("Cold Moon"). Accepted by the owner.
- Existing canonical Events (kennel + date keyed) are enriched/re-merged by the iCal
  source, not duplicated; the old immutable RawEvents remain as audit trail.
- Dormant kennels (`knick`, `si`, `columbia`, `harriettes-nyc`, `drinking-practice-nyc`)
  stay linked even though they publish nothing in the current window — the merge guard
  blocks events for unlinked kennels, and their patterns are still in place for when
  they return.
