# Cowork Handoff Retro — Cluster 1 (Herts H3 · F.U.K Full Moon H3 · Bicester H3) — 2026-08-14

Retro for the first Phase-2 bespoke-adapter batch: `handoffs/2026-08-01-herts-h3.md` and
`handoffs/2026-08-02-fukfm.md` (both part of the 20-kennel backlog rescued in
`handoffs/retros/2026-08-11-backlog-rescue-retro.md`), plus `handoffs/2026-08-14-bicester-h3.md`
(same-day handoff, folded into this cluster's PR at build time rather than deferred to its own
batch). Two new bespoke `HTML_SCRAPER` adapters + one config-only `ICAL_FEED`.

**Outcome:** 3 kennels onboarded (Herts H3 + Bicester H3 new; FUKFM source-add on an already-seeded
kennel). 2 new METROs (Hertfordshire, Bicester — no new country/inference needed, UK already
covers `england`). 3 self-hosted logos, all magic-byte verified PNG. 2 historical backfills shipped
(Herts 269 runs, Bicester 418 runs — not deferred, per the project's "include historical data" rule).
tsc clean, lint 0 errors on all changed files, full test suite green (10,027 passed). Live-verified
all 3 sources against real production URLs: 0 errors, all kennelTags resolved with no unmatched.

---

## Herts H3 and F.U.K Full Moon H3 share a platform but NOT a row-parser

Both sites are the same legacy MS-Office/FrontPage "Save as Web Page" export, but their tables have
genuinely different column layouts (Herts: 7 columns, kennel+run designator first; FUKFM: 5 columns,
bare run number first, no kennel-name repetition since it's single-kennel). Forcing a single unified
row parser would have meant a lot of conditional branching for little reuse. What's actually shared
is small, mechanical stuff: `parseHrsTime` ("11:00Hrs"/"Noon"/"7pm" → "HH:MM") and `isPlaceholderCell`
("TBC"/"Hares Required"/... → true) — factored into `legacy-frontpage-utils.ts`, imported by both
adapters. **Lesson for future "shared platform" handoffs: check whether the column *shapes* actually
match before committing to one parser — sharing narrow utility functions is often the right level,
not a unified row-to-RawEventData function.**

## Real fixtures caught two genuine bugs the handoff's illustrative samples wouldn't have

Per `.claude/rules/live-verification.md` and the fukfm handoff's own explicit instruction ("Build the
test fixture from real `curl -s` output, NOT this file's rendered sample — the sandbox `curl`/
`web_fetch` differ; these FrontPage pages wrap cells in MS-Office `<p>`/`<b>`/`<span>` runs with
`&nbsp;`/`<br>` that a clean-text sample hides"), both adapters' tests were built from real curl'd
HTML trimmed to representative rows, not hand-written markup. This caught:

1. **🔴 `isPlaceholderCell` didn't handle stacked placeholder phrases.** FUKFM row #500's hares cell
   has "TBC" and "Limited Numbers" as two separate `<p>` lines inside one `<td>`, which
   whitespace-collapse into `"TBC Limited Numbers"` — a string my first-pass anchored regex
   (`^\s*(tbc|...)\s*$`) didn't match, so the combined junk string leaked through as a literal hare
   name. Fixed by switching to procedural phrase-stripping (strip every known placeholder phrase,
   check if anything non-whitespace remains) — also keeps it Sonar S5852/S5843-safe (no nested `\s*`
   in alternation).
2. **🔴 Bicester's backfill run-number regex matched an HTML entity, not a run number.** One 2026
   description read `"Runner Bean&#8217;s first trail for BH3!"` — before HTML-unescaping,
   `#\s*(\d+)` matched `#8217` (the entity's own numeric code) as if it were the run number. Fixed by
   always `html.unescape()`-ing title/description *before* any `#`-anchored regex, and preferring the
   TITLE (which follows one of three eras' clean run-number-bearing formats) over free-prose
   DESCRIPTION as the primary extraction source.

Neither bug would have surfaced against a hand-typed "clean" fixture — both are exactly the kind of
messy-real-world-markup issue the live-verification rule exists to catch.

## Bicester's TEC REST archive has three description/title eras — extraction needed a fallback chain

The handoff's field-fill table described one shape (`description = "<p># NNNN</p>"`, run number in
description). The fuller 2018→2026 pull surfaced two more eras the handoff's narrower sample didn't
hit: a 2019–2025 era where the run number moved into the *title* (`"#2424 Hare is Daglocks."`), and a
2026 era matching the live iCal SUMMARY exactly (`"Trail # 2695 - Deadloss - Cumnor, The Vine Inn"`,
empty description). Final extraction order: title `#\s*(\d+)` → description `#\s*(\d+)` → title
`^Trail\s+(\d+)` (2 outlier titles that omit the `#` entirely). Hares: prefer the structured
`organizer[]` API field (works across all eras when populated); fall back to the same dash-delimited
title pattern the live source's `titleHarePattern` config already uses, for the 2026-era rows where
`organizer` is empty. **Lesson: when a handoff samples a REST API's *upcoming* window only, expect the
full historical pull to reveal earlier-era shape drift — budget for a fallback chain, not a single
regex, when building the backfill parser.**

## Two documented-but-unresolved date/run-number anomalies shipped as-is

Herts's #2179 ("5th October 2025" sitting between two September 2025 runs) was flagged by the
original handoff as likely wrong but with no independently verifiable correction. Bicester's #2425
(2020-07-06) → #2409 (2020-07-13) — a run-number regression the fuller pull surfaced fresh, not in
the original handoff. Both ship verbatim (Douliu `#193`-dup / Prague `EventNumber`-typo precedent:
faithful source data beats an invented "fix" with no independent verification). The 5 *documented*
Herts typos (run #2167/#2160 year, #1960→#2060 run-number, #2000 year, #1904 year-inference) DID get
corrected, since the original handoff's sequence-position reasoning for each is itself the
independent verification — the difference is having a specific, reasoned correction versus just an
"this looks odd" flag.

## FUKFM was seeded-but-dark for reasons unrelated to this batch

`fukfm` has existed in `kennels.ts` for a while with no `Source` row, so `/kennels/fukfm` 404'd —
the same "kennel row exists, source never shipped" pattern jax-h3 hit in Config Batch C. Its
`scheduleNotes` was also stale (said "Every full moon evening, 7:30 PM"; the live hareline shows the
club re-formed as a Saturday-noon pub-crawl series — "We're back in black"). Both fixed in the same
pass as the source-add, per the handoff's explicit field-correction section.

## Post-merge runbook (not yet run — separate step after PR merges)

- `npx prisma db seed` (additive) publishes `herts-h3` + `bicester-h3` (new kennels) and adds the
  `fukfm` source (kennel already seeded).
- Run both backfill scripts with `BACKFILL_APPLY=1` — Herts 269 rows, Bicester 418 rows.
- Trigger scrapes for all 3 sources from `/admin/sources`.
- Spot-check `/kennels/herts-h3`, `/kennels/fukfm`, `/kennels/bicester-h3` for event counts + logos.
