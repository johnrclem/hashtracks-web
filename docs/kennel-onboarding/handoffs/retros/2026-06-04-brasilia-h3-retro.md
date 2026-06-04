# Cowork Handoff Retro — Brasília H3 (first 🇧🇷 Brazil / second South America country) — 2026-06-04

Feedback from the Claude Code implementation session for the `2026-06-04-brasilia-h3.md` handoff —
**HashTracks' first Brazil kennel**, a new `BrasiliaH3Adapter` on the Blogger API v3 pattern (the
**empty-title Blogspot** variant — all run data lives in the post body, not the title). Goal: improve
the **research prompt** + **platform notes** so future Blogspot handoffs need fewer mid-implementation
corrections.

**PR produced:**
- Onboarding (adapter + kennel/alias/source + Brazil COUNTRY / Brasília METRO region 5-edit + frozen
  174-run backfill): [PR #1969](https://github.com/johnrclem/hashtracks-web/pull/1969) (merged).
  Four commits on-branch: onboard → review fixes → S5852 regex rewrite → S4325 typed-source helper.

**Outcome:** Live — https://www.hashtracks.xyz/kennels/brasilia-h3. Post-merge runbook ran clean:
seed created Brazil + Brasília regions / kennel / 4 aliases / source (`config.upcomingOnly:true`
asserted); backfill applied **174 canonical events** (2019-04-21 #154 → 2026-05-10 #338), **0 errors**;
a triggered prod scrape published the **upcoming N+340 (Sun 7 Jun 2026, "Brasilia H3 Trail #340",
CONFIRMED)**. **175 events total**, `lastEventDate` 2026-06-07. This was NOT a 0-upcoming ship — the
handoff's verbatim N+340 sample held exactly.

---

## The loop is working — previous retro fixes LANDED

1. **New-country 5-edit `region.ts` checklist (ONH3 / Mijas / Paris / Asunción retros).** All five
   edits carried in the handoff (REGION_SEED_DATA COUNTRY+METRO **emerald** — chosen South-America-
   distinct from Paraguay's purple; `COUNTRY_INFERENCE_RULES` `/\b(brazil|brasil|bras[ií]lia)\b/`;
   `STATE_GROUP_MAP`; `COUNTRY_GROUP_MAP` country→country; `COUNTRY_CODE_TO_NAME` `BR`).
   `inferCountry("Brasília, Brazil")` and `inferCountry("Brasilia H3")` both returned **Brazil**, not
   USA. Clean numeric literals, no S6749.
2. **Non-ASCII shortName slug trap (Asunción Gap C) — pre-empted in RESEARCH this time.** The handoff
   explicitly used the **ASCII `shortName: "Brasilia H3"`** (the kennel writes it without the accent)
   so `toSlug` → `brasilia-h3` cleanly, **no `slug:` override needed**, and called out the
   `asunci-n-h3` trap by name. The lesson didn't just survive — it moved one stage upstream into the
   research prompt. Slug landed `brasilia-h3` with zero correction.
3. **`aliases.ts` keyed by `kennelCode` (Asunción Gap A).** The handoff keyed the alias block by
   `"brasilia-h3"` with the explicit warning callout. (kennelCode == slug here, so it would have
   coincided either way, but the handoff got it right and flagged the rule.)
4. **H7 / Asunción frozen-dataset backfill.** Committed `scripts/data/brasilia-h3-history.json` + a
   dumb loader delegating to `runBackfillScript`; the throwaway extractor (which ran the adapter's
   exported `parseBrasiliaPost` over the live keyed feed) was **not** committed. Regenerated the JSON
   after every adapter change and diffed byte-identical — provenance integrity held.
5. **`upcomingOnly` + future-only adapter + separate backfill (ONH3 retro).** Source
   `config.upcomingOnly:true` keeps reconcile scoped to future dates so the aged 2019→2026 archive
   isn't false-cancelled as posts roll off the 25-post fetch window. Landed and asserted in prod.

---

## What the handoff got RIGHT (keep doing)

1. **The defining structural fact was front-and-center: post titles are EMPTY → parse the body.**
   The handoff led with "ALL run data lives in the post body HTML" and described the exact body order
   (heading `Hash N+NNN "Theme"` → `Weekday, Dth of Month` date line → jokey prose). The adapter
   structure was right on the first pass; all the work was in the date parser (Gap A).
2. **A verbatim upcoming sample (N+340 / Sun 7 Jun 2026) + the "this is UPCOMING, not 0-upcoming"
   framing.** Gave an exact test-fixture oracle and set the right expectation for live-verify.
3. **"N+339 is genuinely absent — do not synthesize."** Held exactly; the adapter/backfill skipped
   the gap and the sequence jumps 338 → 340. Faithful, no fabrication.
4. **Coord sanity pre-flagged: no per-event coords → no default-pin trap.** `latitude/longitude` left
   undefined; merge geocodes venue text or falls back to the Brasília centroid. No `dropCachedCoords`
   churn. Confirmed in prod (geocoder resolved landmark venues, fell back to centroid for vague ones).
5. **Alias collision discipline.** `"BH3"` correctly omitted (globally taken by Boston/Buffalo/
   Bristol/Boulder); the four shipped aliases were grep-clean.
6. **`friendlyKennelName` short-circuit pre-checked** (shortName 11 chars > 4 → returns shortName);
   `title` left undefined so merge synthesized `"Brasilia H3 Trail #340"`. No garbled-title risk.

---

## Handoff GAPS → research-prompt / platform-note improvements (the actionable part)

### A. 🔴 The year-inference rule was WRONG — "naive +1 if before publish" mis-dates recap posts

The handoff (and the draft Blogspot platform note) prescribed: *"year = publishYear; if the candidate
is more than ~7 days BEFORE `post.published`, add 1 year."* That assumes runs are always 0–14 days
**after** the announcement. Across the real 186-post archive that's false: **many posts are recaps
published days-to-weeks AFTER the run** (a previous-run photo gallery gets prepended, bumping
`published` later — a case the handoff itself flagged *elsewhere*). The naive rule wrongly rolls those
a full year forward — a dry-run over the archive produced **5 mis-dated events** (e.g. run 227's
Jan-20-2022 recap, published Feb 10, became 2023-01-20).

The correct rule is **closest-to-publish**: pick the year ∈ {pubY−1, pubY, pubY+1} that minimises
`|candidate − publishDate|`, validating each candidate first so an impossible date (31 Feb, non-leap
29 Feb) can't mask a valid sibling year. That handles the Dec→Jan announcement rollover **and** the
recap-after-run case in one rule. Re-running the dry-run with it: **0 date anomalies**.

> **Prompt / platform change:** for a year-less in-body date line, infer the year as
> **closest-to-publish over {pubY−1, pubY, pubY+1}** — never a directional "+1 if before publish"
> offset. And **sample posts from across the whole archive** (oldest, middle, a batch-posted cluster),
> not just the latest, before specifying the parser — blogs mix announcement and recap posting, so the
> run date can be before *or* after publish. (Mirrors the Asunción "date formats drift across the
> archive" lesson, applied to year-inference.)

### B. 🟡 Best-effort venue extraction needs the heading-on-next-line form, not just `Label:`

The handoff's location regex was colon-only (`Start:` / `Start Location:` / `📍 Start:`). Recent posts
(N+334/N+335) use a **`📍 Start` heading on its own line with the venue on the NEXT line**
(`SQS 406, Bloco K`). A colon-only matcher silently dropped those (caught by Codex review). Adding a
full-line-anchored heading matcher (venue = next non-empty line) while keeping mid-prose `start at the
park…` excluded lifted backfill location coverage **15 → 26 / 174 rows** and resolved the live N+335
venue.

> **Prompt / platform change:** when sampling a source's venue/field labels, check **both** the inline
> `Label: value` form **and** the heading-then-next-line form (`Label`\n`value`). Anchor both to the
> whole line so prose that merely begins with the label word can't false-match.

### C. 🟡 Archive backfills surface faithful SOURCE-DATA errors — store them, don't fabricate

The kennel's own posts carry errors the research can't predict: **run N+252 is reused for two
different runs** ("Diplomatic Corps" 22 Jan + "Pontao" 5 Feb — 253 never assigned), and **six date
pairs collide** because a previous run's date line was copy-pasted into the next post. CodeRabbit
flagged the duplicate run number and proposed renumbering to 253 — **declined with live-blog evidence**
(both posts are genuinely headed `Hash N+252`; renumbering would invent data). The two rows have
distinct dates, so the merge pipeline keeps them as separate canonical events. CodeRabbit agreed and
saved it as a repo learning.

> **Prompt change:** note in the backfill section that a multi-year archive will contain source-author
> errors (duplicate run numbers, copy-pasted/wrong date lines). Extract them **faithfully** — the merge
> pipeline collapses same-`(kennel, date)` rows; never renumber or "correct" to satisfy a linter/bot.

### D. 🟡 The Blogger PUBLIC feed caps at ~150 posts; the KEYED API returns the full archive

The public Atom/JSON feed (`/feeds/posts/default?alt=json&max-results=500`) returned only **150** of
the blog's **186** posts (research read ~150). `fetchBloggerPosts(url, 200)` (Blogger API v3, keyed by
`GOOGLE_CALENDAR_API_KEY`) returned all **186** — reaching back to run #154 (Apr 2019) vs the public
feed's #188. The backfill must use the keyed API, not the public feed, or it silently loses the oldest
~3 years.

> **Platform change (Blogger section):** size + extract a Blogspot backfill via the **keyed Blogger
> API** (`fetchBloggerPosts`), not the public `/feeds/` endpoint — the public feed truncates at ~150
> entries. Use `openSearch$totalResults` from the public feed only as a quick *depth probe*.

---

## Implementation / process learnings (loop context)

1. **Worktree cwd trap — the first `region.ts` edit landed in the MAIN repo, not the worktree.** Bash
   `cd` resets to the main repo between calls, and the Explore agents reported main-repo absolute
   paths; the first Edit hit `/hashtracks-web/src/lib/region.ts` (on an unrelated branch with its own
   uncommitted work). Caught it immediately, `git checkout --` reverted *only* that file (leaving the
   other branch's WIP untouched), and redid every edit with **worktree-prefixed absolute paths**.
   (Known memory; reconfirmed — when in a worktree, always prefix paths with the worktree root.)
2. **`/code-review` (high effort) caught two real latent bugs pre-merge.** (i) Date/venue extraction
   was unanchored first-match → anchored to `body.slice(runMatch.index)` so a prepended recap can't
   supply an earlier date/`Start:` line. (ii) The year round-trip guard checked only the winning
   candidate → moved the validity check *inside* the candidate loop so a valid leap/month-end sibling
   year still wins. Neither manifested in the live data, but both are correct hardening.
3. **SonarCloud new-code issues fixed at the source, not suppressed: 5 → 0 across two rounds.**
   - **S5852 (ReDoS hotspot)** on the venue regex's `(?:\s*Location)?\s*:` adjacency → rewrote to a
     literal ` Location` + literal colon (no leading `\s*`). This was the `new_security_hotspots_reviewed`
     gate failure (the documented "MCP under-reports PR hotspots" quirk) — rewriting cleared it with
     **no SAFE-marking and no NOSONAR**, per the project's beat-Sonar-at-the-source preference.
   - **S4325 ×4** ("unnecessary assertion") on `{...} as never` test source mocks → a single typed
     `brasiliaSource(): Source` helper (one internal cast), per the typed-factory-over-per-callsite rule.
4. **CodeRabbit: 0 acted blindly, 1 declined-with-evidence, rest agreed.** The dup-N+252 "fix" was
   declined with a live-blog citation (Gap C); CodeRabbit accepted and filed the quirk as a learning.
5. **Node 20 / `fnm` weren't on PATH in this checkout** — used Node 25, which satisfies Prisma 7's
   "20+". All checks (tsc/lint/8473 tests/tsx/seed/backfill/scrape) ran fine on 25. (Same as the
   Asunción retro — the runbook's `eval "$(fnm env)" && fnm use 20` is the documented norm; 25 is the
   working fallback.)
6. **Post-merge ran from the worktree against prod** (verified byte-identical to `origin/main`) so the
   main repo's unrelated uncommitted doc WIP was never disturbed. Triggered the live scrape via the
   prod cron endpoint (`POST /api/cron/scrape/<sourceId>` + Bearer `CRON_SECRET`) — the real
   production path (scrape → merge → reconcile), which published N+340 cleanly.

---

## TL;DR for the research prompt + platform notes

1. **Year-less date line → infer the year as CLOSEST-to-publish** over {pubY−1, pubY, pubY+1}, not a
   "+1 if before publish" offset — blogs mix announcement and recap posting. Sample dates from across
   the whole archive before specifying the parser. *(Correct the draft Blogspot platform note, which
   currently carries the naive rule.)*
2. **Venue labels come in inline (`Start: x`) AND heading-then-next-line (`📍 Start`\n`x`) forms** —
   handle both, full-line-anchored so mid-prose `start …` can't match.
3. **Blogspot backfill: use the KEYED Blogger API (`fetchBloggerPosts`), not the public `/feeds/`
   endpoint** — the public feed truncates at ~150 posts and loses the oldest history.
4. **A multi-year archive will contain source-author errors** (duplicate run numbers, copy-pasted date
   lines) — extract faithfully; merge collapses same-`(kennel, date)` rows; never renumber to satisfy
   a bot.
5. **Keep:** the empty-title body-parse framing, the verbatim upcoming sample + "this is UPCOMING"
   framing, "N+339 absent → don't synthesize," the ASCII-shortName-no-slug-override pre-emption (the
   Asunción trap moved upstream into research), the 5-edit new-country region checklist (emerald for
   Brazil), the H7 frozen-dataset backfill, and alias-collision discipline.
