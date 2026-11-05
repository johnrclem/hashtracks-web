# Onboarding Handoff — Cambridge H3 (Cambridge, England) — 2026-08-12

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/cambridge-h3-20260812`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the **Cambridge METRO**
>    to `src/lib/region.ts` as noted in **Adapter notes** (2 edits).
> 3. Implement the adapter exactly as in **Adapter notes** — a NEW bespoke `browserRender` HTML
>    scraper (the site is a Blazor SPA; a plain fetch returns an empty shell). Register in
>    `htmlScrapersByUrl`.
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`
>    — call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'` snippet. Resolve every item
>    flagged `⚠️ Claude Code must confirm` in **Live source verification** (above all: confirm
>    `browserRender` renders the Blazor `.RunList` — see the Blazor note). Validate: events
>    non-empty + upcoming, dates UTC-noon, `startTime` "11:00", `kennelTag` resolves with no
>    unmatched. **DO NOT run `npx prisma db seed` here.**
> 5. The **Historical backfill** one-shot (~1,033 runs from `/runlist`) — worth it; freeze to
>    `scripts/data/cambridge-h3-history.json` + dumb loader (H7 frozen-dataset pattern).
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive
>    checklist below. Follow `docs/source-onboarding-playbook.md` throughout.
> 8. **Post-merge runbook (separate step, after the PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (squash-merge can silently drop a follow-up
>      commit): `git log -1 -- <path>` for the adapter, the backfill script, the frozen JSON, and
>      the seed/region edits. Open a small recovery PR if anything's missing.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive; seeds the kennel/alias/source + Cambridge region)
>    - Run the one-shot backfill script once, then trigger a scrape from `/admin/sources`.
>    - Spot-check `hashtracks.xyz/kennels/cambridge-h3` for the expected event count + sample dates.
> Everything you need is in the sections that follow.

## Summary
- Type: **full onboard**
- Adapter: **HTML_SCRAPER** (NEW bespoke `browserRender` adapter — the site is a **Blazor SPA**;
  no config-only path)
- Effort estimate: **new ~180–260 LoC adapter + tests** (homepage `.RunList` forward parse) **+ a
  one-shot ~1,033-run backfill** parsing `/runlist` year-tables. NOT config-only.
- One-line: First **Cambridge / Cambridgeshire** kennel — a large, ~48-year-old, weekly-Sunday
  English university-city hash (founded 1978, current run **#2486**) with its own site carrying a
  live forward hareline **and** a full run archive back to 2006 (~1,033 runs).

## Dedup result
- Kennel in seed: **no** (grep `cambridge` in `prisma/seed-data/*` → 0 hits)
- Source in seed: **no**
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP,
  **491 slugs**. No `cambridge`/`cambridge-h3` slug. The only `ch3`-family hits are other kennels:
  `/kennels/ch3` renders **Copenhagen Hash House Harriers** (Denmark — opened & confirmed via
  Chrome), `ch3-cm` = Chiang Mai, `ch3-nc`/`ch3-sc`/`ch3-dk` = Charlotte/Charleston/Copenhagen.
  `/kennels/cambridge-h3` renders a **real 404** (Chrome MCP).
- Decision: **full onboard**
- kennelCode: `cambridge-h3` (collision check: bare `ch3` is globally taken → city-based code;
  bare **"CH3" alias OMITTED** — collides with Chicago `ch3`, Charlotte `ch3-nc`, Charleston
  `ch3-sc`, Copenhagen `ch3-dk`)

## Live source verification  ✅ (live sample captured via Chrome MCP) / ⚠️ browserRender feed to confirm at build
- Source: **HTML_SCRAPER (browserRender)** — `https://www.ch3.co.uk/` (homepage forward hareline);
  backfill `https://www.ch3.co.uk/runlist`.
  - **DNS check (non-platform domain):** `ch3.co.uk` → `dns.google` **Status 0** (A `147.93.85.8`). ✅
  - 🔴 **Rendering reality (verified in Chrome):** the site is a **Blazor (.NET) SPA**
    (`_framework/blazor.web.js` + `CSE.Blazor.Bootstrap`). A plain `web_fetch`/`curl` of the
    **https** site returns an **empty shell** (`<meta base>` + viewport only — no run data); the
    content is rendered client-side and does **not** SSR. There is **no REST/JSON data endpoint**
    (Blazor Server streams over SignalR/WebSocket — the only network resource beyond the framework
    bundles is `webhare.gif`). → **`browserRender` is required.** ⚠️ **Claude Code must confirm the
    NAS `browserRender` service renders the Blazor `.RunList`** — wait on a content selector
    (`.RunList` for the homepage; a `table` for `/runlist`), lift `timeout` to 30000, set
    `timezoneId: "Europe/London"`. If browserRender can't drive the SignalR hydration, this is the
    one build risk — see the Blazor note in `source-platform-notes.md`.
  - ⚠️ **Legacy trap — do NOT use the http site.** `http://www.ch3.co.uk/` (no TLS) still serves an
    **old, stale cached** version of the site (SSR HTML showing runs **#1971–#1974 dated Jul 2022**
    — those are 2022 Sundays; the "2017th" link text is likewise stale). Ignore it entirely; the
    live source is the **https** Blazor app.
- Events seen (live, via Chrome DOM 2026-08-12): homepage `.RunList` shows a rolling ~7-run window
  **#2484 (Aug 2) → #2490 (Sep 13)**; `/runlist` archive shows **#1458 (Sep 2006) → #2490
  (Sep 2026) ≈ 1,033 runs**. **5 genuine upcoming** at research time (#2486–#2490). Weekly Sunday
  11:00, current/next run **#2486**. NOT a 0-upcoming case.
- **Source-count parity:** homepage forward window (~7 rows) is a rolling display, not a total —
  parity N/A for the forward feed. The `/runlist` archive is the authoritative total (~1,033);
  the backfill must reach `#1458`. (No pagination — all 20 year-tables load on one page.)
- Sample events (VERBATIM from the live DOM — homepage `.RunList`; run notes reproduced as seen):
  1. **#2486** — Aug 16th 2026 — Black Horse, Rampton, **CB24 8QE** — hares **U Bend and Shamcock**
     — 11:00 — note "Pub will not open before 12. Pee before leaving home or in the woods. Park in
     car park to the left…" *(carries the `.nextRun` CSS class)*
  2. **#2487** — Aug 23rd 2026 — **TBD**, Anywhere, CB1 2JW — hares **Hooker and Kermit** — 11:00
     *(venue undecided → leave `location` undefined; CB1 2JW is a generic Cambridge placeholder)*
  3. **#2488** — Aug 30th 2026 — Rose & Crown, Somersham, **PE28 3EE** (Tel 01487 506625) — hare
     **Muthatuka** — 11:00 — note "A - B run. Meet up at the pub. Runners to car share to start of
     run. Walkers tour of Somersham to a good beer stop"
  4. **#2489** — Sep 6th 2026 — People's Hall, Toft, **CB23 2RE** — hare **Paparazzi** — 11:00 —
     note "Toft Beer Festival"
  5. **#2490** — Sep 13th 2026 — **TBD**, Anywhere, CB1 2JW — hare **Wrong Way** — 11:00
  - Oldest archive rows (verbatim, `/runlist`): **#1458** Sep 9th 2006 — Village Inn, Witchford,
    CB6 2HQ — hare Ettles; **#1459** Sep 23rd — Plough, Birdbrook, CO9 4BJ — Slops and Haven't Got
    One; **#1460** Sep 30th — White Horse, Waterbeach, CB25 9HP — Thumper and Kinky.
- **Run numbers are VERBATIM** — the source labels every run `Run NNNN` (no `#`). There are **no
  theme titles** — event names like "Toft Beer Festival" / "Seaside Run" appear only as trailing
  **notes/description**, not as a title. → leave `title` undefined; `merge.ts` synthesizes
  "Cambridge H3 Trail #N".
- History depth / pagination: `/runlist` = **20 per-year `<table>`s** captioned
  `Runs X-Y  Years A/B` (newest table first), **#1458 (2006) → #2490 (present) ≈ 1,033 runs**,
  columns `Date | Run | Relive | Venue | Hare` (older tables append a `Scribe` column). Single
  page, no pagination. **Worth a one-shot frozen backfill.**
- Coord sanity: **no coords** in the source (venue + postcode only; the on-page "map" is a Blazor
  component, not a Maps URL) → geocode the postcode; **no default-pin trap**. For `TBD`/`Anywhere`
  rows leave location + coords undefined.
- End times: **none** (no per-run end time). `startTime` is not printed per-row → constant
  **"11:00"** from the kennel schedule ("meets every Sunday … 11am sharp").
- Notes: **JS-rendered Blazor SPA → `browserRender` required** (see above). `Tel:` numbers appear on
  some rows (drop — PII-ish venue phone, not needed). Per-event cost overrides appear occasionally
  (e.g. #2482-style seaside runs: "£20 for bus and BBQ") → `Event.cost` only when a row differs
  from the £3 kennel default.
- **Field-fill assertion table** (from the ~7 sampled homepage rows):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 7 | No themes — leave undefined → merge synthesizes "Cambridge H3 Trail #N" |
  | `startTime` | 0 / 7 (not printed) | Constant `"11:00"` from schedule (Sunday 11am sharp) |
  | `endTime` | 0 / 7 | none — accept absence |
  | `location` (venue) | 5 / 7 | Venue segment before the first comma; leave undefined for `TBD`/`Anywhere` |
  | `locationStreet` | 7 / 7 (town + postcode) | Town + UK postcode; TBD rows use generic `CB1 2JW` (drop as street, leave undefined) |
  | `locationUrl` (Maps) | 0 / 7 | On-page map is a Blazor widget, not a URL — geocode postcode instead |
  | `hares` | 7 / 7 | `Hare: <names>` line — split on ` and `/`,` (sort before join for idempotency) |
  | `cost` | 0 / 7 (row-level) | Kennel default `£3` on `Kennel.hashCash`; per-event override only when a row states one |
  | `description` | ~4 / 7 | Trailing note text after the `Hare:` line (theme, parking, beer-festival, A-B run) |
  | `trailLengthText` | 0 / 7 | Not in feed — leave undefined |
  | `coords` (lat/lng) | 0 / 7 | Not in feed — geocode postcode; fallback Cambridge centroid |

## Kennel metadata (deep-dive complete)
- fullName: **Cambridge Hash House Harriers** / shortName: **Cambridge H3** / region: **Cambridge**
  (new METRO) / country: **UK**
- aliases: **["Cambridge Hash House Harriers", "Cambridge Hash"]** — 🔴 bare **"CH3" OMITTED**
  (global collision: Chicago `ch3`, Charlotte `ch3-nc`, Charleston `ch3-sc`, Copenhagen `ch3-dk`)
- website: **https://www.ch3.co.uk/** (DNS Status 0) / facebook: **none found** / instagram: **none**
  / twitter: **none** / discord: **none** — 🔴 the kennel publishes **email contacts + a Google
  email group only** (`enquiries@ch3.co.uk`, `grandmaster@`, `haraiser@`, `webmaster@`); the
  `/contacts` page carries zero social links → **leave socials blank + flag**.
- schedule: **Sunday, 11:00 AM, Weekly** (source: ch3.co.uk home — "The Cambridge hash meets every
  Sunday throughout the year, starting at 11am sharp"). Single pattern → flat fields suffice (no
  `scheduleRules` needed).
- foundedYear: **1978** (source: ch3.co.uk/Hashtory — "The Cambridge Hash started … in the personal
  column of the Cambridge Evening News of September 11th, 1978")
- hashCash: **"£3"** (source: ch3.co.uk home — "The run cost is £3 (GB pounds). Free on your first
  visit!")
- dogFriendly: **unstated → blank + flag**
- walkersWelcome: **true** (source: run notes routinely provide a walkers' route, e.g. #2488
  "Walkers tour of Somersham") — mild inference; flag if you want it stricter
- description: "A drinking club with a running problem — a non-competitive run around the
  Cambridgeshire countryside every Sunday at 11am, followed by a beer in a local pub. New runners
  and visitors especially welcome; first run free." (source: ch3.co.uk home)
- logoUrl: **https://www.ch3.co.uk/images/ch3logo.gif** (stable own-domain GIF, not tokenized) —
  ⚠️ self-host to `public/kennel-logos/cambridge-h3.<ext>` and confirm the real extension via magic
  bytes (`GIF8` = GIF; don't pre-fill `.gif`).
- lat/lng: Cambridge, England ≈ **52.2053, 0.1218** (kennel-level; events geocode their own postcode)

## Historical backfill
- Available: **~1,033 runs** (`/runlist`, run **#1458 Sep 2006 → #2490 Sep 2026**) — fields:
  date (month sub-header + ordinal day), run #, venue + town + postcode, hares (+ scribe in older
  tables — ignore). No coords/time/description in the archive table.
- Plan: **one-shot `scripts/backfill-cambridge-h3-history.ts`** — `browserRender('/runlist',
  { waitFor: 'table', timezoneId: 'Europe/London', timeout: 30000 })`, parse all 20 year-tables,
  freeze the curated rows to `scripts/data/cambridge-h3-history.json` + a dumb loader (H7
  frozen-dataset pattern; **commit the JSON, not the throwaway parser**). Strict `date < today` so
  it never overlaps the forward adapter.
  - 🔴 **Year resolution is the one tricky bit.** Each table is captioned `Years A/B` and spans a
    "hash year" (AGPU-to-AGPU, ~October boundary); the data rows carry only a month sub-header +
    ordinal day (no year). Do **not** hard-code an Oct/Sep split from this handoff — derive it at
    build: walk runs **newest→oldest**, stepping ~7 days per run and snapping to each row's
    month/day, using the caption's two years as the candidate set, then **validate** with the
    frozen-dataset checklist (run-number monotonicity; per-step gap 8.5–40 d; UTC-noon `Date.UTC`
    round-trip). This self-corrects the year at each table boundary.
  - PII scrub the frozen JSON (drop `Tel:` numbers; hares are hash-names, keep).

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Add under a new "England (outside London)" grouping.
{
  kennelCode: "cambridge-h3", shortName: "Cambridge H3", fullName: "Cambridge Hash House Harriers", region: "Cambridge",
  website: "https://www.ch3.co.uk/",
  logoUrl: "/kennel-logos/cambridge-h3.<ext>", // ⚠️ self-host ch3.co.uk/images/ch3logo.gif; confirm ext via magic bytes
  scheduleDayOfWeek: "Sunday", scheduleTime: "11:00 AM", scheduleFrequency: "Weekly", // 12-hr in scheduleTime
  foundedYear: 1978, hashCash: "£3",
  walkersWelcome: true,
  description: "A drinking club with a running problem — a non-competitive Sunday-morning run around the Cambridgeshire countryside at 11am, followed by a beer in a local pub. First run free.",
  latitude: 52.2053, longitude: 0.1218,
  // dogFriendly / facebookUrl / instagramHandle / twitterHandle: unverified — left blank (flagged)
},

// aliases.ts — Record<string, string[]> keyed by kennelCode (NOT slug). Bare "CH3" OMITTED (global collision).
"cambridge-h3": ["Cambridge Hash House Harriers", "Cambridge Hash"],

// sources.ts — Source[] (array of objects). Forward hareline (rolling window → upcomingOnly).
{
  name: "Cambridge H3 Website",
  url: "https://www.ch3.co.uk/",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 90,                     // forward window is narrow (~7 runs); backfill handles history
  config: { upcomingOnly: true },     // homepage .RunList is a rolling window → protects reconcile
  kennelCodes: ["cambridge-h3"],
},
```

## Adapter notes / new-scraper plan

**This is NOT config-only** — the site is a Blazor SPA with no REST/JSON feed and no SSR, so it
needs a NEW bespoke `browserRender` HTML adapter. Model on **`src/adapters/html-scraper/northboro-hash.ts`**
(the canonical `browserRender` scraper) for the fetch plumbing, and **`dublin-hash.ts` /
`burlington-hash.ts`** (Donnington/Herts run-row shape) for field cleaning.

**Fetch + parse plan (forward adapter — homepage):**
- `browserRender({ url: "https://www.ch3.co.uk/", waitFor: ".RunList", timezoneId: "Europe/London", timeout: 30000 })`
  → Cheerio-load the returned HTML.
- Container: `div.RunList`. Its children alternate: `<h3>` month headers text **"Month YYYY"**
  (e.g. "September 2026") and run `<div>`s. The next upcoming run's div carries class **`.nextRun`**.
- Each run `<div>` text (after `stripHtmlTags(html, "\n")` / normalized whitespace):
  `Run <NNNN> <Mon> <Dth> - <Venue> , <Town>, <POSTCODE>[ - Tel: <num>]` then `Hare: <names>` then
  optional note/description line(s).
- Year comes from the **preceding `<h3>` "Month YYYY"** header (unambiguous — do NOT infer). Combine
  with the run div's `Mon Dth` → **UTC noon** (`Date.UTC(y, m-1, d, 12)`); validate the round-trip.
- Fields: `runNumber` = the integer after `Run`; `hares` = the `Hare:` line (split on ` and `/`,`,
  **sort before join** for fingerprint idempotency); `location` = venue segment (undefined if `TBD`);
  `locationStreet`/postcode from the town+postcode segment (undefined for the `CB1 2JW` placeholder);
  `description` = trailing note; `startTime` = constant **"11:00"**; `title` **undefined** (synth).
  No coords → geocode postcode downstream.
- `config.upcomingOnly: true`; honor `options.days` via `buildDateWindow`.
- 🔴 **Fail-loud guard** — single-page, single-container source: if the parsed run rows come back
  empty (Blazor didn't render, or `.RunList` markup drifted), push a `ParseError` into `errors[]`
  (and `errorDetails.parse`) so `scrape.ts` suppresses stale-event reconciliation. A brand-new
  source has a 0 baseline, so the zero-event health alert can't catch a silent empty scrape.
- Register the adapter in `htmlScrapersByUrl` keyed on the `ch3.co.uk` host.

**Backfill script (`/runlist`):** see **Historical backfill** above — same `browserRender` call
waiting on `table`, parse the 20 year-tables, resolve years by newest→oldest weekly walk, freeze to
`scripts/data/cambridge-h3-history.json`.

**⚠️ Claude Code: verify before writing real code.** Any snippet above is illustrative; the live
repo is authority:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); `walkersWelcome` is the
  `Kennel` field (NOT `walkerFriendly`). Check `prisma/schema.prisma`.
- Imports — `browserRender` from `@/lib/browser-render`; date/extract/`stripHtmlTags` helpers from
  `@/adapters/utils`; `extractHashRunNumber` keys on `#` so it won't fit "Run NNNN" — use a local
  `/^Run\s+(\d+)\b/`.
- `kennelPagesStopReason` — set ONLY on genuine truncation (browserRender error / empty render);
  leave null on a clean parse. A non-empty string suppresses stale-event reconciliation.
- `title` — leave `undefined`; never let a note fragment or hare name become the title.
- Dates as **UTC noon**, `startTime` `"11:00"` string, `cuid()` IDs.

**Region — Cambridge METRO = 2 `region.ts` edits (NO inference / NO COUNTRY_GROUP_MAP):**
1. `REGION_SEED_DATA` — add the METRO under the "UK — England (outside London)" block, mirroring
   Bristol/Newcastle exactly:
   ```ts
   {
     name: "Cambridge",
     country: "UK",
     timezone: "Europe/London",
     abbrev: "CAM", // grep-free ("CMB" is taken)
     colorClasses: "bg-violet-100 text-violet-700",
     pinColor: "#8b5cf6",
     centroidLat: 52.2053,
     centroidLng: 0.1218,
     aliases: ["Cambridge, England", "Cambridgeshire"],
   },
   ```
2. `STATE_GROUP_MAP` — add `"Cambridge": "United Kingdom",` in the UK block.
- 🔴 **NO `COUNTRY_INFERENCE_RULES` edit** — the UK rule already covers `england`
  (`/\b(uk|england|scotland|wales|london|surrey|sussex)\b/`), and the seed kennel carries an explicit
  `country`. Do **NOT** add bare `cambridge` — it collides with **Cambridge, MA** (US), and
  `inferCountry()` is first-match with a USA fallthrough. **NO `COUNTRY_GROUP_MAP` edit** (UK metros
  resolve via `STATE_GROUP_MAP`; Surrey/Bristol/Sheffield precedent).

## Deep-dive checklist (nothing deferred)
- [x] logo (stable own-domain GIF; flag self-host + magic-byte ext)  [x] foundedYear 1978 (Hashtory)
  [x] socials (none on site — email/Google-group only → blank+flag)  [x] schedule (Sun 11:00 weekly)
  [x] hashCash £3 (first free)
- [x] description  [x] source live-verified (Chrome DOM; browserRender feed flagged to confirm at build)
  [x] history depth assessed (~1,033 runs, /runlist)
- [x] coord sanity (none in feed → geocode postcode; no default-pin trap)  [x] end times (none)
  [x] kennelCode collision-checked (`cambridge-h3`; bare "CH3" omitted)  [x] kennelCodes source guard set

## Sibling sweep
Cambridge H3's source (`ch3.co.uk`) is **single-kennel** — the `/runlist` and homepage carry only
Cambridge H3's own runs (no co-hosted siblings on this source). Its `/AwayHashing` page enumerates
neighbouring clubs; two are **not yet on HashTracks and are clean future refill leads** (separate
sources, separate onboards): **Milton Keynes H3** ("Always run at 7pm on Monday nights", own site)
and **Spa H3** (Coventry/Warwickshire — "2nd Thursday 7pm & 4th Sunday 11am"). Herts H3, FUKFM, and
Essex H3 (also listed) are already handed off; Norfolk H3 is live. Added to the queue Leads below.

## Implementation gotchas (for Claude Code — repo knowledge, not source knowledge)
- **Blazor SPA → `browserRender` is mandatory** and is the single build risk. Wait on a content
  selector (`.RunList` / `table`), lift `timeout` to 30000, set `timezoneId: "Europe/London"`. If
  the NAS render can't drive the SignalR hydration, escalate before shipping a 0-event adapter.
- **Rejecting upstream coords needs `dropCachedCoords: true`** — N/A here (no upstream coords), but
  don't invent coords; geocode the postcode.
- **`config.upcomingOnly: true` is required** — the homepage `.RunList` is a rolling ~7-run window
  that ages out; without it `reconcile.ts` false-cancels past runs.
- **Tests:** `vi.spyOn(globalThis, "fetch")` accumulates `.mock.calls` — add
  `beforeEach(vi.restoreAllMocks)`. Save a real `.RunList` fixture (mirror the live DOM: `div.RunList`
  > `h3` "Month YYYY" + run `div`s, one with `.nextRun`) and a real `/runlist` year-`<table>` fixture.
- **Sonar S5852 / S5843** — parse month via a `Map` 3-letter lookup or `chronoParseDate`, not a
  month-name alternation; keep the `Run NNNN` / date regexes simple (single `\s`, no stacked `\s*`).
- **`Number.parseInt(s, 10)`**, `replaceAll`, no negated ternaries — the usual adapter-PR Sonar nits.
- **Self-host the logo** into `public/kennel-logos/cambridge-h3.<ext>`; confirm ext via magic bytes
  (`GIF8` → `.gif`). Never pre-fill the extension.
- **`shortName: "Cambridge H3"` is >4 chars** → `friendlyKennelName` short-circuits cleanly to it
  ("Cambridge H3 Trail #N"); no fullName-derivation risk.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is
the brief — no separate prompt needed._
