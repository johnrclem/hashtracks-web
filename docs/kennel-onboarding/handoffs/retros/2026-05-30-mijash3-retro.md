# Cowork Handoff Retro — Mijas H3 (Costa del Sol "Burro Hash") — 2026-05-30

Feedback from the Claude Code implementation session for the `2026-05-30-mijash3.md` handoff
(HashTracks' **first 🇪🇸 Spain kennel**). Goal: improve the **research prompt** so future
handoffs need fewer mid-implementation corrections.

**PRs produced:**
- Onboarding (kennel + Spain/Costa del Sol regions + adapter): https://github.com/johnrclem/hashtracks-web/pull/1832 (merged)
- Historical backfill tooling: https://github.com/johnrclem/hashtracks-web/pull/1837 (merged)

**Outcome:** Mijas H3 live at https://www.hashtracks.xyz/kennels/mijash3 — **389 canonical events
in prod** (run #849 / 9 Jan 2005 → #2034 / 30 Aug 2026), 15 upcoming. Cheerio hareline adapter +
a **one-shot backfill of ~353 historical runs** the handoff said didn't exist (see Gap A — the
single biggest finding this run). Opened Spain as a new country.

---

## The loop is working — previous retro fixes LANDED and paid off

Two recommendations from the ONH3 retro (`handoffs/retros/2026-05-29-onh3-retro.md`) were applied to this
handoff and **prevented the exact bugs they targeted**:

1. **New-country 5-edit checklist (ONH3 retro rec B).** The handoff enumerated all five
   `src/lib/region.ts` edits — `REGION_SEED_DATA`, `STATE_GROUP_MAP`, `COUNTRY_GROUP_MAP`,
   `COUNTRY_CODE_TO_NAME`, **and `COUNTRY_INFERENCE_RULES`** — with the exact tuples, mirroring the
   Belgium precedent. The `inferCountry()→"USA"` fallback bug that bit ONH3 in CI **did not recur**;
   `inferCountry("Mijas, Costa del Sol")` returned `"Spain"` first try. Keep this checklist.
2. **Shape-spec over full code sketch (ONH3 retro rec A).** The handoff gave a parsing *plan* +
   reference adapters (`barnes-hash.ts`, `london-hash.ts`) + an explicit "verify against current
   types before writing real code" note, instead of a 150-line sketch. Far fewer schema-drift
   corrections than ONH3. The `kennelTags` / `safeFetch` / `title`-synthesis conventions were
   stated as rules, not frozen in wrong code. Keep this.

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** with branch name, ordered steps, and "live-verify per
   `.claude/rules/live-verification.md`." Drove the session cleanly, same as prior runs.
2. **🔴 "DOM order is NOT chronological" warning** (the August block renders *before* May on the
   live page). This was the standout catch — the analogue of ONH3's "Hash Trash recap" warning.
   Without it the parser might have derived the year from the month `<h2>` or assumed sorted order.
   The handoff said it three times. **Flag this class of thing ("source order ≠ chronological")
   whenever sampled.**
3. **"config-only is earned" framing** — explicitly ruled out `GenericHtmlAdapter` (can't split one
   `" - "`-delimited line into 4 fields) and the existing `SquarespaceEventsAdapter` (this is a
   *content page*, not an Events collection). Correct, saved a wrong-turn.
4. **`aliases.ts` is `Record<string, string[]>`** shape warning + the **bare "MH3" collision**
   note (collides with Memphis/Munich/Montreal — use "MH3 Spain"). Both accurate and time-saving.
5. **Collision check** (`mijash3` clear) — verified accurate.
6. **Self-host logo flag** (tokenized Squarespace CDN URL rotates) — correct, matches convention.
7. **Coord-sanity call-out** ("hareline carries NO per-event coordinates → no coord-corruption
   trap") — correct and a good habit.
8. **`config.upcomingOnly: true`** flagged for the rolling current-year hareline — correct, and it
   later made the history-backfill reconcile-safe (past events never become cancellation candidates).
9. **Metadata accuracy** — founded 1989, Sunday weekly, seasonal-time-in-`scheduleNotes`, FB group,
   `contactEmail`, coords, hashCash-intentionally-omitted ("don't invent") — all verified correct.

---

## Handoff GAPS → research-prompt improvements (the actionable part)

### A. 🔴 "No historical backfill available" was WRONG — ~353 archived runs were missed (highest-value fix)

The handoff stated, with confidence: *"Historical backfill: none available from this source — the
hareline page shows the current year only … Lifetime history is not archived anywhere
machine-readable on mijash3.com."* **This was false.** The same Squarespace site has a **"Run
Reports & Gallery"** blog collection with **one post per run**, paginated per year (`/runreports-2019`,
`/run-reports-2020`, … `/run-reports-gallery-2025`), reaching back to **run #849 (2005)**. Each
post's title/slug encodes run# + date + theme, and the body carries `Hares:`/`Location:`. The user
had to ask for the backfill as a *follow-up*; it recovered **353 runs** (turning a 36-event kennel
into a 389-event one).

Two root causes, both fixable in the research prompt:

1. **The research only looked at the hareline + a prose "History" page.** It didn't enumerate the
   site's other collections. Squarespace/Wix/WordPress sites very often keep run history in a
   *separate* blog/news/gallery collection from the hareline.
2. **It under-used the fetch it had.** The handoff claimed *"plain fetch returns rendered text, not
   markup"* — **incorrect for Squarespace** (SSR returns full HTML), and it missed that Squarespace
   exposes a clean JSON view at **`?format=json-pretty`** (paginated `items[]` with `title`,
   `urlId`, `fullUrl`, and full `body`) — a handful of JSON fetches replaced hundreds of per-post
   scrapes.

> **Prompt change (do this first):** Before concluding "no history," the research MUST probe the
> site's navigation for an archive/blog collection (names seen: "Run Reports", "Hash Trash",
> "Trail News", "Gallery", "Receding Hareline", "History"). For any Squarespace site, fetch the
> collection landing URL with **`?format=json-pretty`** and report: does it paginate (`pagination.nextPage`),
> how deep does it go (oldest run#/date), and do post titles/bodies carry run#/date/hares/location?
> If yes → recommend the **past→one-shot-backfill / future→adapter** split (same as the ONH3 retro's
> Gap D). A "History" page that's narrative prose is NOT evidence that no machine-readable archive
> exists — keep looking for the per-run collection.

### B. Plain-fetch markup was available — don't speculate the DOM, capture it

The handoff flagged "⚠️ Claude Code must confirm the exact DOM wrapper … I could not read raw DOM
(Chrome auto-denies a brand-new domain)." But a plain `curl`/fetch of the Squarespace page returns
the **full server-rendered markup** (I captured it in planning: `<li><p><span style="color:…">2020
- 31 May 2026</span> - Shaggy & AguaSex - AGM Run</p></li>`). The handoff's speculative fixture
guidance ("likely `.sqs-html-content` / `<ul><li>` or `<p>`") was unnecessary.

> **Prompt change:** When the Chrome MCP auto-denies a new domain, fall back to a **plain HTTP
> fetch** (the research run can do this) and build the test-fixture guidance from the *real*
> captured markup, not a guess. State the actual wrapper + a 2-3 line verbatim sample. (Extends
> ONH3 retro Gap C — "sample more.")

### C. Sonar regex-complexity (S5843) wasn't pre-empted — only S5852/S3776 were

The handoff pre-flagged S5852 (ReDoS) and S3776 (cognitive complexity), which helped. But my
`DATE_RE` used a 12-way month-name alternation (`jan(?:uary)?|feb…|dec(?:ember)?`) and tripped
**S5843 "regex complexity 47 > 20"** in CI — a third round of fixes (PR #1837).

> **Prompt change:** Add **S5843** to the Sonar pre-empt note with the concrete remedy: *don't
> enumerate all 12 months in a regex alternation — match the month as a loose word
> (`[a-z]{3,9}`) and let `chronoParseDate` validate it.* Also note `Number.parseInt` over
> `parseInt`, `replaceAll` over `replace(/…/g)`, `RegExp.exec` over `String.match`, and avoid
> negated-condition ternaries (`x !== undefined ? a : b` → `x === undefined ? b : a`) — these were
> the bulk of a 10-smell cleanup round.

### D. Seed `Source` block omitted `scrapeDays`

The handoff's ready-to-paste source block had `trustLevel`, `scrapeFreq`, `config`, `kennelCodes`
but no `scrapeDays` — every existing source row has it (I added `scrapeDays: 365`, mirroring
HashNYC's rolling-hareline precedent).

> **Prompt change:** Include `scrapeDays` in the source seed block (365 for a rolling current-year
> hareline; wider for full-archive single feeds).

### E. Backfill field conventions worth pre-stating (minor)

Two repo conventions surfaced as CI-review nits on the backfill and would be cheap to bake into any
"history backfill" guidance:
- **`location` is tri-state** — `cleanLocationName()` returns `null` to *explicitly clear*; never
  collapse it to `undefined` via `?? undefined` (that silently preserves a stale value). Preserve
  `null`. (Already a memory: `reference_clean_location_name_helper`.)
- **Fail loud on incomplete pagination** — a paginated archive crawl must `throw` on a truncated
  response, never silently return a partial set. (Squarespace signals end-of-pages by *omitting*
  `nextPage` entirely, NOT by `nextPage: false` — a `=== false` check false-throws on the terminal
  page; the correct guard is `!next?.nextPage`.)

---

## Implementation / process learnings (context for the loop, NOT research-prompt changes)

These are about the *implementation + merge* mechanics, not what the research prompt controls — but
they cost real time this session and the loop should account for them:

1. **A squash-merge silently dropped the 2nd commit.** The onboarding (adapter+seed) and the
   backfill script were two commits on one PR branch. PR #1832 was squash-merged at the *first*
   commit's state, so the backfill script **never reached `main`** — it needed a follow-up PR
   (#1837). The squash commit kept the *first* commit's message (the tell). **Loop implication:**
   when a handoff's work naturally splits (onboarding + historical backfill), expect two PRs, and
   always `git log origin/main -- <file>` to confirm each file actually landed after merge. (Saved
   as memory `feedback_verify_commits_landed_after_squash`.)
2. **Concurrent sessions on the shared `main` checkout caused a branch-switch race** — a parallel
   Claude session ran `git checkout` mid-edit, so my commit landed on the wrong (local-only) branch
   and had to be cherry-picked back. **Loop implication:** onboarding implementation should run in
   an isolated worktree/clone (the README's parked launchd path already uses
   `~/.hashtracks-onboard-bot` for exactly this) if multiple sessions can touch the repo at once.
3. **AI-reviewer suggestions need live verification.** CodeRabbit's pagination fix
   (`nextPage === false` for clean end) was *wrong* for the real API and would have false-thrown on
   every year's last page — caught only by re-checking the live Squarespace response. Don't apply
   bot suggestions blindly.
4. **CI bot gauntlet remains heavy** (3 rounds): SonarCloud (4 ReDoS hotspots on regex literals,
   then 10 new-code smells), CodeRabbit (pagination), gemini (location tri-state, `process.exit`).
   All non-blocking (advisory), but each needs a reply + thread-resolve.
5. **Post-merge runbook** (manual, prod): `npx prisma db seed` (additive) → trigger a scrape from
   `/admin/sources` (or `scrapeSource()` via tsx) → run the one-shot backfill
   (`BACKFILL_APPLY=1 npx tsx scripts/backfill-mijash3-history.ts`) → spot-check the kennel page.
   The backfill is a *separate* post-merge step and needs the seeded source to exist first.

---

## TL;DR for the research prompt

1. **🔴 Never conclude "no historical backfill" from the hareline + a prose History page.** Probe
   for a per-run blog/archive collection ("Run Reports", "Gallery", "Trail News") and, for
   Squarespace, fetch it with **`?format=json-pretty`** to confirm pagination depth + per-post
   run#/date/hares/location. This was the difference between 36 and 389 events.
2. **Plain HTTP fetch returns full SSR markup** (incl. Squarespace) — when Chrome auto-denies a new
   domain, curl it and build fixture guidance from the *real* DOM, don't speculate.
3. **Add Sonar S5843** to the pre-empt list (no 12-way month alternation — loose word + chrono
   validation), plus `Number.parseInt` / `replaceAll` / `RegExp.exec` / no negated-ternary nits.
4. **Include `scrapeDays`** in the seed source block.
5. **Pre-state backfill conventions** (`location` tri-state = preserve `null`; fail-loud pagination;
   Squarespace ends pages by omitting `nextPage`, not `nextPage:false`).
6. **Keep** the new-country 5-edit checklist and the shape-spec-over-code-sketch approach — both
   landed from the ONH3 retro and worked. Keep flagging "source order ≠ chronological" when seen.
