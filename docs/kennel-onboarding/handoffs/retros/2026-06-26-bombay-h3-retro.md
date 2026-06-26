# Cowork Handoff Retro — Bombay H3 (🇮🇳 first India kennel) — 2026-06-26

Feedback from the Claude Code implementation session for the `2026-06-26-bombay-h3.md` handoff — a
**NEW static-Cheerio adapter** (NOT config-only) for a freshly-built self-hosted WordPress site
(`bombayhash.org`, WP 6.9.4 + Astra/Spectra), plus the first **India COUNTRY + Mumbai METRO** region.
The handoff's research was thorough and its metadata held perfectly — but it was written from
`web_fetch`'d SSR *text*, and the as-built DOM differed from the handoff's two structural assumptions
in ways that only a live parse surfaced. The live-verification rule earned its keep twice: once
catching the field-layout reality, once catching three parser bugs before CI. Four review bots
(Gemini, CodeRabbit, Codex, claude[bot]) then converged on one real correctness fix (tri-state hares)
plus three good hardening nits.

**PRs produced:**
- Onboarding (adapter + tests, kennel/alias/source seed + India/Mumbai region + self-hosted logo):
  [PR #2406](https://github.com/johnrclem/hashtracks-web/pull/2406) (merged). **Three commits** —
  onboard base, a `/simplify` tighten (dropped a redundant ordinal-strip, reused `isPlaceholder`), then
  the CI-review batch (tri-state hares, regex ReDoS, narrowed India inference, `IN`-alias collision).
- Docs (this retro + run-log/queue → SHIPPED + the platform-notes correction): this PR.

**Outcome:** Live at `https://www.hashtracks.xyz/kennels/bombay-h3` — **5 canonical events** (#627–#631,
2026-02-22 → **upcoming #631 Sun 28 Jun 2026 09:30 @ Shivaji Park Gymkhana**), all CONFIRMED, monthly
Sunday 9:30 AM, clean synthesized titles "Bombay H3 Trail #N", venues populated (4/5; #629 has no map
pin on the page). Post-merge ran from the **main repo**: `prisma db seed` (additive — timed out once at
the 5-min cap after regions+kennel, idempotent re-run finished the aliases+source), then a one-shot
`POST /api/cron/scrape/<id>` with the Bearer `CRON_SECRET` (**eventsFound 5 / created 5 / 0 unmatched /
0 errors**). Prod query confirmed 5 CONFIRMED events; page returns 200. **No historical backfill** (the
site was built Feb 2026; only #627–#631 exist on it).

---

## The loop is working — previous retro discipline LANDED

1. **Live-verify END-TO-END before CI — caught the field layout AND three parser bugs.** Running
   `parseBombayHashPage` against the saved live HTML *before* writing the test fixture revealed (a) the
   labeled fields are NOT on separate lines (Gap A) and (b) three concrete bugs the fixture alone would
   have baked in: a loose `hare` regex matching prose ("Unless You're the Hare!"), a `🍻`-prefixed venue
   not being stripped, and a dateless drift block climbing to `.entry-content` and stealing a sibling
   run's date (Gap B). All three fixed and re-verified. This is exactly the "never ship against mocked
   fixtures" rule paying off.
2. **Worktree vitest exclude workaround.** Tests under `.claude/worktrees/**` zero out (the config's
   exclude matches every path); used a temp `vitest.local.config.ts` minus that exclude, `prisma
   generate` first, deleted before commit. Recurred again — reliable pattern. [vitest-excludes-worktrees-path]
3. **Magic-byte the logo extension.** The og:image URL ended `.png` AND the header said `image/png` —
   this time the magic bytes (`\x89PNG`, 590×591) **agreed**, so `bombay-h3.png` is genuinely a PNG.
   The discipline still ran (the previous Riyadh logo's `.png` was a lie); confirming costs nothing.
4. **First-country = all 5 `region.ts` edits, palette grep-before-pick.** India COUNTRY + Mumbai METRO,
   tz `Asia/Kolkata`, centroids IN 22.5937,78.9629 / Mumbai 19.076,72.8777, `inferCountry` disambiguation
   test. The `COUNTRY_INFERENCE_RULES` edit (the ONH3/Kenya CI trap) was included from the start.
5. **`upcomingOnly:true` as a reconcile-safety contract.** The home page is a rolling current-runs
   surface (past blocks age off), so the source sets `upcomingOnly:true` and the 4 completed runs
   (#627–#630) are enrichment-only — reconcile never false-cancels them. Same contract as Riyadh/Bandung.
6. **`tsx` DB probe needs `import "dotenv/config"`** — the Riyadh Gap F recurred verbatim: a check
   script importing `@/lib/db` hit a phantom local DB ("database `johnclem` does not exist") until I
   prepended `import "dotenv/config"`. The seed itself was fine (it goes through `prisma.config.ts`).

---

## What the handoff got RIGHT (keep doing)

1. **Every metadata field was sourced and held.** shortName "Bombay H3" (>4 chars → `friendlyKennelName`
   short-circuits to a clean "Bombay H3 Trail #N", verified at build), foundedYear 1983 (cited + "Over 43
   years" corroboration), hashCash ₹250/₹400 (with #630's ₹2100 correctly flagged as a per-event
   special, not the default), Instagram `bombayhash`, walkers-welcome — all shipped as written.
2. **The PII warning was accurate and load-bearing.** The handoff's 🔴 PII flag (phone numbers + payee
   names in the rego lines, an embedded join/waiver `<form>`, a dev email in `wp/v2/posts` author meta)
   was real. The adapter reads only the labeled date/time/venue segments, which *structurally* excludes
   the rego/phone lines, with `scrubHarePii` as defensive belt-and-suspenders. Verified: "9320031565" /
   "Shailesh Shah" absent from every stored field.
3. **Year-bearing dates, no inference.** The dates carry explicit 4-digit years; the handoff said "NO
   year inference" and that's right. Better still, requiring `20\d{2}` in the date regex cleanly excludes
   the rego deadlines ("till Friday, 26th June") and "since Jan" noise without complex alternation.
4. **kennelCode / alias hygiene.** `bombay-h3` (bare `bh3`=Buffalo → descriptive code), bare "BH3"/"BHHH"
   aliases omitted as globally-taken — all correct, passed the seed-integrity tests untouched.
5. **`title` undefined → synth.** The handoff said don't promote the emoji-prose themes to titles; merge
   synthesizes "Bombay H3 Trail #N". Right call — the themes are buried in unparseable emoji soup.

---

## Handoff GAPS → research-prompt / platform-notes improvements (the actionable part)

### A. 🔴 The labeled fields are JAMMED into one run-together paragraph, NOT on separate lines

The handoff (and the platform note it appended) said: *"Labeled fields are emoji-prefixed (`📅 Date:`,
`🕘 Time:`, `📍 Venue:`) … `stripHtmlTags(html,"\n")` → line scan by label is reliable."* The live DOM
is the opposite: all of date+time+venue are concatenated into **one `<p>` with no whitespace between
fields** — `…the Hare!" 😂🐇📅 Date: Sunday, 28th June 2026🕘 Time: 9:30 AM…📍 Venue: Shivaji Park
Gymkhana`. A newline-based line scan finds nothing; the parser must **split on the emoji markers
themselves** (find `📅`, capture until the next field-marker emoji). The markers also **vary per run**
(`🕘 Time:` / `⏰ Assembly:` / bare `TIME:`; `📍 Venue:` / `📍 VENUE:` / bare `📍`), and one run (#630)
prefixes its venue with `🍻` that must be stripped (and excluded from the field-terminator set, or the
venue comes back empty).

> **Process note (→ platform notes correction, applied):** for emoji-decorated WordPress/Spectra run
> blocks, do NOT assume the labels sit on their own lines — `web_fetch`'d SSR *text* collapses
> whitespace and hides this. The fields are emoji-delimited *segments within run-together paragraph
> text*; parse by locating each marker emoji and cutting at the next one. Treat the recon's "line scan
> by label" as unverified until a real parse confirms the whitespace.

### B. 🔴 The run heading's body is NOT a DOM sibling — `nextUntil` returns empty; climb to the dated ancestor

The handoff said *"walk siblings to the next run heading"* (`nextUntil`). In the real Astra/Spectra
markup the heading lives in its own nested container and the body `<p>`s are **not siblings** —
`heading.nextUntil(...)` returns an empty set. The working mechanism is to **climb from the heading to
the nearest ancestor whose text already contains the year-bearing date** (that ancestor is the per-run
Spectra block), capped at 6 levels. 🔴 Critically, the climb must **stop *before* `.entry-content`** —
that page-level wrapper holds *every* run's text, so a dateless drift block (a "RUN #N" heading with no
parseable date — markup drift) would otherwise match a *sibling* run's date there and silently mis-date
itself. The stop-boundary check has to run *before* the date check. (This was caught by a dedicated
`RUN #999` drift fixture in the test.)

> **Process note (→ platform notes correction, applied):** Spectra/Astra (and many block-theme
> WordPress) put the heading and its body in *different* containers — sibling-walk fails. Climb to the
> first ancestor carrying the run's own date, and stop at the page-content wrapper so a dateless block
> can't borrow a neighbour's date. Per-run AND whole-page fail-loud both required.

### C. 🟡 The proposed `lime` palette was already taken — grep caught it (as the handoff told it to)

The handoff proposed `lime` for India but flagged "🔴 grep `bg-lime` before committing." Grep confirmed
`lime` is already used by ~10 US regions, so India shipped **blue** (distinct from every Asian neighbour:
Nepal=violet, Sri Lanka=rose, Thailand=orange, Malaysia=green, Saudi=teal, UAE=amber, Taiwan=sky). The
grep-before-pick instruction did its job; the only note is that the *proposed* colour in a first-country
handoff is a coin-flip and the implementer should expect to re-pick.

### D. 🟡 `scrapeDays: 120` was too tight for a multi-month rolling page — clipped the oldest run

The handoff set `scrapeDays: 120` ("monthly cadence; 120d covers the current page"). But the 5 posted
runs span **Feb 22 → Jun 28 (~126 days)**, and `filterEventsByWindow` is **symmetric (±days)**, so #627
(124 days old at scrape time) fell outside the window — the first live `fetch` returned 4, not 5. Bumped
to **365** (the page is a tiny rolling set with no archive, so a wide backward window just captures
whatever's currently posted; `upcomingOnly` still protects reconcile). 4-of-5 silently shipping would
have looked fine in the run-log.

> **Process note (→ research prompt):** when a rolling page shows N runs spanning M days, the source's
> `scrapeDays` must exceed M (the symmetric ±window clips the oldest otherwise). For a small archive-less
> page, default to a generous window (365) rather than the cadence interval.

---

## Implementation / process learnings (loop context)

1. **🔴 CI review — one real correctness fix: tri-state hares.** Four bots flagged that `parseHares`
   returned `undefined` for the `🐇 HARES: ???` placeholder. Per the repo's tri-state convention
   ([backfill-clear-field-needs-explicit-null]), a *present-but-placeholder* field must return **`null`**
   (explicit clear → merge drops stale hares on re-scrape); `undefined` is reserved for *label absent*
   (preserve). Fixed: `null` for placeholder/PII-only, `undefined` only when no HARES label. Test split
   accordingly (#631 → `toBeNull`, label-absent runs → `toBeUndefined`).
2. **🟡 CI review — regex ReDoS (Sonar S5852).** `\bRUN\s*#?\s*` and `\s*:?\s*` have adjacent optional
   whitespace quantifiers → rewrote to non-overlapping `\s*(?:#\s*)?` / `\s*(?::\s*)?`. This is the same
   S5852/S5843 family the adapter-patterns rule already warns about; worth pre-empting in the first draft.
3. **🟡 CI review — bare `bombay` over-matched in `COUNTRY_INFERENCE_RULES`.** `inferCountry` defaults to
   USA and is run on free-form region input before persisting, so a bare `bombay` token would force
   "Bombay Beach, CA" → India. Narrowed to `\b(india|mumbai)\b|\bbombay\s+(?:h3|hash|hhh)\b` (brand forms
   only) + negative tests. The handoff had flagged `bombay` as "borderline" — the reviewers were right to
   tighten it.
4. **🟡 CI review — the `IN` region alias collides with Indiana.** Codex caught that adding `"IN"` to the
   India COUNTRY region aliases shadows Indiana under `findCanonicalRegionName` (first-match by seed
   order; India is seeded *before* Indiana). Dropped `"IN"` from the region aliases — the ISO-code
   `IN → India` mapping lives separately in `COUNTRY_CODE_TO_NAME` and is unaffected. A 2-letter region
   alias on a first-country is a collision risk worth checking against existing US-state abbrevs.
5. **🟢 `chronoParseDate` parses ordinals natively** — the first draft stripped `28th → 28` before
   chrono; `/simplify` verified chrono handles `"28th June 2026"` directly, so the ordinal-strip constant
   + step were dropped. Lean on the shared parser before adding pre-processing.
6. **🟡 Prod `prisma db seed` exceeds the 5-min foreground cap.** The full seed (~465 kennels / ~2000
   aliases / ~373 sources / ~279 regions over the remote Railway connection) timed out foreground after
   creating regions+kennel but before aliases+source. It's idempotent and applies in order
   (regions→kennels→aliases→sources), so a **background re-run** finished the remainder cleanly. Run the
   post-merge seed with `run_in_background` (or `nohup`) from the start.
7. **🟡 `NEXT_PUBLIC_APP_URL` in the main repo `.env` is `localhost:3000`** — the cron-scrape trigger
   must target `https://www.hashtracks.xyz` directly, not that env var. (POST
   `/api/cron/scrape/<id>` with `Authorization: Bearer $CRON_SECRET` → `verifyCronAuth` accepts it.)

---

## TL;DR for the research prompt + platform notes

1. **🔴 NEW — emoji-decorated WordPress/Spectra run blocks jam the labeled fields into ONE run-together
   paragraph, not separate lines.** Parse by splitting on the marker emoji (`📅`/`🕘`/`⏰`/`📍`), cut at
   the next marker; markers vary per run. `web_fetch`'d SSR text hides the missing whitespace.
   (Platform-notes Bombay section corrected.)
2. **🔴 NEW — Spectra/Astra heading bodies are NOT siblings.** `nextUntil` fails; climb to the first
   ancestor carrying the run's own year-bearing date, and STOP before `.entry-content` (else a dateless
   drift block borrows a neighbour's date). Per-run + whole-page fail-loud both required.
3. **🔴 NEW — a rolling page's `scrapeDays` must exceed the run span** (the ±window is symmetric and clips
   the oldest otherwise). Archive-less rolling page → default 365, not the cadence interval.
4. **🔴 Tri-state hares: placeholder/PII-only → `null` (clear), label-absent → `undefined` (preserve).**
   Re-confirm the convention for any field an adapter sometimes-sees-empty; reviewers will (rightly) flag
   `undefined` for an explicit placeholder.
5. **🟡 First-country gotchas that recur:** the proposed palette is a coin-flip (grep-before-pick); a
   2-letter region alias can collide with a US-state abbrev (`IN`=Indiana — keep ISO codes in
   `COUNTRY_CODE_TO_NAME` only); a bare city token in `COUNTRY_INFERENCE_RULES` can over-match a US
   namesake (`bombay`→Bombay Beach CA — narrow to brand forms).
6. **🟡 Pre-empt Sonar S5852** in the first draft (no adjacent `\s*…?\s*`); lean on `chronoParseDate` for
   ordinals; the worktree temp-vitest-config + magic-byte-logo + `tsx`-needs-`dotenv/config` disciplines
   all held again.
7. **🟡 Post-merge ops:** run `prisma db seed` in the background (it exceeds the 5-min cap and is
   idempotent); trigger the scrape against `https://www.hashtracks.xyz` (not the localhost `.env` URL)
   with the Bearer `CRON_SECRET`.
