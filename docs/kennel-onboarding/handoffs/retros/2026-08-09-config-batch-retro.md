# Cowork Handoff Retro — CONFIG BATCH C (Devon Lunatics · Isca H3 · JaxH3 source-add · Mickleover H3) — 2026-08-09

Retro for the four remaining config-only handoffs from the 20-kennel backlog rescue
(`handoffs/retros/2026-08-11-backlog-rescue-retro.md`): `2026-07-21-dlh3-gb`, `2026-07-22-jax-h3`,
`2026-08-05-isca-h3`, `2026-08-09-mickleover-h3`. Built as one batch PR (hc-batch-4/-6/-10/-11
precedent). One small, deliberate code addition (`GoogleSheetsConfig.requireRunNumber`, ~5 lines +
2 tests) — everything else config-only.

**Outcome:** 3 new kennels (`dlh3-gb`, `isca-h3`, `mickleover-h3`) + 1 source-add on an existing
live kennel (`jax-h3`), 2 new UK METRO regions (Exeter — shared by the two Devon kennels; East
Midlands — carried here since the sibling Quorn H3 handoff hasn't shipped yet), 4 self-hosted logos
(all magic-byte verified). Live-verified all 4 sources via `adapter.fetch()` against the exact
shipped `Source` config: 0 errors across all four, correct `kennelTags` resolution, `requireRunNumber`
confirmed dropping every one of Mickleover's blank-run# winter social rows (364/364 events carry a
runNumber). tsc clean, lint 0 errors, full suite green except 5 pre-existing failures in
`london-hash.test.ts`/`hashrego/adapter.test.ts` — confirmed byte-identical to `origin/main`.

---

## A verification-script bug produced a false alarm — worth recording as a pattern

The first live-verify pass for `dlh3-gb` returned only 6 events (should be ~113, the full archive
back to 2018). This looked like a real config problem — `scrapeDays: 3300` silently not reaching the
archive. It wasn't: `GoogleCalendarAdapter.fetch()`, `GoogleSheetsAdapter.fetch()`, and
`ICalAdapter.fetch()` all take `days` as an **`options` parameter, not read from `source.scrapeDays`
internally** (`const days = options?.days ?? 90;`) — only `HarrierCentralAdapter.fetch()` falls back
to `source.scrapeDays` on its own. The real scrape pipeline (`src/pipeline/scrape.ts:353,501`)
always resolves `days` first and passes `{ days, kennelSlugs }` explicitly; my first-pass
verification script called `adapter.fetch(source)` directly and silently got the adapter's own
90-day default instead of the seeded 3300.

> **Verification-script lesson:** when hand-rolling a live-verify script for a non-HC adapter, always
> pass `{ days: source.scrapeDays }` explicitly — don't assume every adapter self-reads it the way
> HC does. A false "archive isn't reaching back" alarm burns time chasing a config bug that doesn't
> exist. Worth a one-line addition to `.claude/rules/live-verification.md` so the next session
> doesn't repeat this.

---

## The handoffs were 3-5 weeks stale — re-verification caught real drift again

Same lesson as hc-batch-11, reconfirmed on a completely different adapter family:

1. **Isca H3's archive grew from 359 to 401 events** (2017-07-28 → 2027-08-11, vs. the handoff's
   2017-07-28 → 2027-07-23) — the site organically added more events in the intervening weeks, both
   forward and (surprisingly) the archive window shifted slightly. Config still handled it cleanly;
   no adjustment needed.
2. **Mickleover's archive grew from #362 to #364** — including two new not-yet-happened placeholder
   rows (#363 "TBD", #364 blank-fields-except-date) that the `requireRunNumber` flag still correctly
   keeps (they carry a real run number, just thin data) while dropping the winter socials.
3. **Jax H3's #1420 event was edited between research and build** — title changed
   ("...Scavenger Hunt" → "...Game Trail") and start time shifted 13:00 → 14:00. The handoff's
   explicit TZID sanity check ("assert #1420 == 13:00") technically "failed" against the *original*
   sample, but the underlying mechanism it was testing — that the mislabeled `TZID=America/Vancouver`
   self-corrects to the wall-clock time actually authored — held perfectly: whatever time is in the
   ICS today (14:00) is exactly what `startTime` returns. This is source data drift, not an adapter
   defect; a live organizer can and does edit trail details up to race day.

---

## What went right

1. **The `requireRunNumber` design held up exactly as the handoff specified.** Live data showed the
   winter-social "marker" text scattered inconsistently across `Info` and the unmapped `Pack Size`
   column — exactly the messiness the handoff called out as `silentlySkipPatterns`'s weakness. The
   code-level fix (gate on the resolved `runNumber` itself, not a text pattern) cleanly dropped all
   11 blank-run# rows regardless of where their marker text lived, confirmed by the live count
   (364 events fetched, 364 carry a runNumber, 0 without).
2. **The "leave hares/title undefined rather than force a wrong split" caution, repeated across both
   `dlh3-gb` and `isca-h3`, was the right call.** Both calendars' summaries jam venue + hare together
   with inconsistent delimiters (a period sometimes, no delimiter other times, "Hare:" occasionally).
   Shipping only a prefix-strip (`titleStripPatterns`) and skipping `titleHarePattern` entirely kept
   the config simple and avoided fabricating wrong hare data — the structured `LOCATION` field is the
   reliable venue source either way.
3. **All collision/alias checks re-verified clean against the current (post-hc-batch-6) seed** — bare
   `dlh3` (Duneland H3), `ih3` (Ithaca H3), and `mh3` (7-way global collision, plus `mh3-gb` freshly
   reserved by the now-shipped Manchester H3) all confirmed still taken exactly as each handoff
   predicted.
4. **Sharing the Exeter METRO between two independently-researched handoffs (`dlh3-gb`, `isca-h3`)
   worked cleanly** — both specified the identical region block, so adding it once in this batch
   satisfies both kennels with no duplicate-METRO risk.
5. **The Mickleover Google Sites `sitesv` logo, flagged in the handoff as session/referer-bound and
   403-prone, downloaded cleanly on the first plain `curl` at build time.** The caution to "grab it
   fresh at build, don't assume it'll still work" was right even though this particular fetch
   succeeded — the token's fragility is real, just not triggered this time.

## Deferred follow-ups

1. **🟡 Mickleover's East Midlands METRO block must match this PR's exactly if/when the Quorn H3
   handoff (`handoffs/2026-08-08-quorn-h3.md`) ships** — same values (violet, abbrev `EML`, centroid
   52.77/-1.21) so the seeder's upsert-by-name is a true no-op, not a duplicate/variant region.

Applied immediately rather than deferred: `.claude/rules/live-verification.md` now documents the
`{days: source.scrapeDays}` requirement above, so the next config-only GCal/Sheets/iCal handoff
doesn't repeat the false alarm.
