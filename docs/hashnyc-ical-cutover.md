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

```text
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
- `prisma/migrations/20260811130000_hashnyc_friendsgiving_dedupe/` — deletes the
  orphaned duplicate of the 2026-11-14 trail and adds the fail-loud post-state
  assertion the first migration could no longer carry (see below).
- `src/adapters/ical/adapter.ts` — `maps.app.goo.gl` in `MAPS_URL_PATTERN`, and a
  maps-shaped `URL:` property routes to `locationUrl` instead of `sourceUrl`
  (shipped earlier in #2541).
- `src/adapters/ical/adapter.test.ts` — `describe("ICalAdapter — HashNYC …")`, covering
  all 12 routed kennels including the five dormant ones.

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

### The 2026-11-14 Friendsgiving duplicate (fixed in a follow-up migration)

Prod held `NASS #304` → `nah3` on 2026-11-14 (ingested from the old HTML scraper); the
relaunched feed calls that same date + theme `NAWW #396` → `nawwh3`. Because the merge
pipeline keys on kennel + date, the two labels produce two separate canonical events and
2026-11-14 showed the **same trail on both kennel pages**, with the `nah3` copy orphaned
on the retired source.

Corroborating signals for treating it as one trail: identical date, identical theme, and
a 14:00 start matching the NAWW series exactly. The feed carries no `NASS` events at all
any more, so the series appears to have been consolidated upstream.

**Why it took two migrations.** The plan was to *re-home* the `nah3` row onto `nawwh3`
inside the cutover migration, preserving its `Event` id. That never happened, because
`20260810120000` had **already been applied to production by a Vercel preview build of
this PR** (`finished_at` 2026-08-11 00:56 UTC) before the re-home was written — see the
warning below. By then the live feed had already created the `nawwh3` row on its own, so
re-homing was moot and the correct cleanup became a *delete* of the orphan.

`20260811130000_hashnyc_friendsgiving_dedupe` therefore deletes the `nah3` copy and
recomputes both kennels' `lastEventDate`. The delete is heavily guarded and skips with a
`NOTICE` unless all hold: the row is the expected non-manual nah3/2026-11-14/#304 event,
it carries no attendance / check-ins / event links, **its only source is the retired HTML
scraper**, and `nawwh3` already holds a live event that day — so the trail can never
vanish from the site. Its two RawEvents are detached with `processed = true` (not
`false`, which would re-queue them and re-create the row) and kept as audit trail.

Verified on a prod-copy DB: 2 events → 1 (`nawwh3 #396`), `nah3.lastEventDate` correctly
falls back to 2026-02-22, re-run is a clean no-op, and running the real scrape + merge
pipeline against the live feed afterwards leaves it at 1 — the `nah3` copy does not
resurrect.

### Second duplicate class: a trail that changed date (`20260811210000`)

The cutover produced two *different* kinds of duplicate. The Friendsgiving one above was
a **relabel** — the same trail carried a different kennel prefix on each site, so it
landed on two kennels. The other is a **reschedule**: the relaunched site moved a trail
to a different day but kept its run number.

```text
LIL #152   2026-09-12 (old HTML site)  ->  2026-09-05 (live feed)
```

Because merge keys on kennel + date, the moved trail is created as a new canonical event
on the new date while the old row survives on the old one — same trail, listed twice, a
week apart, and the stale copy can never be refreshed or reconciled away because its only
source is the disabled HTML scraper.

`20260811210000_hashnyc_date_shift_dedupe` deletes these. It is written as a **predicate**
rather than a hard-coded row, so any sibling from the same cutover is caught: delete a
future, non-manual, run-numbered event with no attendance/check-ins/links whose *only*
provenance is the retired HTML scraper, **when a twin with the same kennel + run number
exists on another date and that twin is backed by a live source**. The twin requirement
is what makes it safe — the surviving copy is always the live one.

**What it deliberately does not touch.** Six other HTML-only future orphans exist
(`lil #154`/`#155`, `nych3 #2174`-`#2177`). Their run numbers appear *nowhere* in the
feed, which currently stops at `LIL #153` / `NYC #2173` — the old site simply published
further ahead than the new feed does. They are real trails, not duplicates; when the feed
catches up, merge will match them on kennel + date and enrich them in place. Verified: after
the migration all six survive and **zero** duplicate run numbers remain across the 12 NYC
kennels.

> ⚠️ **Vercel preview builds run `prisma migrate deploy` against the production
> database.** A migration in an open PR is applied to prod at preview-build time, before
> review or merge. Once that happens the file is immutable: editing it changes its
> checksum and every later `migrate deploy` fails with a checksum mismatch, blocking all
> deploys. That is exactly what happened here — the fix was to restore
> `20260810120000` byte-for-byte to the applied version and move the follow-up work into
> a new migration. **Never edit a migration after pushing it to an open PR.**

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
