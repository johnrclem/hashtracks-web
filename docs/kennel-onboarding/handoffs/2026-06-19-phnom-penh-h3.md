# Onboarding Handoff — P2H3 (Phnom Penh, Cambodia) — 2026-06-19

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/phnom-penh-h3-20260619`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the **Cambodia COUNTRY +
>    Phnom Penh METRO** region records — this is the **first 🇰🇭 Cambodia kennel**, so do all **5
>    `region.ts` edits** in the New-country checklist below (REGION_SEED_DATA ×2, STATE_GROUP_MAP,
>    COUNTRY_GROUP_MAP, COUNTRY_CODE_TO_NAME, COUNTRY_INFERENCE_RULES). No `seed.ts stateMetroLinks`
>    needed (2-level COUNTRY→METRO, mirror the Poland/Warsaw + Nepal/Kathmandu precedent).
> 3. Implement the **NEW `PhnomPenhH3Adapter`** exactly as in **Adapter notes** (static Cheerio; NOT
>    config-only — see effort note).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` —
>    call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'` snippet. Validate: events non-empty
>    + upcoming, dates UTC-noon, `startTime` "HH:MM", `kennelTag` resolves with no unmatched. Resolve
>    every `⚠️ Claude Code must confirm` item below. **DO NOT run `npx prisma db seed` here.**
> 5. Optional (low priority): a small `/news/<n>` recent-history backfill — see **Historical backfill**.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive checklist.
> 8. **Post-merge runbook (separate step, after the PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (`git log -1 -- <path>` for the adapter, region.ts,
>      seed files, and any backfill script — squash-merge sometimes drops a follow-up commit).
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive)
>    - Trigger a scrape from `/admin/sources` to publish events to prod
>    - Spot-check `hashtracks.xyz/kennels/phnom-penh-h3` for the expected event count + sample dates.

## Summary
- Type: **full onboard**
- Adapter: **HTML_SCRAPER (NEW `PhnomPenhH3Adapter`)** — Grav CMS SSR'd run tables + `/news/<n>` detail
  enrichment. NOT config-only (year-bearing multi-format dates across surfaces, `maps.app.goo.gl`
  locationUrls, placeholder stripping, multi-surface merge).
- Effort estimate: **NEW small Cheerio adapter ~180–260 LoC + tests.** Model on `dublin-hash.ts`
  (table iteration) + `bangkok-monday-hash.ts` / Kaohsiung (dual-surface merge by run #, per-run
  fail-loud guard, `maps.app.goo.gl` → `locationUrl`).
- One-line: First 🇰🇭 **Cambodia** kennel — Phnom Penh's weekly-Sunday country-bus hash (run #1841,
  fully SSR'd, rich `/news` detail pages with hares/venue/Maps/distances), opens the Cambodia region.

## Dedup result
- Kennel in seed: **no** (grep `phnom|p2h3|pph3|cambodia` in kennels/aliases/sources → only hit is
  `pph4`'s alias `"PPH3"`, an unrelated Pikes Peak code — see collision note).
- Source in seed: **no**.
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP
  2026-06-19, **447 kennel slugs**, zero matches for `phnom|cambodia|p2h3|pph3`.
- DNS check (non-platform domain `p2h3.com`): **Status 0 (OK)**, A record `51.161.122.78` (via
  `dns.google/resolve`, Chrome). Domain exists and resolves.
- Pre-onboarding admin-event check: kennel not live (no slug) → no pre-seeded admin `Event` rows to
  dedup/purge. (If Claude Code finds any under `phnom-penh-h3` at build, list + purge before scrape.)
- Decision: **full onboard** (kennel + aliases + source + Cambodia region).
- kennelCode: `phnom-penh-h3` (collision check: **clear** — `phnom-penh-h3`/`p2h3`/`pph3` all free as
  codes; descriptive city slug chosen over the ambiguous bare shortcodes per convention).

## Live source verification ✅
- Source: HTML_SCRAPER — `https://www.p2h3.com/` (home page; SSR'd, `text/html`). Verified live via
  `web_fetch` 2026-06-19 (sandbox has no raw network; `web_fetch` renders the full SSR HTML).
- Platform: **Grav CMS** (flat-file PHP CMS) — pages render markdown-style pipe tables into real
  `<table>` HTML; fully server-side rendered (no JS needed, no browserRender). New platform → see the
  **Grav CMS** section appended to `source-platform-notes.md`.
- Events seen: **6 upcoming** (run #1841–#1846), date range **2026-06-21 → 2026-07-25**, plus 3 recent
  past runs (#1839–#1841) fully detailed on `/news`.
- **Source-count parity:** the home page is the authoritative forward feed; it lists exactly the next
  6 runs (#1841 in "This week's Hash" + #1842–#1846 in "Upcoming Hashes"). No paginated upcoming feed
  exists → parity N/A (capture all 6, no page-size lift needed). Recently-active rule is satisfied
  many times over (real future dates 2–5 weeks out).
- **Sample events (VERBATIM from source — run numbers and dates are real):**

  Home page **"This week's Hash"** table (richest forward row):
  1. **#1841** — 21.06.2026 — By: **Bus** — Hares: **Short Stump & Just Quynh Anh** —
     A-Site: `https://maps.app.goo.gl/RToGwFS82tzuHdzX9` — B-Site: "A-site=B-site" (same link) —
     Remarks: *"Meeting at Villa Grange (`maps.app.goo.gl/wySQEUK46wW5cmiu6`) 13.45 for 14.00 departure,
     don't be late! On On On at Villa Grange"*

  Home page **"Upcoming Hashes"** table (sparse — venues/hares often TBC):
  2. **#1842** — 27.06.2026 — By: TBC — Hares: **Fracking Trumpster** — A/B: TBC — Remarks: "Saturday Hash!"
  3. **#1843** — 05.07.2026 — By: TBC — Hares: **Hares Needed!** — A/B: TBC — Remarks: "/N/A"
  4. **#1844** — 12.07.2026 — By: TBC — Hares: **Hares Needed!** — A/B: TBC — Remarks: "/N/A"
  5. **#1845** — 19.07.2026 — By: TBC — Hares: **Hares Needed!** — A/B: TBC — Remarks: "/N/A"
  6. **#1846** — 25.07.2026 — By: TBC — Hares: **Cheap Date and Loan Shark** — A/B: TBC — Remarks: "Saturday Hash!"

  `/news/<n>` **detail pages** (and the `/news` index, which SSRs the 3 latest in full) — much richer:
  - **#1841** (`/news/1841`): *"Run No. 1841 / Date/Time:- Sunday 21st June 2026 / (A-A Run) - A-point /
    Meeting Point: Villa Grange, meeting at 13.15 for 13.30 departure / Location: Pothiprek Pagoda
    (`maps.app.goo.gl/7zHMnvXwwKReFwGj6`) / Walking : 5km / Running : 10km / On On: Villa Grange /
    Hares: Short Stump & Just Quynh Anh"*
  - **#1840** (`/news/1840`): Sunday 14th June 2026; Location: **Preah Vihear Komboar Pagoda**;
    Walking 5km / Running 10km; On On: Villa Grange; Hares: **Sucking Fag, IT Can't Paint & Pol Snot**.
  - **#1839** (`/news/1839`): Sunday 7th June 2026; Meeting: Areykasat Ferry; Location: **Wat Sovan Sakor**;
    Walking 5km / Running 10km.

- History depth / pagination: **shallow on-site archive.** The `/news` collection publishes only the
  most recent ~13 runs (nav lists **#1829 → #1841**; `/news/1000` and other out-of-range numbers
  **302-redirect to the home page** → no deep archive). Run #1841 ≠ archive depth. ~12 reachable past
  runs (#1829–#1840, ~late-Mar → mid-Jun 2026) via `/news/<n>`. Atom/RSS exist (`/news.atom`,
  `/news.rss`) but returned as binary to the sandbox fetcher → ⚠️ Claude Code can confirm RSS depth at
  build, but expect it mirrors the shallow `/news` set.
- Coord sanity: **no decimal coords anywhere** — all venues/A-sites are `maps.app.goo.gl` shortlinks.
  Store as `locationUrl`; leave `latitude`/`longitude` undefined → merge geocodes the venue text /
  Phnom Penh centroid. **No default-pin corruption trap** (nothing to reject).
- End times: none per-event. (FAQ says the bus returns to Villa Grange ~7 pm — a kennel-level return
  estimate, not an event end timestamp; do not synthesize `endTime`/`endDate`.)
- Notes / cross-surface inconsistencies to handle (confirmed by reading multiple surfaces):
  - **🔴 Two date formats carry the year (NO inference needed):** home tables use `DD.MM.YYYY` (dots);
    `/news` detail uses `Sunday 21st June 2026` (weekday + ordinal + month-name + year); the
    `/hare_line` page uses `DD-MM-YYYY` (dashes). Parse each surface's own format; all are
    year-bearing.
  - **🔴 `/hare_line` is stale/sparser — prefer Home + `/news`.** Hare Line listed #1841 hares as
    "Short Stump & **Octopussy**" while the Home table and `/news/1841` both say "Short Stump & **Just
    Quynh Anh**". Hare Line only carried 2 rows vs the Home "Upcoming" table's 5. **Do not parse
    `/hare_line`** — the Home page (forward backbone) + `/news` (detail) are authoritative and richer.
  - **🟡 #1841 departure-time disagreement across surfaces:** Home "This week" Remarks = "13.45 for
    **14.00** departure"; `/news/1841` = "13.15 for **13.30** departure"; FAQ standard = "bus leaves
    promptly at **1:30 pm**". Treat the `/news` detail departure as the per-event `startTime` when a
    detail page exists; else fall back to the kennel `scheduleTime` 13:30. Don't hard-fail on the
    mismatch — it's a source inconsistency.
  - **Placeholders to strip → `undefined`/`null` (never store literally):** `TBC`, `TBA`,
    `Hares Needed!`, `N/A`, `/N/A`. The "By" column value `Bus` is a logistics note (bus run), not a
    hare — don't map it to `hares`.
  - **`maps.app.goo.gl` shortlinks → `locationUrl` only** (no extractable decimal coords; do NOT try
    to resolve them in-adapter).

- **Field-fill assertion table** (over the 6 forward runs + `/news` enrichment for the ~3 most recent):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 6 (clean themes) | Remarks are run-type notes ("Saturday Hash!") / "/N/A", NOT themes → leave `title` undefined; `merge.ts` synthesizes "Phnom Penh H3 Trail #N". Optionally route "Saturday Hash!" to `description`. |
  | `startTime` | ~3 / 6 | From `/news` "for HH.MM departure" (→ "13:30") on detail-page runs; fallback to kennel `scheduleTime` 13:30. Home Remarks free-text parse is optional/brittle. |
  | `endTime` | 0 / 6 | None per-event → leave undefined. |
  | `location` (venue name) | ~3 / 6 | From `/news` detail `Location:` (Pothiprek Pagoda, Preah Vihear Komboar Pagoda, Wat Sovan Sakor). Home tables have no venue *name* (only A-site Maps link). Future TBC runs → undefined. |
  | `locationStreet` | 0 / 6 | Not in feed → undefined. |
  | `locationUrl` (Maps) | 1–3 / 6 | Home "This week" A-Site link (#1841) + `/news` `A-point`/`Location` links (recent 3). Upcoming TBC rows → none. |
  | `hares` | ~3 / 6 real | Home tables 6/6 but ~half are "Hares Needed!"/"TBC" → strip → ~3 real; `/news` detail confirms real ones. |
  | `cost` | 0 / 6 (per-event) | Kennel default "USD10 / USD7 Khmer" lives on `Kennel.hashCash`; only set `Event.cost` if a run overrides (none seen). |
  | `description` | low | Remarks free-text ("Saturday Hash!") + `/news` "Special instructions/comments" (mostly "N/A") → mostly undefined. |
  | `trailLengthText` | ~3 / 6 | `/news` detail "Walking 5km / Running 10km" → `trailLengthText` e.g. "10 km run / 5 km walk", `min/max` from the running figure (parse 6–10 km range per FAQ). Home tables → none. |
  | `coords` (lat/lng) | 0 / 6 | `maps.app.goo.gl` only → undefined; merge geocodes venue text / Phnom Penh centroid. |

## Kennel metadata (deep-dive complete)
- fullName: **Phnom Penh Hash House Harriers** (source: p2h3.com/about, p2h3.com title)
- shortName: **P2H3**  ·  kennelCode: **`phnom-penh-h3`**  ·  slug: **`phnom-penh-h3`**
- region: **Phnom Penh** (METRO)  ·  country: **Cambodia** (new COUNTRY)
- aliases: **["Phnom Penh", "Phnom Penh H3", "P2H3", "Phnom Penh Hash House Harriers"]**
  - 🔴 **OMIT "PPH3"** — already a global alias of `pph4` (Pikes Peak Hash, `aliases.ts:278`). `P2H3`
    is free (grep-confirmed).
- website: **https://www.p2h3.com/** (source: live)
- facebook: **https://www.facebook.com/groups/p2h3cambodia/** (source: p2h3.com footer)
- twitter/X: handle **`phnompenhh3`** → https://x.com/phnompenhh3 (source: p2h3.com footer)
- instagram: none found
- discord: none. (Other channels in footer: **Telegram** `t.me/phnompenhhash`, **Nostr**, **SimpleX
  Chat** — no DB field for these; note in `description` if desired.)
- schedule: **Sunday, 1:30 PM, Weekly** (source: p2h3.com/about "every Sunday"; p2h3.com/faq "bus leaves
  promptly at 1:30 pm from Villa Grange"). 🟡 Occasional **Saturday** special runs ("Saturday Hash!" on
  #1842, #1846) — the per-event table date is authoritative; keep `scheduleDayOfWeek: "Sunday"`
  (dominant + editorially confirmed) and rely on parsed dates for the actual weekday. A `scheduleRules`
  array is NOT warranted (no fixed Saturday cadence — they're ad-hoc specials).
- foundedYear: **⚠️ UNVERIFIABLE — leave blank + flag.** Not stated on p2h3.com (About/FAQ/Mismanagement),
  not on the Harrier Central `hashruns.org/P2H3-KH/about` page, and a web search surfaced no founding
  year. Do NOT infer from run #1841. (If Claude Code finds a milestone/anniversary post in `/news` or a
  primary source at build, fill it then — per the manual's milestone-post rule.)
- hashCash: **"USD10 (expats) / USD7 (Khmer) — includes transport & all beverages"** (source: p2h3.com/faq).
  Self-validated: no double-symbol/repeat typo.
- dogFriendly: **not stated** → leave blank.
- walkersWelcome: **true** (source: p2h3.com/faq "wide range of abilities, from runners to walkers…
  family Hash, everyone is welcome"; p2h3.com/about "you can just have a leisurely walk").
- description: *"The Phnom Penh Hash House Harriers (P2H3) are a 'drinking club with a running problem'
  that runs and walks the countryside around Phnom Penh every Sunday — a country bus departs Villa
  Grange (~1:30 pm) to rural trails (run ~6–10 km / walk ~4–6 km), followed by a circle and the On-On.
  Family-friendly, walkers and non-drinkers welcome."* (source: p2h3.com/about + /faq)
- logoUrl: **https://www.p2h3.com/user/themes/p2h3-theme/images/logo/logo_www.png** — a stable Grav
  *theme* asset path (NOT a tokenized CDN URL), so reasonably durable; still **recommend self-host** to
  `public/kennel-logos/phnom-penh-h3.<ext>` per convention. 🔴 **Confirm the real extension via magic
  bytes** (`curl -sI` + first bytes — declared `.png`, verify `\x89PNG`).
- lat/lng: not per-event. Phnom Penh metro centroid ≈ **11.5564, 104.9282** (use for the METRO region
  record / kennel fallback). Meeting point "Villa Grange, Phnom Penh" is the weekly bus start.

## Historical backfill
- Available: **~12 recent runs** (#1829–#1840, ~late-Mar → mid-Jun 2026) reachable as rich `/news/<n>`
  detail pages — fields: date, hares, venue name + `maps.app.goo.gl`, distances, On-On.
- Plan: **optional, LOW priority — not worth a frozen-dataset script.** The on-site archive is shallow
  (no deep history; `/news/1000` → home), and these ~12 runs are very recent. If Claude Code wants the
  recent past on the kennel page on day one, a tiny one-shot
  `scripts/backfill-phnom-penh-h3-history.ts` that fetches `/news/1829..1840`, reusing the adapter's
  exported per-post parser, is cheap (H7/Brasília pattern). Otherwise skip — the live adapter
  (`upcomingOnly: true`) handles all future runs and `/news` will keep ~13 recent runs visible.

## Ready-to-paste seed

> 🔴 `aliases.ts` is `Record<string, string[]>` keyed by **kennelCode** (NOT slug, NOT an object
> array). Confirmed shape: `"<kennelCode>": ["Alias One", "Alias Two"]`. (kennelCode == slug here, so
> the key is `"phnom-penh-h3"` either way.)

```ts
// kennels.ts — Kennel[] (array of objects)
{
  kennelCode: "phnom-penh-h3",
  shortName: "P2H3",
  fullName: "Phnom Penh Hash House Harriers",
  region: "Phnom Penh",            // METRO region name (see region.ts edits)
  country: "Cambodia",
  website: "https://www.p2h3.com/",
  facebookUrl: "https://www.facebook.com/groups/p2h3cambodia/",
  twitterHandle: "phnompenhh3",
  // scheduleDayOfWeek/scheduleTime kept as fallback; scheduleRules is authoritative (none here).
  scheduleDayOfWeek: "Sunday",
  scheduleTime: "1:30 PM",         // 🔴 12-hr "H:MM AM/PM" in the Kennel profile field (NOT 24-hr).
  scheduleFrequency: "Weekly",
  hashCash: "USD10 (expats) / USD7 (Khmer) — includes transport & beverages",
  walkersWelcome: true,
  // foundedYear: omitted — unverifiable (do not invent).
  // dogFriendly: omitted — not stated.
  description: "The Phnom Penh Hash House Harriers (P2H3) are a 'drinking club with a running problem' that runs and walks the countryside around Phnom Penh every Sunday — a country bus departs Villa Grange (~1:30 pm) to rural trails (run ~6-10 km / walk ~4-6 km), then a circle and the On-On. Family-friendly; walkers and non-drinkers welcome.",
  logoUrl: "/kennel-logos/phnom-penh-h3.<ext>", // self-host from p2h3.com theme logo; confirm ext by magic bytes
  latitude: 11.5564,
  longitude: 104.9282,
}

// aliases.ts — Record<string, string[]> (keyed by kennelCode)
"phnom-penh-h3": ["Phnom Penh", "Phnom Penh H3", "P2H3", "Phnom Penh Hash House Harriers"],
// 🔴 do NOT add "PPH3" — global collision with pph4 (Pikes Peak).

// sources.ts — Source[] (array of objects). Include scrapeDays!
{
  name: "Phnom Penh H3 Website",
  url: "https://www.p2h3.com/",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 90,                  // narrow forward feed (~6 runs out)
  config: { upcomingOnly: true },  // forward tables age out → suppress reconcile false-cancel
  kennelCodes: ["phnom-penh-h3"],
}
```

### New-country region edits (`src/lib/region.ts`) — all 5, mirror Poland/Warsaw + Nepal/Kathmandu

> 🔴 Cambodia is the **first 🇰🇭 kennel** → `inferCountry()` defaults to `"USA"` without rule #5.

1. **`REGION_SEED_DATA`** — add COUNTRY + METRO (illustrative; mirror the Poland block at
   `region.ts:1888`, pick an Asia palette distinct from neighbors — scan existing Bangkok/Singapore/
   Tokyo/Nepal entries; avoid trailing-zero literals per Sonar S6749):
   ```ts
   // ── Cambodia (first 🇰🇭 kennel: Phnom Penh H3) — 2-level COUNTRY→METRO, mirror Poland/Nepal ──
   {
     name: "Cambodia", country: "Cambodia", level: "COUNTRY",
     timezone: "Asia/Phnom_Penh", abbrev: "KH",
     colorClasses: "bg-rose-200 text-rose-800", pinColor: "#e11d48",  // pick a free Asia palette
     centroidLat: 12.5657, centroidLng: 104.991,
     aliases: ["KH", "Kingdom of Cambodia"],
   },
   {
     name: "Phnom Penh", country: "Cambodia",
     timezone: "Asia/Phnom_Penh", abbrev: "PNH",
     colorClasses: "bg-rose-100 text-rose-700", pinColor: "#f43f5e",  // lighter shade + diff pin
     centroidLat: 11.5564, centroidLng: 104.9282,
     aliases: ["Phnom Penh, Cambodia"],
   },
   ```
   (🔴 Country = darker `-200`, Metro = lighter `-100`, different pin hexes — confirm the chosen
   palette isn't already used by a sibling Asia region.)
2. **`STATE_GROUP_MAP`** — `"Phnom Penh": "Cambodia"` (canonical display name key).
3. **`COUNTRY_GROUP_MAP`** — `"Cambodia": "Cambodia"` (metro resolves via STATE_GROUP_MAP first, so
   only the country-group key is reachable here — mirror the Poland/Nepal comment at `region.ts:4026`).
4. **`COUNTRY_CODE_TO_NAME`** — `KH: "Cambodia"`.
5. **`COUNTRY_INFERENCE_RULES`** — `[/\b(cambodia|phnom\s*penh)\b/, "Cambodia"]`. Unambiguous tokens
   only ("cambodia" + "phnom penh"; omit bare ambiguous words). Add a disambiguation test mirroring the
   Warsaw-IN / Victoria-BC ones.

## Adapter notes / new-scraper plan

**NEW `PhnomPenhH3Adapter`** (static Cheerio; register in `htmlScrapersByUrl` keyed on `p2h3.com`).
Model on `dublin-hash.ts` (table iteration) + `bangkok-monday-hash.ts` / Kaohsiung (dual-surface merge
by run #, per-run fail-loud, `maps.app.goo.gl` → `locationUrl`). Two-surface design:

1. **Backbone — home page tables** (`fetchHTMLPage("https://www.p2h3.com/")`). Grav renders two
   markdown tables into `<table>`s: **"This week's Hash"** (1 row, richest: A-Site/B-Site Maps links +
   Remarks with the meeting/departure time) and **"Upcoming Hashes"** (≤5 rows, sparse). Iterate
   `$("table tr")`; require a numeric first cell (run #) AND `cells.length >= 4` to reject header/
   decorative rows. Columns: `Number | Date(DD.MM.YYYY) | By | Hares | A-Site | B-Site | Remarks`.
   Pull the run-link from the `Number` cell's `<a href>` (`/news/<n>`) for enrichment.
2. **Enrichment — `/news` detail** (the `/news` index SSRs the 3 latest full posts; or follow each
   `/news/<runNumber>` link). Per-post block: `Run No. NNNN`, `Date/Time:- Sunday 21st June 2026`,
   `Meeting Point: <venue> (Maps), meeting at HH.MM for HH.MM departure`, `Location: <venue> (Maps)`,
   `Walking : Nkm` / `Running : Nkm`, `On On: <venue> (Maps)`, `Hares: …`. **Match to backbone by run
   number;** prefer the detail page's `Location` name + departure `startTime` + hares + distances.
   (Don't fetch every `/news` link if it balloons request count — enriching just the current + next
   couple of runs is enough; the rest stay table-only.)

**Date parsing (all year-bearing — NO inference):**
- Home tables: `DD.MM.YYYY` (dots) → `Date.UTC(y, m-1, d, 12)`.
- `/news` detail: `Sunday 21st June 2026` → strip the weekday + the ordinal suffix (`/(\d)(?:st|nd|rd|th)\b/→$1`),
  then a loose `\b(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})\b` with month resolved via a `Map` keyed by
  full+abbrev names (generic word-token + exact `Map.get()`, NOT a month-name alternation — dodges
  Sonar S5843/S5852; the Kaohsiung pattern).
- **Do NOT parse `/hare_line`** (stale + `DD-MM-YYYY` variant; superseded by Home + `/news`).

**startTime:** from `/news` "for HH.MM departure" → "13:30" (note `.` separator → `:`); fallback to the
kennel `scheduleTime`. Home Remarks free-text time is optional.

**Placeholders → undefined/null:** strip `TBC`, `TBA`, `Hares Needed!`, `N/A`, `/N/A`. The `By` column
`Bus` is logistics, not a hare.

**Coords:** `maps.app.goo.gl` shortlinks → `locationUrl` only; `latitude`/`longitude` undefined (no
default-pin trap; merge geocodes).

**Fixture:** build the test fixture from the REAL DOM captured above (both home tables + a `/news`
detail block) — Grav emits standard `<table>`/`<thead>`/`<tbody>` and `<h5>`-anchored news posts.

**⚠️ Claude Code: verify before writing real code** (snippets above are illustrative; the live repo is
authority):
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); `walkersWelcome` (NOT
  `walkerFriendly`); check `prisma/schema.prisma` for canonical `Kennel` field names (`hashCash`,
  `scheduleDayOfWeek`, `scheduleTime`, `logoUrl`, `latitude`/`longitude`) before using.
- Imports — `fetchHTMLPage` + date/extract helpers from `@/adapters/utils`; `safeFetch` from
  `@/adapters/safe-fetch` (NOT raw `fetch`) if fetching `/news/<n>` directly.
- `kennelPagesStopReason` — set ONLY on genuine truncation (a `/news` fetch error / a full surface left
  unfetched); a non-empty string suppresses stale-event reconciliation. A clean shallow archive end is
  NOT truncation.
- `title` — leave `undefined` (no clean themes); `merge.ts` synthesizes "<Friendly> Trail #N". 🔴 P2H3
  is ≤4 chars → **verify `friendlyKennelName("P2H3","Phnom Penh Hash House Harriers")`** before shipping
  (`npx tsx -e 'import {friendlyKennelName} from "./src/pipeline/merge"; console.log(friendlyKennelName("P2H3","Phnom Penh Hash House Harriers"))'`);
  if it produces a verbose/garbled string, lengthen shortName (e.g. "Phnom Penh H3") or fix the helper
  (H7 retro lesson).
- **Single forward feed → mandatory fail-loud zero-row guard** (PER-RUN where you parse numbered
  blocks): if the tables parse to 0 rows (or a numbered block fails to parse), push an `errors[]` entry
  so `scrape.ts` suppresses reconcile — don't let the scrape "succeed" with `events: []` (a brand-new
  source has a 0 baseline, so the zero-event health alert won't fire). Per the Kaohsiung/Manila/AH3-NZ
  lessons.

**🟡 Optional secondary source — Harrier Central (`P2H3-KH`, config-only IF populated).** P2H3 also has
a Harrier Central listing (`hashruns.org/P2H3-KH`). HC is a **config-only** source type (existing
`HARRIER_CENTRAL` adapter — mirror Bandung/Barbados/Taiwan rows). **⚠️ I could NOT verify HC's upcoming
data from the sandbox** (HC pages are JS-rendered; `hashruns.org/api/global-runs` needs params the
sandbox can't pass). The **website is the verified, richest primary** (per-run venue/hares/Maps/
distances), so it's the right primary. If Claude Code wants a belt-and-suspenders secondary, evaluate
HC at build (capture P2H3's `publicKennelId` GUID from `hashruns.org/api/global-runs` via the browser;
add a `trustLevel:8` HC source with `upcomingOnly` OMITTED, `defaultKennelTag: "phnom-penh-h3"`,
`defaultTitle: "Phnom Penh H3"`). Optional — not required to ship.

## Deep-dive checklist (nothing deferred)
- [x] logo (stable theme path; recommend self-host + magic-byte ext)  [⚠️] foundedYear (unverifiable —
  flagged, not invented)  [x] socials (FB, X, Telegram/Nostr/SimpleX noted)  [x] schedule (Sunday 1:30 PM
  weekly + occasional Sat specials)  [x] hashCash (USD10/USD7)
- [x] description  [x] source live-verified (SSR HTML via web_fetch; DNS Status 0)  [x] history depth
  assessed (shallow ~13 `/news` posts; `/news/1000`→home)
- [x] coord sanity (no decimal coords — `maps.app.goo.gl` only; no default-pin trap)  [x] end times
  noted (none per-event)  [x] kennelCode collision-checked (`phnom-penh-h3` clear; `PPH3` alias omitted)
  [x] kennelCodes source guard set (`["phnom-penh-h3"]`)

## Implementation gotchas (for Claude Code — repo knowledge)
- **`config.upcomingOnly: true` is set** — the home forward tables age out (runs drop off after they
  pass), so without it `reconcile.ts` would false-CANCEL aged-off runs. Correct for this source.
- **Single-surface fail-loud guard** (above) — per-run + total-zero.
- **Sonar S5843/S5852:** month parse via generic word-token + `Map.get()` (no alternation); ordinal/
  date regexes simple (single `\s`, no `\s*`-adjacent-`.+`). Use `Number.parseInt(s,10)`,
  `s.replaceAll(...)`, `RegExp.exec()` for captures, no negated ternaries.
- **Self-host the logo** to `public/kennel-logos/phnom-penh-h3.<ext>`; literal `<ext>` placeholder —
  confirm by magic bytes (declared `.png`).
- **Codacy `eslint-plugin-security`** (not in local lint): prefer `Map.get()` / `for…of` over
  `obj[var]` indexing in the new adapter.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the
brief — no separate prompt needed._
