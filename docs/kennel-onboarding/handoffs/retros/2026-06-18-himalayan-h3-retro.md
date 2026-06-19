# Cowork Handoff Retro — Himalayan H3 (Kathmandu, Nepal, est. 1979) — 2026-06-18

Feedback from the Claude Code implementation session for the `2026-06-18-himalayan-h3.md` handoff —
HashTracks' **first 🇳🇵 Nepal kennel**: a small static **WordPress / Avada + TablePress SSR** scraper
(`himalayanhash.run/`) parsing a "Receding Hareline" table plus a featured-run detail block, plus a
brand-new country. Goal: fold the genuine learnings back into the **research prompt** + **platform notes**.
The standout this run is that **the adversarial Codex review caught a `fail-open` bug the research note's
date logic would have shipped** — a frozen/abandoned table republishing last year's runs as phantom
*future* events — and the fix interacts with two follow-on review catches (backward year roll, impossible
dates) to make year-less rolling tables correct at last.

**PR produced:**
- Onboarding (kennel + alias + source + NEW `HimalayanHashAdapter` + Nepal/Kathmandu region + self-hosted
  logo + 19 tests): [PR #2255](https://github.com/johnrclem/hashtracks-web/pull/2255) (merged).

**Outcome:** Live at https://www.hashtracks.xyz/kennels/himalayan-h3 — **3 canonical events** #2521–#2523
(2026-06-13 → 2026-06-27). #2521 "Himalayan H3 Trail #2521" (2026-06-13 15:00, hare Call Boy, venue
"Chobhar / Adinath School", Maps pin + **real Fusion-map coords 27.666559/85.293534**) CONFIRMED; #2522/#2523
placeholder-cleared (`Undecided` venue → undefined, `Needed` hares → `null`). One code PR (no backfill — the
WP REST API exposes a single 2017 post). Post-merge from **synced `main`** on prod `.env`: `db seed`
(Created 1 / Updated 418) → prod cron-scrape endpoint (found 3 / created 3 / 0 errors / 0 blocked) →
spot-checked.

---

## The loop is working — previous retro fixes LANDED

1. **🔴 Hare placeholders → `null` (Warsaw Gap A)** — the handoff said `null` this time (not "strip to
   undefined"); the adapter emits `stripPlaceholder(cell) ?? null` for `Needed`. **The Warsaw fix held at
   the source.**
2. **🔴 New-country inference = unambiguous tokens only (Warsaw Gap C)** — the handoff's rule was
   `/\b(nepal|kathmandu|pokhara)\b/`, correctly omitting any bare ambiguous token. No US place-name
   collision. **Held.**
3. **`Kennel.scheduleTime` 12-hour "3:00 PM" vs `RawEventData.startTime` 24-hour "15:00" (sh3-kr Gap B)** —
   the handoff got the split right; no correction. **Held.**
4. **5-edit `region.ts` for a brand-new 2-level country** (Nepal COUNTRY + Kathmandu METRO, mirror
   Poland/Warsaw, **no `seed.ts` stateMetroLinks**) — complete and correct; violet palette, no adjacent-pin
   clash.
5. **`config.upcomingOnly: true` + mandatory fail-loud `events.length === 0` guard** — both pre-stated and
   implemented (and the horizon fix below makes the fail-loud actually fire on abandonment).
6. **`kaohsiung-hash.ts` / `bangkok-monday-hash.ts` / `dublin-hash.ts` as references** — exactly right
   (month-`Map` + forward-roll from Kaohsiung; detail-block merge-by-run-number from Bangkok; table
   iteration from Dublin). Named in the handoff, carried over directly.
7. **`title` undefined → merge synthesizes "Himalayan H3 Trail #N"** — verified live (titles are
   "Himalayan H3 Trail #2521"…); `friendlyKennelName` short-circuits on the 12-char shortName.
8. **Self-host the logo, magic-byte the extension** — `trans_logo1.png` (117×120 RGBA `og:image`, the
   cleanest of three variants) confirmed PNG by `\x89PNG`, not the URL suffix.
9. **Capture-the-real-DOM mandate** — `curl`'d the verbatim table before parsing (Warsaw Gap F): the
   `web_fetch` "markdown table" was a render artifact; the real DOM is cleaner than feared (Gap F below).

---

## What the handoff got RIGHT (keep doing)

1. **The `▶ FOR CLAUDE CODE` directive** — branch, ordered steps, live-verify mandate, post-merge runbook —
   drove the session end-to-end and the post-merge (seed → prod scrape → spot-check) verbatim.
2. **Verbatim sample + field-fill table** — runs #2521–#2523, `1500 Hrs` → `"15:00"`, On-In/Hares/w3w
   mapping, the 1-just-past + 2-upcoming shape all matched the live `fetch()` exactly.
3. **DNS pre-check + sitemap dedup** — `himalayanhash.run` → 191.96.244.235; 446-slug sitemap, no
   `himalaya`/`kathmandu`/`nepal`/`hh3`. First-Nepal confirmed.
4. **kennelCode `himalayan-h3` + bare "HHHH"/"H4" OMITTED** — every bare initialism collision-checked
   (`HHHH` → h6 Hollyweird, `H4` → h4 Hangover kennelCode + hockessin/h4-tx aliases); qualified "HHHH Nepal"
   used instead. Correct (the Seoul "check EVERY bare initialism" rule applied).
5. **No backfill** — correctly assessed (1 WP post total; per-run posting abandoned ~2017).

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 A "no decimal coords" research finding is unreliable for map-plugin sites — grep the inline map shortcode

The handoff (and the platform note) asserted *"Location is What3Words, not coordinates… no decimal lat/lng…
leave `latitude`/`longitude` undefined → merge geocodes the venue text / centroid."* The build `curl`
disproved it: the featured run's detail block embeds a **Fusion Google-Map shortcode** whose inline
`<script>` carries **`addresses:[{"latitude":"27.666559","longitude":" 85.293534"}]`** — the real venue
coordinates. Capturing them gives a precise pin instead of geocoding "Chobhar / Adinath School" (which a
geocoder may miss) or falling back to the Kathmandu centroid. This was the research note's biggest miss —
`web_fetch`'s markdown rendering hid the map shortcode entirely.

> **🔴 Platform-note / prompt change (landed in `source-platform-notes.md`):** when a page shows only a
> What3Words or Maps *link*, **still grep the detail-block / map-embed inline `<script>` for decimal
> lat/lng** before concluding "no coords." Avada/Fusion, Leaflet, and most WP Google-Maps plugins stash
> `addresses:[{latitude,longitude}]` (or `data-lat`/`data-lng`) in the shortcode JSON even when the visible
> UI hides it. A research-time "no coords" is a hypothesis to disprove at build, not a fact.

### B. 🔴 Year-less rolling tables fail OPEN on source abandonment — gate to a tight near-term horizon

The handoff's date logic ("today-anchored, small forward window") missed that a **frozen/abandoned** receding
hareline **republishes last year's rows as phantom FUTURE events**: a year-less `13th June` resolves to *this*
year once "now" wraps back within ~90 days of June, lands inside `filterEventsByWindow`'s ±90d, and publishes —
and `upcomingOnly` reconcile (future-only) + the zero-event health alert are **both blind** to it (valid date,
present every scrape). The **Codex adversarial review** caught this. Fix: gate accepted rows to a tight
near-term horizon (`now-14d .. now+42d`) — a receding hareline never legitimately lists a run further out — so
an abandoned table yields 0 events and the existing fail-loud fires instead of phantoms.

> **🔴 Prompt + platform-note change (landed):** for a **year-less rolling/receding-hareline** source under
> `upcomingOnly`, `filterEventsByWindow` is NOT enough — add a **near-term acceptance horizon** so a frozen
> table fails closed. This is shared exposure across every year-less `upcomingOnly` adapter
> (`kaohsiung-hash`, `bangkok-monday-hash`); captured in the `reference_yearless_rolling_table_phantom_future`
> memory.

### C. 🟡 Year inference needs a BACKWARD (Dec→Jan) roll too — "no bidirectional rule needed" was wrong

The handoff said *"only ~3 near-term rows, so no Bangkok-style bidirectional rule needed."* **Gemini** caught
the year-boundary failure: a just-past `27 Dec` run scraped on `2 Jan` resolves to *next* December (~12 months
out) without a backward roll — and the horizon (Gap B) would then *drop a real run*. Mirror bangkok's
`inferYear`: `>8mo` future → prior year. The forward roll and backward roll are both required; the horizon
keeps the backward-rolled just-past run.

> **Prompt change:** a year-less date resolver is **always bidirectional** (forward roll for stale-past,
> backward roll for next-year-boundary) — even for a "only ~3 rows" rolling table. Don't special-case it away.

### D. 🟡 Impossible calendar dates silently normalize — round-trip-reject them

`Date.UTC(y, 5, 31)` rolls `31 June` → `1 July`; a typo'd hareline cell would publish a *wrong* date instead
of failing closed. **Codex (P2)** caught it; a `day <= 31` guard doesn't help. Fix: round-trip the constructed
date against the requested month/day and return `null` on mismatch (leap-aware — `29 Feb` survives only in a
leap year).

> **Prompt change:** any adapter that builds a date from parsed month/day integers must **validate via
> round-trip** (`d.getUTCMonth() === monthIdx && d.getUTCDate() === day`), not just range-check the day —
> `Date.UTC` silently normalizes overflow.

### E. 🟡 `new URL(href)` on a scraped link needs a base URL + normalized return

**Gemini** flagged that `extractW3wUrl` did `new URL(href)` with no base — it throws on protocol-relative
(`//w3w.co/…`) or relative hrefs (the `try/catch` then silently *drops* a valid link). Pass the source origin
as base and return `parsed.href`.

> **Platform-note change:** when validating a scraped link by host, **`new URL(href, sourceOrigin)`** (handles
> protocol-relative/relative) and return the normalized `parsed.href`. Bare `new URL(href)` is lossy.

### F. 🟢 The "UNVERIFIED" markup resolved SIMPLER — it's TablePress, not raw Fusion

The handoff flagged the `<table>`/`<td>` nesting as UNVERIFIED ("the real DOM is a Fusion `fusion-text` block;
capture it"). The build `curl` showed a **clean TablePress** table (`#tablepress-5`, semantic `td.column-1…6`,
proper `<thead>`/`<tbody>`) — stable selectors, simpler than feared. (Same shape as Warsaw Gap F: the
UNVERIFIED caveat usually *confirms or simplifies*, rarely contradicts.) Read cells by **position**
(`td.eq(n)`) for robustness against class drift.

> **Platform-note add (landed):** TablePress (`table.tablepress`, `td.column-N`) is a common, clean WP table
> source — read by td position, not class.

### G. 🟢 "Undecided" is a venue placeholder NOT in the shared `stripPlaceholder` list

`stripPlaceholder` (`utils.ts`) catches TBD/TBA/TBC/Needed/N-A/None/…, but **not "Undecided"** — so the venue
column's `Undecided` would leak as a location without an explicit per-source guard. Added one.

> **Platform-note add (landed):** the shared placeholder set is not exhaustive — verify a source's actual
> placeholder vocabulary (`Undecided`, `Check.Back.Later`) against `stripPlaceholder` and add per-source
> guards for the misses.

### H. 🟢 Explicit `vitest` imports — match the sibling-test convention

**CodeRabbit** noted the test file omitted `import { describe, it, expect } from "vitest"` while 99/125 sibling
adapter tests include it. Added (cheap consistency, despite `globals: true`).

---

## Implementation / process learnings (loop context)

1. **The adversarial Codex review earned its keep — twice.** The fail-open horizon catch (Gap B) is the single
   most valuable review finding of this run (it would have shipped phantom future events on source
   abandonment, invisible to reconcile/health). A *second* Codex P2 pass then caught the impossible-date
   normalization (Gap D). Both were real, neither was noise.
2. **The horizon (B) and backward roll (C) are complementary — fixing one alone is wrong.** The near-term
   horizon, by itself, would have *dropped* a legitimate late-December run scraped in early January; the
   backward roll resolves it to last year so the horizon keeps it. Year-less correctness needs both.
3. **`/simplify` earned a real reuse cut** — replaced an 18-line hardcoded `MONTH_INDEX` literal with
   `new Map(Object.entries(MONTHS_ZERO))` from `utils.ts` (keeps the Codacy-safe `.get()` while deleting the
   duplication). A false-positive ("`cleanVenue`'s `Undecided` guard is redundant") was correctly *declined* —
   `stripPlaceholder` does not catch "Undecided", and the live run proved the guard necessary.
4. **Post-merge ran from synced `main`, not the stale worktree** — to avoid a stale-worktree `db seed`
   reverting other sources' `Source.config`. `db seed` additive (Created 1 / Updated 418); the prod cron
   endpoint (`POST /api/cron/scrape/<id>` with the `CRON_SECRET` bearer fallback) is the scriptable equivalent
   of the `/admin/sources` "scrape now" button.
5. **SonarCloud + Codacy both passed with 0 new issues** — the pre-PR `/simplify` + `/code-review` and the
   Sonar-aware regex authoring (bounded month token, no `\s*` adjacent to `.+`, `Map.get` not `Record[var]`)
   meant no hotspots to mark SAFE.

---

## TL;DR for the research prompt + platform notes

1. **🔴 "No coords" is a hypothesis, not a fact** — for any map-plugin site (Avada/Fusion, Leaflet, WP
   Google-Maps), grep the detail-block / map-embed inline `<script>` for `latitude`/`longitude` before
   leaving `lat/lng` undefined. `web_fetch`'s markdown rendering hides map shortcodes.
2. **🔴 Year-less rolling tables need THREE guards** — bidirectional year roll (forward + backward Dec→Jan) +
   impossible-date round-trip reject + a tight near-term acceptance horizon (fail-closed on abandonment).
   A naive forward roll fails OPEN (phantom future events) and the year boundary drops real runs.
3. **TablePress** (`table.tablepress`, `td.column-N`) is a clean WP table source — read by td position.
4. **The shared `stripPlaceholder` set is not exhaustive** — "Undecided" (and other per-source vocab) slip
   through; add explicit guards.
5. **Validate scraped links with `new URL(href, sourceOrigin)`** + return `parsed.href`; bare `new URL` is
   lossy on relative/protocol-relative hrefs.
6. **Keep:** the `▶ FOR CLAUDE CODE` directive, hare→`null` tri-state, unambiguous new-country inference
   tokens, 12h/24h `scheduleTime`/`startTime` split, the 5-edit 2-level `region.ts` pattern (no
   `stateMetroLinks`), `upcomingOnly` + fail-loud, `title`-undefined synthesis, self-host-logo (magic bytes),
   capture-the-real-DOM at build, and check-EVERY-bare-initialism for alias collisions.
