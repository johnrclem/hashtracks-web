# Onboarding Handoff — Donnington H3 (Shropshire / Telford, England) — 2026-08-07

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/donnington-h3-20260807`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the new **Shropshire
>    METRO** to `src/lib/region.ts` as noted in **Adapter notes** (2 edits).
> 3. Implement the **new `DonningtonHashAdapter`** exactly as in **Adapter notes** (static Cheerio,
>    no browserRender — the site is fully SSR).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` —
>    call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'`. Validate: events non-empty +
>    upcoming, dates UTC-noon, `startTime` "HH:MM", `kennelTags` resolves to `donnington-h3` with no
>    unmatched. Resolve every `⚠️ Claude Code must confirm` item. **DO NOT run `npx prisma db seed`
>    here** — seeding + prod scrape is the post-merge step (step 8).
> 5. Build the **Historical backfill** one-shot (frozen JSON + dumb loader, H7 pattern) — worth it
>    (~2,600 runs back to #1 / 21 Jun 1976).
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive
>    checklist below. Follow `docs/source-onboarding-playbook.md` throughout.
> 8. **Post-merge runbook (after PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (squash-merge can silently drop a follow-up
>      commit): `git log -1 -- src/adapters/html-scraper/donnington-hash.ts`,
>      `git log -1 -- scripts/backfill-donnington-h3-history.ts`,
>      `git log -1 -- scripts/data/donnington-h3-history.json`. Recover any missing file with a small PR.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive; seeds the kennel/alias/source + Shropshire region)
>    - Run the backfill one-shot, then trigger a scrape from `/admin/sources`
>    - Spot-check `/kennels/donnington-h3` for the expected event count + sample dates

## Summary
- Type: **full onboard**
- Adapter: **HTML_SCRAPER** (**NEW bespoke adapter** — nothing config-only fits; WP REST `/wp-json/wp/v2/pages` is empty, run data is plain HTML `<table>` inside WordPress Pages)
- Effort estimate: **new ~150–220 LoC static-Cheerio adapter + tests** + a **frozen ~2,600-run backfill** (JSON + dumb loader)
- One-line: First **Shropshire / Telford** kennel — **Donnington H3**, the **3rd hash ever founded in the UK** (1976), a large, very active weekly Shropshire hash with a clean SSR run table on its own WordPress site and a complete #1→present archive.

## Dedup result
- Kennel in seed: **no** (grep `donnington|telford|shropshire|oswestry|wrekin|shrewsbury` in `kennels.ts`/`aliases.ts`/`sources.ts` → 0 hits)
- Source in seed: **no**
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP (**491 slugs**, 2026-08-07); no `donnington`/`telford`/`shropshire`/`oswestry`/`wrekin`/`shrewsbury` slug. `/kennels/donnington-h3` renders a **real 404** (Chrome-rendered). `/kennels/dh3` = **Denver H3** (DEN/USA, distinct); seed `kennelCode:"dh3"` = **Dublin H3** (slug `dublin-h3`, distinct) — both confirm the bare `dh3` namespace is taken.
- Decision: **full onboard**
- kennelCode: `donnington-h3` (collision check: bare `dh3` taken by Dublin H3 → city-name code; **bare "DH3" alias OMITTED** — Dublin/Denver/Dallas/Dayton/Desert). slug = `donnington-h3` (clear).

## Live source verification  ✅
- Source: **HTML_SCRAPER** — `https://www.donningtonh3.co.uk/` (homepage forward run `<table>`; fully SSR, `web_fetch`-able, `text/html`). DNS `donningtonh3.co.uk` → **Status 0 → 5.153.222.49** (checked via `dns.google/resolve`).
- Feed HEAD-check: n/a (HTML page, not a machine feed). ⚠️ Note: the origin **403s bare `curl`/cloud IPs** (logo + assets) but **renders full SSR HTML to `web_fetch`/browser** — so Claude Code should fetch via the app's `fetchHTMLPage` (which uses `safeFetch` with a browser UA), not raw `curl`.
- Events seen: **22 forward rows on the homepage** — **#2640 (03/08/2026) → #2661 (27/12/2026)**. Genuine upcoming (today 2026-08-07): next run **#2641 Mon 10 Aug 2026 18:30**. NOT a 0-upcoming case.
- **Source-count parity:** N/A for a hand-maintained rolling table (no platform "total" count). The homepage forward window carries 22 rows; the full current-year page `/2026-runs/` carries the whole year. Adapter reads the homepage forward table (upcoming) + `upcomingOnly:true`; history comes from the backfill, not pagination.
- Sample events (**VERBATIM from the homepage table**, DD/MM/YYYY):
  1. **#2640** — 03/08/2026 — 18.30 — The Royal Hill — Edgerley, Oswestry — SY10 8ES — hares Pip / Harry
  2. **#2641** — 10/08/2026 — 18.30 — The Stanton Arms — Stanton upon Hine Heath — SY4 4LR — hares Rob / Liann  ← next upcoming
  3. **#2642** — 17/08/2026 — 18.30 — The Bell and Bails — 84 Church St, St George's, Telford — TF2 9LT — hares "Merv and Teddy" / Fiona
  4. **#2643** — 24/08/2026 — 18.30 — TBA — hares Rachel / Mark
  5. **#2644** — 31/08/2026 — 18.30 — The Wrekin View — Milners Ln, Dawley Bank, Telford — TF4 2JH — hares Susan / Derek — Notes "August Bank Holiday"
  6. **#2647** — 20/09/2026 — 11.00 — TBA — hares "Chris H" / "Peter H" — Notes "First Sunday Run" (← the seasonal Mon→Sun switch)
  - 🔴 **Run numbers + hare names are VERBATIM.** There are **no theme titles** in the table (the "Notes" column is occasional prose like "August Bank Holiday" / "Last Monday Run", not a run theme). Leave `title` undefined → `merge.ts` synthesizes `"Donnington H3 Trail #N"`. Blank cells ("TBA", "HARE NEEDED", empty) = leave the field undefined, don't synthesize.
- History depth / pagination: **DEEP — Run #1 (21 Jun 1976) → #2661 (2026), ~2,600 runs**, spread across per-year WordPress Pages: `/2026-runs/`, `/2025-runs/`, `/2024-runs/`, `/2023-runs/`, `/2022-runs/`, `/2018-runs/` (2018–2021), `/runs/2014-runs/` (2014–2017), `/2010-runs/` (2010–2013), and `/run-number-1-through-to-1791/` (1976→~2009, **one 172 KB page**). All are single SSR pages (no pagination). See **Historical backfill**.
- Coord sanity: **no lat/lng in the table** — venue + Area (address) + **Post Code** (+ occasional What3Words `///a.b.c`) per row → geocode the postcode. **No default-pin trap** (nothing to reject).
- End times: **none** (single time = start). No multi-day rows in the forward window.
- Notes: Fully SSR classic WordPress (6.8.7) — **no browserRender needed**. WP REST `/wp-json/wp/v2/pages` returns empty (run data is inline `<table>` markup in Page bodies, not the REST API) → **no config-only path**. New platform note appended to `source-platform-notes.md`.
- **Field-fill assertion table** (from the homepage forward sample, N=22; the winter rows further out have blank venues/hares as the schedule is filled in later):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 22 | No theme titles → leave undefined, `merge.ts` synthesizes `"Donnington H3 Trail #N"` |
  | run number | 22 / 22 | `Run No` column, integer |
  | `startTime` | 22 / 22 | parse `Time` col: `"18.30"`/`"11.00"`/`"1830"` → `"HH:MM"`; skip non-time text (`"Summertime 'Do'"`) |
  | `endTime` | 0 / 22 | not in feed — accept absence |
  | `location` (venue) | ~8 / 22 | `Venue` col; many far-out rows are `TBA`/blank → leave undefined |
  | `locationStreet` | ~8 / 22 | `Area` col (address text) — pair with postcode |
  | `locationUrl` (Maps) | 0 / 22 | not in table (some cells carry What3Words `///…`, not a Maps URL) |
  | `hares` | ~8 / 22 | `Hare 1` + `Hare 2` joined `", "`; blank/`HARE NEEDED` → undefined |
  | `cost` | 0 / 22 | kennel default `£2` (per-event override not in table) |
  | `description` | ~6 / 22 | `Notes` col when present (e.g. "August Bank Holiday", "First Sunday Run") |
  | `trailLengthText` | 0 / 22 | not in feed |
  | `coords` (lat/lng) | 0 / 22 | geocode `Post Code`; fallback Shropshire centroid |

## Kennel metadata (deep-dive complete)
- fullName / shortName / region / country: **Donnington Hash House Harriers** / **Donnington H3** / **Shropshire** / **UK**
- aliases: `["Donnington H3", "Donnington Hash", "Donnington HHH", "DH3 Telford", "Donnington Hash House Harriers"]` — **bare "DH3" OMITTED** (global collision: Dublin/Denver/Dallas/Dayton/Desert). All proposed aliases grep-clean in `aliases.ts`.
- website: `https://www.donningtonh3.co.uk/` (source: DNS Status 0)
- facebook: `https://www.facebook.com/Dh3running/` (source: donningtonh3.co.uk/about)
- instagram / twitter / discord: **none found on site → blank + flag** (site lists only Facebook)
- schedule: **weekly, seasonal** — **Monday 18:30 (summer)** / **Sunday 11:00 (winter)** (source: donningtonh3.co.uk/about "Meet: Every week — 18.30 (Monday nights in the summer), 11.00 (Sunday mornings in the winter)"). Observed switch points in the 2025 table: → Monday at #2568 (07/04/2025, "First Monday Run"); → Sunday at #2593 (21/09/2025, "First Sunday Run"). Use `scheduleRules` with `validFrom`/`validUntil` (see seed).
- foundedYear: **1976** (source: donningtonh3.co.uk/about — "founded 1976 by Brigadier Ray Thornton… 3rd Hash to be founded in the UK… first trail 21st June 1976"; corroborated by the **50th Anniversary 19–21 June 2026** on `/forthcoming-events/` and Run #1 dated 21 Jun 1976 in the archive).
- hashCash: **£2** (source: donningtonh3.co.uk/about — "Cost: £2 per run. Free raffle ticket")
- dogFriendly: **unstated at kennel level → blank + flag** (some run Notes mention "dog friendly pub" for specific venues, but no kennel-wide statement)
- walkersWelcome: **unstated → blank + flag** (typical for a UK hash but not asserted on-site)
- description: `"A Drinking Club with a Running Problem. Donnington Hash House Harriers (DH3), founded 1976 at the Army Ordnance Depot in Donnington, Telford — the third Hash founded in the UK. Weekly trails across Shropshire: Monday evenings in summer, Sunday mornings in winter."`
- logoUrl: `https://www.donningtonh3.co.uk/wp-content/uploads/2019/01/Hash-Logo.<ext>` — ⚠️ **self-host** to `public/kennel-logos/donnington-h3.<ext>`. 🔴 **NEVER pre-fill the extension** — the URL says `.jpg` but the origin **403s `curl`** so it was NOT magic-byte-confirmed here. Download via a browser UA and confirm Content-Type + magic bytes (`\xff\xd8`=JPEG, `\x89PNG`=PNG, `RIFF`=WebP) before committing.
- lat/lng: kennel is Shropshire-wide; use the METRO centroid **52.6784, −2.4453** (Telford). (Location page embeds a Google map centred `ll=52.731628,−2.421754`, Lilleshall/Donnington.)

## Historical backfill
- Available: **~2,600 runs, #1 (21 Jun 1976) → ~#2661 (2026)** — fields per row: **run number, date, time, venue, area/address, post code, Hare 1, Hare 2, notes**.
- Plan: **worth it** — frozen `scripts/data/donnington-h3-history.json` + dumb loader `scripts/backfill-donnington-h3-history.ts` (H7 pattern: use a throwaway parser to extract, commit only the curated JSON + dumb loader; do NOT commit the parser). Strict `date < today` partition so it never overlaps the adapter's forward window.
  - Sources to parse (all single SSR pages, `fetchHTMLPage`): `/run-number-1-through-to-1791/`, `/2010-runs/`, `/runs/2014-runs/`, `/2018-runs/`, `/2022-runs/`, `/2023-runs/`, `/2024-runs/`, `/2025-runs/`, `/2026-runs/`.
  - 🔴 **Two date formats across the archive** — modern year pages use **`DD/MM/YYYY`** ("05/01/2025"); the deep `/run-number-1-through-to-1791/` page uses **`DD MMM YYYY`** ("21 Jun 1976"). Normalize both (a `chronoParseDate` pass handles both; validate day/month).
  - 🔴 **Non-run / spacer rows** — blank run-number rows carry section text ("No Hash in winter of 76", "Hash ceased for winter") and empty separator rows. **Skip any row whose `Run No` cell isn't an integer.** Some rows have `N/A` run numbers (social days e.g. the Knaresborough Bed Race) — skip those too.
  - 🔴 **Time variants** — `"17.30"`, `"11.00"`, `"1830"` (no dot), `"11.15"`, plus non-time labels (`"Summertime 'Do'"`, `"Summer Bash"`). Parse `HH.MM`/`HHMM` → `"HH:MM"`; if unparseable, fall back to the seasonal schedule time (Mon 18:30 / Sun 11:00) or leave undefined.
  - **Frozen-dataset validation checklist** (run before shipping): PII scrub (older rows carry full member names — that's the hare data, keep; but grep `@`/phone patterns in `Notes` and redact); run-number monotonicity; gap sanity vs neighbours; field-bleed on `:` in hares/venue.

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Insert in the UK / England (outside London) block.
{
  kennelCode: "donnington-h3",
  shortName: "Donnington H3",
  fullName: "Donnington Hash House Harriers",
  region: "Shropshire",
  country: "UK",
  website: "https://www.donningtonh3.co.uk/",
  facebookUrl: "https://www.facebook.com/Dh3running/",
  foundedYear: 1976,
  hashCash: "£2",
  // scheduleDayOfWeek/scheduleTime kept as fallback; scheduleRules is authoritative.
  scheduleDayOfWeek: "Monday",
  scheduleTime: "6:30 PM", // 🔴 12-hr "H:MM AM/PM" fallback; scheduleRules.startTime stays 24-hr.
  scheduleFrequency: "Weekly",
  scheduleRules: [
    // Seasonal alternation (only one active at a time). INTERVAL=1 → no anchorDate needed.
    // Observed 2025 switch points: → Monday at #2568 07/04, → Sunday at #2593 21/09.
    { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "18:30", label: "Summer", validFrom: "04-01", validUntil: "09-30", displayOrder: 0 },
    { rrule: "FREQ=WEEKLY;BYDAY=SU", startTime: "11:00", label: "Winter", validFrom: "10-01", validUntil: "03-31", displayOrder: 1 },
  ],
  description: "A Drinking Club with a Running Problem. Donnington Hash House Harriers (DH3), founded 1976 at the Army Ordnance Depot in Donnington, Telford — the third Hash founded in the UK. Weekly trails across Shropshire: Monday evenings in summer, Sunday mornings in winter.",
  logoUrl: "https://www.donningtonh3.co.uk/wp-content/uploads/2019/01/Hash-Logo.<ext>", // ⚠️ self-host to public/kennel-logos/donnington-h3.<ext>; confirm ext by magic bytes
}

// aliases.ts — Record<string, string[]> (keyed by kennelCode). Confirmed shape via head of file.
"donnington-h3": ["Donnington H3", "Donnington Hash", "Donnington HHH", "DH3 Telford", "Donnington Hash House Harriers"],

// sources.ts — Source[] (array of objects). Model: Burlington H3 Website (sources.ts:2756).
{
  name: "Donnington H3 Website",
  url: "https://www.donningtonh3.co.uk/",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: { upcomingOnly: true }, // rolling forward table → reconcile would false-cancel without this
  kennelCodes: ["donnington-h3"],
}
```

### region.ts — 2 edits (new Shropshire METRO under existing UK COUNTRY)

Mirror the Bristol/Newcastle England-metro records exactly (violet palette, `Europe/London`).

```ts
// 1) REGION_SEED_DATA — add in the "UK — England (outside London)" block:
{
  name: "Shropshire",
  country: "UK",
  timezone: "Europe/London",
  abbrev: "SHR", // grep-confirmed free in region.ts
  colorClasses: "bg-violet-100 text-violet-700",
  pinColor: "#8b5cf6",
  centroidLat: 52.6784,
  centroidLng: -2.4453, // Telford (kennel base); Shropshire is county-wide
  aliases: ["Telford", "Shropshire, England"],
},

// 2) STATE_GROUP_MAP — add:
"Shropshire": "United Kingdom",
```

- **NO `COUNTRY_INFERENCE_RULES` edit** and **NO `COUNTRY_GROUP_MAP` edit** — matches the Sheffield/Manchester/Newcastle/Bristol precedent: the UK inference rule `\b(uk|england|scotland|wales|london|surrey|sussex)\b` already matches this kennel's `country:"UK"` + "Shropshire, England" text, and metros resolve to the country via `STATE_GROUP_MAP`. The seed kennel also carries an explicit `country:"UK"`, so the inference path (research-text only) never decides this kennel.
- 🔴 **abbrev**: `"SHR"` was grep-free at research time — **re-confirm free** at build (`grep 'abbrev: "SHR"' src/lib/region.ts`).

## Adapter notes / new-scraper plan

**New `DonningtonHashAdapter`** — static Cheerio, no browserRender. Model on
`src/adapters/html-scraper/dublin-hash.ts` (table plumbing + `fetchHTMLPage`) and
`src/adapters/html-scraper/burlington-hash.ts` (field cleaning, `parseTrailLength`-style guards,
Sonar-safe regex). Single page, single `<table>`, no pagination.

Shape (ILLUSTRATIVE — verify field names against live types):
- `fetch(source, options?)`: `const html = await fetchHTMLPage(source.url ?? DEFAULT_URL)` (DEFAULT_URL = `https://www.donningtonh3.co.uk/`). `const $ = cheerio.load(html)`.
- Select the run table: it's the first content `<table>` on the homepage whose header row contains "Run No"/"Date"/"Venue". Map columns **by header text**, not fixed index (the deep archive labels them "Run Number"/"Hare One"/"Hare Two" — build a header→index map so the same parser can drive the backfill).
- Per `<tr>` (helpers, keep Sonar S3776 ≤ 15):
  - `parseRunNumber(cell)` → integer; **skip the row if not an integer** (spacer/section/`N/A` rows).
  - `parseDonningtonDate(cell)` → UTC noon. Handle `DD/MM/YYYY` (forward + modern years) AND `DD MMM YYYY` (deep archive) via `chronoParseDate` from `@/adapters/utils` (do NOT hand-roll a 12-way month alternation — Sonar S5843).
  - `parseTime(cell)` → `"HH:MM"`: accept `"18.30"`, `"11.00"`, `"1830"`, `"11.15"`; return undefined for non-time text.
  - Normalize each hare cell FIRST — map `TBA` / `HARE NEEDED` / empty to `undefined` — THEN filter and
    join: `[hare1, hare2].map(normalizeHareCell).filter(Boolean).map(s=>s.trim()).join(", ")`. 🔴
    `.filter(Boolean)` alone does NOT catch `"HARE NEEDED"` — it's a non-empty, truthy string, so it
    would be stored as a literal hare name unless normalized first.
  - `location` = Venue cell (undefined if "TBA"/blank); `locationStreet` = Area cell; extract a UK postcode + optional `///w3w` from Area/Venue for geocoding.
  - `title`: **leave undefined** (no themes) → `merge.ts` synthesizes.
  - `kennelTags: ["donnington-h3"]`.
- Honor `options.days` via `buildDateWindow(options?.days ?? 365)`.
- 🔴 **Fail-loud guard:** single-table adapter → `if (rows.length === 0) errors.push("Donnington: no run rows parsed")` so a markup drift suppresses reconcile instead of silently cancelling live events (AH3-NZ retro Gap D).

Registry entry to add (`src/adapters/registry.ts`, in the `htmlScrapersByUrl`-style array):
```ts
{ pattern: /donningtonh3\.co\.uk/i, name: "DonningtonHashAdapter", factory: () => new DonningtonHashAdapter() },
```

Test fixture: capture the **real** homepage table markup verbatim (a `<table>` with `<thead>`/`<tbody>` `<tr><td>` cells — WordPress classic-editor table) — do NOT hand-write a flat fixture. Include one modern `DD/MM/YYYY` row AND one deep-archive `DD MMM YYYY` row so both date paths are covered.

**⚠️ Claude Code: verify before writing real code.** Any snippet above is illustrative; the live repo is authority. Before writing the adapter, confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); walker field on `Kennel` is `walkersWelcome`. Check `prisma/schema.prisma` for canonical names.
- Imports — `fetchHTMLPage` + `chronoParseDate` + `buildDateWindow` from `@/adapters/utils`; use `safeFetch` (never raw `fetch`) if you fetch directly.
- `KennelScheduleRuleSeed` — confirm `validFrom`/`validUntil`/`displayOrder` field names (modelled on kennels.ts:234).
- `kennelPagesStopReason` — leave null on a clean single-page parse; set only on genuine truncation/HTTP error.
- `title` — leave undefined; never let a hare name or a "Notes" fragment become the title.

## Deep-dive checklist (nothing deferred)
- [x] logo (⚠️ self-host, ext unconfirmed — 403s curl, confirm magic bytes)  [x] foundedYear (1976)  [x] socials (FB only; IG/X/Discord blank+flag)  [x] schedule (+ scheduleRules seasonal Mon/Sun)  [x] hashCash (£2)
- [x] description  [x] source live-verified (SSR homepage table, 22 forward rows, DNS 0)  [x] history depth assessed (~2,600 runs #1→#2661, two date formats)
- [x] coord sanity (no coords in feed → geocode postcode; no default-pin trap)  [x] end times noted (none)  [x] kennelCode collision-checked (`donnington-h3`; bare "DH3" omitted)  [x] kennelCodes source guard set

## Implementation gotchas (repo knowledge)
- **`config.upcomingOnly: true` is REQUIRED** — the homepage table is a rolling forward hareline; old rows age off it. Without `upcomingOnly`, `reconcile.ts` would `CANCEL` valid events as they scroll out of the window. (Backfill rows are historical and never re-scraped.)
- **Backfill = frozen JSON + dumb loader, parser NOT committed** (H7 pattern). Strict `date < today` partition; adapter handles `>= today` from the homepage.
- **`friendlyKennelName`** — `shortName:"Donnington H3"` is >4 chars, so the synth title short-circuits cleanly to `"Donnington H3 Trail #N"`. No `friendlyKennelName` fix needed (but a quick `npx tsx -e` check is cheap).
- **Sonar:** parse date with `chronoParseDate` (avoid month-name alternation S5843); split any date+time combo into simple regexes; use `Number.parseInt(s, 10)`, `s.replaceAll(...)`, no negated ternaries.
- **http/https:** the site is https — no S5332 http-literal hotspots expected.
- **Self-host tokenized/CDN logo** and confirm the real extension by magic bytes (the URL's `.jpg` was NOT verified — origin 403s curl).

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
