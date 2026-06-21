# Cowork Handoff Retro — Phnom Penh H3 / P2H3 (Phnom Penh, Cambodia) — 2026-06-19

Feedback from the Claude Code implementation session for the `2026-06-19-phnom-penh-h3.md` handoff —
HashTracks' **first 🇰🇭 Cambodia kennel**: a small static **Grav CMS** dual-surface scraper
(`p2h3.com` home markdown→`<table>`s as the forward backbone, enriched from the `/news/<n>` detail
collection, merged by run number), plus a brand-new country. Goal: fold the genuine learnings back
into the **research prompt** + **platform notes**.

The headline this run is that **the handoff was unusually complete and almost everything landed at the
source** — the prior retros' patterns (tri-state placeholders, unambiguous new-country inference, the
5-edit 2-level `region.ts`, `upcomingOnly` + fail-loud, `title`-undefined synthesis, self-host-logo,
HC-drop-if-empty) all held or were correctly applied. The few genuinely-new items were small:
a **units regex** (`Nkm`) tripped Sonar S5852, the **tri-state placeholder rule shipped as `undefined`
first and was corrected to `null` in review** (it wasn't restated in the handoff), and the **post-merge
prod-scrape trigger has a `www.`-host gotcha** worth recording.

**PR produced:**
- Onboarding (kennel + alias + source + NEW `PhnomPenhH3Adapter` + Cambodia/Phnom Penh region +
  self-hosted logo + 15 tests + a `/news` history backfill script):
  [PR #2266](https://github.com/johnrclem/hashtracks-web/pull/2266) (merged).

**Outcome:** Live at https://www.hashtracks.xyz/kennels/phnom-penh-h3 — **18 canonical events**
(12 backfilled #1829–#1840, 2026-03-28 → 06-14, + 6 upcoming #1841–#1846, 2026-06-21 → 07-25).
Titles synthesized "Phnom Penh H3 Trail #N"; hares populated for real ones (#1841/#1842/#1846) and
**cleared (`null`)** for the "Hares Needed!" placeholders (#1843–#1845); current run #1841 enriched from
`/news` (venue "Pothiprek Pagoda", `maps.app.goo.gl`, trail "10 km run / 5 km walk", departure 13:30).
Post-merge from **synced `main`** on prod `.env`: `db seed` (Created 1 region's metro+country / kennel /
source, 419 schedule-rules updated) → `BACKFILL_APPLY=1` history loader (created 12 / 0 errors) → prod
cron-scrape endpoint (found 6 / created 6 / 0 errors / 0 blocked) → spot-checked the live page.

---

## The loop held — handoff + prior-retro patterns that LANDED

1. **5-edit 2-level `region.ts` for a brand-new country** (Cambodia COUNTRY + Phnom Penh METRO, mirror
   Poland/Nepal, **no `seed.ts` stateMetroLinks**) — complete and correct.
2. **New-country inference = unambiguous tokens only** (Warsaw Gap C) — handoff specified
   `/\b(cambodia|phnom\s*penh)\b/`; no bare ambiguous token, no US place-name collision. Held.
3. **Alias collision discipline** — `PPH3` correctly OMITTED (global collision with `pph4` Pikes Peak);
   `P2H3` verified free. The "check EVERY bare initialism" rule applied.
4. **`config.upcomingOnly: true` + mandatory fail-loud guard** — both pre-stated and implemented
   (total-zero **and** per-run parse-drift push to `errors[]`, Kaohsiung pattern).
5. **`title` undefined → merge synthesizes "Phnom Penh H3 Trail #N"** — verified live; and
   **`friendlyKennelName("P2H3","Phnom Penh Hash House Harriers")` → "Phnom Penh H3"** (the handoff's
   ≤4-char concern was a non-issue — it strips "Hash House Harriers" and appends " H3"; no shortName
   change needed).
6. **`maps.app.goo.gl` shortlinks → `locationUrl`, no decimal coords, no default-pin trap** — held;
   merge geocodes the venue text / Phnom Penh centroid (two ZERO_RESULTS venue names fell back cleanly).
7. **Reference adapters** (`dublin-hash.ts` table iteration, `kaohsiung-hash.ts` fail-loud + Maps
   allowlist, `bangkok-monday-hash.ts` merge-by-run-number) — named in the handoff, carried over directly.
8. **Self-host the logo + magic-byte the extension** — declared `.png`, confirmed `\x89PNG` (301×301 RGBA).
9. **Capture-the-real-DOM at build** — `curl`'d the verbatim home `<table>`s + a `/news/1841` post body
   before parsing; the `web_fetch` "markdown table" was a render artifact (the real DOM was cleaner).
10. **HC-drop-if-unverifiable** — the handoff flagged HC `P2H3-KH` as optional "only if populated"; see Gap E.

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch → seed → adapter → live-verify → tsc/lint/test → PR →
   ordered post-merge runbook — drove the session and the post-merge (seed → backfill → prod scrape →
   spot-check) verbatim.
2. **Dual-surface design + verbatim sample + field-fill table** — the home-backbone ⊕ `/news`-enrichment
   merge-by-run-number, the 3 year-bearing date formats, the "ignore `/hare_line` (stale)" call, and the
   6-upcoming shape all matched the live `fetch()` exactly.
3. **DNS pre-check + 447-slug sitemap dedup** — `p2h3.com` → 51.161.122.78; no
   `phnom`/`cambodia`/`p2h3`/`pph3`. First-Cambodia confirmed.
4. **Shallow-archive sizing** — the handoff's `/news/1000`→home redirect probe correctly predicted
   "~13 recent runs, not a deep archive"; the 12-run backfill matched.

---

## GAPS / corrections → research-prompt / platform-note improvements

### A. 🟡 Tri-state placeholder semantics weren't restated in the handoff → shipped `undefined` first, corrected to `null` in review

The handoff said *"strip TBC/TBA/Hares Needed!/N/A"* but not the `null`-vs-`undefined` distinction, so the
first implementation returned `undefined` for a present placeholder (which the merge reads as
"preserve existing"). Four reviewers (Gemini/CodeRabbit/Codex) flagged it; corrected to a tri-state
`cleanField` — present placeholder → **`null`** (explicit clear), absent cell → `undefined` (preserve) —
applied to home hares + remarks and the `/news` hares, with `mergeDetail` guarding on `!== undefined`.
This is the **Warsaw Gap A lesson recurring**: the rule is in the prompt, but it's phrased as
"strip placeholders," and a new-adapter author reads "strip" as "→ undefined."

> **🔴 Prompt change:** in the handoff's adapter plan, for any `upcomingOnly` source with placeholder
> cells, state the tri-state explicitly — *"present placeholder → emit `null` (clear); absent field →
> `undefined` (preserve); never collapse `null`→`undefined`; merge same-run on `!== undefined`, never `??`."*
> Don't say "strip" — it keeps shipping as `undefined` and getting caught in review.

### B. 🟡 A units regex (`Nkm`) tripped Sonar S5852 — bound EVERY numeric quantifier, not just the "obvious" date/time ones

The S5852 gate failure was on `KM_RE = /(\d+(?:\.\d+)?)\s?km\b/` (trail distance) — the unbounded `\d+`
adjacent to `\s?km` can backtrack super-linearly on digit-heavy non-matching input. The prompt's regex
section already mandates bounded patterns, but the guidance reads as being about date/time regexes; a
distance/units regex felt innocuous and slipped through. Fix: bound the digits — `/(\d{1,4}(?:\.\d{1,2})?)\s?km\b/`.
(Side note: I initially mis-attributed the hotspot to the placeholder alternation and converted it to a
Set first — good hygiene, but not the cause. **Use the SonarCloud REST API
`api/hotspots/search?pullRequest=N` to find the exact flagged line — the Sonar MCP returns 0 for
PR-scoped hotspots**, a quirk already noted in the Madrid retro.)

> **🔴 Prompt reinforcement:** the "bound your quantifiers" S5852 rule applies to **every** numeric
> capture in a new adapter — distances, counts, fees — not just dates/times. `\d{1,4}` not `\d+`.

### C. 🟢 `parseNewsDetail`'s label if-chain hit S3776 cognitive-complexity (17 > 15)

The natural 8-label per-paragraph `if (stripLabel(...)) {…; return}` chain exceeded the threshold.
Refactored to an ordered **label → handler dispatch table** (`[label, (rest, ctx, $, el) => void][]`)
+ extracted `parseDeparture`/`applyTrailLength` helpers.

> **Platform-note add:** a multi-label detail-page parser (`Run No.`/`Date`/`Location`/`Hares`/…) should
> use a dispatch table from the start, not a long if/else-return chain — it stays under S3776 and reads cleaner.

### D. 🟡 Post-merge prod scrape: POST the canonical `www.` host directly — the apex→`www` redirect drops the `Authorization` header

`hashtracks.xyz` 308-redirects to `www.hashtracks.xyz`; `curl -L` **drops the `Authorization: Bearer
$CRON_SECRET` header across the cross-host redirect** → 401. POST straight to
`https://www.hashtracks.xyz/api/cron/scrape/<sourceId>` (the scriptable equivalent of the
`/admin/sources` "scrape now" button; dual-auth Bearer fallback).

> **Runbook add (post-merge step):** trigger the prod scrape against the **canonical `www.` host**, not
> the apex — and don't follow the redirect with the auth header attached.

### E. 🟢 The Harrier Central secondary was correctly DROPPED on live evidence

The handoff flagged HC `P2H3-KH` as an optional config-only secondary "IF populated," to drop if
unverifiable. Live probe (from the dev box, not the sandbox): HC `getEvents` returned **0 events** for
P2H3 under every filter (short-name `P2H3`/`P2H3-KH`, city `Phnom Penh`/`Cambodia`); the kennel-list
endpoints 500'd. Dropped it (an empty trustLevel-8 source is a liability) and documented why in the PR.
The "drop if it can't be verified" instruction worked as intended.

---

## Implementation / process learnings (loop context)

1. **The adversarial PR review earned its keep** — beyond the tri-state (A), the Claude reviewer caught a
   real bug: `mergeDetail` propagated location/hares/trail but **dropped the `/news` On-On venue** (the
   backfill path kept it) → fixed to surface it as the description when the home Remarks didn't already.
2. **🔴 Worktree path discipline bit again** — the first Write/Edit calls used **main-repo** absolute
   paths (the CLAUDE.md context header advertises main-repo paths), so the adapter/test/registry edit
   landed in the MAIN checkout instead of the worktree branch. Caught early, relocated cleanly
   (`cp` → worktree, `git restore` main, re-apply). In a worktree session, target the
   **worktree-prefixed absolute path** for every Write/Edit.
3. **🔴 Post-merge `db seed` must run from a freshly-synced `main`, not the merged worktree** — the
   worktree's `sources.ts` was **33 lines stale** (missing a concurrently-merged PR's `includePastEvents`
   config on ~33 Facebook sources); seeding from it would have **stripped that config** (the documented
   `Source.config` full-overwrite revert). Diffed `origin/main` vs the worktree first, then `git stash -u`
   the doc WIP → ff `main` → `stash pop` before seeding. (Same lesson as the Himalayan retro #4 — promote
   it into the runbook.)
4. **Local test runs in a worktree need a throwaway config** — `vitest.config.ts` excludes
   `**/.claude/worktrees/**`, so `npm test` finds 0 tests in a worktree; ran via a disposable in-worktree
   `vitest.tmp.config.mts` (CI is unaffected — it checks out outside `.claude/worktrees`). And `npx tsx`
   couldn't resolve TS named exports under the box's Node 25, so the **live `fetch()` verification ran as
   a throwaway `*.spec.ts` with a real (un-mocked) `safeFetch`** instead.
5. **`prisma generate` first in a fresh worktree** — `tsc --noEmit` failed with "Cannot find module
   `@/generated/prisma/client`" until the client was generated.
6. **SonarCloud + Codacy ended green** — after bounding `KM_RE` (B) and the dispatch-table refactor (C),
   0 new issues / 0 hotspots to review.

---

## TL;DR for the research prompt + platform notes

1. **🔴 Restate the tri-state placeholder rule in the handoff** (present → `null` clear; absent →
   `undefined` preserve; merge same-run on `!== undefined`). "Strip" keeps getting shipped as `undefined`.
2. **🔴 Bound EVERY numeric quantifier** in a new adapter regex (`\d{1,4}` not `\d+`) — units/counts too,
   not just dates/times (S5852). Find the flagged line via the Sonar **REST** API (the MCP returns 0 for
   PR hotspots).
3. **🟡 Post-merge runbook:** seed from a freshly-synced `main` (never the merged worktree — stale
   `sources.ts` reverts other sources' `config`); trigger the prod scrape against the canonical **`www.`**
   host (the apex redirect drops the auth header).
4. **🟢 Platform note (Grav CMS, already landed):** dual-surface markdown→`<table>` home + shallow
   `/news/<n>` detail, merge by run #; out-of-range `/news/<n>` → home redirect sizes the archive; multiple
   surfaces carry disagreeing data (prefer the richest, don't hard-fail). Use a label→dispatch-table parser.
5. **Keep:** the `▶ FOR CLAUDE CODE` directive, the 5-edit 2-level `region.ts` (no `stateMetroLinks`),
   unambiguous new-country inference tokens, `upcomingOnly` + per-run fail-loud, `title`-undefined
   synthesis, self-host-logo (magic bytes), capture-the-real-DOM, check-EVERY-bare-initialism, and
   HC-drop-on-0-events.
