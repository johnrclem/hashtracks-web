# Onboarding Handoff — Colombo Harriettes (Colombo, Sri Lanka) — 2026-06-22

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/colombo-harriettes-20260622`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the **Sri Lanka
>    COUNTRY + Colombo METRO** region records (5 `region.ts` edits, see **Adapter notes → Region**).
> 3. Implement the **new `ColomboHarriettesAdapter`** exactly as in **Adapter notes** (single
>    current-run SSR block, static Cheerio — confirmed SSR from the sandbox; model on
>    `src/adapters/html-scraper/warsaw-h3.ts` and `manila-h3.ts`).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` —
>    call `adapter.fetch(source)` via `npx tsx -e '…'`. 🔴 **At research time the site is in its
>    between-postings PLACEHOLDER state** ("Next run / We will announce soon" — Run #2223 ran
>    2026-06-20, 2 days before this handoff). So `adapter.fetch` will legitimately return **0 events**
>    until the committee posts the next Saturday run. Validate: (a) placeholder state → 0 events,
>    `errors: []` (clean, NOT a parse error); (b) when a run IS posted, the block parses to 1 event
>    with date UTC-noon, `startTime` "HH:MM", `kennelTag` resolves. 🔴 **You must capture the real
>    FILLED-state "Next run" DOM at build time** (the exact wrapper markup is unconfirmed — the site
>    was in placeholder state during research) and build the test fixture from it. **DO NOT run
>    `npx prisma db seed` here.**
> 5. Optional: the single-run **Historical backfill** (Run #2223) — see **Historical backfill**.
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive checklist.
> 8. **Post-merge runbook (after PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (`git log -1 -- <path>` for the adapter, the
>      seed edits, `region.ts`, the logo, and any backfill script). Squash-merge can silently drop a
>      follow-up commit — open a small recovery PR if anything's missing.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed`
>    - Trigger a scrape from `/admin/sources`. 🔴 Expect **0 events on the first scrape if the site is
>      still in placeholder state** — that's correct. The next run auto-appears on the first scrape
>      after the committee posts it. (If you seeded the optional #2223 backfill, the page shows that
>      one recent run immediately.)
>    - Spot-check `/kennels/colombo-harriettes`.

## Summary
- Type: **full onboard**
- Adapter: **HTML_SCRAPER** (NEW `ColomboHarriettesAdapter` — single current-run SSR block, static Cheerio; ~120–170 LoC + tests). **NOT config-only** (bespoke single-block parse).
- Effort estimate: small new Cheerio adapter (~120–170 LoC + tests), mirror `warsaw-h3.ts` / `manila-h3.ts`. Plus 5 `region.ts` edits (first Sri Lanka country).
- One-line: **First Sri Lanka kennel** — Colombo Hash House Harriettes (mixed-gender, est. 20 Jun 1984), a custom Next.js site with a single SSR "Next run" block. Opens the Sri Lanka region.

## Dedup result
- Kennel in seed: **no** (grep `prisma/seed-data/kennels.ts` — no Colombo / Sri Lanka entry).
- Source in seed: **no** (grep `sources.ts` — no `hashcolombo.com`).
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP (2026-06-22, **448 slugs**). No `colombo` / `lanka` / `ceylon` / `srilanka` slug. The two `harriettes`-matching slugs are unrelated: `harriettes` = **Harriettes HHH, NYC, USA** (opened `/kennels/harriettes` → rendered "Harriettes Hash House Harriers · NYC USA"), `bkk-harriettes` = Bangkok Harriettes. Neither is Colombo.
- Decision: **full onboard.**
- kennelCode: `colombo-harriettes` (collision check: **clear** — `grep -i '"colombo-harriettes"'` and `'"chhh"'` both empty in `kennels.ts`/`aliases.ts`). slug = `colombo-harriettes` (ASCII-clean → no `slug:` override needed).
- Pre-onboarding admin-event check: no admin-seeded `Event` rows expected (brand-new kennel, never live). Confirm against prod at build; purge any stray admin rows before first scrape.

## Live source verification  ⚠️ filled-state DOM needs Claude Code to capture at build
- Source: **HTML_SCRAPER** — `https://hashcolombo.com/` (home page "Next run" block).
- **DNS check (non-platform domain): PASS** — `dns.google/resolve?name=hashcolombo.com&type=A` → `Status: 0`, A records `172.66.0.96`, `162.159.140.98` (Cloudflare). Domain is real.
- **SSR confirmed:** plain `web_fetch` of `https://hashcolombo.com/` returned the full server-rendered page **including the "Next run" block** → **static Cheerio, no browserRender needed.** (Improves on the queue's "⚠️ confirm SSR vs JS" — SSR is now confirmed from the sandbox.) Site is **Next.js** (`/_next/image` asset URLs); **no JSON API/feed** (per prior recon; only a Google Maps embed in the filled state).
- Events seen: **0 strictly-upcoming at research time (placeholder state).** Most recent confirmed run **#2223, 2026-06-20** (2 days ago).
- **Source-count parity:** N/A — single current-run block, platform UI shows 0 upcoming. Applying the **Step 3 recently-active rule** instead (evidence below).
- **🟡 Recently-active onboard (NOT blocked) — evidence:**
  - **Verbatim placeholder excerpt** (proves source live, in between-postings state), `web_fetch https://hashcolombo.com/` 2026-06-22:
    > `Where the trail ends, the fun begins!`
    > `Next run`
    > `We will announce soon`
  - **Verbatim filled-state sample** (the most recent posted run, captured by the queue's Claude-in-Chrome recon **2026-06-18**, attributed — site was filled then):
    > **Run #2223 — 2026-06-20 (Sat) — KK's Crib — 17:00 — No.5, 1st Cross Street, Kandawala Road, Ratmalana** (with an embedded Google Map).
  - **Cadence:** weekly **Saturday** (the kennel's own About page: *"Saturday is our day of merriment … we've since declared Saturday sacred for our runs"*). Run #2223 on Sat 2026-06-20 is **2 days ago** — well within ~2× the weekly interval (≤ ~2 weeks). A regular-cadence kennel between postings, not a dead source.
  - Onboarding rationale (put in the run-log + PR): *"0 upcoming at research time — onboarding on recent-cadence evidence (weekly Saturday, last run #2223 on 2026-06-20). The next run appears on the first scrape after it's posted."*
- **🔴 Run numbers/titles are VERBATIM, not constructed.** The only concrete run is **#2223** (from the 2026-06-18 capture). The filled block carries a run **number** and a **venue**, NOT an event theme — so `title` should be left undefined (merge synthesizes "Colombo Harriettes Trail #N"). Do not invent run numbers or themes.
- History depth / pagination: **single page, no archive.** Both surfaces probed and confirmed history-less: (a) modern `hashcolombo.com` = single current-run block, no list/feed/API; (b) legacy `colomboharriettes.com` = a marketing landing page ("33 Years / 1800+ Runs" counters, no per-run list); its `wp-json/wp/v2/posts` returned **empty** (not a usable archive). → **no historical backfill source.**
- Coord sanity: filled state embeds a **Google Map** (likely a `maps/embed?pb=…!2d<lng>!3d<lat>` iframe). 🔴 If present, extract in-adapter (`m = src.match(/!2d(-?\d+\.\d+)!3d(-?\d+\.\d+)/); {lat:+m[2], lng:+m[1]}`) — `extractCoordsFromMapsUrl` Pattern 1a/1b does NOT match embed URLs (Asunción lesson). Single venue per run → no default-pin trap, but verify the embed isn't a fixed office pin across runs at build.
- End times: **none** (only a single start time, 17:00).
- Notes: SSR static Cheerio. Chrome MCP **auto-denied** `hashcolombo.com` during research (brand-new domain, no user present to approve) — `web_fetch` carried the verification. The **filled-state wrapper DOM is unconfirmed** (site was in placeholder state) → Claude Code must capture it at build when a run is posted.
- **Field-fill assertion table** (from the #2223 filled-state sample, n=1; placeholder state fills 0/1 on every row):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 1 | No theme in block (only run # + venue) → leave undefined; `merge.ts` synthesizes "Colombo Harriettes Trail #N" |
  | `startTime` | 1 / 1 | "17:00" → `"HH:MM"` (12-hr "5:00 PM" on kennel) |
  | `endTime` | 0 / 1 | Not published → undefined |
  | `location` (venue name) | 1 / 1 | "KK's Crib" → `location` |
  | `locationStreet` | 1 / 1 | "No.5, 1st Cross Street, Kandawala Road, Ratmalana" → `locationStreet` |
  | `locationUrl` (Maps) | 1 / 1 | Google Maps embed iframe `src` → `locationUrl` (capture real DOM at build) |
  | `hares` | 0 / 1 | Not seen in the #2223 capture — confirm in the filled DOM at build; if absent, undefined (don't synth) |
  | `cost` | 0 / 1 | Kennel default unknown (hashCash unverifiable) → undefined; per-event override only |
  | `description` | 0 / 1 | None in block → undefined |
  | `trailLengthText` | 0 / 1 | Not in feed → undefined |
  | `coords` (lat/lng) | 0–1 / 1 | From Maps embed `!2d`/`!3d` (in-adapter parse) → else fall back to Colombo centroid |

## Kennel metadata (deep-dive complete)
- **fullName:** Colombo Hash House Harriettes  (source: hashcolombo.com/about)
- **shortName:** Colombo Harriettes  (>4 chars → `friendlyKennelName` short-circuits cleanly; verify at build)
- **region:** Colombo  ·  **country:** Sri Lanka  *(new — see Region edits)*
- **aliases:** `["Colombo Harriettes", "Colombo Hash House Harriettes", "CHHH"]`
  - Bare `"Harriettes"` **omitted** — globally taken by `harriettes-nyc` (`aliases.ts:18`).
  - `"Colombo Hash"` / `"Colombo H3"` **omitted** — those belong to the men's sibling **The Colombo Hash House Harriers** (colombohash.com), not this kennel; avoid mis-routing.
  - `"CHHH"` is clear in the global namespace (grep empty) and matches their own handle (X `@CHHHarriettes`).
- **website:** https://hashcolombo.com/  (source: live)
- **facebook:** https://www.facebook.com/p/Colombo-Hash-House-Harriettes-61563456704517/  (source: web search)
- **twitter:** `CHHHarriettes`  (X `@CHHHarriettes`)  ·  **instagram:** none found  ·  **discord:** none found
- **schedule:** **Saturday**, **5:00 PM** (17:00), **Weekly**
  - Day: hashcolombo.com/about (*"Saturday is our day of merriment … declared Saturday sacred"*; originally Wednesday).
  - Time: from the #2223 filled-state capture (17:00). 🟡 Legacy site copy says "Saturday **night**"; the live run block showed 17:00. Seed 5:00 PM; the adapter takes the real time per run.
  - `scheduleDayOfWeek: "Saturday"`, `scheduleTime: "5:00 PM"` (12-hr seed format), `scheduleFrequency: "Weekly"`. Single weekly pattern → no `scheduleRules` needed.
- **foundedYear:** **1984** (20 June 1984) — high confidence; two sources agree: hashcolombo.com/about (*"woven since Twentieth of June Nineteen Eighty Four"*) and colomboharriettes.com (*"the Colombo Hash House Harriettes was born on the 20th June 1984"*).
- **hashCash:** ⚠️ **unverifiable — leave blank.** No amount published; site only says beer/soft drinks/food "provided at a cost". Do not invent. (Flag for later enrichment.)
- **dogFriendly:** not stated → omit.
- **walkersWelcome:** not explicitly stated (About describes a "mixed group … adults of all backgrounds") → omit rather than assume.
- **logoUrl:** `https://hashcolombo.com/logomain.png` (nav logo; stable path) — og:image is also PNG (`meta-og:image:type: image/png`). ⚠️ **Self-host** to `public/kennel-logos/colombo-harriettes.<ext>` and reference `/kennel-logos/colombo-harriettes.<ext>`. 🔴 **Confirm the extension by magic bytes**, not the path/Content-Type (RIFF=WebP, \x89PNG=PNG, \xff\xd8=JPEG).
- **description:** "Colombo Hash House Harriettes (est. 20 June 1984) — Sri Lanka's mixed-gender hash, 'a drinking club with a running problem.' Saturday trails laid hare-and-hound style across Colombo and beyond — paddy fields, beaches, jungle and urban parks — ending in a circle of beer, snacks and song. All adults welcome." (paraphrased from hashcolombo.com/about; keep it short.)
- **lat/lng:** Colombo centroid `6.9271, 79.8612` (kennel-level; per-event coords from the Maps embed when present).

## Historical backfill
- Available: **none** as a collection — single current-run block, no archive on either the modern or legacy site (both probed). So **no backfill script** in the usual sense.
- **🟡 Optional single-run seed:** the one concrete recent run **#2223 (2026-06-20, KK's Crib, 17:00, No.5 1st Cross Street, Kandawala Road, Ratmalana)** could be seeded via a tiny one-row `scripts/backfill-colombo-harriettes-history.ts` so the kennel page shows one real recent run immediately instead of being empty until the next post. Low priority / optional — Claude Code's call. (`config.upcomingOnly: true` only restricts *reconcile* to future dates; a seeded past run is fine and won't be cancelled.)

## Ready-to-paste seed

> 🔴 `aliases.ts` is `Record<string, string[]>` (slug/kennelCode → string[]), NOT an object array.
> Key is the **kennelCode** (here `colombo-harriettes`, which equals the slug). Confirmed against
> `head prisma/seed-data/aliases.ts`.

```ts
// kennels.ts — append to the KENNELS array (before the closing `];` ~line 5352). Kennel[] shape:
{
  kennelCode: "colombo-harriettes",
  shortName: "Colombo Harriettes",
  fullName: "Colombo Hash House Harriettes",
  region: "Colombo",
  country: "Sri Lanka",
  website: "https://hashcolombo.com/",
  facebookUrl: "https://www.facebook.com/p/Colombo-Hash-House-Harriettes-61563456704517/",
  twitterHandle: "CHHHarriettes",
  foundedYear: 1984, // 20 June 1984 — hashcolombo.com/about + colomboharriettes.com agree
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "5:00 PM", // 12-hr seed format; RawEventData.startTime stays 24-hr "17:00"
  scheduleFrequency: "Weekly",
  // hashCash: omitted — unverifiable (no published amount); enrich later.
  description:
    "Colombo Hash House Harriettes (est. 20 June 1984) — Sri Lanka's mixed-gender hash, 'a drinking club with a running problem.' Saturday hare-and-hound trails across Colombo and beyond, ending in a circle of beer, snacks and song. All adults welcome.",
  logoUrl: "/kennel-logos/colombo-harriettes.<ext>", // self-hosted; confirm <ext> by magic bytes
  latitude: 6.9271,
  longitude: 79.8612,
},

// aliases.ts — add to KENNEL_ALIASES (Record<string, string[]>):
"colombo-harriettes": ["Colombo Harriettes", "Colombo Hash House Harriettes", "CHHH"],

// sources.ts — append to the SOURCES array (before the closing `];` ~line 7209). Source[] shape:
{
  name: "Colombo Harriettes Website",
  url: "https://hashcolombo.com/",
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 90,            // narrow single-run feed
  config: { upcomingOnly: true },
  kennelCodes: ["colombo-harriettes"],
},
```

## Adapter notes / new-scraper plan

**New `ColomboHarriettesAdapter`** — `src/adapters/html-scraper/colombo-harriettes.ts`. Single
current-run SSR block; mirror **`warsaw-h3.ts`** (Mobirise single-`<p>` SSR next-run block) and
**`manila-h3.ts`** (single label-block, `upcomingOnly` + fail-loud zero guard). Static Cheerio via
`fetchHTMLPage` from `@/adapters/utils` — **no browserRender** (SSR confirmed).

Parse plan:
1. `fetchHTMLPage(url)` → `cheerio.load(html)`.
2. Locate the **"Next run"** section heading, then read the following block.
   - 🔴 **Placeholder vs filled discriminator.** If the block text is the placeholder
     **"We will announce soon"** (whitespace-collapsed, case-insensitive `includes`), return **0
     events with `errors: []`** — this is a legitimate between-postings state, NOT a parse failure.
   - If the block carries a run (a `#NNNN` run number and/or a date), parse it.
3. From the filled block extract: **run number** (`#?(\d{3,5})` → integer), **date** (the filled
   capture showed an explicit date for #2223 → parse to **UTC noon**; ⚠️ capture the real date
   string format at build — could be ISO or `D Month YYYY`; if it carries a year, NO inference; if
   year-less, today-anchored Dec→Jan rollover), **startTime** (`"17:00"` → `"HH:MM"`), **venue**
   (`location`), **street** (`locationStreet`), **Maps embed** → `locationUrl` + in-adapter coord
   parse (`!2d`=lng/`!3d`=lat), **hares** (if present in the filled DOM — confirm at build).
4. `title` left **undefined** (no theme; merge synthesizes "Colombo Harriettes Trail #N").
5. `kennelTags: ["colombo-harriettes"]`.

**🔴 Fail-loud guard (per the single-current-run rule).** Distinguish three outcomes so markup drift
can't ship a silent 0:
- placeholder text present → `events: []`, `errors: []` (clean).
- a run block present (has `#NNNN` or a date-like line) but it fails to fully parse → push a
  `ParseError` into `errors[]` (suppresses reconcile; surfaces the drift).
- neither the placeholder phrase NOR a parseable run block found → also push an error (the
  committee may have reworded the placeholder, or the markup drifted) — don't return a silent empty.

Registry entry (`src/adapters/registry.ts`, in `htmlScrapersByUrl` / the static-scraper list near
`warsawh3.com`):
```ts
{ pattern: /hashcolombo\.com/i, name: "ColomboHarriettesAdapter", factory: () => new ColomboHarriettesAdapter() },
```
Import `ColomboHarriettesAdapter` at the top alongside `WarsawH3Adapter` (~line 116).

### Region — Sri Lanka COUNTRY + Colombo METRO (5 `region.ts` edits — first Sri Lanka kennel)

Mirror the Cambodia/Vietnam/Nepal country→metro precedent (no state-province intermediate).
**Rose** palette. 🔴 **NOT cyan** — Vietnam shipped cyan via [PR #2269](https://github.com/johnrclem/hashtracks-web/pull/2269) (COUNTRY `bg-cyan-200`/`#0e7490`, HCMC METRO `bg-cyan-100`/`#0891b2`), so cyan would put two nearby Asian groups on indistinguishable colors. Rose is distinct from **every** Asian neighbour (teal=Indonesia, red=Japan/Singapore/China, orange=Thailand, sky=Taiwan, cyan=Vietnam, violet=Nepal, purple=Cambodia, green=Malaysia, fuchsia=Philippines) — rose's owners are all US/Europe. Country = darker `-200`/`text-…-800`, metro = lighter `-100`/`text-…-700`, different pin hexes. 🔴 Re-grep `REGION_SEED_DATA` at build and swap if rose now collides with a nearer region.

1. **`REGION_SEED_DATA`** (add a COUNTRY + a METRO record):
   ```ts
   // ── Sri Lanka (first Sri Lankan country; country → metro, no state-province
   // intermediate, mirroring Cambodia/Nepal). Rose palette — NOT cyan (Vietnam,
   // #2269); rose is unused by any Asian region (its owners are US/Europe). ──
   {
     name: "Sri Lanka",
     country: "Sri Lanka",
     level: "COUNTRY",
     timezone: "Asia/Colombo",
     abbrev: "LK",
     colorClasses: "bg-rose-200 text-rose-800",
     pinColor: "#e11d48",
     centroidLat: 7.8731,
     centroidLng: 80.7718,
     aliases: ["LK", "Ceylon", "Democratic Socialist Republic of Sri Lanka"],
   },
   {
     name: "Colombo",
     country: "Sri Lanka",
     timezone: "Asia/Colombo",
     abbrev: "CMB",
     colorClasses: "bg-rose-100 text-rose-700",
     pinColor: "#f43f5e",
     centroidLat: 6.9271,
     centroidLng: 79.8612,
     aliases: ["Colombo, Sri Lanka", "Colombo, LK"],
   },
   ```
2. **`STATE_GROUP_MAP`** — add `"Colombo": "Sri Lanka",` (with a `// Sri Lanka` comment, beside the Cambodia/Vietnam block ~line 3869).
3. **`COUNTRY_GROUP_MAP`** — add the country key only (metro resolves via `STATE_GROUP_MAP` first, per the Nepal/Cambodia/Vietnam precedent ~line 4103):
   ```ts
   // Sri Lanka — metro "Colombo" resolves via STATE_GROUP_MAP first, so only the
   // country-group key "Sri Lanka" is reachable here (mirrors the Vietnam precedent).
   "Sri Lanka": "Sri Lanka",
   ```
4. **`COUNTRY_CODE_TO_NAME`** — add `LK: "Sri Lanka",` (~line 4239, beside `SG`).
5. **`COUNTRY_INFERENCE_RULES`** — add (beside the other Asian rules ~line 3658):
   ```ts
   // Sri Lanka — country + capital. Both tokens are unambiguous (no notable US
   // "Colombo"); inferCountry() is first-match with USA as the default fallthrough.
   // "Ceylon" deliberately excluded — Ceylon, MN collides; kept only as a region alias.
   [/\b(sri\s*lanka|colombo)\b/, "Sri Lanka"],
   ```
   (No new metro under an *existing* country here — this is a brand-new country, so the inference rule above is the complete coverage.)

**⚠️ Claude Code: verify before writing real code.** Any code snippet above is illustrative; the
live repo is authoritative. Before writing the adapter, confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); `walkersWelcome` (NOT
  `walkerFriendly`); `location`/`locationStreet`/`locationUrl` per `prisma/schema.prisma`.
- Imports — `fetchHTMLPage` from `@/adapters/utils`; `safeFetch` from `@/adapters/safe-fetch` if a
  raw fetch is needed (NOT bare `fetch`); coord parse in-adapter for the Maps **embed** URL
  (`extractCoordsFromMapsUrl` won't match `maps/embed?pb=…!2d!3d`).
- `kennelPagesStopReason` — leave null on a clean placeholder/empty (it's an expected state, not
  truncation); a non-empty string suppresses stale-event reconciliation.
- `title` — leave `undefined`; `merge.ts` synthesizes "Colombo Harriettes Trail #N". Never let the
  venue ("KK's Crib") or a hare name become the title.
- Sonar: keep regexes simple (`#?(\d{3,5})`, no `\s*`-adjacent-`.+`); two-pass date parse; prefer
  `Number.parseInt(s, 10)`, `Map.get()` over `Record[var]`.

## Deep-dive checklist (nothing deferred)
- [x] logo (self-host flagged, confirm ext by magic bytes)  [x] foundedYear (1984, two sources)  [x] socials (FB + X; IG/Discord none)  [x] schedule (Sat 5:00 PM weekly)  [x] hashCash (unverifiable — blank, flagged)
- [x] description  [x] source live-verified (SSR confirmed via web_fetch; DNS pass)  [x] history depth assessed (none — both surfaces probed)
- [x] coord sanity (Maps embed → in-adapter parse)  [x] end times (none)  [x] kennelCode collision-checked (clear)  [x] kennelCodes (source guard) set  [x] sibling sweep (men's Colombo H3 = future source-add once its site refreshes; aliases kept distinct)

## Implementation gotchas (for Claude Code — repo knowledge)
- **`config.upcomingOnly: true` is required** — a single current-run page ages the run off weekly;
  without it `reconcile.ts` would false-CANCEL the run once the block advances. (Already in the seed.)
- **Placeholder state ≠ failure.** "We will announce soon" → 0 events, `errors: []`. Only push to
  `errors[]` on a genuine parse failure or an unrecognized non-placeholder block (so reconcile is
  suppressed on real drift but not on the legitimate between-postings state).
- **Rejecting/parsing upstream coords:** if the Maps embed pin turns out to be a fixed office pin
  repeated across runs, reject it and emit `dropCachedCoords: true` (a re-scrape keeps a stored bad
  pin otherwise). Single-venue-per-run here, so likely fine — verify at build.
- **Self-host the logo** to `public/kennel-logos/colombo-harriettes.<ext>`; confirm `<ext>` by magic
  bytes, never pre-fill it.
- **`friendlyKennelName("Colombo Harriettes", "Colombo Hash House Harriettes")`** — shortName is
  >4 chars so it short-circuits to the shortName; verify once at build.
- **First Sri Lanka country** — all 5 `region.ts` edits are mandatory; the
  `COUNTRY_INFERENCE_RULES` omission is the one that silently routes new kennels to "USA" in CI.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
