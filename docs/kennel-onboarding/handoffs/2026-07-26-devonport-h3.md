# Onboarding Handoff — Devonport H3 (Devonport, Tasmania, Australia) — 2026-07-26

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/devonport-h3-20260726`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the **Tasmania STATE
>    + Devonport METRO** region records and map entries exactly as in **Region setup** (the
>    `COUNTRY_INFERENCE_RULES` Australia rule ALREADY covers `tasmania`/`hobart` — do NOT re-add it,
>    and do NOT add bare `devonport` = UK/NZ collision).
> 3. Implement the **NEW bespoke Blogger adapter** exactly as in **Adapter notes** (model on
>    `brasilia-h3.ts` body-parse + `ofh3.ts` Blogspot plumbing; use `fetchBloggerPosts`).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md` —
>    call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'`. Resolve every `⚠️ Claude Code
>    must confirm` item below. Validate: events non-empty + include the current upcoming Monday run,
>    dates UTC-noon, `startTime` "18:45", `kennelTag` resolves to `devonport-h3` with no unmatched.
>    **DO NOT run `npx prisma db seed` here.**
> 5. Optional: a shallow **recent-history backfill** of the labeled-format announcement posts (see
>    **Historical backfill** — the deep archive is free-form prose, NOT worth scripting).
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive checklist.
> 8. **Post-merge runbook (separate step, after the PR merges):**
>    - `git checkout main && git pull`
>    - **Verify each expected file landed on `main`** (`git log -1 -- <path>` for the adapter, the
>      registry entry, region.ts, the three seed files, and any backfill script). Squash-merge can
>      silently drop a follow-up commit — open a small recovery PR if anything's missing.
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive; seeds the kennel/alias/source + Tasmania/Devonport regions)
>    - Trigger a scrape from `/admin/sources` to publish events to prod
>    - Spot-check `hashtracks.xyz/kennels/devonport-h3` for the current run + recent dates.

## Summary
- Type: **full onboard** (new kennel + new Tasmania/Devonport regions)
- Adapter: **HTML_SCRAPER** (**NEW bespoke Blogger adapter, ~180–240 LoC** — no shared config-only
  Blogger adapter exists; body-parse like `brasilia-h3.ts`, plumbing like `ofh3.ts`)
- Effort estimate: new ~180–240 LoC adapter + tests; **~4 `region.ts` edits** (Tasmania STATE +
  Devonport METRO records, STATE_GROUP_MAP ×2, COUNTRY_GROUP_MAP ×2; inference already covers Tasmania)
- One-line: **First Tasmania kennel** — large, very active weekly-Monday NW-Tasmania club
  ("The Odd Sock Hash", run #2326), on a custom-domain Blogger site with clean labeled announcement
  posts (`Hare:`/`Where:`/`When:`/`Cost:`) + an embedded forward "Receding Hareline".

## Dedup result
- Kennel in seed: **no** (`grep -in "devonport" prisma/seed-data/kennels.ts prisma/seed-data/aliases.ts` → 0 hits)
- Source in seed: **no** (no `dhash.com` in `sources.ts`)
- Live sitemap dedup: **confirmed NOT live** — read `hashtracks.xyz/sitemap.xml` via Chrome MCP,
  **491 slugs**; no `devonport` / `tasmania` / `hobart` / `launceston` / `dhash` fragment.
- Pre-onboarding admin-event check: kennel not live → no admin-seeded `Event` rows expected under
  `devonport-h3`. (Claude Code: quick confirm no prod `Event` rows for this kennelCode before first scrape.)
- Decision: **full onboard**
- kennelCode: `devonport-h3` (collision check: bare `dh3` is **taken by Dublin H3**
  `kennels.ts:1107` + `aliases.ts:158`; `dh3-tx`/`dh3-co` also exist → use the descriptive
  `devonport-h3`, which equals the slug and dodges the crowded `dh3` namespace)

## Live source verification  ✅
- Source: **HTML_SCRAPER (Blogger JSON feed)** — `https://www.dhash.com/`
  (custom domain fronting Blogger; blog id **`7231198193475707740`**; `meta name=generator` = `blogger`).
  DNS `dhash.com` → **Status 0** (resolves; not NXDOMAIN), verified via `dns.google/resolve` in Chrome.
  Feed is **sandbox-fetchable** (`web_fetch`, `application/json`).
- Events seen: current run + full forward hareline; **openSearch$totalResults = 1426 posts**
  (deep archive, but only recent posts use the clean labeled format — see History depth below).
- **Source-count parity:** platform UI shows **0 strictly-upcoming as a distinct list** (Blogger has
  no "upcoming" view) → parity N/A; applied the **recently-active** rule instead. The current
  announcement post (Run #2326, published 2026-07-23) is for **Monday 27 July 2026** — i.e. an
  upcoming run at research time (research date 2026-07-26). Weekly Monday cadence, unbroken:
  #2324 (13 Jul), #2325 (20 Jul), #2326 (27 Jul). **Live and recently active.**
- Sample events (VERBATIM from the rendered post bodies, `dhash.com` home page, 2026-07-26):
  1. **Run 2326** — When: **Monday, 27 July 2026**, 6.30pm for 6.45pm Sharp START (AEST) — Hare **Gyno** — Where **K-Tek Workshop, Matthews Way, Don** — Cost **$20**
  2. **Run 2325** — When: **Monday, 20 July 2026** — Hare **Crow** — Where **Oz Rock Inn, Beach Rd, Ulverstone** — Cost **$20**
  3. **Run 2324** — When: **Monday, 13 July 2026** — Hare **Dint** — Where **31 St Andrews Drive, Devonport** — Cost **$20**
  - **Embedded "Receding Hareline"** in the #2326 post (forward schedule, `Run NNNN – D/M  Hare`,
    VERBATIM): Run 2327 – 3/8 Shagadelic · 2328 – 10/8 Ratchet · 2329 – 17/8 Killer · **2340 – 24/8
    Lantern** · 2341 – 31/8 Seize-Her · 2342 – 7/9 Jinx · 2343 – 14/9 Thrust · 2344 – 21/9 Tracka ·
    2345 – 28/9 Nez · 2346 – 5/10 Bald Eagle · 2347 – 12/10 Cheese · 2348 – 19/10 · 2349 – 26/10.
    🔴 **Source typo present**: the sequence jumps 2329 → **2340** (should be 2330). Extract
    faithfully — do NOT "correct" it; the merge pipeline collapses by `(kennel, date)`.
- Run numbers: **VERBATIM** — the run number is the post title (`Run NNNN`); the forward list uses
  `Run NNNN – D/M`. No invented numbers. **No theme titles** (titles are the bare run number) →
  leave `title` undefined so `merge.ts` synthesizes `"Devonport H3 Trail #N"`.
- History depth / pagination: **1426 total posts**, back to ~2009 — **but the clean labeled
  `Hare:/Where:/When:/Cost:` format is a RECENT convention.** Sampled a post ~800-back
  (feed `start-index=800`, published 2012-12-08, "Cloud Nine Hash"): older posts are **free-form
  prose** (RIP notices, recaps, socials — titles like "Squeak!", "Who is Squeaking", run details
  buried in narrative). So the deep archive is NOT worth a full backfill (evidence: I pulled the
  2012 slice and it's prose, not structured). Only recent labeled announcements are cleanly parseable.
- Coord sanity: **no per-event coords** — `Where:` is a free-text venue (e.g. "K-Tek Workshop,
  Matthews Way, Don"). Leave `latitude`/`longitude` undefined → merge geocodes the venue / metro
  centroid. No default-pin trap.
- End times: none published (`When:` gives only a start: "6.30pm for 6.45pm Sharp START").
- Notes: Fully SSR'd Blogger — `fetchBloggerPosts` (bypasses cloud-IP 403s) is the right plumbing;
  no browserRender. Custom domain fronting Blogger (same shape as Teign Valley H3, handed off 2026-07-25).
- **Field-fill assertion table** (from the 3 sampled announcement posts):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 0 / 3 (bare "Run N") | leave undefined → `merge.ts` synthesizes "Devonport H3 Trail #N" |
  | `startTime` | 3 / 3 | `"18:45"` from "6.45pm Sharp START" (fixed weekly; parse the `When:` time) |
  | `endTime` | 0 / 3 | none published — accept absence |
  | `location` (venue) | 3 / 3 | free-text venue from `Where:` |
  | `locationStreet` | ~3 / 3 (embedded in venue) | `Where:` line carries street/suburb; keep as `location` |
  | `locationUrl` (Maps) | 0 / 3 (recent) | not in recent posts (older prose posts had Maps links) — none |
  | `hares` | 3 / 3 | single name from `Hare:` |
  | `cost` | 3 / 3 | `$20` from `Cost:` (per-event → `Event.cost`; varies, was `$15` in Feb 2026) |
  | `description` | opt | `Bring:` / `Notes:` text if wanted; else leave undefined |
  | `trailLengthText` | 0 / 3 | not published |
  | `coords` (lat/lng) | 0 / 3 | none — merge geocodes venue / Devonport centroid |

## Kennel metadata (deep-dive complete)
- fullName: **Devonport Hash House Harriers** / shortName: **Devonport H3** / region: **Devonport, TAS** / country: **Australia**
- aliases: `["Devonport H3", "Devonport Hash", "Devonport HHH", "Odd Sock Hash", "DHash"]`
  — 🔴 **OMIT bare "DH3"** (globally claimed by Dublin H3 `aliases.ts:158`; also `dh3-tx`/`dh3-co`).
  Claude Code: `grep -in '"Odd Sock Hash"\|"DHash"' prisma/seed-data/aliases.ts` to confirm those two are free (expected clear).
- website: `https://www.dhash.com/` (source: dhash.com home, DNS Status 0)
- facebook: `https://www.facebook.com/devonporthash` (source: dhash.com home page social link)
- instagram / twitter / discord: **none found** — leave blank
- schedule: **Monday**, **6:45 PM sharp** (6:30 for 6:45), **Weekly** (source: every announcement
  `When:` line, e.g. "Monday, 27 July 2026, 6.30pm for 6.45pm Sharp START (AEST)")
- foundedYear: **unverifiable from a citable source → leave blank + flag.** (Run #2326 at ~weekly
  cadence implies founding ~early 1980s; a Tasmanian sibling, Burnie H3, was founded 19 Apr 1982 —
  but Devonport's own founding date is not on the site. Claude Code MAY check `hhh.asn.au/byState.php?whichState=T`
  or an AGM/anniversary post in the archive at build; otherwise leave blank.)
- hashCash: **"$20"** (source: dhash.com run posts #2324–#2326; note it varies — `$15` on Run #2303,
  Feb 2026). Kennel-level default `"$20"`; per-run variation belongs on `Event.cost`.
- dogFriendly: unverifiable → blank. walkersWelcome: **true** (mixed club, "all abilities"/family
  ethos; "Bring: … Chair" implies non-runners welcome — low confidence, source: run posts). Leave
  `walkersWelcome` unset if you want stricter sourcing.
- description: `"Devonport Hash House Harriers ('The Odd Sock Hash') — a mixed hash in Devonport on
  Tasmania's north-west coast. Runs every Monday, 6:45 PM sharp, around Devonport, Ulverstone and the
  surrounding NW coast."` (source: dhash.com posts + FB page name)
- logoUrl: ⚠️ **self-host** — the only logo is the tokenized Blogger masthead banner
  `https://blogger.googleusercontent.com/img/a/AVvXsEgchERgIoyOspBROGfHUgq21mWDkRk90IftT_hXLk6Js_h9A9t8EASDzeSnWNpQJRdEe5HCZuQg6j56EcSOlzq0vHCNy8-j4iEacEkK5qT0l94tIq6zrmszEmXyMbuoKVALK3YzUpOFvtQ8n6H6H2bj8cx1xrYFpZQAFNTlLKnkxiyzxzej52jh8jgI=s1100`
  (1100×200, no extension in URL). Download into `public/kennel-logos/devonport-h3.<ext>` and confirm
  the real extension via `curl -sI` Content-Type **and** magic bytes (`\x89PNG`/`\xff\xd8`/`RIFF…WEBP`).
- lat/lng: none per-event; Devonport, TAS centroid **-41.1789 / 146.3510** (used for the METRO record).

## Region setup — Tasmania STATE + Devonport METRO (~4 region.ts edits)

🔴 **`COUNTRY_INFERENCE_RULES` ALREADY covers `tasmania` and `hobart`** (`region.ts:3942`, the
Australia rule) — **do NOT edit it.** Do NOT add bare `devonport` (collides with Devonport, Plymouth UK
and Devonport, Auckland NZ). The seed kennel carries explicit `country: "Australia"`, so inference only
matters for the research path, which `tasmania` already covers. `COUNTRY_CODE_TO_NAME` (AU→Australia)
already exists — no edit.

Add to **`REGION_SEED_DATA`** (mirror the Victoria/Melbourne STATE+METRO pair; yellow palette,
STATE `-100` / METRO `-200`, distinct pins):

```ts
// ── Australia Phase 3: Tasmania ──
{
  name: "Tasmania",
  country: "Australia",
  level: "STATE_PROVINCE",
  timezone: "Australia/Hobart",   // AEST/AEDT with DST — NOT Australia/Sydney
  abbrev: "TAS",
  colorClasses: "bg-yellow-100 text-yellow-700",
  pinColor: "#713f12",            // yellow-900 — distinct from existing AU state pins
  centroidLat: -42.0,
  centroidLng: 146.6,
  aliases: ["TAS", "Tasmania, Australia"],
},
{
  name: "Devonport, TAS",
  country: "Australia",
  timezone: "Australia/Hobart",
  abbrev: "DPO",                  // Devonport airport code; confirm unused
  colorClasses: "bg-yellow-200 text-yellow-800",
  pinColor: "#eab308",            // yellow-500 — distinct
  centroidLat: -41.1789,
  centroidLng: 146.3510,
  aliases: ["Devonport, Tasmania", "Devonport, TAS"],  // NO bare "Devonport" (UK/NZ collision)
},
```

Add to **`STATE_GROUP_MAP`** (near `region.ts:4357`, after the Victoria block):
```ts
"Tasmania": "Tasmania",
"Devonport, TAS": "Tasmania",
```

Add to **`COUNTRY_GROUP_MAP`** (near `region.ts:4577`, after `"Melbourne, VIC": "Australia"`):
```ts
"Tasmania": "Australia",
"Devonport, TAS": "Australia",
```

> ⚠️ Claude Code must confirm: `abbrev: "DPO"` and `"TAS"` are unused elsewhere in `region.ts`
> (grep). No trailing-zero literals (`-42.0`/`146.6` are fine; Sonar S6749 rejects e.g. `146.60`).

## Historical backfill
- Available: **recent labeled-format announcements only** — the deep archive (1426 posts back to
  ~2009) is **free-form prose** (verified via the 2012 sample), NOT worth a full backfill.
- Plan: **Optional, low priority.** With `config.upcomingOnly: true` + the adapter fetching the
  recent window each scrape, recent past runs populate from the adapter itself — no separate
  backfill required to make the page look alive. If a deeper recent set is wanted, a one-shot
  `scripts/backfill-devonport-h3-history.ts` that walks the feed and keeps only posts whose title
  matches `^Run \d+` AND whose body has a `When:` line (freeze to `scripts/data/devonport-h3-history.json`,
  dumb loader per the H7 frozen-dataset pattern) — but STOP where the labeled format breaks into
  prose. Not required for launch.

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (append one object)
{
  kennelCode: "devonport-h3",
  shortName: "Devonport H3",
  fullName: "Devonport Hash House Harriers",
  region: "Devonport, TAS",
  country: "Australia",
  website: "https://www.dhash.com/",
  facebookUrl: "https://www.facebook.com/devonporthash",
  scheduleDayOfWeek: "Monday",
  scheduleTime: "6:45 PM",       // 🔴 12-hr for the Kennel profile field; adapter RawEventData.startTime is 24-hr "18:45"
  scheduleFrequency: "Weekly",
  hashCash: "$20",
  walkersWelcome: true,
  description: "Devonport Hash House Harriers ('The Odd Sock Hash') — a mixed hash on Tasmania's north-west coast. Runs every Monday, 6:45 PM sharp, around Devonport, Ulverstone and the surrounding NW coast.",
  // logoUrl: set after self-hosting → "/kennel-logos/devonport-h3.<ext>"
  // foundedYear: LEAVE UNSET — unverifiable from a citable source (flag)
},

// aliases.ts — Record<string, string[]>, keyed by kennelCode (== slug here)
"devonport-h3": ["Devonport H3", "Devonport Hash", "Devonport HHH", "Odd Sock Hash", "DHash"],
// 🔴 bare "DH3" OMITTED — globally claimed by Dublin H3.

// sources.ts — Source[] (append one object)
{
  name: "Devonport H3 Blogger",
  url: "https://www.dhash.com/",   // Blogger blog id 7231198193475707740; fetchBloggerPosts() discovers this via blogs.byurl from the plain domain, NOT a feed-path URL
  type: "HTML_SCRAPER" as const,
  trustLevel: 6,
  scrapeFreq: "daily",
  scrapeDays: 365,
  config: { upcomingOnly: true },   // announcements age off the bounded fetch window → suppress reconcile false-cancel
  kennelCodes: ["devonport-h3"],
},
```

## Adapter notes / new-scraper plan

**NEW bespoke Blogger adapter** `src/adapters/html-scraper/devonport-h3.ts` (~180–240 LoC). No shared
config-only Blogger adapter exists. **Model on `brasilia-h3.ts`** (Blogspot body-parse) and **`ofh3.ts`**
(Blogspot plumbing); use **`fetchBloggerPosts(url, maxResults)`** from `src/adapters/blogger-api.ts`
(bypasses cloud-IP 403s; keyed Blogger API v3). Register by URL pattern in `htmlScrapersByUrl`.

Control-flow shape (ILLUSTRATIVE — verify field names against current types, see the stanza below):

```
fetch(source, options):
  posts = await fetchBloggerPosts(FEED_URL, MAX_RESULTS)          // MAX_RESULTS ~ 60–100
  window = buildDateWindow(options?.days ?? source.scrapeDays ?? 365)
  events = []
  for post of posts:
    runNumber = parseRunNumber(post.title)                        // /^Run\s+(\d+)/i ; skip if no match
    flat = stripHtmlTags(post.content, "\n")
    if (!/\bWhen\s*:/i.test(flat)) continue                       // skip prose recaps / RIP / socials
    date = parseWhenDate(flat)                                    // labeled `When:` line, YEAR-BEARING → NO inference
    if (!date || !inWindow(date, window)) continue
    events.push({
      kennelTags: ["devonport-h3"],
      date,                                                       // UTC noon
      runNumber,
      startTime: parseWhenTime(flat) ?? "18:45",                 // "6.45pm Sharp START" → "18:45"
      hares: parseLabel(flat, "Hare"),
      location: parseLabel(flat, "Where") ?? undefined,
      cost: parseLabel(flat, "Cost") ?? undefined,               // per-event; e.g. "$20"
      // title: undefined  → merge synthesizes "Devonport H3 Trail #N"
    })
  // FAIL-LOUD zero guard (single bounded source, 0 baseline):
  if (events.length === 0 && posts.length > 0)
    errors.push(new ParseError("Devonport H3: posts fetched but 0 events parsed — format drift"))
  return { events, errors, ... }
```

Field extraction detail (from the real bodies):
- **Labeled lines** render as `Hare: <v>` / `Where: <v>` / `When: <v>` / `Cost: <v>` / `Bring: <v>`
  / `Notes: …`, each on its own line after `stripHtmlTags(content, "\n")`. Bound each value at the
  next label OR the next newline (multi-pass tokenizer per `nswhhh.ts`). Labels use `Word:` with the
  colon adjacent → label regexes need no `\s*` (also keeps them S5852-clean).
- **`When:` date is YEAR-BEARING** — "Monday, 27 July 2026" → parse `D Month YYYY` (or `chronoParseDate`),
  **no year inference needed.** Store UTC noon. `startTime`: from "6.45pm Sharp START" → `"18:45"`
  (fixed; a simple `\b(\d{1,2})[.:](\d{2})\s*pm\b` grab of the *second* time, or just hard-default "18:45").
- **`Where:` is a free-text venue** (street + suburb, e.g. "K-Tek Workshop, Matthews Way, Don" /
  "Oz Rock Inn, Beach Rd, Ulverstone") → `location`. No coords; merge geocodes.

**Optional enhancement — parse the embedded "Receding Hareline"** in the most-recent announcement post
for FORWARD skeleton events (gives upcoming runs beyond next Monday). Lines are `Run NNNN – D/M  Hare`
(EN-dash). D/M has **no year** → infer as the next occurrence after the anchor post's run date
(same year, roll Dec→Jan). Emit `{ kennelTags, date, runNumber, hares }` with `location`/`startTime`
undefined (startTime falls back to the schedule). 🔴 Preserve the source typo (2329→2340) verbatim.
Recommended but Claude Code may defer if it adds risk — the primary per-post parse already yields the
current upcoming run. If included, add a regression test for the D/M year-rollover and the EN-dash split.

**⚠️ Claude Code: verify before writing real code.** Any snippet above is illustrative; the live repo
is the authority. Confirm against current types/imports:
- `RawEventData` field names — **`kennelTags` is `string[]`** (NOT `kennelTag`); walker field on
  `Kennel` is **`walkersWelcome`** (NOT `walkerFriendly`). Check `prisma/schema.prisma`.
- Imports — `fetchBloggerPosts` from `@/adapters/blogger-api`; `stripHtmlTags` + date/window helpers
  (`buildDateWindow`, `chronoParseDate`) from `@/adapters/utils`; use `safeFetch` (NOT raw `fetch`)
  anywhere you fetch directly.
- `kennelPagesStopReason` — leave null on a clean end; set ONLY on genuine truncation (a full page
  left unfetched / HTTP or fetch error). A non-empty string suppresses stale-event reconciliation.
- `title` — leave `undefined` (titles are the bare run number, no theme) → merge synthesizes.

## Deep-dive checklist (nothing deferred)
- [x] logo (tokenized Blogger masthead → flag self-host)  [x] foundedYear (unverifiable → blank+flag)
  [x] socials (FB only)  [x] schedule (Mon 6:45 PM weekly)  [x] hashCash ($20, varies)
- [x] description  [x] source live-verified (Blogger feed, DNS Status 0, 3 verbatim samples)
  [x] history depth assessed (1426 posts, deep = prose → no full backfill)
- [x] coord sanity (no per-event coords; venue text)  [x] end times noted (none)
  [x] kennelCode collision-checked (`dh3` taken → `devonport-h3`)  [x] kennelCodes source guard set

## Implementation gotchas (for Claude Code — repo knowledge, not source knowledge)
- **`config.upcomingOnly: true` is REQUIRED** — the adapter fetches a bounded recent window, so a run
  older than the window would "age off" and `reconcile.ts` would false-CANCEL it. Set it.
- **Fail-loud zero guard is REQUIRED** (single bounded source, brand-new = 0 baseline) — `if
  (events.length === 0 && posts.length > 0) errors.push(...)` so a body-format drift can't "succeed"
  with `events: []` and let reconcile cancel live runs.
- **Titles are the bare run number** → `title: undefined`; `friendlyKennelName("Devonport H3", …)`
  short-circuits (shortName >4 chars) → clean "Devonport H3 Trail #N". No need to check.
- **Timezone** — Tasmania is `Australia/Hobart` (DST-observing AEST/AEDT), NOT `Australia/Sydney`.
  Dates store UTC noon so this mostly affects display; `startTime` stays the string "18:45".
- **Self-host the tokenized Blogger masthead** into `public/kennel-logos/devonport-h3.<ext>`; confirm
  ext by magic bytes (URL has no extension). NEVER pre-fill the extension.
- **Sonar S5852/S5843** — keep the label regexes simple (`^Hare\s*:` style, single `\s`); resolve the
  month via `chronoParseDate` (year-bearing) rather than a month-name alternation. `Number.parseInt(s, 10)`.
- **Tests:** `beforeEach(vi.restoreAllMocks)` if you spy on fetch across `it()` blocks. Fixture must
  mirror the REAL Blogger JSON body (labeled `Hare:/Where:/When:/Cost:` inside `content.$t` HTML) — use
  the verbatim samples above.

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
