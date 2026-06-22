# Cowork Handoff Retro — Saigon H3 (Ho Chi Minh City, Vietnam) — 2026-06-20

Feedback from the Claude Code implementation session for the `2026-06-20-saigon-h3.md` handoff —
HashTracks' **first 🇻🇳 Vietnam kennel**: a small static **bespoke-SSR-hash-club-site** scraper
(`saigonhashers.com/hareline`, a markdown→`<table>` "Receding Hairline" forward feed), plus a brand-new
country. Goal: fold the genuine learnings back into the **research prompt** + **platform notes**.

The headline this run: the handoff was again unusually complete, and almost everything landed at the
source — the prior retros' patterns (5-edit 2-level `region.ts`, unambiguous new-country inference,
`upcomingOnly` + per-run/zero fail-loud, `title`-undefined synthesis, self-host-logo, bare-initialism
alias omission, capture-the-real-DOM) all held. The three genuinely-new items were all things the handoff
**flagged but couldn't resolve from the sandbox**: (1) the `/runs` archive it called "JS-rendered, not
sandbox-reachable" actually **SSR'd a full ~800-run table** from the dev box → a real 771-run backfill
instead of "probe/skip"; (2) the illustrative **orange palette collided with Belgium** (the handoff
explicitly said "verify vs SE-Asia neighbors") → switched to **cyan**; and (3) the **`startTime`** the
handoff left undefined was set to the fixed **13:30** bus departure (matching the Phnom Penh sibling) after
a reviewer flagged untimed events.

**PR produced:**
- Onboarding (kennel + alias + source + NEW `SaigonH3Adapter` + Vietnam/Ho Chi Minh City region +
  self-hosted logo + 16 tests + a `/runs` history backfill script):
  [PR #2269](https://github.com/johnrclem/hashtracks-web/pull/2269) (merged).

**Outcome:** Live at https://www.hashtracks.xyz/kennels/saigon-h3 — **794 canonical events**
(771 backfilled #16/#1062→#1834, 2011-01-16 → 2026-06-21, + 23 upcoming #1835→#1857, 2026-06-28 →
2026-11-29), all CONFIRMED, all `startTime=13:30`. Titles synthesized "Saigon H3 Trail #N" for the
"Bus Trip/City Run" run-type rows; real occasions kept ("William of Orange Run", "Saigon H3 36th Birthday
Run", "Cherry Ho & Sore Arse B-Day Run"); "Hares Needed!" placeholders cleared (`null`); real hares kept
verbatim incl. the trailing "& Co". Post-merge from **synced `main`** on prod `.env`: `db seed`
(Created 1 / Updated 420) → `BACKFILL_APPLY=1` `/runs` loader (created 771 / 0 errors / 0 blocked) →
`scrapeSource(..., {force})` forward scrape (found 23 / updated 23 — the daily cron had already published
them / 0 errors) → spot-checked the live page (1857 highest run #, 36 years active, 23 upcoming + 771 past).

---

## The loop held — handoff + prior-retro patterns that LANDED

1. **5-edit 2-level `region.ts` for a brand-new country** (Vietnam COUNTRY + Ho Chi Minh City METRO,
   mirror Poland/Nepal/Cambodia, **no `seed.ts` stateMetroLinks**) — complete and correct.
2. **New-country inference = unambiguous tokens only** — `/\b(vietnam|viet\s*nam|saigon|ho\s*chi\s*minh|hanoi)\b/`;
   no bare ambiguous token, no US place-name collision. Returned the full name `"Vietnam"` (not a code),
   matching the recent Nepal/Cambodia precedent. Including `hanoi` pre-serves the Hanoi H3 sibling.
3. **Alias collision discipline** — bare **`"SH3"` correctly OMITTED** (global collision: `summit` /
   `sh3-wa` / `salemh3` all carry it in `aliases.ts`); the "Ho Chi Minh …" original-name forms verified free.
4. **`config.upcomingOnly: true` + mandatory fail-loud guard** — both pre-stated and implemented
   (total-zero **and** per-run parse-drift push to `errors[]`, Kaohsiung/Phnom Penh pattern).
5. **`title` undefined → merge synthesizes "Saigon H3 Trail #N"** — verified live; and
   **`friendlyKennelName("Saigon H3", …)` → "Saigon H3"** (the >4-char short-circuit, as predicted).
6. **ISO `YYYY-MM-DD` dates → NO inference** — parsed straight to UTC noon; far simpler than the SE-Asia
   `DD MMM`/comma-ordinal variants. No chrono, no S5843/S5852 date-regex risk.
7. **Reference adapters** (`dublin-hash.ts` table iteration, `phnom-penh-h3.ts` tri-state `cleanField` +
   fail-loud + Maps allowlist) — named in the handoff, carried over directly.
8. **Self-host the logo + magic-byte the extension** — declared `.png`, confirmed `\x89PNG` (625×625 RGBA).
9. **Capture-the-real-DOM at build** — `curl`'d the verbatim `/hareline` `<table>` (and later `/runs`)
   before parsing; the `web_fetch` "markdown table" was a render artifact.

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch → seed → adapter → live-verify → tsc/lint/test → PR →
   ordered post-merge runbook — drove the session and the post-merge (seed → backfill → forward scrape →
   spot-check) verbatim.
2. **Verbatim sample + field-fill table** — the `numbers | Date | Name/Occasion | Hares | A-Site | On-On`
   columns, the run-type-vs-theme split, and the "A-Site/On-On empty today but code for it" all matched the
   live `fetch()`. (The forward feed showed **23** runs, not the handoff's 24, because #1834 had receded off
   `/hareline` into the `/runs` archive the day after research — exactly the "Receding Hairline" behavior the
   `upcomingOnly` call anticipated.)
3. **DNS pre-check + 447-slug sitemap dedup** — `saigonhashers.com` → 145.223.124.21; no
   `saigon`/`vietnam`/`hcmc`/bare `sh3`. First-Vietnam confirmed.
4. **Shared-COUNTRY coordination** — the "Vietnam COUNTRY shared with Hanoi #1; whichever ships first adds
   it" call was correct; Saigon shipped it, so Hanoi will add only the Hanoi METRO.
5. **The bare-`SH3` collision call + the "verify the palette vs neighbors" flag** — both were right (see Gap A).

---

## GAPS / corrections → research-prompt / platform-note improvements

### A. 🔴 The illustrative palette ("orange") collided with Belgium — the handoff's "verify vs neighbors" flag was right; the *map* of taken palettes is the missing input

The handoff illustrated `bg-orange-200`/`#ea580c` but flagged *"orange is common, so verify or swap"* and
the run-log follow-up said *"illustrative orange may clash — verify vs SE-Asia neighbors."* It does:
**orange is Thailand/Bangkok's** (and used ~25×), and the first implementation pass picked **amber**, which
turned out to be **Belgium's exact COUNTRY+METRO+pin pair** (amber is used ~20×). The `/code-review` pass
caught the amber/Belgium duplication; switched to **cyan** — distinct from *every* SE-Asia neighbour
(Thailand=orange, Cambodia=purple, Nepal=violet, Malaysia=green, **Indonesia=teal**, **Taiwan=sky**,
Singapore/HK/Japan/China=red, Philippines=fuchsia), whose cyan owners (Hawaii, US-east, NZ) are nowhere near
Vietnam on the map. **Every Tailwind family is already used somewhere** (only grayscale `zinc`/`neutral` are
unused), so the real rule isn't "pick a free family" — it's "**don't duplicate a *neighbour's* full
palette, and don't exact-dup any single country's family+both-shades+both-pins.**"

> **🔴 Prompt change:** the new-country `region.ts` step should say: *grep `REGION_SEED_DATA` for the
> candidate family BEFORE choosing it (every family is reused; the goal is neighbour-distinct + not an exact
> country dup). For SE-Asia, orange/amber/teal/sky/red/violet/purple/green/fuchsia are taken by neighbours —
> default to a cyan-class cool palette and verify.* The `/code-review` palette check earns its keep — keep it.

### B. 🟢 `/runs` SSR'd a full ~800-run archive — re-probe "JS-rendered / sandbox-timeout" assumptions from the dev box

The handoff (and run-log) called `/runs` *"JS-rendered DataTables, timed out, not sandbox-reachable"* and
scoped the backfill as "probe at build, low priority, skip if only JS." From the **dev box**, a plain
`curl` of `/runs` returned a **6.2 MB fully-SSR'd `<table>`** of ~800 past runs
(`numbers | Date | Name/Occasion | Pack Size | Hares | A-Site | On-On`, descending from #1834). The sandbox
*timeout* was a sandbox limitation (6 MB page), not a client-render. So the backfill went from "maybe skip"
to a real **771-run load spanning 2011-01-16 → 2026-06-21** (15+ years) — done via the Phnom Penh sibling
pattern (`runBackfillScript` + an exported `parseRunsArchive`, **live-fetch, NOT a committed frozen JSON** —
the `/runs` endpoint is reliable, so an 800-row fixture would just be churn).

> **🔴 Prompt reinforcement:** when the *sandbox* can't reach an archive surface (timeout / nav-only),
> mark it **"re-probe from the dev box at build"**, not "JS-rendered/skip." A plain `curl` from the build
> box frequently SSRs what the sandbox couldn't. For a reliable SSR archive endpoint, prefer a **live-fetch
> backfill** (export a `parseRunsArchive` from the adapter + reuse `runBackfillScript`) over a frozen JSON.

### C. 🟡 `startTime`: a fixed-departure country-bus hash should stamp the fixed time, not leave it undefined

The handoff said *"leave `startTime` undefined — City Runs may differ, so undefined is safer."* But the
live banner + FAQ state the **bus departs 1:30 pm every Sunday** (bus-trip *and* city-run), and the Phnom
Penh sibling stamps `DEFAULT_START_TIME` for exactly this reason. Codex flagged that undefined events render
untimed and sort after timed same-day runs. Resolved (with the user) to stamp **`13:30`** on every run in
the shared `buildSaigonRawEvent` (hareline + archive). The "city runs may differ" caveat was over-cautious —
the *departure* is fixed even when the trail type varies.

> **🟡 Prompt add:** for a country-bus / fixed-meeting-time hash whose site states one departure time, set
> that as a `DEFAULT_START_TIME` (mirror `phnom-penh-h3.ts`) rather than leaving `startTime` undefined —
> even when the per-run table carries no time. Undefined = untimed render + wrong same-day sort.

### D. 🟡 The Maps-URL validator should return the *absolute* resolved URL, not the raw href

Gemini flagged that `isValidMapsUrl` validated the href but stored the **original** (possibly
protocol-relative `//maps.app.goo.gl/…` or relative) string as `locationUrl`. Refactored to
`getAbsoluteMapsUrl` → returns `new URL(href, origin).href` (the fully-qualified absolute URL) or `null`.
The Phnom Penh sibling has the same return-the-raw-href shape, so this is a small improvement worth
propagating.

> **Platform-note add:** the per-adapter Maps allowlist helper should return the **absolute** URL
> (`parsed.href`), not the matched-but-raw href — so a protocol-relative/relative link is stored renderable.

### E. 🟢 The tri-state placeholder rule shipped slightly short again — restate it (recurring: Phnom Penh Gap A, Warsaw Gap A)

`cleanHares` first shipped typed `string | null` (no `undefined` branch). `/code-review` aligned it to the
Phnom Penh `cleanField` tri-state (`undefined` arg → `undefined` preserve; present placeholder/empty →
`null` clear; real → trimmed). In practice the cell is always present here so the effect was nil, but the
**type/shape divergence from the sibling** is the same recurring "strip ≠ tri-state" gap. Keep restating it.

---

## Implementation / process learnings (loop context)

1. **🔴 Worktree path discipline bit AGAIN** (Phnom Penh retro #2, verbatim recurrence) — the first
   Write/Edit calls used **main-repo** absolute paths (the CLAUDE.md context header advertises them), so the
   adapter/test/registry edits landed in the MAIN checkout instead of the worktree branch. Caught at the
   first test run (vitest found the file "missing"); relocated cleanly (`cp` → worktree,
   `git checkout -- <file>` + `rm` in main, re-verify). **In a worktree session, target the worktree-prefixed
   absolute path for every Write/Edit** — and conversely, this docs-sync PR's edits belong in the **main**
   checkout (where the daily-routine changes live), so the right target flips per task.
2. **🔴 `vitest.config.ts` excludes `**/.claude/worktrees/**`** → `npm test`/`vitest` finds **0 test files**
   from inside a worktree (the exclude glob matches the worktree's own absolute path). Ran via a disposable
   in-worktree `vitest.local.config.ts` (the committed config minus that exclude), **deleted before commit**.
   CI is unaffected (it checks out outside `.claude/worktrees`). (Same as Phnom Penh retro #4 / Himalayan #4
   — this one is now a standing worktree gotcha; saved to memory.)
3. **🟢 `prisma generate` first in a fresh worktree** — `tsc --noEmit` floods with "Cannot find module
   `@/generated/prisma/client`" until the gitignored client is generated. (Phnom Penh retro #5.)
4. **`npx tsx -e` transpiles to CJS** → top-level `await` errors ("not supported with cjs output"); wrap the
   live-verify / forward-scrape one-liners in an `async function main(){…}; main().then(()=>process.exit(0))`.
   Node here is **25 only** (no `fnm`/node@20); 25 satisfies the "20+" requirement.
5. **Post-merge `db seed` from a freshly-synced `main`, not the merged worktree** — pulled `main` first
   (the merge was a true **merge commit**, not a squash, so **both** commits — onboarding + the startTime/URL
   review-fix follow-up — landed; verified each file via `git log`/grep before seeding). Avoids the stale
   `sources.ts` full-overwrite revert (Phnom Penh retro #3).
6. **Forward scrape via `scrapeSource(sourceId, {force})`** from synced `main` — found 23 / **updated** 23
   (the daily cron had already published them; the manual scrape re-confirmed idempotently, created=0).
   The `revalidateTag` *"no request scope"* log it emits is **benign** (the cache-bust only works inside a
   Next request; the DB write commits first).
7. **The adversarial PR review earned its keep** — the amber/Belgium palette collision (A), the
   absolute-Maps-URL hardening (D), and the cleanHares tri-state (E) were all reviewer catches, not
   self-caught. CodeRabbit clean, Sonar/Codacy green.

---

## TL;DR for the research prompt + platform notes

1. **🔴 Palette: grep `REGION_SEED_DATA` for the candidate family first.** Every Tailwind family is reused;
   the rule is neighbour-distinct + no exact single-country dup. SE-Asia: orange/amber/teal/sky/red/violet/
   purple/green/fuchsia are all taken by neighbours → default cyan-class cool. Keep the `/code-review` palette check.
2. **🔴 Re-probe "JS-rendered/sandbox-timeout" archives from the dev box** — `/runs` SSR'd a full ~800-run
   table a plain `curl` reached. Prefer a **live-fetch backfill** (`parseRunsArchive` + `runBackfillScript`)
   over a frozen JSON when the archive endpoint is reliable.
3. **🟡 Fixed-departure country-bus hash → stamp the `DEFAULT_START_TIME`** (mirror Phnom Penh), don't leave
   `startTime` undefined; undefined = untimed render + wrong same-day sort.
4. **🟡 Maps allowlist helper returns the absolute URL** (`parsed.href`), not the raw href (handles
   protocol-relative). **🟢 Restate the tri-state placeholder shape** (the recurring "strip ≠ tri-state" gap).
5. **🔴 Worktree hygiene (standing):** worktree-prefixed paths for Write/Edit; temp `vitest.local.config.ts`
   to run tests inside a worktree; `prisma generate` first; `tsx -e` needs an async-IIFE wrapper on Node 25;
   post-merge seed from synced `main` (merge-commit kept both commits).
6. **Keep:** the `▶ FOR CLAUDE CODE` directive + ordered post-merge runbook, the 5-edit 2-level `region.ts`
   (no `stateMetroLinks`), unambiguous full-name inference tokens, `upcomingOnly` + per-run/zero fail-loud,
   `title`-undefined synthesis + `friendlyKennelName` >4-char short-circuit, ISO-dates-no-inference,
   self-host-logo (magic bytes), check-EVERY-bare-initialism, capture-the-real-DOM, shared-COUNTRY coordination.
