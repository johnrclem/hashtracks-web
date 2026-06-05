# Cowork Handoff Retro — Bangkok Monday H3 (🇹🇭 Bangkok's oldest hash, est. 1982) — 2026-06-05

Feedback from the Claude Code implementation session for the `2026-06-05-bmh3-bkk.md` handoff — a new
`BangkokMondayHashAdapter` on a **bespoke static club site** (`bangkokmondayhhh.com`: hand-maintained
HTML, GIF banners, a forward hareline + homepage near-term table + per-year archive). Goal: feed the
one genuinely new lesson (year-less dates need a **bidirectional** rollover) back into the research
prompt + platform notes so future static-club-site handoffs specify it up front.

**PR produced:**
- Onboarding (new adapter + 26 tests + kennel/alias/source seed + frozen 1,185-run backfill):
  [PR #2010](https://github.com/johnrclem/hashtracks-web/pull/2010) (merged). Two commits on-branch:
  onboard → review fixes (bidirectional `inferYear` + Sonar helper-extraction + partial-fetch test).

**Outcome:** Live — https://www.hashtracks.xyz/kennels/bangkok-monday-h3. Post-merge runbook ran clean:
seed (Created 1 / Updated 376); backfill applied **1,185 canonical events** (#981 2002-01-07 → #2212
2026-05-18), **0 errors / 0 blocked**; a triggered live scrape published the **26 forward runs**
(#2213→#2240, 0 unmatched, 0 errors). **1,211 events total**, `lastEventDate` 2026-11-30, 24 upcoming,
`#2215` carries its next-run pin (13.78578, 100.50743). The handoff's verbatim samples (#2215 / 17:30,
the `"2 Nov AGM"` row → 2026-11-02, the #2238/#2239 gap) all held exactly.

---

## The loop is working — previous retro fixes LANDED

1. **H7 / Brasília frozen-dataset backfill.** Committed `scripts/data/bmh3-bkk-history.json` + a dumb
   loader delegating to `runBackfillScript`; the throwaway archive extractor (which ran the adapter's
   exported `parseHarelineRow` over the 24 year-index pages with the page year, not inference) was
   **not** committed. Provenance held; backfill applied byte-for-byte.
2. **`upcomingOnly` + separate backfill (ONH3/Brasília retro).** Source `config.upcomingOnly:true`
   keeps reconcile scoped to future dates so the aged 2002→2026 archive isn't false-cancelled as runs
   roll off the forward hareline. Landed and asserted.
3. **Alias-collision discipline (Asunción/Brasília).** Bare `"BMH3"` correctly **omitted** (globally
   taken — `bullmoon` lists it, and `bmh3-tx` is Brass Monkey/Houston); kennelCode `bmh3-bkk` chosen
   because bare `bmh3` is Bushman/Chicago. The four shipped aliases were grep-clean.
4. **ASCII shortName → no slug override (Asunción/Brasília).** `shortName: "Bangkok Monday H3"` →
   `toSlug` = `bangkok-monday-h3`, no override needed; `friendlyKennelName` (>4 chars) returns it
   verbatim → titles synthesized as `"Bangkok Monday H3 Trail #N"`. Confirmed in prod.
5. **`title` left undefined; merge synthesizes.** No theme titles on this source → adapter never sets
   `title`; no hare-name-as-title risk. Held across all 1,211 events.

---

## What the handoff got RIGHT (keep doing)

1. **The two-surface structure was front-and-center.** "Fetch `FutureHares.html` for the backbone AND
   the homepage for the next-run block; merge by run number." The adapter shape was right on the first
   pass; all the rework was in the date rule (below).
2. **Verbatim oracles for the tricky rows.** The handoff called out `"2 Nov AGM"` (strip `AGM` →
   2026-11-02), the `#2238/#2239` gap ("do not synthesize"), and `#2215`'s next-run coords
   (`!3d13.78578!4d100.50743`, Pattern 1a). Each became a unit-test fixture and each held live.
3. **Field-fill assertion table.** The per-field n-filled/n-sampled table (title 0/27, startTime 1/27 →
   default 17:30, hares ~24/27, etc.) set correct expectations — e.g. "default 17:30 for every forward
   run," "TBA → undefined," "only the next-run block has coords → centroid fallback for the rest." No
   default-pin trap.
4. **Collision + region pre-clearance.** kennelCode/slug/alias collisions all resolved in research, and
   "Bangkok/Thailand region already seeded → no `region.ts` edits" was correct (verified
   `region.ts:2482` Bangkok / `:2470` Thailand) — so this was a clean no-region-edit onboard.
5. **Backfill pre-scoped as worth it.** "~1,200 runs, same clean table, 2002→2026, frozen-dataset
   pattern" was accurate (actual: 1,185) and the one-shot ran first try.

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 Year-less forward-hareline dates need a BIDIRECTIONAL rollover, not just Dec→Jan

The handoff specified only the forward case: *"infer year from today with Dec→Jan rollover (a Jan row
on the forward page belongs to next year)."* That's necessary but incomplete. The homepage's near-term
table also retains the **1–2 just-completed runs** (it showed #2213/#2214 from late May when scraped
June 5). Scraped in **early January**, that same table would show a completed **Nov/Dec** run — and a
"reference-year, roll forward if past" rule would push that Nov run to *next* November (~+300 days),
producing a bogus future event that slips through the 365-day window. Gemini and claude-review both
flagged it; Gemini's proposed **300-day** forward bound is too loose (a Nov-in-Jan run is ~291 days
out and escapes). The fix is a symmetric rule anchored on the scrape date:

- candidate > **~60 days past** → `refYear + 1` (forward case; 60-day margin keeps just-completed runs current),
- candidate > **~8 months (240 days) future** → `refYear − 1` (stale prior-year run still on the homepage).

240 days is safe because the live forward hareline only reaches ~6 months and a weekly club never
schedules >8 months out. Both directions are now unit-tested.

> **Prompt / platform change:** for a year-less `DD MMM` cell on a rolling hareline that *also shows
> recently-completed runs*, specify a **bidirectional** year inference (past>60d→+1yr, future>~8mo→−1yr)
> anchored on the scrape date — never a one-directional "+1 if past" offset. (Captured in the new
> "Bespoke static club sites" platform-notes section.) Sibling of the Brasília "closest-to-publish"
> lesson: the right anchor is the real reference instant, and the rule must handle drift in *both*
> directions.

### B. 🟡 Non-data table rows survive a numeric-first-cell check — guard on cell COUNT too

The per-year archive pages carry a nav table whose first cell text is `"2024 Archives"`, and
`Number.parseInt("2024 Archives", 10)` returns `2024` — so a "skip rows without a numeric run #" guard
alone would mis-ingest the nav row as run #2024. What actually filters it is the **`cells.length >= 4`**
guard (the nav row has 2 cells). Worth stating explicitly in the playbook for any hand-rolled HTML
table scraper.

> **Prompt change:** when the row parser rejects header/nav/decorative rows, require BOTH a numeric run
> cell AND a minimum cell count — `parseInt` stops at whitespace, so `"2024 Archives"` parses to a
> plausible-looking number.

### C. 🟡 Flag the field that has no schema home BEFORE writing the seed block

The handoff listed a **Flickr** URL as kennel metadata, but `KennelSeed` has no flickr field (only
`facebookUrl`, `instagramHandle`, `twitterHandle`, `discordUrl`). It was dropped at implementation and
noted as a follow-up. Cheap to catch in research by diffing the proposed metadata against the actual
`KennelSeed` interface.

> **Prompt change:** in the metadata section, map every gathered social/link to its concrete
> `KennelSeed` field; if a value has no field (Flickr, Strava, YouTube…), mark it "no schema field —
> drop or add column" in the handoff rather than leaving it for the implementer to discover.

---

## Implementation / process learnings (loop context)

1. **🔴 Worktree cwd trap AGAIN — all 8 files first landed in the MAIN checkout.** The environment's
   primary dir is the worktree, but Write/Edit were called with main-repo absolute paths, so the new
   adapter, seed edits, registry, backfill, and frozen JSON all wrote to `/hashtracks-web/...` (on
   `main`). Caught it at live-verify (tsx couldn't resolve `@/...bangkok-monday-hash` because the file
   was in main-src, not the worktree). Relocated all 5 (then 8) files into the worktree, `git restore`
   the modified ones in main, `rm` the new ones in main — leaving main clean (only an unrelated
   untracked `.ship-retros.sh` remained). **Standing reminder: in a worktree, prefix every Write/Edit
   path with the worktree root.** (4th+ recurrence — this keeps costing a recovery step.)
2. **tsx in a worktree with no `node_modules`** resolves `@/` against the worktree's tsconfig but walks
   up to the main repo's `node_modules`; the worktree needed `npx prisma generate` once (gitignored
   build artifact) so transitive runtime imports resolved. Type-only imports (`Source`, `CheerioAPI`,
   `Element`) are erased by tsx so they don't need the generated client. (Node 25 again — `fnm` not on
   PATH; 25 satisfies Prisma 7's "20+" for generate/seed/backfill/scrape.)
3. **Sonar new-code issues fixed at SOURCE, 4 → 0, no NOSONAR.** S3776 (fetch cognitive complexity
   20→<15) + S1121×2 (`errorDetails.fetch/.parse ??=` assignment-in-expression) both dissolved by
   extracting `collectPageRows` / `extractCells` / `applyNextRun` helpers and accumulating into plain
   arrays assigned after the loop. S7721 (hoist the test's `mockBothPages` to module scope). Per the
   beat-Sonar-at-the-source preference.
4. **claude-review's `inferYear` analysis beat the simpler bot suggestion.** Gemini said "add a 300-day
   backward bound"; claude-review showed 300 misses November and proposed ~240 — implemented 240 with a
   documented constraint (no run >8 months out). Worth distinguishing *which* reviewer's number is
   right rather than taking the first.
5. **A Codex connector bot opened a sandboxed "follow-up PR" that never landed.** It re-did the same
   fix with the inferior 300-day bound in its own ChatGPT sandbox; the commit wasn't on any remote ref
   and no PR existed in the repo. Verified (no matching open PR, `git cat-file` unknown) and ignored —
   pulling it would have *regressed* the 240-day fix. Don't chase phantom bot PRs; confirm against the
   actual repo refs.
6. **Post-merge ran from the MAIN repo on `main`** (it has node_modules + generated client + prod
   `.env` → Railway) after the worktree branch merged: seed → backfill dry-run → `BACKFILL_APPLY=1` →
   live scrape via `scrapeSource(id, {force:true})` → prod spot-check (1,211 events). The geocode
   `ZERO_RESULTS` warnings during backfill are expected (informal Bangkok soi/restaurant venue names →
   region-centroid fallback), not errors.

---

## TL;DR for the research prompt + platform notes

1. **Year-less rolling-hareline dates → BIDIRECTIONAL year inference** (past>60d→+1yr,
   future>~8mo→−1yr), anchored on the scrape date — a page that shows recently-completed runs alongside
   future ones can mis-date in *both* directions. A one-directional "+1 if past" rule is a bug. *(New
   "Bespoke static club sites" platform-notes section.)*
2. **Hand-rolled table scrapers: reject non-data rows on numeric-run AND cell-count** — `parseInt`
   happily turns `"2024 Archives"` into `2024`.
3. **Map every gathered social/link to a real `KennelSeed` field in research** — flag the ones with no
   column (Flickr here) instead of surfacing it at implementation.
4. **Keep:** the two-surface fetch-and-merge framing, verbatim oracles for the tricky rows (AGM strip,
   the run-gap, the next-run pin), the field-fill assertion table, region/collision pre-clearance, and
   the frozen-dataset per-year-archive backfill — all landed first-try.
