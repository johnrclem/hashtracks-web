# Cowork Handoff Retro — North Shore Wanderers H3 (Sydney, est. 2004) — 2026-06-02

Feedback from the Claude Code implementation session for the `2026-06-02-nswhhh.md` handoff
(HashTracks' 5th live Sydney kennel, and the first **dual-source** onboarding where one source
exists purely to enrich another's coordinates). Goal: improve the **research prompt** + **platform
notes** so future handoffs need fewer mid-implementation corrections.

**PR produced:**
- Onboarding (kennel + aliases + 2 sources + NEW `NSWHHHAdapter` + logo + tests + backfill +
  `GoogleSheetsConfig.columns.location` optional + merge regression test):
  https://github.com/johnrclem/hashtracks-web/pull/1917 (merged)

**Outcome:** Live at https://www.hashtracks.xyz/kennels/north-shore-wanderers-h3 — **187 canonical
events in prod** (oldest #904 / 26 Sep 2022, 27 upcoming through #1092 / 21 Dec 2026, weekly Monday
6:30pm). The current run (#1065) carries its venue + map coords (Bay Road Reserve, Waverton) from
the website source. One PR, full scope: GOOGLE_SHEETS forward source + NEW website HTML adapter
(venue/coords enrichment) + a 160-run one-shot historical backfill.

---

## The loop is working — previous retro fixes LANDED, with one partial miss

1. **"Probe for history before declaring none" (Mijas retro Gap A).** Mijas taught: don't trust a
   research-time "no history" — probe the source's other collections. This **half-landed**: the
   handoff *did* assess the website's "Recent Runs/Walks" prose list (correctly judged too messy),
   **but never checked the other tabs of the embedded Google Sheet.** The sheet had a *second* gid
   (`360703890`) holding a clean **160-row archive back to Sep 2022** — found at implementation time,
   not by the handoff. → Generalize Mijas Gap A from Squarespace collections to **Google Sheet tabs**
   (see Gap A below).
2. **Self-host-logo with `<ext>` placeholder (ah3-nz retro Gap B).** The handoff used a literal
   `<ext>` placeholder and said "confirm via Content-Type/magic bytes" — no pre-filled guess. Correct
   (the asset was PNG). Keep. (New wrinkle: the URL 403s server-side — Gap E.)
3. **Capture-the-real-DOM mandate.** The handoff flagged that the sandbox couldn't read
   `nswhhh.info` and *mandated* a real `curl`/`fetchHTMLPage` capture for the fixture. Worked — a
   single `curl` confirmed the home page is fully SSR'd and revealed the labelled-line structure.
   Keep.
4. **Sonar pre-empts (S5852/S5843/S3776, `Number.parseInt`, no negated ternaries).** Pre-stated and
   mostly honored — but **two findings still slipped through** (an S5852 hotspot on a trailing-strip
   regex + an S3776 on the parser). The pre-empt list narrows the surface; it doesn't eliminate it.
   See process learnings 1–2.

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch name, ordered steps, live-verify mandate — drove
   the session end-to-end.
2. **The Source-decision tree** (*"try GOOGLE_SHEETS first; HEAD-check the CSV export; fall back to
   HTML_SCRAPER if it's not anonymously fetchable"*) was exactly the right shape. The CSV **was**
   public (`content-type: text/csv`), so the config-only path was available — the handoff couldn't
   verify it (sandbox blocks `docs.google.com`) but framed the decision so implementation resolved
   it in one `curl`.
3. **Flagging the sheet `columns` mapping as a PLACEHOLDER** needing real-header confirmation — right;
   the real header was `Date | Run # | Hare | Start` (Start empty), not what anyone could guess.
4. **Google Sites home pages are server-rendered** (no `browserRender` needed) — confirmed.
5. **`config.upcomingOnly: true` on both sources** — correct (forward sheet ages rows to the archive
   tab; website shows only the current run; both would be false-CANCELLED without it).
6. **kennelCode `nswhhh`** collision-clear, **region pre-checked** (`Sydney, NSW` METRO + `Australia`
   already seeded → no `region.ts` edits), **metadata** (founded 2004, Mon 6:30pm weekly, "$5, first
   run free", FB only) — all verified in prod.
7. **`title` undefined → merge synthesizes "North Shore Wanderers H3 Trail #N"** — correct.

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 "No history" was judged from the website only — the Google Sheet's other tab held a clean archive

The handoff declared *"Historical backfill: none worth scripting"* after assessing the website's
hand-typed "Recent Runs/Walks" prose list. But the source it ultimately shipped — the embedded
Google Sheet — had a **second tab** (`gid=360703890`, discoverable via `…/htmlview` or `gviz`)
carrying a **structured 160-row archive (#904 Sep 2022 → #1064 May 2026)**. A one-shot backfill of
that tab landed 159 historical events. The "no history" call was made against the wrong surface.

> **Prompt/platform change:** when a source is (or might be) a Google Sheet, **enumerate ALL tabs/gids**
> (`/htmlview` lists them; `gviz/tq` confirms columns) and inspect each for a forward-vs-archive
> split **before** declaring no backfill. The embedded/link `gid` is usually just the *forward*
> hareline; history often lives in a sibling tab. (Generalizes Mijas Gap A — "probe other
> collections" — from Squarespace to Sheet tabs.)

### B. 🔴 Dual-source trust was INVERTED — would have silently dropped the website's coordinates

The handoff set the venue/coords-bearing **website** source to `trustLevel: 5` and the location-less
**sheet** to `trustLevel: 7`, framed as "sheet = authority, website = enrichment." This is a latent
bug: the merge pipeline's lower-trust enrichment path (`merge.ts` ~L1668) backfills `locationName`
but **NOT** `locationAddress`/`latitude`/`longitude`. So if the trust-7 sheet's raw merged first
(order is nondeterministic across two daily scrapes), the canonical Event was created coordless and
the trust-5 website's **map pin was silently dropped** — defeating the entire reason the website
source exists. Caught by the **Codex adversarial review**, not by any linter.

> **Prompt change:** dual-source trust ordering must follow **which source owns the coordinates**,
> not a "primary vs enrichment" intuition. The coord/venue-bearing source must be **≥** the other's
> trust so it takes the full-update path and writes lat/lng deterministically. Pre-state this whenever
> a handoff proposes a location-less primary + a coord-bearing secondary. (Fix shipped: website → 8,
> above the sheet's 7, with a merge-level regression test. Follow-up task filed to make the
> lower-trust enrichment path backfill coords symmetrically with `locationName`.)

### C. GoogleSheets `gid`-mode still requires `GOOGLE_CALENDAR_API_KEY` — use `csvUrl` for anonymous sheets

The first config used `config.gid` for the forward tab. The `GoogleSheetsAdapter` checks for
`GOOGLE_CALENDAR_API_KEY` **before** the `gid` branch (`adapter.ts` ~L726), so a `gid`-mode source
on an anonymously-exportable sheet still errors without the key — even though gid-mode never calls
the Sheets API. Switching to **`config.csvUrl`** (the full `…/export?format=csv&gid=N` URL) routes
through `fetchDirectCsv`, which skips the key gate entirely (same path Munich H3 uses).

> **Platform change (done):** added to the Google Sites note — for any anonymously-exportable sheet,
> seed `config.csvUrl` (not `config.gid`); keep `sheetId` for `validateSourceConfig`.

### D. `GoogleSheetsConfig.columns.location` was a required field — made optional

A forward hareline of `date | run # | hare` with no venue column is a legitimate shape, but
`columns.location` was typed `number` (required). Made it optional + guarded the single read site,
mirroring the already-optional `runNumber`. (Minor; fixed in-PR with a regression test.)

### E. Tokenized Google Sites logo (`lh3.googleusercontent.com/sitesv/…`) 403s server-side

The handoff correctly said "self-host the logo." But the `og:image` is a **session/referer-bound**
Google Sites CDN token (`…=w16383`) that returns **HTTP 403 to `curl`/`safeFetch`** (and the token
rotates per page load — a fresh load showed a different token). It loaded fine in an authenticated
browser, so the logo was grabbed via Chrome MCP, then self-hosted to `public/kennel-logos/nswhhh.png`
(294×248, confirmed PNG via magic bytes).

> **Platform change (done):** Google Sites `sitesv` logos can't be fetched server-side — grab via the
> user's browser (Chrome MCP) and self-host. Extends the self-host-logo convention.

---

## Implementation / process learnings (loop context)

1. **The real Sonar S5852 hotspot was NOT where any bot guessed.** Gemini, the in-CI Claude
   reviewer, *and* the Codex connector all asserted the flag was on `TIME_RE` (`\s*(am|pm)`). The
   actual hotspot (via the public Sonar REST API `api/hotspots/search?…&pullRequest=N`) was
   **`extractVenue`'s `/[\s,…]+$/u`** — a char-class `+` anchored at `$`. **Lesson: query the real
   hotspot location+key from the Sonar API before fixing; don't trust bot guesses about which line.**
   The project is public so the read needs no token. (The MCP returns 0 for PR hotspots — the known
   `reference_sonarcloud_hotspot_gate_zero_quirk` — but the public REST search works.)
2. **Procedural string ops beat S5852 on trailing-strip regexes.** Rewriting `/[\s,…]+$/u` to
   `trim()` + a `slice` loop over trailing comma/ellipsis **eliminated** the flagged regex (no
   review-marking needed). Memory `feedback_sonar_s5852_procedural_over_regex`.
3. **The Codex adversarial review earned its keep** — it found the trust-ordering coord-drop (Gap B)
   that Sonar, Codacy, CodeRabbit, and Gemini all missed. Verified the claim against `merge.ts` before
   acting (it was real), fixed via trust bump, and added a merge regression test (sheet-first →
   website-second → coords land).
4. **Codacy = 5 false positives, left unsuppressed (with the user).** `detect-object-injection` on
   const-keyed array access (`row[COL.x]`, `lines[runIdx]`) + a "HTML passed to parser" taint rule on
   `cheerio.load(html)` / `stripHtmlTags(html)`. **No sibling adapter suppresses these** (boiseh3,
   norfolk-h3, kch3 all carry them clean) and `main` is unprotected (Codacy non-blocking), so adding
   5 divergent suppressions to silence a Security-category rule was the wrong kind of green. Surfaced
   the trade-off; user chose "leave it."
5. **CodeRabbit: one valid catch, one redundant.** Valid: `safeFetch`'s **direct** path has no default
   timeout (only the residential-proxy branch does, `safe-fetch.ts:74` vs `:94`) → added
   `AbortSignal.timeout(30_000)` to the backfill fetch. Redundant-but-harmless: a `date < today`
   cutoff (the shared `runBackfillScript` → `reportAndApplyBackfill` already partitions it) — added
   anyway as defense-in-depth so `fetchArchive` is self-contained.
6. **hares `null` vs `undefined` — bots disagreed; behavior was identical.** Gemini + Codex wanted
   `undefined` (preserve); the Anthropic reviewer wanted `null` (explicit-clear). Traced `merge.ts:701`:
   the trust-5 website can't override the trust-7 sheet's hare regardless, and `sanitizeHares` strips
   placeholders downstream — so it's a no-op either way. Kept `null` per the adapter-patterns
   atomic-bundle convention rather than churn.
7. **Squash-merge** — verified every file landed on `main` post-merge (`git log origin/main -- <path>`).
   Memory `feedback_verify_commits_landed_after_squash`.
8. **Post-merge runbook ran clean**: seed (Created 1 / Updated 368) from a fresh `main` (not the stale
   worktree — `feedback_concurrent_seed_reverts_source_config`) → backfill apply (159 created, 0
   blocked) → live scrapes (sheet 28 forward created, 2 "No Run" rows dropped by
   `silentlySkipPatterns`; website 1 enriched with coords) → live page verified.

---

## TL;DR for the research prompt + platform notes

1. **Google Sheet sources: enumerate ALL gids and check each for a forward-vs-archive split** before
   declaring "no history." The embedded gid is usually just the forward hareline.
2. **Dual-source trust ordering follows COORD OWNERSHIP, not primary/enrichment intuition** — the
   coord-bearing source must be ≥ the other's trust (the merge enrichment path backfills `locationName`
   but not lat/lng/`locationAddress`).
3. **Anonymous public Sheets: seed `config.csvUrl`, not `config.gid`** — `gid`-mode still requires
   `GOOGLE_CALENDAR_API_KEY`; `csvUrl` bypasses it.
4. **Tokenized Google Sites `sitesv` logos 403 server-side** — grab via the user's browser, self-host.
5. **Query the real Sonar hotspot via the public REST API before fixing** — the in-CI bots guessed the
   wrong regex line; the procedural trailing-strip rewrite eliminates the flag outright.
6. **Keep**: the Source-decision tree, the capture-the-real-DOM mandate, Google Sites SSR (no
   browser-render), `silentlySkipPatterns` for "No Run" holiday rows, `upcomingOnly` on both sources,
   and the `<ext>` logo placeholder.
