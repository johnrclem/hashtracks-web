# Onboarding Handoff — Kaohsiung H3 (Kaohsiung, Taiwan) — 2026-06-14

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously:
> 1. Branch off a clean `main`: `onboard/kaohsiung-h3-20260614`.
> 2. Apply the **Ready-to-paste seed** below (kennel + alias + source). Add the new **Kaohsiung
>    METRO** region as noted in **Adapter notes / region** (Taiwan COUNTRY + the `kaohsiung`/`高雄`
>    inference rule already exist on `main` — only a METRO record + 2 group-map entries are needed).
> 3. Implement the NEW `KaohsiungHashAdapter` exactly as in **Adapter notes** (static Cheerio over the
>    fully-SSR'd Wix pages — NOT config-only, NOT browserRender).
> 4. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`
>    — call `adapter.fetch(source)` via a throwaway `npx tsx -e '…'` snippet. **🔴 You MUST capture
>    the verbatim DOM at build** (`curl -s https://www.kaohsiunghash.com/run-information` and
>    `curl -s https://www.kaohsiunghash.com/`) and build the test fixture from that real markup — the
>    research sandbox could only read the rendered text (Chrome auto-denied the brand-new domain and a
>    cross-origin page-context fetch is CORS-blocked). Validate: events non-empty + upcoming, dates
>    UTC-noon, `startTime` "HH:MM", `kennelTag` resolves with no unmatched. **DO NOT run
>    `npx prisma db seed` here.**
> 5. No historical backfill (none available — see **Historical backfill**).
> 6. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 7. Commit and open a PR carrying the metadata, live-verification results, and the deep-dive
>    checklist below. Follow `docs/source-onboarding-playbook.md` throughout.
> 8. **Post-merge runbook (after the PR merges):**
>    - `git checkout main && git pull`
>    - Verify each expected file landed on `main` (squash-merge can drop a follow-up commit):
>      `git log -1 -- src/adapters/html-scraper/kaohsiung-hash.ts`, `…/public/kennel-logos/kaohsiung-h3.*`
>    - `eval "$(fnm env)" && fnm use 20`
>    - `npx prisma db seed` (additive)
>    - Trigger a scrape from `/admin/sources` to publish events to prod
>    - Spot-check `https://www.hashtracks.xyz/kennels/kaohsiung-h3` for the expected upcoming runs.

## Summary
- Type: **full onboard**
- Adapter: **HTML_SCRAPER** (NEW `KaohsiungHashAdapter`, static Cheerio over fully-SSR'd Wix pages — NOT config-only)
- Effort estimate: **new ~150–250 LoC Cheerio adapter + tests** (mirror `boiseh3.ts` Wix content-keyed traversal; surface shape closest to Manila/NSWHHH SSR home page)
- One-line: 🇹🇼 **Southern Taiwan's oldest hash (est. 16 Sep 1973), 4th Taiwan kennel** — adds Kaohsiung METRO and the weekly KHHH run feed (run #2732 as of June 2026).

## Dedup result
- Kennel in seed: **no** (`grep -i kaohsiung prisma/seed-data/kennels.ts` → 0 hits)
- Source in seed: **no**
- Live sitemap dedup: **confirmed NOT live** — read `https://www.hashtracks.xyz/sitemap.xml` via Chrome MCP (2026-06-14, **442 slugs**). Only Taiwan-family slugs present are `taiwan-h3` + `taipei-h3` (Taipei H3 PR #2170 now live). `/kao/` fragment search → **0 hits**; no `kaohsiung*`/`khhh*`/`kh3` slug.
- Pre-onboarding admin-event check: kennel is entirely absent from prod (no slug) → no admin-seeded `Event` rows to dedup/purge.
- Decision: **full onboard**
- kennelCode: `kaohsiung-h3` (collision check: **clear** — `kaohsiung` appears nowhere in `kennels.ts`/`aliases.ts`). 🔴 The kennel's own shortcode **"KHHH" is already an alias of `kampong-h3`** (Kampong H3, Singapore) and **"KH3" belongs to `kowloon-h3`** (Kowloon H3, HK) — both bare shortcodes are taken in the global resolver namespace → **omit both from aliases** and use the city-based `shortName`/`kennelCode` (mirrors the Taiwan H3 `twh3-tw` / Taipei `taipei-h3` discipline).

## Live source verification  ✅ (HTML listings; one ⚠️ for Claude Code)
- Source: **HTML_SCRAPER** — `https://www.kaohsiunghash.com/run-information` (primary, richest) + `https://www.kaohsiunghash.com/` (home page, clean backbone). Both **fully server-rendered** — a plain `web_fetch`/`curl` returns the complete run content. **No browserRender needed.** (Wix generator confirmed: `meta-generator: Wix.com Website Builder`; assets on `static.wixstatic.com`.)
- DNS check: `dns.google/resolve?name=kaohsiunghash.com&type=A` → **Status 0 (OK)**, resolves to Wix IPs `185.230.63.107/186/171`.
- Events seen: **2 numbered upcoming runs** (+1 non-run event), date range **June 27 → July 11, 2026** (both future; today 2026-06-14).
- **Source-count parity:** N/A — this is a rolling "next-runs" surface (home page lists the next ~2–3 numbered runs; the full 2026 schedule is published only as an **image**, `KHHH V2(2).png`, not scrapeable text). Recently-active rule applies: source is live, weekly cadence, both visible runs upcoming → onboard. `upcomingOnly: true`.
- Sample events (VERBATIM from `/run-information` + home page, 2026-06-14):
  1. **#2732 — June 27 — "Saturday Night Run"** — hares **Dobby's Cock Sock and LOL** — location "Stay tuned for details to come!" (not yet posted) — time "Our night runs typically start around 19:00".
  2. **#2734 — July 11 — "7-eleven Joint Night Run"** — hares **Less Fun Than AIDS + Hare** — location "Meet at Qinshui Park behind SKM Mall in CianJhen … Exit 2 from Caoya MRT station" + maps link `https://maps.app.goo.gl/AheK8veDRwxfwJZf7` — time **6:30PM** ("Hare and hounds set off together at 7PM") — cost **NTD300** — joint run with the bi-annual **Kaohsiung 7/11 H3**.
  - Non-run event (skip — no run number): "**June 19, 20, 21 — Dragon Boats**" (dragon-boat racing, not a trail).
- 🔴 **Run-number source inconsistency:** the **home page** lists the July 11 run as **`#2733`** while **`/run-information`** lists the same July 11 run as **`#2734`** (and `#2733` is absent from run-information). Real source messiness — see Adapter notes for the recommended resolution (treat `/run-information` as canonical for run number, or match the two surfaces by **date**, not run number).
- History depth / pagination: **single forward surface, no archive.** The `/events` page is a regular SSR content page for special events (Dragon Boats), not a calendar. No `?format=json`/feed. Run #2732 implies ~2,700 historical runs since 1973, but the source exposes none of them. **No backfill source.**
- Coord sanity: **no per-run coords.** Run venues are `maps.app.goo.gl` shortlinks (no extractable lat/lng). The ONLY decimal coord on the site (`22.6213514,120.2910226`) is the **sponsor bar** (Uncle Bob's), **NOT** a run start — do **not** use it for events. No default-pin trap. lat/lng undefined → merge geocodes the venue text (Kaohsiung bias) or falls back to the Kaohsiung centroid.
- End times: **none published.**
- Notes: Fully SSR'd Wix — static Cheerio. Year-less dates (only ~2–3 forward runs, all future → simple Dec→Jan rollover suffices, no Taipei-style run-number anchoring needed). Single SSR surface ⇒ **fail-loud `events.length === 0` guard** required (brand-new source, 0 baseline). See `source-platform-notes.md` → Wix section.
- **Field-fill assertion table** (sample = the 2 numbered runs above):

  | Field | n filled / n sampled | Plan if low |
  |---|---|---|
  | `title` | 2 / 2 | Keep the post-date theme segment when descriptive ("7-eleven Joint Night Run"); leave **undefined** for a bare run-type label ("Saturday Night Run") → merge synthesizes `"Kaohsiung H3 Trail #N"` |
  | `startTime` | 1 / 2 explicit (2/2 derivable) | Parse prose ("Time: 6:30PM" / "set off together at 7PM" / "start around 19:00"); **fallback by run type** from the title (Sat **night** → 19:00, Sat **afternoon** → 13:00, **Sun family** → 09:00 — see schedule) |
  | `endTime` | 0 / 2 | accept absence |
  | `location` (venue name) | 1 / 2 | prose after "Meet at …"; #2732 = "Stay tuned" → leave undefined (don't store the placeholder) |
  | `locationStreet` | 0 / 2 | not in feed |
  | `locationUrl` (Maps) | 1 / 2 | `maps.app.goo.gl` shortlink from the run body (validate `https:` + host allowlist per Codacy) |
  | `hares` | 2 / 2 | the `<h1>` after `#### Your Hares:` ("Dobby's Cock Sock and LOL", "Less Fun Than AIDS + Hare") |
  | `cost` | 1 / 2 | per-event `Event.cost` when stated (NTD300 on #2734); kennel-level standard not published (see hashCash) |
  | `description` | 2 / 2 | run-body prose |
  | `coords` (lat/lng) | 0 / 2 | none — leave undefined; merge geocodes venue text / Kaohsiung centroid fallback |

## Kennel metadata (deep-dive complete)
- fullName: **Kaohsiung Hash House Harriers** / shortName: **Kaohsiung H3** / region: **Kaohsiung** / country: **Taiwan**
- aliases: `["Kaohsiung Hash", "Kaohsiung Hash House Harriers", "Kaohsiung HHH", "高雄捷兔"]` — 🔴 **omit bare "KHHH" (= Kampong H3) and "KH3" (= Kowloon H3)**, both already taken in the global namespace. (`高雄捷兔` is the kennel's Chinese name, confirmed on the FB group title — mirrors Taiwan H3 `台灣健龍捷兔` / Taipei `台北捷兔`.)
- website: `https://www.kaohsiunghash.com` (source: live, DNS-OK)
- facebook: `https://www.facebook.com/KaohsiungH3` (page; FB group also at `facebook.com/groups/kaohsiunghash`) (source: site header social links)
- instagram: `kaohsiunghash` → `https://www.instagram.com/kaohsiunghash/` (source: site header)
- twitter / discord: none found
- schedule: **Saturday (primary), Weekly** — but MIXED run types. From `/run-schedule` (verbatim): *"Usually, the Saturday afternoon runs meet at 1:00pm, the Saturday night runs at 7:00pm and the Sunday family runs at 9:00am."* (source: `kaohsiunghash.com/run-schedule`). Flat fields = Saturday fallback; encode the variation in `scheduleNotes` (a single `scheduleDayOfWeek` can't express afternoon/night/Sunday-family — **do not** over-engineer `scheduleRules` from an image schedule; keep flat + notes).
- foundedYear: **1973** — *"The Kaohsiung chapter of the Hash House Harriers was founded on September 16, 1973."* (source: `kaohsiunghash.com/about`; cross-confirmed via web search). High confidence.
- hashCash: **not published for standard runs** — the only stated price (**NTD300**) was for the special #2734 7/11 joint run, so it's a per-event `Event.cost`, NOT the kennel standard. ⚠️ **Leave `hashCash` blank / follow up** (don't assume the sibling Taipei "NT$200" applies). (source: `/run-information`)
- dogFriendly: unknown → leave undefined
- walkersWelcome: **true** — *"Every hash will have a runner's trail (longer) and a walker's trail (shorter) and during Family Runs we have a stroller's trail."* (source: `/about`)
- logoUrl: ⚠️ **self-host** — Wix tokenized `https://static.wixstatic.com/media/d6bfcb_51bc5d5c7f70458a8e7f428f5113058e~mv2.png` ("Hashlogopatch.png", the hash patch logo). Download to `public/kennel-logos/kaohsiung-h3.<ext>` and reference `/kennel-logos/kaohsiung-h3.<ext>`. 🔴 **Confirm the real extension via magic bytes**, NOT the `~mv2.png` suffix or Content-Type (Wix CDN can mislabel; AH3-NZ/VH3 precedent). Alt logo on site: `HASHLOGO.jpg`.
- description: "Kaohsiung Hash House Harriers (高雄捷兔) is southern Taiwan's oldest hash — the Kaohsiung chapter of the Hash House Harriers, founded 16 September 1973. A self-described 'drinking club with a running problem' that runs trails around the island and the city: Saturday afternoon runs (~1:00pm), Saturday night runs (~7:00pm), and Sunday family runs (~9:00am) with runner, walker, and stroller trails. Run #2732 as of June 2026. On On!" (sourced from `/about` + `/run-schedule`)
- lat/lng: **22.6273, 120.3014** (Kaohsiung city centroid — kennel-level fallback; no per-run coords)

## Historical backfill
- Available: **none.** The full 2026 schedule is published only as an **image** (`KHHH V2(2).png`); `/events` is a special-events content page; there is no machine-readable archive, JSON feed, or paginated post list. Run #2732 implies a deep history that the source does not expose.
- Plan: **none** — future-only adapter with `config.upcomingOnly: true`. (If a structured archive ever surfaces — e.g. a FB-events export or a Drive sheet — revisit as a one-shot backfill, per the Taipei H3 "deeper archive deferred" note.)

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Add near the other Taiwan kennels (after taipei-h3 / before the China block).
{
  kennelCode: "kaohsiung-h3", shortName: "Kaohsiung H3", fullName: "Kaohsiung Hash House Harriers",
  region: "Kaohsiung", country: "Taiwan",
  foundedYear: 1973,
  scheduleDayOfWeek: "Saturday", scheduleTime: "7:00 PM", scheduleFrequency: "Weekly",
  scheduleNotes: "Mixed run types around Kaohsiung. Per the kennel: Saturday afternoon runs meet ~1:00pm, Saturday night runs ~7:00pm, and Sunday family runs ~9:00am (runner, walker, and stroller trails). Per-run venue/time/hares posted on the Wix /run-information page; meeting points are Google Maps pins. Run #2732 as of June 2026 (running since 1973). Standard hash cash not published online (a NT$300 cost appeared only on a special 7/11 joint run).",
  description: "Kaohsiung Hash House Harriers (高雄捷兔) is southern Taiwan's oldest hash — the Kaohsiung chapter of the Hash House Harriers, founded 16 September 1973. A self-described 'drinking club with a running problem' running trails around the island and the city: Saturday afternoon runs (~1:00pm), Saturday night runs (~7:00pm), and Sunday family runs (~9:00am) with runner, walker, and stroller trails. Run #2732 as of June 2026. On On!",
  // hashCash: undefined — standard per-run price not published (follow up); NT$300 seen only on a special joint run.
  walkersWelcome: true,
  logoUrl: "/kennel-logos/kaohsiung-h3.<ext>",   // self-host the Wix Hashlogopatch.png; confirm <ext> by magic bytes
  facebookUrl: "https://www.facebook.com/KaohsiungH3",
  instagramHandle: "kaohsiunghash",
  website: "https://www.kaohsiunghash.com",
  latitude: 22.6273, longitude: 120.3014,
},

// aliases.ts — Record<string, string[]> (keyed by kennelCode). Omit bare "KHHH" (Kampong) + "KH3" (Kowloon).
"kaohsiung-h3": ["Kaohsiung Hash", "Kaohsiung Hash House Harriers", "Kaohsiung HHH", "高雄捷兔"],

// sources.ts — Source[] (array of objects). Add near the Taipei source.
{
  name: "Kaohsiung H3 Run Information",
  url: "https://www.kaohsiunghash.com/run-information",
  type: "HTML_SCRAPER" as const,
  trustLevel: 5,
  scrapeFreq: "daily",
  scrapeDays: 90,                 // narrow rolling forward window (next ~2–3 runs)
  // The site shows only the next few numbered runs (full schedule is an image, no archive).
  // upcomingOnly keeps reconcile.ts from false-CANCELling runs as they age off the page.
  config: { upcomingOnly: true },
  kennelCodes: ["kaohsiung-h3"],
},
```

## Adapter notes / new-scraper plan

**NEW `KaohsiungHashAdapter` (`src/adapters/html-scraper/kaohsiung-hash.ts`)** — static Cheerio, NOT config-only, NOT browserRender. Both pages are fully SSR'd (confirmed via `web_fetch`).

**Fetch:** `fetchHTMLPage` from `@/adapters/utils` (NOT raw `fetch`; the project standard is `safeFetch`-backed `fetchHTMLPage`). Primary page `/run-information` (richest); optionally also fetch the home page `/` to pick up any near-term run not yet detailed on run-information, merging by **date**.

**Surface structure (from the rendered content — 🔴 capture the verbatim DOM with `curl` at build for the fixture):**
- `/run-information`: each run is an `<h2>` heading `#NNNN <Month> <Day> <Title>` (e.g. `#2732 June 27 Saturday Night Run`), followed by free-form prose paragraphs (time, cost, "Meet at …", a `maps.app.goo.gl` link), then a `<h4>Your Hares:</h4>` block, then an `<h1>` with the hare names.
- Home page `/`: same runs as linked `<h2>` headings `#NNNN - <Month> <Day> - <Title>` (anchors to `/run-information` or `/events`). Cleaner backbone.
- Wix wraps each content block in `[data-testid="richTextElement"]`; key the parse on **visible text**, not opaque rotating class names (see `boiseh3.ts` — climb to the `richTextElement` container, content-keyed traversal).

**Parsing plan (model on `boiseh3.ts` for Wix traversal; `manila-h3.ts`/`nswhhh.ts` for a single/few-run SSR home page):**
- **Run detection:** iterate headings; a run = a heading whose text matches `RUN_RE = /#(\d{3,5})\b/`. Skip non-run events (Dragon Boats — no `#NNNN`).
- **Date:** after the `#NNNN`, parse `<Month> <Day>` (year-less). Resolve year forward against the scrape date (candidate >~60 days in the past → +1 year). Only ~2–3 forward runs (all future) → a simple Dec→Jan rollover is sufficient; **no Taipei-style run-number anchoring needed** (that was for a deep history page; this surface has none). Store **UTC noon**.
- **Run number:** the `\d{3,5}` capture. 🔴 **Source inconsistency** — home page `#2733` vs run-information `#2734` for the same July 11 run. **Treat `/run-information` as canonical** (richer, more carefully maintained); if you merge the two surfaces, **match by date, not run number**, and prefer the run-information number. Emit run numbers faithfully; do not synthesize gaps.
- **Title:** the heading text after the date. Keep it as `title` when it's a real theme ("7-eleven Joint Night Run"); leave `title` **undefined** for a bare run-type label ("Saturday Night Run", "Sunday Family Run") so `merge.ts` synthesizes `"Kaohsiung H3 Trail #N"`. (`shortName` "Kaohsiung H3" is >4 chars → `friendlyKennelName` short-circuits cleanly; verify with the one-liner in gotchas.)
- **Hares:** the `<h1>` immediately after the `Your Hares:` `<h4>` for that run (e.g. "Dobby's Cock Sock and LOL"). On the home-page-only path there are no hares.
- **Time (`startTime` "HH:MM"):** parse the run prose — `Time:\s*(\d{1,2}:?\d{0,2})\s*(AM|PM)` and phrases like "start around 19:00" / "set off together at 7PM". **Fallback by run type** when prose has no time: Saturday **night** → `19:00`, Saturday **afternoon** → `13:00`, **Sun**day **family** → `09:00` (from the published schedule). Keep regexes S5852-safe (split date/time; no stacked `\s*` before classes).
- **Location:** prose after "Meet at …" / "Place:" → `location`; the `maps.app.goo.gl` link → `locationUrl` (validate `https:` + a host allowlist — Codacy flags variable-URL fetches/links). Drop placeholder venue text ("Stay tuned for details", "TBA") → undefined. **No coords** — leave lat/lng undefined (merge geocodes the venue text with Taiwan/Kaohsiung bias, or falls back to the Kaohsiung centroid). No default-pin trap.
- **cost:** when a run states a price ("Run Costs are NTD300 per person") → `Event.cost` (per-event, NOT the kennel default).
- **Fail-loud guard:** single SSR surface → if zero `#NNNN` runs parse, `errors.push("Kaohsiung H3: no runs parsed from /run-information")` so `reconcile.ts` is suppressed (the zero-event health alert can't catch a brand-new source whose baseline is already 0). See `source-platform-notes.md` → Manila/Boise/AH3-NZ fail-loud notes.
- `kennelTags: ["kaohsiung-h3"]` on every event.

**Registry entry** (`src/adapters/registry.ts`): add an import + an `adaptersByName`/`htmlScrapersByUrl` entry mirroring Taipei/Boise:
```ts
import { KaohsiungHashAdapter } from "./html-scraper/kaohsiung-hash";
// …in the URL-pattern list:
{ pattern: /kaohsiunghash\.com/i, name: "KaohsiungHashAdapter", factory: () => new KaohsiungHashAdapter() },
```

**Region — NEW Kaohsiung METRO under the existing Taiwan COUNTRY (3 `src/lib/region.ts` edits; the `kaohsiung`/`高雄` inference rule already exists):**
1. **`REGION_SEED_DATA`** — add a Kaohsiung METRO record after the Taipei record (~line 1745), mirroring Taipei's metro palette (sky family; both Taiwan metros share it — intentional):
   ```ts
   {
     name: "Kaohsiung",
     country: "Taiwan",
     timezone: "Asia/Taipei",
     abbrev: "KHH",
     colorClasses: "bg-sky-100 text-sky-700",
     pinColor: "#0ea5e9",
     centroidLat: 22.6273,
     centroidLng: 120.3014,
     aliases: ["Kaohsiung, Taiwan", "高雄"],
   },
   ```
2. **`STATE_GROUP_MAP`** (~line 3680, next to `"Taipei": "Taiwan"`): add `"Kaohsiung": "Taiwan",`
3. **`COUNTRY_GROUP_MAP`** (~line 3933, next to `"Taiwan": "Taiwan"`): add `"Kaohsiung": "Taiwan",` (mirrors the China `"China"`+`"Shanghai"` both-wired precedent; note Taipei is currently absent here but works — adding Kaohsiung is the safe, manual-compliant choice).
- **`COUNTRY_INFERENCE_RULES`** — ✅ **already covers `kaohsiung` AND `高雄`** (region.ts:3483, the Taiwan rule: `…|kaohsiung|…|高雄|…`). **No edit needed.**
- **`COUNTRY_CODE_TO_NAME`** — `TW: "Taiwan"` already present. **No edit.**

**⚠️ Claude Code: verify before writing real code.** Any snippet above is illustrative; the live repo is authority. Confirm against current types/imports:
- `RawEventData` field names — `kennelTags` is `string[]` (NOT `kennelTag`); `walkersWelcome` (NOT `walkerFriendly`) on `Kennel`. Check `prisma/schema.prisma` for canonical names.
- `Kennel` seed fields — confirm `instagramHandle`, `walkersWelcome`, `scheduleNotes`, `logoUrl` are the real column names (the Taipei seed at `kennels.ts:3146` is the closest template).
- Imports — `fetchHTMLPage` from `@/adapters/utils` (which uses `safeFetch`); never raw `fetch`. `extractHashRunNumber` from `@/adapters/utils` keys on `#` and fits here (`#2732`).
- `title` — leave `undefined` for generic run-type labels; `merge.ts` synthesizes `"Kaohsiung H3 Trail #N"`. Never let a hare name or a labeled fragment become the title.
- `kennelPagesStopReason` — single page, no pagination. Set ONLY on a genuine fetch/HTTP error (a non-empty string suppresses stale-event reconciliation). Leave null on a clean parse.

## Deep-dive checklist (nothing deferred)
- [x] logo (Wix tokenized → flagged self-host + confirm ext by magic bytes)  [x] foundedYear (1973, /about)  [x] socials (FB page + group, IG)  [x] schedule (Sat primary; mixed afternoon/night/Sun-family — flat + scheduleNotes)  [x] hashCash (not published — flagged follow-up; NT$300 is per-event)
- [x] description  [x] source live-verified (SSR confirmed via web_fetch; DNS OK; ⚠️ Claude Code captures verbatim DOM at build)  [x] history depth/pagination assessed (none — image schedule, no archive)
- [x] coord sanity checked (no per-run coords; sponsor coord must NOT be used)  [x] end times noted (none)  [x] kennelCode collision-checked (`kaohsiung-h3` clear; KHHH/KH3 omitted)  [x] kennelCodes (source guard) set

## Implementation gotchas (for Claude Code — repo knowledge, not source knowledge)
- **🔴 Capture the verbatim DOM at build for the fixture** — `curl -s https://www.kaohsiunghash.com/run-information` and `curl -s https://www.kaohsiunghash.com/`. The research sandbox could only read rendered text (Chrome auto-denied the brand-new domain; a cross-origin page-context fetch is CORS-blocked by Wix). Build the test fixture from the real `[data-testid="richTextElement"]` markup, not from this handoff's rendered samples.
- **Wix logos rotate + can be mislabeled** — self-host into `public/kennel-logos/kaohsiung-h3.<ext>`; confirm the extension by **magic bytes** (`file public/kennel-logos/kaohsiung-h3*` — `RIFF…WEBP`=WebP, `\x89PNG`=PNG, `\xff\xd8`=JPEG), NOT the `~mv2.png` suffix or Content-Type.
- **`config.upcomingOnly: true` is required** — the home/run-information pages show only the next few runs; without it, `reconcile.ts` would false-CANCEL runs the moment they age off the page.
- **Single-surface adapter → explicit `events.length === 0` fail-loud guard** (push to `errors[]`) so a markup drift doesn't "succeed" with `events: []`/`errors: []` and silently suppress the zero-event alert on a 0-baseline new source.
- **Sonar S5852 / S5843** — split any date+time regex into two simple regexes; no `\s*` adjacent to alternations; match dates loosely and validate with a month-map / `Date.UTC` round-trip. Use `Number.parseInt(s, 10)`, `s.replaceAll(...)`, `RegExp.exec()` for captures, no negated ternaries.
- **`friendlyKennelName` check** (shortName "Kaohsiung H3" is >4 chars, should short-circuit — confirm):
  ```bash
  npx tsx -e 'import {friendlyKennelName} from "./src/pipeline/merge"; console.log(friendlyKennelName("Kaohsiung H3","Kaohsiung Hash House Harriers"));'
  ```
- **Validate the `maps.app.goo.gl` link before storing/using** (`https:` scheme + host allowlist) — Codacy flags variable-URL handling. Store as `locationUrl`; do NOT attempt coord extraction (shortlinks carry none).
- **CJK in seeds is fine** (`高雄捷兔`) — valid UTF-8 TS string literals (Taiwan/Japan/HK precedent).

---

_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
