# Cowork Handoff Retro — Hanoi H3 (Hanoi, Vietnam) — 2026-06-21

Feedback from the Claude Code implementation session for the `2026-06-21-hanoi-h3.md` handoff —
the **Traditional Hanoi Hash House Harriers** (est. 1991), Vietnam's **second metro** and the sibling of
Saigon H3 ([#2269](https://github.com/johnrclem/hashtracks-web/pull/2269)). A small static **WordPress.com
single-current-run home-PAGE** scraper plus a seasonal-cadence kennel. Goal: fold the genuine learnings
back into the **research prompt** + **platform notes**.

The headline this run: the handoff was again unusually complete, and the **Saigon-coordination call paid off
exactly as designed** — because Saigon shipped the Vietnam COUNTRY first, the region work collapsed from
"5 edits" to **2** (the Hanoi METRO + its `STATE_GROUP_MAP` row; the COUNTRY record, both group maps, the
`VN` code, the inference regex *and* the Hanoi inference tests were all already on `main`). The three
genuinely-new items were all build-time discoveries the sandbox couldn't surface: (1) a stray **`No. 1763`
past-run gallery caption** in a second column would shadow the run heading on a whole-page scan → scope to
the run's own `wp-block-column`; (2) the bare first-pickup maps shortlink had the **next run's `No.`
template glued onto it** (`…Tik7No.`) with no separator → a precise artifact strip; and (3) **SonarCloud
caught two regex findings post-merge** that local `tsc`/`lint`/CI-test all passed.

**PR produced:**
- Onboarding (kennel + alias + source + NEW `HanoiH3Adapter` + Hanoi METRO region + self-hosted logo +
  9 tests), with a follow-up commit resolving the SonarCloud regex findings:
  [PR #2272](https://github.com/johnrclem/hashtracks-web/pull/2272) (merged).

**Outcome:** Live at https://www.hashtracks.xyz/kennels/hanoi-h3 — **1 canonical CONFIRMED event**,
**run #1820, Sat 2026-06-20**, title synthesized **"Hanoi H3 Trail #1820"** (run-type `(A-B Run)` dropped),
hares "Faster Than Diarrhea and Finger In Van Dyke", location "Soc Son outside of Hanoi city" + pickup
street, trail "Walking ~6km+ / Running ~8km+", trust 6. Two active HIGH `SEED_DATA` seasonal `ScheduleRule`s
(Summer `BYMONTH=4..10` 14:00 / Winter `BYMONTH=11,12,1,2,3` 13:30) — the disjoint-`BYMONTH` design held (no
`(kennelId, rrule, source)` collision). Post-merge from **synced `main`** on prod `.env`: `db seed`
(schedule-rule backfill Created 5 / Updated 421) → `POST /api/cron/scrape/<id>` with the `CRON_SECRET`
(found 1 / created 1 / 0 errors) → spot-checked the live page + queried prod for the canonical Event.

---

## The loop held — handoff + prior-retro patterns that LANDED

1. **Shared-COUNTRY coordination paid off — 2 `region.ts` edits, NOT 5.** The handoff's "whichever Vietnam
   kennel merges first adds the COUNTRY; the second adds only its METRO" call was exactly right. Verified on
   `main` that the Vietnam COUNTRY (cyan), `STATE_GROUP_MAP`/`COUNTRY_GROUP_MAP`/`COUNTRY_CODE_TO_NAME`, the
   inference regex (already incl. `hanoi`), **and even the Hanoi inference tests** all shipped via Saigon
   #2269. Added only the Hanoi METRO (cyan `-100`, pin `#06b6d4` distinct from HCMC's `#0891b2`) + the one
   `STATE_GROUP_MAP` row. No COUNTRY re-add, no duplicate inference rule.
2. **`config.upcomingOnly: true` + mandatory fail-loud guard** — both pre-stated and implemented (no-heading
   and date-parse-fail push to `errors[]`; the single-surface 0-baseline can't fire the zero-event health
   alert). Manila/Warsaw/Saigon pattern.
3. **`title` undefined → merge synthesizes "Hanoi H3 Trail #N"** — verified live (#1820 → "Hanoi H3 Trail
   #1820"); `friendlyKennelName("Hanoi H3", …)` → `"Hanoi H3"` (the >4-char short-circuit, as predicted).
   The run-type blocklist (`a-b run`/`city run`/`bus run`) dropped `(A-B Run)`.
4. **Year-bearing irregular date → NO inference** — `"saturday, June,20th,2026"` normalized (ordinal strip,
   commas→spaces, collapse) → `chronoParseDate` → `2026-06-20`. Year present, no rollover.
5. **Self-host the logo + magic-byte the extension** — declared `.png`, confirmed `\x89PNG` (403×150 RGB).
6. **Capture-the-real-DOM at build** — `curl`'d the verbatim home page; built the fixture from the real
   `wp-block-column` markup (and a second `#1819` fixture for comma/format variance), content-keyed (not
   class-keyed) since WP.com rotates classes.
7. **Alias collision discipline** — bare `"HH3"`/`"HHH"` correctly OMITTED; flagged that `"Hanoi Hash House
   Harriers"` may need disambiguation if the separate `hanoihash.com` original kennel is onboarded later.

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch → seed → adapter → live-verify → tsc/lint/test → PR →
   ordered post-merge runbook — drove the session and the post-merge (seed → scrape → spot-check) verbatim.
2. **The field-fill table + verbatim sample** — `📌 Location` / `📍 First pick up` / `🐇 Hares` labeled
   lines, the run-type-vs-theme split, the "no decimal coords → no default-pin trap" call, and the
   seasonal-time-only schedule all matched the live `fetch()`.
3. **DNS pre-check + 447-slug sitemap dedup** — `hanoih3.com` → Automattic `192.0.78.24/25`; no
   `hanoi`/`vietnam`/`saigon`/`hcmc`. First-of-metro confirmed.
4. **The seasonal-`scheduleRules` steer with the disjoint-`BYMONTH` warning** — the handoff explicitly said
   the day is constant (Saturday) and only the time shifts, so the two rules must keep disjoint `BYMONTH` to
   stay distinct on the upsert key. That's the crux of this onboard and it was pre-flagged (see Gap C).

---

## GAPS / corrections → research-prompt / platform-note improvements

### A. 🔴 A past-run **photo-gallery caption** (`No. 1763`) shadows the run heading on a whole-page scan — single-current-run pages with a slideshow need container-scoped parsing

The handoff said *"locate the 'Upcoming runs' section, then the current-run heading"* — correct, but it
didn't flag *why* a whole-page text scan is unsafe: the home page's **second column** is a Jetpack
slideshow whose `figcaption` reads **`No. 1763 Cold bia hoi run`** (a *past* run's photo). A naive
`lines.find(/^No\.?\s*\d+/)` over the full page would match **whichever `No.NNNN` comes first in document
order** — fragile (works today only because the text column precedes the slideshow). Fix: scope to the
`wp-block-column` that contains the "Upcoming runs" `<h2>` via cheerio `.closest(".wp-block-column")`, then
`stripHtmlTags` *that* column. The gallery caption lives in a different column and drops out.

> **🟡 Platform-note add (done):** for a single-current-run page that **also** has a photo gallery / archive
> of past runs, scope parsing to the run block's own container (the column/section holding the heading), not
> a whole-page text scan — past-run captions reuse the `No.NNNN` shape and will shadow the live heading.

### B. 🔴 The bare first-pickup maps shortlink had the **next run's `No.` template glued onto it** (`…Tik7No.`) — source-data artifact with no separator

The committee's first-pickup link is **bare text** (not an `<a href>`), and this week it read
`https://maps.app.goo.gl/FTavtwpc4hAoQTik7No.` — the next run's heading prefix (`No.`) typed directly onto
the shortcode with no whitespace. A plain `…/[A-Za-z0-9]+` capture greedily swallows the `No` (both
alphanumeric), yielding a **broken** shortlink. goo.gl shortcodes never contain a period, so the
discriminator is clean: a captured shortcode that ends in `No` **and is immediately followed by `.` in the
source** is the artifact → strip the trailing `No`. (The *second*-pickup link, followed by `<`, is clean —
so this is specifically the "heading template leaked onto the last line of the block" case.)

> **🟡 Platform-note add (done):** hand-maintained blocks often **glue the next entry's prefix onto a bare
> trailing URL** with no separator. Don't trust a greedy `[A-Za-z0-9]+` shortcode capture on a bare-text
> URL that sits at the end of a block; check the character immediately after the match and strip a known
> trailing template token (here `No` before a `.`). Prefer an `<a href>` when one exists.

### C. 🟡 Same-weekday seasonal `scheduleRules` need **disjoint `BYMONTH` + `validFrom`/`validUntil` + `displayOrder`** — used the richer precedent over the handoff's `BYMONTH`-only sketch

The handoff sketched two `BYMONTH`-only rules. The day is constant (Saturday) and only the bus time shifts
(14:00 summer / 13:30 winter), so two `FREQ=WEEKLY;BYDAY=SA` rules would **collide on the
`(kennelId, rrule, source)` unique key** — disjoint `BYMONTH` is what makes the rrule strings distinct.
Verified `parseRRule` accepts `BYMONTH` (the Pass-3 backfill validates every seed rule via `parseRRule`, so
an unparseable one silently vanishes) and mirrored the proven same-weekday precedent at `kennels.ts:5305`
(disjoint `BYMONTH` **plus** `validFrom`/`validUntil` MM-DD season gating **plus** `displayOrder`) rather
than the thinner `BYMONTH`-only version. Both rules landed HIGH/active in prod, no collision.

> **🟢 Prompt reinforcement:** for a same-weekday seasonal split, mirror the `kennels.ts:5305` shape
> (disjoint `BYMONTH` + `validFrom`/`validUntil` + `displayOrder`), not `BYMONTH`-only — the `BYMONTH`
> disjointness is *mandatory* (collision avoidance) and the season anchors drive both projection gating and
> the kennel-page display. Already a memory note; this is a second confirming case.

### D. 🔴 SonarCloud caught **two regex findings the local gate missed** — `tsc`/`lint`/CI-`test` all passed green

The local checks (`tsc --noEmit`, `npm run lint`, full vitest) and the GitHub `test`/`claude-review`/Codacy/
CodeRabbit checks were **all green**, but the SonarCloud quality gate failed on `new_security_rating: 4`:
- **S5852 (CRITICAL, ReDoS)** on `DATE_PREFIX_RE` (`/^\s*(?:on\b\s*)?(?:(?:sun|…|sat)[a-z]*\b)?\s*/i`) —
  nested optional `\s*` adjacent to an alternation → super-linear backtracking risk.
- **S5869 (MAJOR)** on `MAPS_URL_RE` — `[A-Za-z0-9]` under the `/i` flag duplicates `A-Z`.

Fix (follow-up commit): **deleted `DATE_PREFIX_RE` entirely** — `chronoParseDate` already ignores a leading
`on`/weekday and locks onto the explicit `Month D YYYY` (tested it wins even when the source weekday
disagrees with the date), so the fragile prefix-strip was never needed; and **dropped the `/i` flag** from
`MAPS_URL_RE` (scheme + host are always lowercase). Re-verified live (run #1820, URL still cleaned). Both
match standing memory notes (`feedback_sonar_s5869_case_insensitive_charclass`; "prefer string ops when a
regex would put `\s*` next to an alternation").

> **🔴 Prompt reinforcement:** local `lint`/`tsc`/CI-`test` do NOT cover SonarCloud's regex rules — **expect
> a post-push SonarCloud pass on any new adapter regex** and pre-empt it: no `\s*` adjacent to an alternation
> (prefer string ops / let chrono absorb prefix words), and no `[A-Za-z…]` under `/i` (drop the flag or use
> `[A-Z…]`). The cheapest fix for a "strip leading filler words before chrono" step is usually to **not strip
> them** — chrono ignores them.

### E. 🟢 The per-event **trail blurb → `description`** heuristic (line after the heading with no `:`/URL) worked, but is content-fragile

Description was taken as the line immediately after the heading when it carries no `label:` and no URL — the
trail blurb. It's correct for the live data and degrades safely (a blurb with a colon just yields no
description). Minor; noting it as a known soft spot if a future block puts a colon in the prose.

---

## Implementation / process learnings (loop context)

1. **🟢 Worktree path discipline HELD this time** (contrast Saigon retro #1 / Phnom Penh retro #2, which both
   bit) — every Write/Edit for the adapter/test/registry used the **worktree-prefixed** absolute path from
   the start; nothing landed in the main checkout. Conversely, this docs-sync PR's edits correctly target the
   **main** checkout (where the daily-routine docs live). The right target still flips per task.
2. **🔴 `vitest.config.ts` excludes `**/.claude/worktrees/**`** → `vitest` finds **0 tests** from inside a
   worktree. Ran via a disposable in-worktree `vitest.local.config.ts` (committed config minus that exclude),
   **deleted before commit**. Standing worktree gotcha (Saigon retro #2 / Phnom Penh #4 / Himalayan #4).
3. **🟢 `prisma generate` first in a fresh worktree** — needed both for `tsc` and for the live-verify script
   (the `friendlyKennelName` import pulls `@/lib/db` → the gitignored client). (Saigon retro #3.)
4. **`npx tsx` live-verify needs an async wrapper** (top-level `await` → CJS error); Node here is **25 only**
   (no `fnm`), which satisfies "20+". The live-verify ran the real `adapter.fetch()` against the live URL +
   the parser against the captured HTML — confirmed run #1820 end-to-end before the PR.
5. **Merge was a true merge commit, not a squash** — so **both** commits (onboarding + the SonarCloud
   regex-fix follow-up) landed on `main`; verified each file/fix via `git cat-file`/grep on `origin/main`
   before seeding. (The squash-drop-a-follow-up-commit hazard didn't apply, but the check is cheap.)
6. **Post-merge `db seed` from a freshly-synced `main`, not the merged worktree** — pulled `main` first,
   confirmed **no seed-data drift** vs the worktree (no other seed PR merged in the gap), avoiding the stale
   `sources.ts` full-overwrite revert (Phnom Penh retro #3 / `feedback_concurrent_seed_reverts_source_config`).
7. **🔴 NEW — triggering the prod scrape needed *explicit* user authorization.** The post-merge "trigger a
   scrape" step (`POST /api/cron/scrape/<id>` with the `CRON_SECRET`) was **blocked by the auto-mode
   classifier** as an unauthorized production write — `"pr merged"` wasn't read as authorizing that specific
   shared-infra action. It only proceeded after the user said *"please trigger prod scrape now."* The seed
   (additive) went through, but the live cron `POST` is gated. **Expect to either ask for explicit go-ahead
   on the scrape step, or note that the daily dispatch cron will pick it up at 06:00 UTC.** (The actual prod
   domain is **`www.hashtracks.xyz`** — `hashtracks.xyz` 308-redirects to `www`, and `hashtracks.com` is a
   parked HugeDomains page; `NEXT_PUBLIC_APP_URL` in `.env` is the local dev value, not the prod host.)

---

## TL;DR for the research prompt + platform notes

1. **🟡 Single-current-run page + a photo gallery → container-scoped parsing.** A past-run `figcaption`
   reuses the `No.NNNN` shape and shadows the live heading on a whole-page scan. Scope to the run block's
   own `wp-block-column`/section (cheerio `.closest`), then `stripHtmlTags` that.
2. **🟡 Hand-maintained blocks glue the next entry's prefix onto a bare trailing URL** (`…shortcodeNo.`).
   Don't greedily capture a bare-text shortcode at a block's end; check the next char and strip a known
   trailing template token. Prefer `<a href>` when present.
3. **🟢 Same-weekday seasonal `scheduleRules` = disjoint `BYMONTH` + `validFrom`/`validUntil` + `displayOrder`**
   (mirror `kennels.ts:5305`), not `BYMONTH`-only — the `BYMONTH` disjointness is the collision fix.
4. **🔴 Expect a post-push SonarCloud regex pass on any new adapter** — local `lint`/`tsc`/CI-`test` don't
   cover S5852/S5869. No `\s*` next to an alternation (let chrono absorb leading filler words instead of
   stripping them); no `[A-Za-z…]` under `/i`.
5. **🔴 The prod-scrape post-merge step needs explicit user authorization** (auto-mode classifier gates the
   live cron `POST`); the prod host is `www.hashtracks.xyz`, not `NEXT_PUBLIC_APP_URL`.
6. **Keep:** shared-COUNTRY coordination (2-edits-not-5 when the sibling shipped the country), `▶ FOR CLAUDE
   CODE` + ordered post-merge runbook, `upcomingOnly` + per-run/zero fail-loud, `title`-undefined synthesis +
   `friendlyKennelName` >4-char short-circuit, year-bearing-date-no-inference, self-host-logo (magic bytes),
   check-EVERY-bare-initialism, capture-the-real-DOM (+ a 2nd fixture for format variance), worktree hygiene.
