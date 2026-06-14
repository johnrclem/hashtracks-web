# Cowork Handoff Retro — New Taipei H3 (🇹🇼 新北捷兔, est. 2013) — 2026-06-13

Feedback from the Claude Code implementation session for the `2026-06-13-nth3-tw.md` handoff — a
**NEW `NewTaipeiHashAdapter`** (HTML_SCRAPER, static Cheerio over a **Big5-encoded** yearly
`run_site_<YYYY>.htm` page, **not** config-only) + seed + self-hosted logo + a **13-year frozen
backfill**, with **zero `region.ts` edits** (Taipei METRO + Taiwan COUNTRY + the `new taipei|新北`
inference regex already on `main` from Taiwan H3 #2107 / Taipei H3 #2170). The 3rd Taipei-area kennel
and **HashTracks' first Big5 source**.

The handoff was **high-fidelity on the structure and the two headline gotchas** (Big5 decode,
year-from-URL) and held exactly. The divergences were all *additive discoveries from the real Big5
DOM* (which the handoff explicitly flagged the research sandbox couldn't capture — it could only read
the ASCII columns), one **wrong sibling-platform assumption the merge with `main` corrected**, and a
long, productive four-round bot review that hardened the adapter.

**PRs produced:**
- Onboarding (adapter + tests + seed + self-hosted logo + 13-yr backfill + docs): [PR #2186](https://github.com/johnrclem/hashtracks-web/pull/2186) (merged). 5 commits — onboard, review fixes (fetch timeout + overseas `countryOverride`), 2 Sonar minors, Taiwan-local year, merge-with-main.
- Docs (this retro + run-log → SHIPPED + target-queue → shipped): this PR.

**Outcome:** Live at https://www.hashtracks.xyz/kennels/new-taipei-h3 — **715 canonical Events**
(#1 2013-01-06 → #718 2026-12-27), 29 upcoming, 651/715 geocoded. Live-verify before CI returned the
**52 2026 runs** (#667→#718, current #690 06/14 @ 15:00), 0 unmatched tags, 0 PII phone leaks, no
duplicate run numbers, Big5 round-trip confirmed (`新北捷兔`). Post-merge from the **worktree** on prod
`.env`: `prisma generate` → `db seed` (additive — kennel/6 aliases/source + 2 seasonal `scheduleRules`,
no new regions) → `BACKFILL_APPLY=1` backfill (**created 663 / 0 blocked / 0 errors**) → prod
`/api/cron/scrape/{id}` (Bearer `CRON_SECRET`) → **eventsFound 52 / created 52 / 0 unmatched / 0
blocked / 0 cancelled / 0 errors**. The Big5 adapter ran cleanly **in the deployed Vercel environment**,
not just locally.

---

## The loop is working — previous retro fixes LANDED

1. **kennelCode/alias collision discipline (Taiwan H3 / Taipei H3 / Lisbon / Budapest retros).** Handoff
   grep-cleared `nth3-tw` (bare `nth3` free; the `-tw` suffix matches sibling `twh3-tw`) and confirmed the
   bare **"NTH3" alias is free** (only `n2th3` carries N2TH3/NNTH3) → included it. Landed exactly.
2. **`<ext>` logo placeholder, confirm via magic bytes (Taipei H3 / Budapest retros).** `NTH3-FB.jpg` was a
   genuine JPEG (`\xff\xd8\xff\xe0` + `image/jpeg` Content-Type, 1013×395) → `/kennel-logos/nth3-tw.jpg`.
3. **Split adapter-verify from post-merge seed (Taipei H3 / Budapest retros).** Structured exactly so —
   `adapter.fetch()` (no DB write) pre-PR confirmed 52 events; `db seed` + backfill + `scrapeSource` as a
   separate post-merge runbook. Landed.
4. **Worktree-`@/`-alias for throwaway scripts (worktree-relative-import memory).** The live-verify and the
   throwaway history-builder both lived under `scripts/` and imported via `@/` — no `../../../` escape.
5. **Frozen-JSON + dumb-loader backfill, builder NOT committed (H7 / Madrid / Brasília retros).** Built the
   663-run archive with a throwaway parser, **froze** `scripts/data/nth3-tw-history.json`, committed only the
   dumb loader, and **deleted the builder** — drift-proof, exactly the lesson.
6. **Region work pre-done (Taiwan H3 / Taipei H3 retros).** "New Taipei" was already a Taipei METRO alias and
   the `new taipei|新北` inference regex already covered it → "do NOT touch `region.ts`" held. Zero edits.
7. **Seasonal `scheduleRules` with disjoint BYMONTH (Budapest / Shanghai retros).** Summer Apr–Sep 15:00 /
   winter Oct–Mar 14:30, disjoint BYMONTH (mirror `shh3-cn`), with `displayOrder`. Seeded clean (no rrule
   upsert-key collision). Pass-2 of the schedule-rule backfill correctly opted out (kennel has `scheduleRules`).

---

## What the handoff got RIGHT (keep doing)

1. **🔴 The Big5 decode was THE headline gotcha — flagged loudly, and dead-on.** "No `<meta charset>`,
   legacy Big5, decode the raw bytes before `cheerio.load`." Implemented by reusing `auckland-hussies.ts`'s
   byte-fetch + size-cap scaffold but **forcing `TextDecoder("big5")`** (native in Node, **no `iconv-lite`
   dependency**). Unit-tested the title round-trips from the real Big5 hex (`新北捷兔` = `b773a55fb1b6a8df`).
   First Big5 source on HashTracks; the queued Taiwanese cousins are catalogued.
2. **🔴 Year-from-URL filename — simpler than the Taipei H3 cousin's run-number anchoring.** The handoff
   correctly noted the year lives in `run_site_2026.htm`, so no anchoring is needed — *and* warned the
   SOURCE url embeds the year, so the adapter must construct `run_site_${currentYear}.htm` or it scrapes a
   stale page after New Year. Both held. (Nice contrast with the Taipei retro's run-number-anchoring win —
   the research correctly identified that this sibling does NOT need it.)
3. **"The sandbox could only read ASCII columns — build the fixture from the real Big5 DOM."** Exactly right.
   Capturing the real DOM (`curl … | iconv -f BIG5 -t UTF-8`) surfaced three things the inferred shape
   missed (Word `<style>`-in-cell leak, stacked-`<p>` multi-value cells, COVID "X" rows) — see GAPS below.
4. **PII phone strip + dedup-Important-Events-by-run-number + fail-loud zero-event guard, all flagged up
   front.** All implemented; the guard pushes an `errors[]` + `errorDetails.parse` entry so a Big5/markup
   drift can't "succeed" with `events: []` and let `reconcile` cancel live runs (0 baseline → health alert
   misses it). Dedup correctly collapsed #700/#708/#714 (Important Events) **and** the "This Week" #690 dupe.
5. **Multi-day `MM/DD~DD` range → first day; founded-year from the `run_site_all_list.htm` index.** The
   index labels years `2013(1st)…2026(14th)` → founded 2013, confirmed by run #1 = 2013-01-06 (hares "Big
   Tree & Fire Bird"). Both held.
6. **`upcomingOnly: true` + the reconcile rationale.** Whole-year page (past + future) + the 13-yr backfill
   → `upcomingOnly` keeps `reconcile.ts` from false-cancelling the aged-off history. Correct.

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🔴 The handoff's "queued Kaohsiung/Taoyuan siblings are the same Big5 shape — reuse this" was WRONG — and the merge with `main` caught it

The handoff said the queued Taiwanese siblings were "the same shape; reuse this." But `main`'s
`docs/taipei-h3-ship` PR (#2182) had **pre-written** a Big5 platform note (anticipating this exact
onboarding) that correctly recorded **Kaohsiung and Taoyuan are Wix, NOT legacy `.htm`** — a different
platform entirely. The merge surfaced a conflict in `source-platform-notes.md` (both PRs appended a Big5
section); resolving it meant consolidating into one **verified** section and adopting `main`'s
sibling-platform correction over the handoff's assumption.

> **Prompt note:** the daily run should not assert a *queued* sibling shares a platform with the kennel
> being onboarded unless it has actually inspected that sibling's markup. "Same city / same naming family"
> ≠ "same platform" (Taipei H3 = SSR PHP, New Taipei = Big5 `.htm`, Kaohsiung/Taoyuan = Wix — four
> Taipei-area kennels, **four different source platforms**). Also: when a prior ship pre-writes a platform
> note for an anticipated target, expect a `source-platform-notes.md` merge conflict and consolidate to the
> verified version.

### B. 🟡 The real Big5 DOM was a Word "Save as HTML" export — three quirks the ASCII-only research couldn't see

All discovered only by parsing the real decoded DOM (and the 13-year archive for the backfill):
- **`<style><!--td {...}--></style>` leaks *inside* table cells** (2024+ pages); cheerio `.text()` includes
  it → strip `style, script` per cell.
- **Multi-value specials stack siblings** — the 2025 2-day Chiang Mai special renders the run cell as
  `<p>647</p><p>648</p>` and the date as `<p>08/23</p><p>08/24</p>`, which `.text()` mashes to "647648" /
  "08/2308/24" → insert a space at block boundaries (`p, div, li`) and take the **first** run#/date.
- **COVID cancellations have no run number** — 2021 rows use run cell `"X"` + venue `"…三級疫情取消"` /
  `"大雨取消"`. Treat any non-numeric run cell as a non-run and **skip it silently** (only a *numbered* run
  with an unparseable date is a genuine anomaly worth an `errors[]` entry).

> **Prompt note:** for hand-maintained legacy `.htm` sites (especially MS-Word/FrontPage "Save as HTML"
> exports), warn that cells may carry stray `<style>` content, that multi-value rows stack `<p>`/`<br>`
> siblings (collapse with block-boundary spacing, take the first value), and that "cancelled"/"suspended"
> rows often blank the run number rather than the row — skip on a non-numeric run cell.

### C. 🟢 `locationUrl` vs `externalLinks` for a non-map per-run link — a deliberate, verified deviation from the handoff

The handoff said "store the FB event link as `locationUrl`." Verifying downstream showed `locationUrl` is
persisted as the canonical `Event.locationAddress`, which drives the **static-map click-through** in
`EventLocationMap`/`EventDetailPanel` — so an `fb.me/e/…` there points the "map" at Facebook. Routed the
per-run Facebook event links to **`externalLinks` (labelled EventLinks)** instead and reserved `locationUrl`
for genuine `goo.gl/maps` links. Better UX, documented in the PR.

> **Prompt note:** `locationUrl` is map-semantic (→ `locationAddress` → static-map href + geocode input).
> Per-run *non-map* links (Facebook event, registration) belong in `externalLinks` (`{url,label}` →
> EventLink), not `locationUrl`. Recommend `externalLinks` for FB/registration links in handoffs.

### D. 🟡 Sonar S5852 fired on the hare-SEPARATOR regex, not the phone regexes

The handoff (correctly) warned to keep the phone-strip regexes simple — and they passed. The S5852 ReDoS
flag actually landed on `HARE_SEPARATOR_RE = /\s*[&＆、]\s*/g` (the `\s*` on **both** sides of the
alternation is the documented footgun). Fixed by dropping to a bare `[&＆、]` char class — `normalizeHaresField`
trims each comma-split part anyway. The seven `http://` literals (origin serves no https) raised S5332
hotspots → marked SAFE via the REST API (MCP returns 0 PR hotspots, per the Madrid/AH3-NZ retros).

> **Prompt note:** the "no `\s*` adjacent to an alternation" S5852 rule applies to **every** new regex,
> not just phone/date patterns — separator/splitter regexes are the easy miss. Prefer a bare char class +
> downstream trim.

---

## Implementation / process learnings (loop context)

1. **🔴 The Taipei retro's "no explicit `vitest` import" prompt-note (item C) is WRONG — and CodeRabbit
   withdrew it here.** CodeRabbit re-flagged the explicit `import { describe, it, expect, vi } from "vitest"`
   as "unnecessary (globals enabled)." Declined with evidence: **96 of the `html-scraper/*.test.ts` files
   import it** — globals make the import *optional, not forbidden*, and the codebase convention is to import
   (editor autocomplete / explicitness). CodeRabbit **accepted, withdrew the comment, and recorded a repo
   learning**. → **Correction to the Taipei retro:** do NOT strip the `vitest` import from new test files;
   match the 96-sibling convention.
2. **🔴 An overseas-special row needs `countryOverride` or its geocode is dropped (Codex P2).** `merge.ts`
   discards a geocoded result >200km from the kennel/region centroid **unless `countryOverride` is set**.
   The archive's two overseas trips (`日本 沖繩` #543, `泰國 清邁` #647) would lose their (correct) foreign
   pins. Added a `foreignCountryOverride()` (Chinese country-token set → `countryOverride: ""`), mirroring
   `new-tokyo-katch.ts`. Regenerated the frozen JSON — **only the 2 overseas rows changed**; 663 total intact.
   (→ memory: foreign-venue countryOverride pattern.)
3. **🟢 `safeFetch` already defaults to a 45s timeout — the explicit `AbortSignal.timeout(30s)` was a
   consistency add, not a fix.** Gemini/Claude flagged a missing timeout; `safeFetch` already bounds it, but
   three sibling adapters pass an explicit signal, so matched them. (The Taipei retro's #2176 made the
   *direct-fetch* default 45s — so this is now belt-and-suspenders.)
4. **🟢 Live-verify proved END-TO-END before CI** — `adapter.fetch()` returned 52 events with correct
   UTC-noon dates, seasonal `startTime` (June→15:00, Oct/Nov→14:30), `kennelTags=["nth3-tw"]`, no dup run#s,
   no phone leaks, FB links captured — before tsc/lint/test and before any DB write. The committed Big5
   page-fixture decode is a deterministic end-to-end test (real bytes → decode → parse).
5. **🟢 Backfill validation caught real data shape, not bugs.** The throwaway builder's checklist (PII scrub,
   run-number monotonicity, gap sanity, dangling separators) flagged the genuine 2021 COVID 84-day hiatus and
   3 absent run numbers (#46/#577 = source page omissions, #648 = the Chiang Mai 2-day fold) — all faithful to
   the source, none a parse error. Verify "missing" run numbers against the live page before assuming a bug.
6. **🟢 Post-merge from the worktree on prod `.env`** (same as Taipei/Shanghai/Taiwan) — main repo carried doc
   WIP on a stale branch; the worktree had the merged code + a working prod env + generated client. Seed was
   slow over the Railway public proxy (~9 min, mostly I/O wait) but additive and clean; the backfill geocoded
   663 venues sequentially (37 ZERO_RESULTS + 10 >200km skips → region-centroid fallback, expected).

---

## TL;DR for the research prompt + platform notes

1. **Big5 / legacy `.htm` is now a documented platform** (first source). Decode raw bytes with
   `TextDecoder("big5")` before cheerio (no `iconv-lite`); a `Mozilla`-prefixed UA is mandatory (origin 500s
   on bare `curl`); year-from-URL filename; seasonal `startTime` by month (the in-table marker even had a
   typo — the header is authoritative); Word-export `<style>`-in-cell + stacked-`<p>` quirks; COVID "X"
   no-run-number rows skip silently. (→ `source-platform-notes.md` Big5 section.)
2. **Don't assume queued siblings share a platform** — four Taipei-area kennels, four platforms (SSR PHP /
   Big5 `.htm` / Wix ×2). Inspect each sibling's markup before asserting reuse. Expect a platform-notes merge
   conflict when a prior ship pre-wrote a note for the anticipated target.
3. **`externalLinks`, not `locationUrl`, for per-run non-map links** (Facebook event / registration) —
   `locationUrl`→`locationAddress` drives the static-map click-through.
4. **Overseas-special rows need `countryOverride`** to survive merge's 200km centroid guard (foreign-venue
   detection → `countryOverride:""`, mirror `new-tokyo-katch.ts`).
5. **CORRECTION to the Taipei retro:** new `*.test.ts` files **should** keep the explicit `vitest` import —
   it's the 96-file codebase convention; globals make it optional, not forbidden. (S5852 still applies to
   *separator* regexes; S5332 http hotspots still get a justified SAFE via REST.)
6. **Keep:** the loud Big5 + year-from-URL flags, "build the fixture from the real DOM," the PII strip +
   dedup + fail-loud guard, frozen-JSON backfill with the builder deleted, kennelCode/alias collision
   discipline, the split adapter-verify / post-merge-seed runbook, and prod-DB-query (not live-page)
   post-scrape verification.
