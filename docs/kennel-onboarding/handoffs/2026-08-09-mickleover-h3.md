# Onboarding Handoff — Mickleover H3 (East Midlands / Derby, England) — 2026-08-09

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/mickleover-h3-20260809`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). If the **East Midlands**
>    METRO isn't seeded yet, add it as noted in **Adapter notes → Region** (mirror the Quorn H3
>    handoff's block EXACTLY — both handoffs create the same METRO; do NOT create a second variant).
> 3. Configure the source (**config-only `GOOGLE_SHEETS`** — the `GoogleSheetsAdapter` already exists).
>    The one design wrinkle is skipping the winter "social only" rows — see **Adapter notes**; the
>    recommended fix is a small opt-in `requireRunNumber` flag on `GoogleSheetsConfig` (~5–10 LoC +
>    test), with a pure-config fallback documented.
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` —
>    call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'`. Resolve every `⚠️ Claude Code
>    must confirm` item in **Live source verification**. Validate: events non-empty + include the
>    upcoming #362 (2026-08-10) and deep past, dates UTC-noon, `startTime` "19:15", `kennelTag`
>    resolves to `mickleover-h3` with no unmatched, and the winter "social only" rows are dropped.
>    **DO NOT run `npx prisma db seed` here.**
> 5. Historical backfill: **none needed as a separate script** — the sheet is a full archive and the
>    adapter self-backfills the whole 1993→present log with a wide `scrapeDays` (see **Historical
>    backfill**). Confirm the full ~360-run pull at live-verify.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive checklist.
> 8. **Post-merge runbook (separate step, after the PR merges):**
>    - `git checkout main && git pull`
>    - Verify each expected file landed on `main` (`git log -1 -- <path>` for the adapter/seed/region files).
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive)
>    - Trigger a scrape from `/admin/sources` to publish events to prod
>    - Spot-check `hashtracks.xyz/kennels/mickleover-h3` for ~360 runs + next run 2026-08-10.
> Everything you need is in the sections that follow.

## Summary
- Type: **full onboard**
- Adapter: **GOOGLE_SHEETS** (config-only — `GoogleSheetsAdapter` exists AND the CSV feed is verified
  working). One small opt-in adapter flag (`requireRunNumber`) recommended for clean row-skipping.
- Effort estimate: **config-only source config + ~5–10 LoC opt-in `requireRunNumber` flag + 1 test**
  (a pure-config fallback via `silentlySkipPatterns` is documented if you'd rather ship zero adapter
  code — see **Adapter notes**). Far cheaper than a new adapter. **0 region.ts edits if the Quorn H3
  handoff's East Midlands METRO merges first; else 2 edits.**
- One-line: First **Mickleover / Derby** kennel and the second **East Midlands** kennel — a large,
  33-year-old (est. 1993) monthly Derby hash whose complete run log (run #1 1993 → #362 2026) lives
  in a public Google Sheet with a genuine upcoming run tomorrow.

## Dedup result
- Kennel in seed: **no** (`grep -rin "mickleover" prisma/ src/` → 0 hits)
- Source in seed: **no**
- Live sitemap dedup: **confirmed NOT live** — read via Chrome MCP, **491 slugs** (2026-08-09); no
  `mickleover` / `mickleover-h3` slug (the only `*mh3*` hits are Munich/Montreal/Minneapolis/etc.).
  `/kennels/mickleover-h3` renders a **real 404** (Chrome-rendered, `title: "404: This page could not
  be found."`).
- Decision: **full onboard**
- kennelCode: `mickleover-h3` (collision check: bare `mh3` shortName is globally taken —
  `mh3-mn`/`mh3-de`/`mh3-ca` + Miami/Madrid/Memphis/Morgantown/Manila/Dubai all suffix it; `mh3-gb`
  is reserved by the **Manchester H3** handoff. City-based `mickleover-h3` is grep-clean. **Bare "MH3"
  alias OMITTED.**)

## Live source verification  ✅
- Source: **GOOGLE_SHEETS** — "MH3 Full Run log" tab of the public sheet
  `1oZFMbkKFQp2rBM3x4LUt9vGOImCbsFOnyriQdO6xSCg`.
  - Adapter URL (the tab that holds the full log): `.../export?format=csv&gid=0`
    (feed HEAD-check: **HTTP 200 `content-type: text/csv`** — fetched the real CSV, 362 data rows).
  - ⚠️ **Non-obvious gid mapping — confirm at build:** the sheet has two tabs. **`gid=0` = "MH3 Full
    Run log"** (the archive + next run — this is the source). **`gid=1624247485` = "Next run"** (a
    single-cell form that shows `#N/A` when no hare is booked — do NOT use it). This is inverted from
    the usual "gid=0 is the first visible tab" assumption; the export URLs above were each fetched to
    confirm which is which. Use `gid=0`.
- Events seen: **362 numbered runs** (plus ~8 un-numbered winter "social only" rows to skip), date
  range **1993-05-10 (#1) → 2026-08-10 (#362)**.
- **Source-count parity:** the sheet returns the *entire* archive on every fetch (full-archive feed),
  so with a wide `scrapeDays` the adapter yields all ~362 numbered runs → parity ~100%. No pagination.
- **Recently-active / upcoming:** NOT a 0-upcoming case — **#362 is 2026-08-10 (Monday, tomorrow)**,
  a genuine upcoming run. The kennel runs numbered trails ~monthly Apr–Sep and holds un-numbered pub
  "socials" over winter. Cadence over the last season: #359 13-Apr-26, #360 11-May-26, #361 20-Jul-26,
  #362 10-Aug-26 (monthly-ish Mondays; June skipped).
- Sample events (VERBATIM from the sheet — run numbers and hares are real, no theme titles exist):
  1. **#362 — 2026-08-10 (upcoming)** — White Lion Inn, 24 Middle Street, **Beeston, NG9 1FX** — hare "Captain Oats"
  2. **#361 — 2026-07-20** — Red Cow, 2 St Edmunds Close, **Allestree, DE22 2DZ** — hare "Organ Stops" — info "4K walk/run"
  3. **#360 — 2026-05-11** — Chequers Inn, 27 High St, **Ticknall, DE73 7JH** — hares "Oriface & Gobalot" — info "Cougar trail…"
  4. **#359 — 2026-04-13** — The Malt Shovel, 49 The Wharf, **Shardlow, DE72 2HG** — hare "Butchers Dog" — info "First run of the year"
  5. **#358 — 2025-09-08** — The Swan, Fradley Junction, **Alrewas, DE13 7DW** — hare "Captain Oates"
  6. Oldest — **#1 — 1993-05-10** — Three Horseshoes, **Thurvaston, DE6 5BL** — hares "Dobber & Rawhide" (att. 29)
- **NO run numbers missing from titles**: there are **no theme titles** in the sheet. Leave `title`
  undefined → `merge.ts` synthesizes "Mickleover H3 Trail #N". Info-column notes ("Xmas hash",
  "Butcher's Birthday", "30th Anniversary") are NOT themes → route to `description` only.
- History depth / pagination: **single CSV, full archive, ~362 runs 1993→2026** (no pagination).
- Coord sanity: **no coords** — the `GoogleMaps` column is either a duplicate of the pub name or a
  bare search URL (`http://maps.google.co.uk/maps?q=<postcode>`), never lat/lng. **No default-pin
  trap.** Merge geocodes the postcode (col `PostCode`).
- End times: **none** (no end column).
- Notes: server-fetchable CSV, no browserRender/auth. The kennel's site is a Google Sites page
  (`sites.google.com/site/mickleoverh3`) that is fully `web_fetch`-able for metadata; the run data
  itself is the linked sheet. The sheet's `sitesv`/`sheets` logo URLs are tokenized (see logo note).

- **Field-fill assertion table** (from the sample + a scan of the full 362-row archive):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 362 | no theme column → leave undefined, `merge.ts` synths "Mickleover H3 Trail #N" |
  | `startTime` | 0 / 362 | not in sheet → `startTimeRules: { default: "19:15" }` (Mon 7:15pm, confirmed) |
  | `endTime` | 0 / 362 | none → accept absence |
  | `location` (Pub Name, col 2) | ~360 / 362 | map `columns.location: 2`; a few "don't know" → stripPlaceholder |
  | `locationStreet` (street, col 4) | ~180 / 362 | partial; optional (`columns.address` — but see postcode) |
  | postcode (col 6) | ~360 / 362 | best geocode key → map as `columns.address: 6` (or combine) |
  | `hares` (col 7) | ~355 / 362 | `columns.hares: 7`; a few "?"/blank → stripPlaceholder |
  | `cost` | 0 / 362 (per-event) | kennel default `£2` on the Kennel record; no per-event overrides |
  | `description` (Info, col 8) | ~120 / 362 | `columns.description: 8` (notes only; NOT a title) |
  | `coords` (lat/lng) | 0 / 362 | none → merge geocodes the postcode |

## Kennel metadata (deep-dive complete)
- fullName / shortName / region / country: **Mickleover Hash House Harriers** / **Mickleover H3** /
  **East Midlands (Derby), England** / **United Kingdom**
- aliases: `["Mickleover Hash House Harriers", "Mickleover HHH", "Mickleover"]`
  (🔴 **bare "MH3" OMITTED** — global collision with Munich/Montreal/Minneapolis/Miami/Madrid/
  Memphis/Morgantown/Manila/Dubai)
- website: `https://sites.google.com/site/mickleoverh3` (source: the site)
- facebook: `https://www.facebook.com/MickleoverH3/` (source: home page "We are also on Facebook")
- instagram / twitter / discord: **none found → blank + flag**
- schedule: **monthly, 2nd Monday, 19:15** (source: home page — "once a month on a Monday evening at
  19:15, usually on the second Monday of the Month"; corroborated by history page "Monday night, start
  time 7.15pm"). `scheduleFrequency: "monthly"`. *(Historical note: 1993–95 ~5–7 runs/yr, fortnightly
  1995–2000, monthly since 2000 — current is monthly. A single `scheduleDayOfWeek` is fine; the winter
  "socials" are non-trail and skipped, so no multi-pattern `scheduleRules` needed.)*
- foundedYear: **1993** (source: `.../mh3-hash-history` — "Formed: May 10th, 1993" by Dave "The
  Dobber" Birkett; corroborated by log run #1 = 10-May-1993 AND run #338's "30th Anniversary" note in
  May 2023 → 1993. High confidence, no discrepancy.)
- hashCash: **"£2 per run (visitors & virgins free; no annual subscription)"** (source: home page
  "How much does it cost? £2 per run … Visitors and virgins are free (one time only). There is no
  annual subscription fee.")
- dogFriendly: **unstated → blank + flag**
- walkersWelcome: **true** (source: home page — "Walkers are welcome and there are always some walkers
  on each run and the walkers normally do around 2 miles.")
- description: "A sociable, mixed running club that starts and finishes at a pub — runners and walkers
  both welcome. Trails once a month on a Monday evening, at a different pub within about 30 minutes of
  Derby (roughly the Derby–Nottingham–Loughborough triangle)." (source: home page "What we do")
- logoUrl: **⚠️ self-host** — the only logo is the tokenized Google Sites `og:image`
  `https://lh3.googleusercontent.com/sitesv/AG8ngQW…=w16383` (a session/referer-bound `sitesv` token
  that 403s server-side and rotates per load — same trap documented in `source-platform-notes.md` →
  Google Sites `sitesv`). Grab it via Chrome MCP (navigate `/home`, read the rendered logo `<img>`,
  fetch in-page, download) → self-host to `public/kennel-logos/mickleover-h3.<ext>` and confirm the
  extension by magic bytes. **Never pre-fill the extension.**
- lat/lng: optional; Mickleover, Derby ≈ 52.923 / −1.526. (Region centroid is used for display; per-run
  pins come from geocoded postcodes.)
- contact (do NOT seed as a public field — PII): `organstopps@gmail.com` (the hare-coordinator).

## Historical backfill
- Available: **~362 runs, #1 (1993-05-10) → #362 (2026-08-10)**, fields: run # / date / venue (pub) /
  street+town+postcode / hares / info-notes. (Milestone runs on the history page — #50 1997-12-29,
  #100 2001-09-17, #150 2006-02-13, #200 2010-03-15, #250 2014-04-14, #300 2018-06-11 — match the log
  exactly, confirming run-number/date integrity.)
- Plan: **no separate one-shot script needed.** The sheet is a **full-archive feed** — it returns the
  entire log on every fetch. `buildDateWindow(days)` in `src/adapters/utils.ts` is **symmetric**
  (`[now − days, now + days]`), so a wide `scrapeDays` makes the adapter emit the whole 1993→present
  archive on every scrape, and re-emit it every time → **`reconcile.ts` never false-cancels → NO
  `upcomingOnly`, NO backfill script.** This mirrors the Isca H3 full-archive decision.
  - Set **`scrapeDays: 12500`** (≈ 34 years — reaches back past 1993-05; #1 is ~12,145 days before
    2026-08-09). ⚠️ **Claude Code: confirm at live-verify that the full ~362-run set comes back** (i.e.
    `buildDateWindow(12500)` includes 1993 rows). It should, given the symmetric window; if for any
    reason old rows are dropped, widen `scrapeDays` further — do NOT reach for `upcomingOnly` (this is
    a full archive, not an ages-out feed).

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Insert under a UK / East Midlands grouping
// (next to the Quorn H3 entry if that handoff has merged).
{
  kennelCode: "mickleover-h3",
  shortName: "Mickleover H3",
  fullName: "Mickleover Hash House Harriers",
  region: "East Midlands",          // METRO name — must match the region record (see Region note)
  country: "United Kingdom",
  website: "https://sites.google.com/site/mickleoverh3",
  facebookUrl: "https://www.facebook.com/MickleoverH3/",
  foundedYear: 1993,
  hashCash: "£2 per run (visitors & virgins free; no annual sub)",
  walkersWelcome: true,
  // dogFriendly: unstated on-site → leave unset (flag)
  scheduleDayOfWeek: "Monday",
  scheduleTime: "7:15 PM",          // 🔴 12-hr in Kennel.scheduleTime; adapter/RawEventData startTime stays 24-hr "19:15"
  scheduleFrequency: "monthly",     // 2nd Monday; winter "socials" are non-trail (skipped by the source)
  description: "A sociable, mixed running club that starts and finishes at a pub — runners and walkers both welcome. Monthly Monday-evening trails at a different pub within ~30 minutes of Derby.",
  logoUrl: "public/kennel-logos/mickleover-h3.<ext>", // ⚠️ self-host the tokenized Google-Sites sitesv logo; confirm <ext> by magic bytes
  // lat/lng optional: 52.923 / -1.526 (Mickleover, Derby)
},

// aliases.ts — Record<string, string[]> keyed by kennelCode (NOT slug). Bare "MH3" OMITTED (global collision).
"mickleover-h3": ["Mickleover Hash House Harriers", "Mickleover HHH", "Mickleover"],

// sources.ts — Source[] (array of objects).
{
  name: "Mickleover H3 Run Log Sheet",
  url: "https://docs.google.com/spreadsheets/d/1oZFMbkKFQp2rBM3x4LUt9vGOImCbsFOnyriQdO6xSCg/export?format=csv&gid=0",
  type: "GOOGLE_SHEETS" as const,
  trustLevel: 7,
  scrapeFreq: "daily",
  scrapeDays: 12500,                 // full-archive pull (1993→present); buildDateWindow is symmetric → NO upcomingOnly
  config: {
    sheetId: "1oZFMbkKFQp2rBM3x4LUt9vGOImCbsFOnyriQdO6xSCg",
    // Direct CSV export of the "MH3 Full Run log" tab (gid=0). Anonymously
    // fetchable → bypasses the Sheets-API tab-discovery path (no GOOGLE_CALENDAR_API_KEY).
    csvUrl: "https://docs.google.com/spreadsheets/d/1oZFMbkKFQp2rBM3x4LUt9vGOImCbsFOnyriQdO6xSCg/export?format=csv&gid=0",
    // Header row: Run # | Date | Pub Name | GoogleMaps | street | town/village | PostCode | Hares | Info | Pack Size | Pubs
    columns: {
      runNumber: 0,
      date: 1,          // "DD-MMM-YY" — natively parsed by parseDMonDate (2-digit pivot: 26→2026, 94→1994)
      location: 2,      // Pub Name (venue)
      address: 6,       // PostCode — best UK geocode key (street col 4 / town col 5 are partial)
      hares: 7,
      description: 8,   // Info notes only (NOT a title)
    },
    startTimeRules: { default: "19:15" }, // sheet has no time col; Monday 7:15pm confirmed on-site
    kennelTagRules: { default: "mickleover-h3" },
    // 🔴 Winter "social only" rows (blank Run #) — see Adapter notes. Recommended:
    requireRunNumber: true,           // ← small opt-in adapter flag (see Adapter notes); OR the silentlySkipPatterns fallback
    // NO upcomingOnly — full-archive feed.
  },
  kennelCodes: ["mickleover-h3"],
},
```

## Adapter notes / config plan

**Config-only `GOOGLE_SHEETS` — earned:** (a) the exact CSV feed (`.../export?format=csv&gid=0`) was
fetched and returns the full 362-row log as `text/csv`; (b) `GoogleSheetsAdapter`
(`src/adapters/google-sheets/adapter.ts`) already exists and is registered. The sheet's date format
`DD-MMM-YY` is a **first-class supported format** — `parseDate` → `parseDMonDate`
(regex `^(\d{1,2})-([A-Za-z]{3})-(\d{2,4})$`) + `normalizeYear` (2-digit pivot: `<50 → 2000+`,
`≥50 → 1900+`), validated via a `Date.UTC` round-trip. So `10-Aug-26 → 2026-08-10`,
`02-May-94 → 1994-05-02`, `10-May-93 → 1993-05-10`. No date code needed.

**🔴 The one design wrinkle — winter "social only" rows.** Between the numbered Apr–Sep trails, the
kennel logs un-numbered winter pub "socials": rows with a **blank `Run #` (col 0)** and "Social only"
in either `Info` (col 8) or `Pack Size` (col 9). `GoogleSheetsAdapter` **does NOT drop blank-run#
rows** — by deliberate design (`resolveKennelTagFromSheetRow`, #1625) it emits them with
`runNumber: undefined` so legit unnumbered specials on other sheets aren't lost. So these socials must
be skipped explicitly. Two options:

- **Recommended — add an opt-in `requireRunNumber?: boolean` to `GoogleSheetsConfig`** (~5–10 LoC +
  1 test): in `processRows`, after `resolveKennelTagFromSheetRow`, if `config.requireRunNumber` and
  the resolved `runNumber === undefined`, `continue` (skip the row). Default `false` preserves existing
  behavior for MASS H3 / MFMH3 (#1639/#1657). This cleanly drops **all** social rows uniformly
  (they're all unnumbered) — the correct semantic for a numbered-runs-only kennel. This is the only
  change that catches the ~2 rows whose "social only" text sits in the unmapped `Pack Size` column.
- **Pure-config fallback (zero adapter code)** — `silentlySkipPatterns: [{ pattern: "social", field:
  "description" }]` with `columns.description: 8`. This drops every social row whose note lands in
  `Info` (the large majority, incl. "Xmas Social"), but MISSES the ~2 rows (e.g. 2026-03-09,
  2026-01-12) whose only "social only?" marker is in the unmapped `Pack Size` column — those would
  ingest as junk dated events with no run#/venue/hares. Acceptable only if you accept a couple of
  low-value phantom rows; `requireRunNumber` is cleaner.

**Coords / geocoding:** no lat/lng anywhere; the `GoogleMaps` column (col 3) is a bare
`maps?q=<postcode>` search URL or a pub-name dup — do NOT parse it for coords. Merge geocodes the
`PostCode` (mapped as `columns.address: 6`). No default-pin trap → no `dropCachedCoords` needed.

**Titles:** no theme column. Leave `title` undefined (do NOT set `runHareTitle`) → `merge.ts`
synthesizes "Mickleover H3 Trail #N". shortName "Mickleover H3" is >4 chars → `friendlyKennelName`
short-circuits to a clean synth title (no need to run the ≤4 check).

**Region (East Midlands METRO):**
- The **Quorn H3 handoff (`handoffs/2026-08-08-quorn-h3.md`, handed-off)** already introduces an
  **"East Midlands" METRO** (Derby–Nottingham–Leicester). Mickleover (Derby) belongs to the same
  METRO. **If Quorn's region block has merged → reuse it → 0 region.ts edits** (the seeder upserts
  regions by name).
- **If it has NOT merged**, add the identical block (2 edits) — mirror Bristol/Newcastle
  (`src/lib/region.ts:1575`), and match Quorn's values EXACTLY so the two handoffs can't create a
  duplicate/variant METRO:
  1. `REGION_SEED_DATA`: `{ name: "East Midlands", country: "UK", timezone: "Europe/London",
     abbrev: "EML", colorClasses: "bg-violet-100 text-violet-700", pinColor: "#8b5cf6",
     centroidLat: 52.77, centroidLng: -1.21, aliases: ["East Midlands, England", "Derby"] }`
     (level METRO under the existing United Kingdom COUNTRY).
  2. `STATE_GROUP_MAP`: `"East Midlands": "United Kingdom"`.
  - **NO `COUNTRY_INFERENCE_RULES` / `COUNTRY_GROUP_MAP` edits** — the UK rule already covers
    `england`, and the seed kennel carries an explicit `country`. (Bare `derby`/`nottingham`/
    `leicester` are US-collision-prone — do not add them to inference.)
  - ⚠️ **Claude Code: check whether Quorn already used `"Derby"` as a METRO alias vs. a metro name.**
    If Quorn instead created a `Derby` metro (not "East Midlands"), put Mickleover in whichever metro
    Quorn actually shipped — do NOT create a competing region. Confirm against `origin/main` +
    `handoffs/2026-08-08-quorn-h3.md` before seeding.

**⚠️ Claude Code: verify before writing real code.** Any values below are from the live repo as read
at research time — reconfirm against current types/imports:
- `GoogleSheetsConfig` field names (`csvUrl`, `sheetId`, `columns.{runNumber,date,location,address,
  hares,description}`, `startTimeRules`, `kennelTagRules`, `silentlySkipPatterns`) — read
  `src/adapters/google-sheets/adapter.ts` / `src/adapters/types.ts`.
- `RawEventData.kennelTags` is `string[]` (the adapter emits `kennelTags: [config.kennelTagRules.default]`).
- `silentlySkipPatterns` valid `field`s are exactly `title | description | location | hares`
  (`src/adapters/skip-rules.ts`).
- If adding `requireRunNumber`: it's a NEW config key — add it to `GoogleSheetsConfig`, honor it in
  `resolveKennelTagFromSheetRow`/`processRows`, and extend `config-validation.ts` if it validates the
  sheets config shape. Add one unit test (a blank-run# social row is dropped; a numbered row survives).

## Deep-dive checklist (nothing deferred)
- [x] logo (tokenized `sitesv` → flag self-host + magic-byte ext)  [x] foundedYear (1993, cited ×3)
  [x] socials (FB found; IG/X/Discord none → flag)  [x] schedule (monthly 2nd Mon 19:15, cited)
  [x] hashCash (£2, cited)
- [x] description (cited)  [x] source live-verified (CSV fetched, `text/csv`, 362 rows, upcoming #362)
  [x] history depth (full 1993→2026 in-feed)  [x] pagination (none — single CSV)
- [x] coord sanity (no coords → geocode postcode; no default-pin trap)  [x] end times (none)
  [x] kennelCode collision-checked (`mickleover-h3`, bare MH3 omitted)  [x] kennelCodes source guard set

## Implementation gotchas (for Claude Code — repo knowledge, not source knowledge)
- **This is a FULL-ARCHIVE feed → do NOT add `config.upcomingOnly`.** The sheet returns every run on
  every fetch, so reconcile sees all of them and never false-cancels. `upcomingOnly` here would be
  wrong (it restricts reconcile to the future for ages-out feeds — this is the opposite case).
- **`buildDateWindow` is symmetric** (`[now−days, now+days]`) — that's why `scrapeDays: 12500` pulls
  the 1993 archive. Confirm the full ~362-run pull at live-verify; widen if needed.
- **Blank-run# rows are emitted by design (#1625)** — you MUST skip the winter socials via
  `requireRunNumber` (recommended) or `silentlySkipPatterns` (fallback, misses ~2 col-9-only rows).
- **`GoogleMaps` col is not coords** — never parse it; geocode the postcode.
- **`title` undefined → synth** — never let an Info-note ("Xmas hash", "Butcher's Birthday") become
  the title; those go to `description` only.
- **Self-host the tokenized `sitesv` logo** (403s to `curl`/`safeFetch`, rotates per load) — grab via
  Chrome MCP; confirm the extension by magic bytes, never pre-fill `.png`.
- **Region duplicate-METRO risk** — Mickleover and Quorn both target the East Midlands METRO. Reuse,
  don't recreate; match Quorn's block exactly.
- **Sonar S5852/S5843/S3776** — config-only path means little new regex/logic; if you add
  `requireRunNumber`, the change is a single `if (… === undefined) continue;` — trivial complexity.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the
brief — no separate prompt needed._
