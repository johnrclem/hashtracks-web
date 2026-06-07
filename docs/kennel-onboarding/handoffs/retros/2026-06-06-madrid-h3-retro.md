# Cowork Handoff Retro — Madrid H3 (🇪🇸 HashTracks' 2nd Spain kennel, est. 1984) — 2026-06-06

Feedback from the Claude Code implementation session for the `2026-06-06-madrid-h3.md` handoff — a new
`MadridHashAdapter` on a **self-hosted WordPress site** (`madridhhh.com`) whose run posts carry every
datum cleanly labeled in the body (`Run No.` / `Date` / `Time` / `Fee` / `Location` / `GPS` / `Hares`),
modeled on `ewh3.ts`. The handoff was excellent and every verbatim live oracle held; the one genuinely
new wrinkle was that an **11-year hand-typed archive** needs the post's **publish date** as a corrective
anchor for the body `Date:` line — which only surfaced once the backfill actually walked all 453 posts.

**PR produced:**
- Onboarding (new adapter + 25 tests + kennel/alias/source seed + Madrid METRO region + frozen 441-run
  backfill): [PR #2029](https://github.com/johnrclem/hashtracks-web/pull/2029) (merged). Three commits
  on-branch: onboard → review fixes (Sonar S5852 / href-from-anchor / per-event try-catch) → S4325
  typed-factory cleanup.

**Outcome:** Live at `https://hashtracks.xyz/kennels/madrid-h3` (title renders, founded 1984, upcoming
Trail #2713). Post-merge ran clean from the **MAIN repo** on `main`: seed (additive — kennel/alias/source
+ Madrid METRO region + scheduleRules), backfill **created=441 / blocked=0 / eventErrors=0**, then a
forced `scrapeSource(id, {force:true})` **created=1** (the upcoming #2713) / **updated=29** (recent runs
re-confirmed against the backfill) / 0 unmatched / 0 errors. Final state: **442 canonical events**,
#2106 (2015-06-21) → #2713 (2026-06-07), `lastEventDate` 2026-06-07. The upcoming-run oracle held
byte-for-byte: #2713 "Habemus Papadam", Sun 2026-06-07, 13:00, GPS `40.454352,-3.629372`, hares
"Bush Warmer, Sir Scrambled Dag".

---

## The loop is working — previous retro fixes LANDED

1. **`upcomingOnly` on a forward-windowed adapter + deep frozen backfill (ONH3 / Brasília / Asunción / H7
   / bmh3 / vindobona).** The forward adapter pulls only the latest ~30 posts; the 441-run archive is
   owned by `scripts/backfill-madrid-h3-history.ts` (frozen JSON + dumb loader delegating to
   `runBackfillScript`). `config.upcomingOnly:true` keeps `reconcile.ts` from false-cancelling the aged
   archive. Specified in the handoff, landed, verified (backfill `blocked=0`).
2. **Alias-collision discipline (Asunción / Brasília / bmh3 / vindobona).** Bare `"MH3"` correctly
   **omitted** — it's globally owned by Memphis / Munich / Montreal / Miami / Minneapolis. kennelCode
   `madrid-h3`; the four aliases are all multi-word ("Madrid H3" / "Madrid Hash" / "Madrid HHH" /
   "Madrid Hash House Harriers").
3. **`title` left undefined; merge synthesizes.** The post titles are stylized themes (`The "Habemus
   Papadam" R*n`); the adapter carries the bare theme in `description` and never promotes it to `title`,
   so merge synthesizes `"Madrid H3 Trail #N"`. Confirmed in prod (#2713 title = "Madrid H3 Trail #2713").
4. **Self-host the logo + confirm via magic bytes (self-host-unstable-logos).** Downloaded the candidate
   PNG, confirmed `\x89PNG` (1000×1000), referenced `/kennel-logos/madrid-h3.png`. The handoff's "verify
   bytes, the candidate is `.bmp` OR `.png`" instinct was right — the `.png` candidate was the real one.
5. **Sort multi-value fields before join (fingerprint-stability).** Hares split on `&`/`,` then
   `localeCompare`-sorted before re-join, so API row order can't churn fingerprints.

---

## What the handoff got RIGHT (keep doing)

1. **The labeled-body parse map was exact.** "Require a `Run No.` marker (run/non-run filter); read
   `Date:` / `Time:` / `Location:` / `GPS:` / `Hares:` line values." The adapter shape was right first
   pass — structurally `ewh3.ts` minus the title parsing, plus a decimal-GPS bracket parse.
2. **Decimal coords, no default-pin trap — called in research.** "Every run carries a real decimal GPS
   pair; all distinct." Held: 28/28 distinct on the forward window, 418/441 on the archive (the rest are
   DMS-only or maps-only lines → geocode from text, which is correct). No `dropCachedCoords` needed.
3. **"Trust the in-body `Date:` line, NOT `post.date`" was the right DEFAULT.** Posts publish ~2–5 days
   before the run, so `post.date` alone would mis-date every event. The handoff's rule is correct for the
   forward window (28/28 clean) — it just needed a corrective layer for the messy tail of the archive
   (gap A below).
4. **Sibling sweep done in research.** `madridhhh.com` hosts only Madrid HHH — single-kennel source,
   no Full Moon / sibling surfaced. Stated up front; no `kennelPatterns` needed.
5. **The 2-edit region.ts checklist was spelled out** (Madrid METRO + one `STATE_GROUP_MAP` line; Spain
   COUNTRY + the `madrid` inference regex + `COUNTRY_GROUP_MAP` + `COUNTRY_CODE_TO_NAME` all already
   existed). Zero region guesswork — the Costa-del-Sol/Mijas precedent made it a level-less METRO.
6. **Field-fill assertion table + the "synthesize vs theme title" decision** were both pre-made, so the
   `title: undefined` + theme-in-description choice was a one-line confirmation, not a design debate.

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 A deep hand-typed archive needs the PUBLISH DATE as a corrective anchor for the body date

The handoff's "trust the in-body `Date:` line" is right for the forward window, but walking all 453
archive posts surfaced **9 of 442** run dates that the body line gets wrong — and they only show up once
you backfill the tail:
- **year-less lines** ("Sunday 17th December" — no year → chrono picks the wrong year),
- **a month typo** ("Sunday 30th Januray 2022" → chrono returns garbage),
- **copy-pasted stale dates** (a 2022 "Pool Party" post stamped "14th July 2019" — both day *and* year
  carried over from an old post; and ~6 pure year-typos like "2024" for a 2025 run).

The fix (`resolveRunDate`): parse the line **anchored to the publish date** (chrono `referenceDate`) —
this alone recovers the year-less and typo lines — then, only when the parsed date lands **>45 days
BEFORE publication**, re-anchor to the line's named weekday on/after the publish date. The
**directional** guard (past-stale only) is the load-bearing part: it came out of Gemini + claude-review,
who flagged that an absolute `|gap|>45d` would corrupt a *legitimately far-future* announcement. Measured
against the live archive: clean-row publish→run gap is −2…+7d, and **0 posts** are far-FUTURE while 7 are
far-PAST — so the directional threshold fixes every real error and can't fire on a healthy row.

> **Prompt / platform change:** for any deep blog/WordPress archive backfill, state that hand-typed body
> dates drift (year-less, month typos, copy-pasted day/year) and the post's **publish date** is the
> corrective anchor: parse with `chronoParseDate(line, locale, publishDate)`, and re-anchor to the named
> weekday-on/after-publish **only when the parsed date is >N days BEFORE publication** (never after —
> that's a real advance announcement). This generalizes the existing
> `yearless-date-infer-closest-to-publish` memory to also cover explicit-but-wrong years. The forward
> adapter should thread `post.date` through too, so a future typo self-corrects.

### B. 🟡 Estimate archive depth from the REST post COUNT, not the month-archive widget

The handoff estimated **~550–600 runs back to Oct 2014** (from the sidebar month-count widget). The
WordPress REST `/wp/v2/posts` actually exposes **453 posts total → 441 past runs back to 2015-06-21**
(run #2106). No truncation — `fetchAllWordPressPosts` terminated cleanly on the short final page; the
pre-2015 posts simply aren't in the `post` feed. The widget over-counts (non-run posts, deleted/migrated
content).

> **Prompt change:** size a WordPress archive from the real REST count (`?per_page=1` and read the
> `X-WP-Total` header, or paginate once), not the month-archive widget — the widget is an upper bound that
> can over-state depth by 25%+.

### C. 🟡 "`<12h> – <24h>h` time line" — prefer the h-suffixed 24h value, fall back to first

Madrid Time lines are `1pm – 13:00h`, but the archive has `7:30pm – 19:30h` (a *colon'd* 12-hour prefix —
a naive "first HH:MM" grabs `07:30`) and `9pm – 21:00 but PLEASE be there for 20:45…` (explanatory text
with a second, *earlier* time — a naive "last HH:MM" grabs the 20:45 arrival time). The robust rule:
prefer the HH:MM immediately followed by `h` (the 24-hour marker), fall back to the first HH:MM when no
`h`-suffixed time exists. Got both `#2385`→19:30 and `#2271`→21:00 right.

> **Platform note:** for "`<12-hour> – <24-hour>h`" time lines, anchor on the `h` suffix, not position.

### D. 🟡 Read the Maps URL from the anchor `href`, but with a STARTS-WITH selector + trailing-punct strip

Gemini + claude-review both flagged that regex-matching the flattened `$.text()` for the Maps link is
fragile (and the greedy `\S+` swallowed a trailing `)` from the prose). Reading the anchor `href` before
`$.text()` is more reliable and recovered 4 missed URLs (coverage 427→431/441). Two real edges surfaced:
- a `contains` selector (`a[href*='goo.gl/maps']`) matched a **Facebook `l.php?u=…goo.gl/maps…` tracking
  shim** on one post (the goo.gl URL is in a query param) — fixed with a **starts-with** selector
  (`a[href^='https://goo.gl/maps']`), which falls back to the clean body URL for the shimmed post;
- one post's `href` literally ends in `)` (a source typo) → a final `replace(/[).,;]+$/,"")` strip.

> **Platform note:** prefer the anchor `href` over the flattened text for links, but match it with a
> **starts-with** attribute selector (a `contains` selector matches FB/redirect shims that embed the
> target URL) and strip trailing punctuation a short link never ends in.

---

## Implementation / process learnings (loop context)

1. **🟢 No worktree-cwd trap this time — but the worktree has NO `.env`, so post-merge ran from MAIN.**
   The worktree (`.claude/worktrees/…`) has no `.env`; Prisma + the backfill + `scrapeSource` need the
   prod `DATABASE_URL`, so every post-merge step ran from `/hashtracks-web` on `main` (node_modules +
   generated client + prod `.env` → Railway). `npx prisma generate` once per checkout (gitignored
   `@/generated/prisma`). Throwaway tsx scripts must live **inside** the repo (the `@/` path alias
   doesn't resolve from `/tmp`). Node 25 again (no `fnm` on PATH; 25 satisfies Prisma 7's "20+").
2. **🔴 The prod domain is `hashtracks.xyz`, NOT `hashtracks.com`.** `hashtracks.com` is a **parked
   for-sale domain** (HugeDomains) — curling it returns a 200 "for sale" page, and `CLAUDE.md` /
   `NEXT_PUBLIC_APP_URL` (localhost) both point the wrong way. The canonical host is in the code
   (`metadataBase` → `hashtracks.xyz`). Spot-check kennel pages against `hashtracks.xyz`.
3. **SonarCloud gate: 2 S5852 hotspots marked SAFE, 3 S4325 fixed at source.** The theme-quote regex
   (`["“]([^"”]+)["”]`) and the Maps-URL fallback are **linear** (single negated-class repetition, no
   nested quantifiers / overlapping alternation) — genuine S5852 false positives. The
   `new_security_hotspots_reviewed` condition failed at 0% until they were reviewed; the
   **`sonarqube` MCP under-reports PR hotspots (returns 0)**, so I located them via the
   `api/hotspots/search` REST endpoint (token in the main `.env`) and marked both **SAFE** with
   justifications — the documented `sonarcloud-hotspot-gate-zero-quirk` workflow. The 3 S4325
   "unnecessary `as never`" smells on the `adapter.fetch` test calls were cleared with a one-cast typed
   `madridSource()` helper (per `typed-factory-over-as-never-per-callsite`), not NOSONAR.
4. **`/code-review high` + `/simplify` earned their keep pre-push.** `/simplify` swapped a hand-rolled
   weekday array for the shared `WEEKDAY_NAMES` map; the adversarial pass found the time mis-parse, the
   directional-re-anchor corruption risk (gap A), and the `NaN` run-number path (now guarded by requiring
   a leading digit in the `Run No.` capture) — all before the external bots, which then had only the
   Sonar hotspot left.
5. **Distinguished review premise from worth (vindobona's lesson re-applied).** The `7:30pm` time bug and
   the FB-shim href edge were both *real* (verified against live archive rows), so they were fixed and
   tested; the directional re-anchor was kept minimal (past-only) rather than over-built into per-kennel
   special-event config. Reply-and-resolve only the four inline threads actually acted on.
6. **`scrapeSource` post-write `after()` IndexNow + `revalidateTag` throw "outside request scope"** when
   run via one-shot tsx — **expected and harmless** (they fire after the DB writes; events are fully
   persisted). The kennel page already rendered the new data on `hashtracks.xyz`; the hareline cache
   refreshes on its ISR cycle.

---

## TL;DR for the research prompt + platform notes

1. **Deep blog/WordPress archives have hand-typed date drift** (year-less / month-typo / copy-pasted
   day+year). Anchor the body-date parse to the post's **publish date**, and re-anchor to the named
   weekday-on/after-publish **only for >N-days-BEFORE-publish (past-stale)** dates — never far-future.
   Thread `post.date` into the forward adapter too. (Generalizes `yearless-date-infer-closest-to-publish`.)
2. **Size a WordPress archive from the REST post count** (`X-WP-Total` / one paginate), not the
   month-archive widget (which over-counts).
3. **`<12h> – <24h>h` time lines: anchor on the `h` suffix**, not position.
4. **Read links from the anchor `href` with a STARTS-WITH selector** (a `contains` selector matches FB
   `l.php?u=…` redirect shims) and strip trailing punctuation.
5. **Prod domain is `hashtracks.xyz`** (`hashtracks.com` is parked-for-sale) — fix the stale `CLAUDE.md`
   example when convenient.
6. **SonarCloud PR hotspots: the MCP returns 0; use the `api/hotspots/search` REST endpoint** (token in
   `.env`) to see and mark linear-regex false positives SAFE; clear `as never` S4325 smells with a typed
   factory.
7. **Keep:** the labeled-body parse map, the decimal-coords / no-default-pin call, the
   trust-in-body-date default, the single-kennel sibling sweep, the 2-edit Spain-metro region checklist,
   and the synthesize-vs-theme title decision — all landed first-try.
