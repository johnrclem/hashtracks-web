# Onboarding Handoff — Hanoi Hash (the original) (Hanoi, Vietnam) — 2026-09-25

> ## ▶ FOR CLAUDE CODE — implement this entire file, end to end
> You are being given this whole file. Do the full onboarding now, autonomously — **but this is a
> `needs live-verify` handoff: the run feed could NOT be sampled from the research sandbox (it is
> JS/admin-ajax-rendered and Chrome/browserRender was unavailable in this non-interactive run).
> Your FIRST job is to confirm the live source before you build anything.**
>
> 0. **🔴 LIVE-VERIFY GATE (do this first; if it fails, STOP and mark `blocked: stale`, do not ship):**
>    - `hanoihash.com` is a WordPress + Elementor site. The **run archive** (`/runs/`), **stats**
>      (`/stats/`), **cash list** (`/cash-list/`) and the homepage **"This week's run" / "Coming up"**
>      widgets are all **empty in server-rendered HTML** — they hydrate client-side from a bespoke
>      backend (custom "by VD" hash-stats app; NO custom WP REST namespace — `/wp-json/` lists only
>      `wp/v2`, `rankmath/*`, `elementor/*`, `indexnow`, `oembed`). So the run data is served either
>      via `admin-ajax.php?action=…` or a non-WP PHP endpoint.
>    - **Render `https://hanoihash.com/runs/` and the homepage with `browserRender()`** (or Chrome),
>      open the network tab, and **capture the actual data request** (URL + params + response shape).
>      That endpoint — a machine-readable JSON/HTML fragment — is the real adapter source. Record it.
>    - **Confirm recently-active:** the WP blog Run-Report posts are STALE (last one is Hash **#1728**,
>      2024-09-28; the only 2026 WP post is a single "Hash Away Weekend 2026" event promo dated
>      2026-04-03). The *live* run log moved into the stats app. Confirm the stats app shows runs in
>      the last ~2 weeks (weekly-Saturday kennel → within ~2× interval). If #1728 was Sep-2024, a
>      weekly kennel should be around **#1830s by Sep-2026** — verify the current run number/date.
>      If the stats app is ALSO stale (no run in months), this kennel is dormant → `blocked: stale`.
> 1. Branch off a clean `main`: `onboard/hanoi-hash-20260925`.
> 2. **🔴 RE-CONFIRM DEDUP against the FRESH sitemap / prod DB before seeding** (the research run's
>    `web_fetch sitemap.xml` returned a **stale 415-slug cache with ZERO `hanoi` matches — not even the
>    seeded `hanoi-h3`**, so it could not be used to dedup; the fresh Chrome sitemap is ~498 slugs).
>    Check `/kennels/hanoi-hash` and confirm the original Hanoi Hash is not already a manual prod entry.
>    Note the seeded `hanoi-h3` is the **DISTINCT breakaway "Traditional Hanoi H3" (est. 1991)** — do
>    NOT merge them.
> 3. Apply the **Ready-to-paste seed** below (kennel + alias + source). **🔴 Region: 0 `region.ts`
>    edits** — Hanoi METRO + Vietnam COUNTRY already exist (seeded via `hanoi-h3` / `saigon-h3`).
>    **🔴 Alias reassignment:** `aliases.ts:621` currently gives `hanoi-h3` the alias
>    `"Hanoi Hash House Harriers"`, which actually belongs to THIS kennel (the seed comment at
>    `aliases.ts:619-620` says so explicitly: *"reassign/disambiguate if the original hanoihash.com
>    kennel is onboarded later"*). Move `"Hanoi Hash House Harriers"` off `hanoi-h3` onto `hanoi-hash`.
> 4. Implement the adapter against the endpoint you captured in step 0 (bespoke — NOT config-only; see
>    **Adapter notes**). Prefer the discovered JSON/admin-ajax endpoint over `browserRender` if one exists.
> 5. **Live-verify the adapter directly** (no DB write) per `.claude/rules/live-verification.md`:
>    `adapter.fetch(source)` via `npx tsx -e '…'`. Validate events non-empty, dates UTC-noon,
>    `startTime` "HH:MM", `kennelTags` resolves. **DO NOT run `npx prisma db seed` here.**
> 6. Optional: the **Historical backfill** one-shot (large archive #1→current — only if worth it and
>    the endpoint exposes it; frozen-JSON + dumb-loader H7 pattern).
> 7. `eval "$(fnm env)" && fnm use 20 && npx tsc --noEmit && npm run lint && npm test`.
> 8. Commit and open a PR carrying the metadata + live-verification results + deep-dive checklist.
> 9. **Post-merge runbook:** `git checkout main && git pull`; verify each expected file landed
>    (`git log -1 -- <path>`); `fnm use 20`; `npx prisma db seed`; trigger a scrape from
>    `/admin/sources`; spot-check `hashtracks.xyz/kennels/hanoi-hash`.
> Everything you need is in the sections that follow.

## Summary
- Type: **full onboard** (with one alias reassignment off `hanoi-h3`)
- Adapter: **HTML_SCRAPER** — NEW bespoke adapter (**NOT config-only**; JS/admin-ajax-backed WordPress
  stats app, endpoint to be captured at build)
- Effort estimate: **new ~150–250 LoC adapter + tests** (bespoke; effort depends on whether step-0
  finds a clean JSON/admin-ajax endpoint [lower] or requires `browserRender` over `/runs/` [higher])
- One-line: Onboards **the original Hanoi Hash House Harriers** (`hanoihash.com`) — one of Asia's
  large, long-running kennels and the parent from which the seeded "Traditional Hanoi H3" broke away
  in 1991 — filling a known, seed-flagged coverage gap in an already-seeded metro (Hanoi) and country
  (Vietnam), so **0 region.ts edits**.

## Dedup result
- Kennel in seed: **no** — `hanoi-hash` grep-clean across `kennels.ts` / `aliases.ts` / `sources.ts`.
  (The seeded `hanoi-h3` @ `kennels.ts:5317` is the **distinct** breakaway "Traditional Hanoi H3".)
- Source in seed: **no** — no `hanoihash.com` source row.
- Live sitemap dedup: **⚠️ INCONCLUSIVE at research time — Claude Code MUST re-confirm.** The
  non-interactive `web_fetch` of `sitemap.xml` returned a **stale 415-`/kennels/`-slug cache** with
  **zero** `hanoi` matches (not even the seeded `hanoi-h3`), consistent with prior run-logs noting the
  web_fetch sitemap lags origin/main (the fresh Chrome sitemap is ~498 slugs). So absence of a
  `hanoi-hash` slug here proves nothing. Re-check `/kennels/hanoi-hash` against the fresh sitemap / prod DB.
- Decision: **full onboard** (pending the step-0 live-verify gate).
- kennelCode: `hanoi-hash` (collision check: `hanoi-h3` taken by Traditional Hanoi; bare `hh3`/`HHHH`
  taken [Hollyweird h6 / Himalayan]; `hanoi-hash` is grep-clean and matches the domain).

## Live source verification  ⚠️ needs Claude Code to confirm (JS-rendered feed; not sampled)
- Source: **HTML_SCRAPER** — `https://hanoihash.com/` (run feed backend TBD — capture at build; run
  archive UI at `/runs/`, forward run on the homepage "This week's run" / "Coming up" widgets).
  DNS check: **`hanoihash.com` Status 0** (`dns.google/resolve` → `103.153.64.23`). Site SSR renders
  HTTP 200; `article:modified_time` on Home = **2026-08-13**.
- Events seen: **0 sampled** — ⚠️ the run list is client-rendered (empty in SSR) and could not be
  fetched from the non-interactive sandbox (no Chrome/browserRender; `/stats/` timed out at 180s).
- **Source-count parity:** **N/A — could not sample.** Claude Code establishes the baseline at build.
- Sample events: **NONE captured. 🔴 Do not fabricate — the WSH3 failure mode. The one hard datum is
  historical, from the (now-stale) WP Run-Report posts:** Hash **#1728 "Dong Quan Lake"** (run report
  posted 2024-09-28) and Hash **#1727 "Non Vua Peak / Phuong Hoang mountain"** (posted 2024-09-21) —
  VERBATIM post titles via `/wp-json/wp/v2/posts`. These prove the kennel was at ~#1728 in Sep-2024;
  they are **not** current and must not be shipped as upcoming.
- History depth / pagination: potentially **very deep** (#1 → ~#1830s) inside the stats app; the WP
  posts blog only holds recap posts through #1728 (Sep-2024) and is otherwise dormant. Real archive
  depth = whatever the step-0 endpoint exposes.
- Coord sanity: unknown (feed not sampled). Trails are day-of; likely no per-run coords → fall back to
  the Hanoi city centroid (no default-pin trap; single-area kennel).
- End times: unknown (not sampled).
- Notes: **JS/admin-ajax-rendered WordPress stats app.** No custom WP REST namespace. Endpoint must be
  captured via browserRender/Chrome network tab (see step 0). Appended a platform note to
  `source-platform-notes.md`.
- **Field-fill assertion table** — ⚠️ **cannot be filled from research (feed not sampled).** Claude
  Code must build this from the step-0 sample. Expected shape based on the site's schema (`/runs/`
  columns + homepage copy): run # (yes), date (yes), hares/"Hares"+"Does" (likely), venue/location
  (likely), start time (schedule default — bus 13:30 summer / 13:00 winter), theme title (sometimes).

## Kennel metadata (deep-dive complete where a working source exists; else blank + flagged)
- fullName: **Hanoi Hash House Harriers** / shortName: **Hanoi Hash** / region: **Hanoi** / country: **Vietnam**
- aliases: `["Hanoi Hash", "HanoiHash", "Original Hanoi Hash", "Hanoi Hash House Harriers"]`
  (🔴 `"Hanoi Hash House Harriers"` must be **reassigned off `hanoi-h3`** — see directive step 3.
  Bare `"Hanoi"` / `"Hanoi H3"` are owned by Traditional Hanoi H3 → **OMITTED**.)
- website: `https://hanoihash.com/` (source: DNS Status 0 + SSR 200)
- facebook: `https://www.facebook.com/groups/hanoih3` (source: `hanoihash.com` homepage + `og:publisher`)
- instagram / twitter / discord: **none found → blank + flag**
- schedule: **Saturday, weekly** — bus departs **13:30 (summer) / 13:00 (winter)** from 36 Ngo Quyen St,
  Hoan Kiem District (source: `hanoihash.com/` "When"). Suggest flat `scheduleDayOfWeek: "Saturday"`
  fallback + `scheduleTime: "1:30 PM"`; a 2-rule `scheduleRules` array could encode the summer/winter
  time split if desired (both `FREQ=WEEKLY;BYDAY=SA`, startTime "13:30"/"13:00").
- foundedYear: **⚠️ unverifiable from a stated source → leave blank + flag.** The About page is generic
  Mother-Hash lore (no Hanoi founding date). Inference only (do NOT seed as fact): the seeded
  Traditional Hanoi H3 (`hanoi-h3`) is documented as a **1991 breakaway from this original**, so the
  original predates 1991 (~1989–1990 likely); run #1728 in Sep-2024 at weekly cadence is consistent
  with a ~1990/91 start. Claude Code: scan the stats app / "In Memoriam" / anniversary runs for a
  cited first-run date before filling.
- hashCash: **"150,000 VND (first-timers +50,000, present included); under-5s free"** (source:
  `hanoihash.com/` "How much")
- dogFriendly: unstated → blank ; walkersWelcome: **true** (source: homepage — dedicated walking trail 6–8 km)
- description: "The original Hanoi Hash House Harriers — a run/walk 'drinking club with a running
  problem' that meets every Saturday, rain or shine. A Hash bus leaves central Hanoi (36 Ngo Quyen
  St, Hoan Kiem) each week for running (9–12 km) and walking (6–8 km) trails through the countryside
  and villages around Hanoi, followed by a beer stop, a circle and an On-On dinner. No membership —
  just show up." (source: `hanoihash.com/` Home + About)
- logoUrl: `⚠️ self-host` → `public/kennel-logos/hanoi-hash.<ext>` from
  `https://hanoihash.com/wp-content/uploads/2019/06/header-for-web-1.png` (confirm real extension via
  `curl -sI` Content-Type + magic bytes; do NOT assume `.png`).
- lat/lng: none in feed → use Hanoi centroid (reuse the seeded Hanoi METRO centroid; do not invent).

## Historical backfill
- Available: **potentially the full archive (#1 → current, ~1800+ runs)** inside the stats app —
  depth confirmed only after step-0 endpoint capture. WP Run-Report posts alone reach back through
  #1728 (Sep-2024) and older, but are an incomplete recap subset, not the run log.
- Plan: **assess at build.** If the step-0 endpoint returns the full run table (date/run#/hares/venue),
  a one-shot **frozen-JSON + dumb-loader** backfill (`scripts/data/hanoi-hash-history.json` +
  `scripts/backfill-hanoi-hash-history.ts`, H7 pattern) is worth it. Run the frozen-dataset validation
  checklist (PII scrub for hasher names/emails, run-# monotonicity, gap sanity ~7d weekly). Set source
  `config.upcomingOnly: true` regardless (the forward "This week's run" widget ages out weekly).

## Ready-to-paste seed

```ts
// kennels.ts — Kennel[] (array of objects). Region "Hanoi" + country "Vietnam" already seeded.
{
  kennelCode: "hanoi-hash",
  shortName: "Hanoi Hash",
  fullName: "Hanoi Hash House Harriers",
  region: "Hanoi",
  country: "Vietnam",
  website: "https://hanoihash.com/",
  facebookUrl: "https://www.facebook.com/groups/hanoih3",
  // scheduleDayOfWeek/scheduleTime kept as fallback; scheduleRules is authoritative.
  scheduleDayOfWeek: "Saturday",
  scheduleTime: "1:30 PM", // 12-hr in Kennel.scheduleTime; adapter/scheduleRules startTime stay 24-hr "13:30"
  scheduleFrequency: "Weekly",
  hashCash: "150,000 VND (first-timers +50,000, present included); under-5s free",
  walkersWelcome: true,
  // foundedYear: OMITTED — unverifiable from a stated source (see metadata note). Do not invent.
  logoUrl: "/kennel-logos/hanoi-hash.<ext>", // self-host; confirm ext via magic bytes
  description:
    "The original Hanoi Hash House Harriers — a Saturday run/walk 'drinking club with a running problem'. A Hash bus leaves central Hanoi (36 Ngo Quyen St, Hoan Kiem) each week for running (9-12 km) and walking (6-8 km) trails through the countryside around Hanoi, then a beer stop, a circle and an On-On dinner. No membership - just show up.",
}

// aliases.ts — Record<string, string[]> (keyed by kennelCode). NEW entry:
"hanoi-hash": ["Hanoi Hash", "HanoiHash", "Original Hanoi Hash", "Hanoi Hash House Harriers"],
// 🔴 AND edit the existing hanoi-h3 entry to REMOVE "Hanoi Hash House Harriers" (reassigned above):
//   "hanoi-h3": ["Hanoi", "Hanoi H3", "Traditional Hanoi H3", "Traditional Hanoi Hash House Harriers"],

// sources.ts — Source[] (array of objects). Endpoint URL finalized at build (step 0).
{
  name: "Hanoi Hash Run Records",
  url: "https://hanoihash.com/runs/",            // ← replace with the captured data endpoint if distinct
  type: "HTML_SCRAPER" as const,
  trustLevel: 5,
  scrapeFreq: "daily",
  scrapeDays: 120,                                // narrow forward window; backfill handles history
  config: { upcomingOnly: true },                 // forward widget ages out weekly
  kennelCodes: ["hanoi-hash"],
}
```

## Adapter notes / new-scraper plan
**NOT config-only.** The run data is served by a bespoke JS/admin-ajax WordPress stats app (no custom
WP REST namespace). Build path:
1. **Capture the endpoint** (directive step 0) — render `/runs/` + homepage, read the network request
   that populates the run table / "This week's run". Prefer a JSON/`admin-ajax.php?action=…` endpoint;
   fall back to `browserRender()` over `/runs/` only if no clean data request exists.
2. Model the adapter on a bespoke table/records scraper — `src/adapters/html-scraper/dublin-hash.ts`
   (table layout) + `burlington-hash.ts` (field parsing helpers). If it ends up `browserRender`-based,
   mirror `northboro-hash.ts` for the render call.
3. Dates → **UTC noon**; `startTime` → `"HH:MM"` (default `"13:30"` summer / `"13:00"` winter if the
   feed lacks a time); run # → integer; hares split/sort/join; venue → `location` (blank → undefined);
   `title` → leave undefined unless a real theme exists (`merge.ts` synthesizes "Hanoi Hash Trail #N";
   🔴 `friendlyKennelName("Hanoi Hash", …)` — shortName is >4 chars so it short-circuits cleanly, but
   confirm at build). No per-run coords expected → Hanoi centroid fallback, no default-pin trap.
4. **Fail-loud zero-row guard** (`if (rows.length === 0) errors.push(...)`) — single-source, so a
   markup/endpoint drift must surface, not silently reconcile-cancel live events.
5. Register in `src/adapters/registry.ts` (`htmlScrapersByUrl`).

**⚠️ Claude Code: verify before writing real code.** Snippets here are illustrative. Confirm against
current types/imports: `RawEventData.kennelTags` is `string[]` (NOT `kennelTag`); `Kennel.walkersWelcome`
(NOT `walkerFriendly`); use `safeFetch` from `@/adapters/safe-fetch` (NOT raw `fetch`); `browserRender`
from `@/lib/browser-render`; date/extract helpers from `@/adapters/utils` (`chronoParseDate`);
`kennelPagesStopReason` set ONLY on genuine truncation (a non-empty string suppresses reconciliation).

## Deep-dive checklist
- [~] logo (self-host flagged; ext TBD via magic bytes)  [ ] foundedYear (unverifiable → blank + flag)
  [x] socials (FB found; IG/X/Discord none → blank)  [x] schedule (+ summer/winter time note)
  [x] hashCash  [x] description  [⚠️] **source live-verified — NO (JS feed unsampled; step-0 gate)**
  [⚠️] history depth (deep but unmeasured — endpoint TBD)  [ ] coord sanity (not sampled)
  [ ] end times (not sampled)  [x] kennelCode collision-checked  [x] kennelCodes (source guard) set
  [x] region (0 edits — Hanoi/Vietnam seeded)  [x] alias reassignment flagged

## Implementation gotchas (repo knowledge)
- **`config.upcomingOnly: true` is REQUIRED** — the forward "This week's run" widget ages out weekly;
  without it `reconcile.ts` will false-CANCEL aged-off events.
- **Rejecting upstream coords needs `dropCachedCoords: true`** if the feed ever emits a bad/default pin.
- **On partial pagination/endpoint failure set `kennelPageFetchErrors` + `kennelPagesStopReason`** so
  stale-event reconciliation doesn't run against partial data.
- **Self-host the tokenized logo**; never pre-fill the extension — confirm via `curl -sI` + magic bytes.
- **Sonar:** `Number.parseInt(s,10)`, `s.replaceAll(...)`, no negated ternaries; keep regexes S5852-safe
  (split date/time, anchor greedy matches). If `hanoihash.com` serves any `http` literal, expect S5332
  hotspots — use `https` in tests, mark the ~3 real prod literals SAFE.

---
_Implementation directive is at the top of this file (**▶ FOR CLAUDE CODE**). The whole file is the brief._
