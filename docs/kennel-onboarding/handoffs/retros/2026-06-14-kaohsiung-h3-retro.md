# Cowork Handoff Retro — Kaohsiung H3 (🇹🇼 高雄捷兔, southern Taiwan's oldest hash, est. 16 Sep 1973) — 2026-06-14

Feedback from the Claude Code implementation session for the `2026-06-14-kaohsiung-h3.md` handoff — a
**NEW `KaohsiungHashAdapter`** (HTML_SCRAPER, static Cheerio over the fully-SSR'd Wix `/run-information`
page, **not** config-only, **not** browserRender) + seed + new **Kaohsiung METRO** under the
already-seeded Taiwan COUNTRY + self-hosted PNG logo. The **4th Taiwan kennel** (after live Taiwan H3,
Taipei H3, New Taipei H3) and the first in Kaohsiung.

The handoff was **high-fidelity** — every verbatim oracle held against the real DOM, and the two things
it explicitly flagged as risks (the cross-page run-number drift, the sandbox's inability to capture raw
markup) were exactly the things that needed a build-time decision. The substance of this run was a
**four-round bot-review cadence** that hardened the adapter, including one genuinely important Codex
adversarial-review catch — and one round of **self-inflicted churn** worth not repeating.

**PRs produced:**
- Onboarding (adapter + tests + seed + region + self-hosted logo): [PR #2196](https://github.com/johnrclem/hashtracks-web/pull/2196) (merged). 4 commits — onboard, partial-drift fail-loud (Codex), Gemini/Sonar nits, SonarCloud complexity refactor.
- Docs (this retro + run-log → SHIPPED + a `source-platform-notes.md` Wix implementation update + queue → shipped): this PR.

**Outcome:** Live at https://www.hashtracks.xyz/kennels/kaohsiung-h3 — **2 upcoming canonical Events**,
both `CONFIRMED`: **#2732** (2026-06-27 19:00, bare "Saturday Night Run" → synthesized "Kaohsiung H3
Trail #2732", hares "Dobby's Cock Sock and LOL") and **#2734** (2026-07-11 18:30, kept theme
"7-eleven Joint Night Run", NTD300, "Qinshui Park behind SKM Mall…", hares "Less Fun Than AIDS + Hare").
Live-verify before CI returned both with correct UTC-noon dates, `HH:MM` times, validated `maps.app.goo.gl`
URL, 0 unmatched tags, 0 errors. Post-merge from the **main repo** (synced; see learning #3):
`db seed` (additive — **Created 2 / Updated 412**) → `scrapeSource()` → **eventsFound 2 / created 2 /
0 unmatched / 0 blocked / 0 cancelled / 0 errors**; prod DB query confirmed the kennel, source +
`SourceKennel` link (`config.upcomingOnly:true` intact), Kaohsiung METRO, both canonical events, and
`haresText` on both.

---

## The loop is working — previous retro fixes LANDED

1. **kennelCode/alias collision discipline (Taiwan H3 / Taipei H3 / Lisbon / Shanghai retros).** Handoff led
   with the bare-shortcode collisions — **"KHHH" = Kampong H3** (Singapore), **"KH3" = Kowloon H3** (HK) —
   → `kennelCode: kaohsiung-h3` (city-based) + **both bare aliases omitted**, with the global-namespace
   rationale. Landed exactly; grep-clear.
2. **`<ext>` logo placeholder, confirm via magic bytes (ah3-nz / Budapest / Taiwan H3 / Taipei retros).** The
   Wix `…~mv2.png` token was a genuine PNG (`\x89PNG` + `file` = "PNG image data, 500 x 500") →
   `/kennel-logos/kaohsiung-h3.png`. Trusted magic bytes over the URL suffix.
3. **Split adapter-verify from post-merge seed (ZH3 / Budapest / Taiwan H3 / Taipei retros).** Structured
   exactly so — `adapter.fetch()` (no DB write) pre-PR confirmed 2 events; `db seed` + `scrapeSource()` as a
   separate post-merge runbook. Did **not** run `db seed` during the PR.
4. **Worktree-`@/`-alias for live-verify scripts (worktree-relative-import memory).** The throwaway
   live-verify `tsx -e` snippet imported via the `@/` alias — no `../../../` escape to the main repo.
5. **Single-page fail-loud zero guard (Vindobona / Manila / Taipei retros).** Implemented up front — but Codex
   showed the *page-level* guard isn't enough for a *multi-run* page (→ "what the handoff missed" #A). The
   prior retros' instinct was right; this run sharpened its granularity.
6. **CJK / region work pre-done (Taiwan H3 retro).** The `kaohsiung`/`高雄` `COUNTRY_INFERENCE_RULES` branch
   + Taiwan COUNTRY shipped with Taiwan H3 #2107 — the handoff correctly said only a METRO record + group-map
   entries were needed. No inference edit.

---

## What the handoff got RIGHT (keep doing)

1. **🔴 Flagged the cross-page run-number drift up front — and the resolution was "parse one surface".** The
   handoff called out that the home page lists the Jul 11 run as `#2733` while `/run-information` lists it as
   `#2734`, and said "match by date, not run number". At build the cleaner call surfaced: the home page added
   **no run** that `/run-information` lacked, so parsing `/run-information` **only** removed the discrepancy
   entirely with zero loss. The handoff's "treat `/run-information` as canonical" steer made this obvious.
2. **Flagged the sandbox couldn't capture raw markup → "capture the verbatim DOM at build".** Exactly right:
   `curl` of the real page showed each run is a sequence of `[data-testid="richTextElement"]` blocks (an
   `<h2>` `#NNNN Month Day Title`, prose `<p>`, a `Your Hares:` `<h4>`, then the hare names in an `<h1>`),
   with `&nbsp;`/`<br>` inside headings — built the fixture from that, not the handoff's rendered-text sample.
3. **Bare-label-title → synthesize, descriptive-theme → keep.** The handoff's field-fill table prescribed
   leaving `title` undefined for "Saturday Night Run" and keeping "7-eleven Joint Night Run". Verified
   end-to-end in prod: #2732 → "Kaohsiung H3 Trail #2732", #2734 → "7-eleven Joint Night Run".
4. **Time-by-run-type fallback + "Time: 6:30PM" over the 7PM pack-off.** The prose has both a 6:30PM start and
   a "set off together at 7PM"; the handoff's "first explicit time" rule + the night/afternoon/family fallback
   produced 18:30 / 19:00 correctly.
5. **`upcomingOnly:true` + no backfill, with the reasons.** The schedule is published only as an image and
   there's no machine-readable archive — the handoff said so and prescribed `upcomingOnly` to protect the
   rolling ~2–3-run window from reconcile. Correct.
6. **Didn't over-engineer the mixed schedule into `scheduleRules`.** Sat-afternoon / Sat-night / Sun-family
   come from an *image* schedule, so the handoff kept flat fields + `scheduleNotes` rather than inventing
   season/weekday rules. Right call — `scheduleRules` from an unverifiable image would have been fiction.

---

## Handoff GAPS → research-prompt / process improvements (the actionable part)

### A. 🔴 "Fail-loud zero guard" under-specified the granularity — multi-run pages need PER-RUN fail-loud (Codex adversarial review)

The handoff (and prior single-page retros) prescribed a **page-level** guard: `events.length === 0` →
`errors[]`. I implemented that (keyed on the windowed result). Codex's adversarial review caught the hole: a
**multi-run** page with *partial* drift — two runs, one heading whose date no longer parses — returns **one**
event with `errors: []`. `scrape.ts` then runs stale reconciliation, and because `upcomingOnly` only shields
*past* events, `reconcile.ts` can **false-CANCEL the drifted run's sole-source canonical while the page still
lists it**. The page-level guard never fires because the result isn't empty.

Fix: every numbered (`#NNNN`) block that fails to fully parse now pushes a `ParseError` into both flat
`errors[]` and `errorDetails.parse` — so *partial* drift suppresses reconcile even when other runs parse
cleanly. Added a test (one good + one date-drifted heading → good run returned, parse error raised).

> **Prompt note:** for any **multi-run** SSR page (this, Bangkok Monday, Vindobona, Madrid-style), specify the
> fail-loud guard as **per-numbered-block**, not `events.length === 0`. Every `#NNNN`/`Run N` heading that is
> detected-but-unparseable is markup drift and must emit a `ParseError`; silently `continue`-ing past it lets
> reconcile cancel that run's canonical. The single-block guard from Manila/Boise is the *floor*, not the spec.
> (→ memory + `source-platform-notes.md` Wix implementation update.)

### B. 🟡 A reviewer readability nit caused a Sonar complexity failure — reach for the durable form first

Round 2 (Gemini) flagged the deterministic month parser: "prefer exact month-name lookups over slicing
prefixes (`'Maybe'` could match `'May'`)". I addressed it by expanding `MONTH_RE` to a full-name **+**
abbreviation alternation (~23 arms) and keying the `Map` on both forms. Round 3 (SonarCloud) then flagged
that very regex as **S5843** (complexity 22 > 20). The form that satisfies *all* of them — and is genuinely
the best — is neither the original abbreviation-slice nor the full-name alternation: scan candidate words with
a trivial `/\b[a-z]{3,9}\b/gi` and validate each by **exact `Map.get()`** (keyed by full + abbreviated names).
No alternation (no S5843/S5852), no slice, no `'Maybe'→'May'` false positive, and a `Map` (not `Record[var]`)
sidesteps Codacy's object-injection rule. It took an extra review cycle to arrive there.

> **Prompt note:** when parsing month names, don't reach for a month-name **alternation** (it's an S5843
> complexity trap) or an abbreviation **slice** (the `'Maybe'→'May'` false-positive Gemini flags). Write the
> durable form from the first commit: a generic word-token regex + an **exact `Map.get()`** keyed by full and
> short names. (→ memory — this is the second time the `Map.get()`-over-`Record[var]` lesson has appeared,
> after Manila.)

### C. 🟢 The handoff over-counted the region edits — "match precedent, don't add for symmetry"

The handoff said "3 `region.ts` edits" (REGION_SEED_DATA + `STATE_GROUP_MAP` + `COUNTRY_GROUP_MAP`). The
correct count is **2**: the sibling **Taipei is absent from `COUNTRY_GROUP_MAP` and resolves fine** (the
metro key there is dead — resolution hits `STATE_GROUP_MAP` first), so adding Kaohsiung there would have been
redundant. The handoff itself flagged the ambiguity ("Taipei is currently absent here but works — adding
Kaohsiung is the safe… choice"); I chose to **match the working sibling precedent** (omit) over adding for
symmetry. A bot-review finder briefly mis-read this as "Kaohsiung in COUNTRY_GROUP_MAP" (it's in
`STATE_GROUP_MAP`) — verified by line number and declined.

> **Prompt note:** when a handoff prescribes an edit to a map/structure whose **sibling precedent omits it and
> still works**, match the precedent (omit) rather than adding for symmetry — and say so in the PR. Verify any
> reviewer "it's in map X" claim against the actual map boundaries (the two Taiwan group-maps are adjacent).

---

## Implementation / process learnings (loop context)

1. **🔴 The four-round bot-review cadence is now the norm — budget for it.** own `/code-review` (high) →
   Codex `/codex:adversarial-review` → Gemini inline nits → SonarCloud new-code issues. Each round produced a
   real, pushed commit; only the Codex round found a behavioral bug (A), the rest were quality. Every inline
   thread got a one-line reply + resolve; the SonarCloud/Codacy summaries (no `comment_id`) got a documenting
   PR comment. The headline cost was the self-inflicted churn in (B) — the Gemini→Sonar interaction — which a
   first-commit durable form would have avoided.
2. **🔴 Seed from up-to-date `main`, never the stale worktree.** Five PRs (#2198/#2200/#2201/#2202 + this one)
   merged to `main` after the worktree's branch point, so the worktree's `sources.ts` was stale — and
   `prisma db seed` does a **full overwrite** of every source's `config`. Seeding from the worktree would have
   reverted those PRs' source config (the `feedback_concurrent_seed_reverts_source_config` hazard). Correct
   path: stash the user's doc-WIP on `docs/taipei-h3-ship`, `git checkout main` + `pull --ff-only`, seed,
   restore WIP. Verified the gap first (`git rev-list --count main...origin/main` = 20 behind, 5 merges).
3. **🔴 `scrapeSource()` from a standalone script does NOT bust the page's ISR cache.** Same
   `after()` / `revalidateTag … no request scope` no-ops as every prior retro — non-fatal, the events persist.
   Verified via a prod **DB query** (authoritative), not the live page. (For a brand-new slug the page renders
   fresh on first request anyway — confirmed HTTP 200 with both runs + logo.)
4. **🟢 `Event.hares` (the misman relation) is empty for scraped events — `haresText` is the display field.**
   Briefly alarming that `event.hares` came back `[]`; it's the `EventHare[]` structured relation (populated by
   misman attendance, not scraping). The scraped hares land on `Event.haresText` ("Dobby's Cock Sock and LOL"),
   which is what the card shows. Don't mistake an empty `hares` relation for dropped hares — check `haresText`.
5. **🟢 Live-verify proved END-TO-END before CI** — `adapter.fetch(source)` returned both events with correct
   dates/times/cost/location/validated-maps-URL/hares and 0 errors before tsc/lint/test and before any DB write.

---

## TL;DR for the research prompt + platform notes

1. **Per-run fail-loud for multi-run pages.** `events.length === 0` is the floor; every detected-but-unparseable
   `#NNNN` block must emit a `ParseError` so *partial* drift suppresses reconcile (Codex catch; → memory +
   platform note). The single-block guard from Manila/Boise/Vindobona under-specifies multi-run pages.
2. **Month parsing: word-token regex + exact `Map.get()`, never a month alternation or a prefix slice.** Dodges
   S5843 (alternation complexity), S5852, the `'Maybe'→'May'` false positive, and Codacy object-injection — in
   one form, from the first commit.
3. **Seed from up-to-date `main`, not the stale worktree** — `db seed` full-overwrites `Source.config`; a stale
   tree reverts other merged PRs. Stash user WIP → `checkout main` → `pull --ff-only` → seed → restore.
4. **Match a working sibling precedent over adding for symmetry** (the dead `COUNTRY_GROUP_MAP` metro key) —
   and verify reviewer "it's in map X" claims against the actual map boundaries.
5. **Parse the single richest surface; skip redundant ones** when a second surface adds no new runs (it only
   added the run-# drift here).
6. **Keep:** the cross-page-drift + "capture verbatim DOM at build" flags, kennelCode/alias collision discipline
   (KHHH/KH3 omitted), magic-byte logo confirmation, the split adapter-verify / post-merge-seed runbook, the
   prod-DB-query (not live-page) post-scrape verification, bare-label-title → synthesize, and *not* inventing
   `scheduleRules` from an image schedule.
