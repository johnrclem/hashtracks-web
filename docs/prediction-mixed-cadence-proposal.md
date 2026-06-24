# Proposal: model a "mixed per-weekday cadence" in Travel-Mode prediction

**Status:** **Change 1 SHIPPED** (per-rule confidence + Pass-3 CADENCE sentinels + projection rendering + Desert H3 re-seed). **Change 2 (recall) remains deferred** — it depends on a recall computation that does not exist yet (`scripts/score-prediction-ledger.ts` computes precision only; recall is an explicit deferred follow-up there). Precision is already protected by Change 1 (see below).
**Motivating data:** Desert H3 (Dubai), onboarded in #2294.
**Owner area:** `src/lib/travel/projections.ts`, `scripts/backfill-schedule-rules.ts`, `src/pipeline/prediction-ledger.ts`, `scripts/score-prediction-ledger.ts`, `prisma/seed-data/kennels.ts`.

---

## 1. Summary

Onboarding Desert H3 surfaced a real-world schedule shape that HashTracks' schedule
model **cannot express cleanly today**: a kennel that runs roughly **once a week, but
whose run-day alternates between two weekdays** (here Monday-evening ⇄ Sunday-afternoon),
with the secondary day's start time drifting by season/daylight.

The current model can express *either* a single confident weekly cadence *or* an
observed-history low-confidence "cadence sentinel" — but **not a dominant weekday plus a
secondary weekday at a different confidence on the same kennel**. The result is that any
single-rule choice either over-projects (predicts a run every Monday *and* every Sunday →
~2×/week vs ~1×/week actual) or silently under-counts the ~40% of runs that fall on the
secondary day.

This doc (a) documents the gap precisely against the code, (b) proposes a minimal,
data-grounded enhancement to **express** the pattern and to **measure** it fairly in the
prediction ledger, and (c) records what Desert H3 ships with in the interim.

---

## 2. The motivating case — Desert H3 (verified from the live Hare Line)

49 recent runs (2025-07-07 → 2026-06-22) plus the upcoming run #2457 (2026-06-29). One run
per week, but the day and time wobble:

| | Monday | Sunday |
|---|---|---|
| Count (12 months) | **29 (59%)** | **20 (41%)** |
| Start time | always **19:00** | **14:00–18:00** (earlier in deep winter) |
| End time | 22:00 | usually 22:00 |

**It is not cleanly seasonal** (so `validFrom`/`validUntil` season windows don't capture it):

```
2025-07  Mon×4 Sun×0      2025-11  Mon×1 Sun×4      2026-03  Mon×4 Sun×0
2025-08  Mon×3 Sun×2      2025-12  Mon×3 Sun×1      2026-04  Mon×3 Sun×1
2025-09  Mon×3 Sun×1      2026-01  Mon×1 Sun×3      2026-05  Mon×1 Sun×4
2025-10  Mon×2 Sun×2      2026-02  Mon×3 Sun×0      2026-06  Mon×1 Sun×2
```

Both weekdays interleave across most months; Sunday clusters in the cooler months but Monday
never disappears for a clean season block. (The pre-2021 venue-bearing archive — backfilled
by `scripts/backfill-dh3-ae-history.ts`, 151 runs 2018–2021 — ran a steadier 18:30 start, so
the day-alternation is a more recent pattern; the point stands either way.)

---

## 3. Why the current model can't express it

Three mechanisms, each verified against the code:

1. **Flat schedule fields apply one frequency to all days.** `Kennel.scheduleDayOfWeek` +
   `scheduleFrequency` feed Pass 2 (`runKennelDisplayPass`), which emits one rule *per day* at
   the *same* frequency. `scheduleDayOfWeek: "Monday / Sunday"` + `"Weekly"` → two **WEEKLY**
   rules → the engine projects a run *every* Monday **and** *every* Sunday (~2/week) against
   ~1/week actual ⇒ roughly half the projections are MISSes.

2. **Seed `scheduleRules` are hard-pinned to HIGH and opt the kennel out of Pass 2.** Pass 3
   (`runKennelSeedPass`) assigns `confidence: "HIGH"` to every seeded rule
   (`scripts/backfill-schedule-rules.ts:969`), and any kennel that declares a `scheduleRules`
   array is removed from Pass 2's observed-history derivation
   (`scripts/backfill-schedule-rules.ts:773-777`). So you cannot seed a HIGH primary weekday
   **and** let Pass 2 derive a LOW secondary-weekday sentinel for the same kennel — it's one
   or the other.

3. **Seasonal windows don't fit** (see §2 — no clean Mon/Sun season boundary), so the existing
   `validFrom`/`validUntil` multi-cadence mechanism (Flour City, Hockessin) can't model it.

And on the scoring side: the ledger only snapshots **date-bearing** HIGH/MEDIUM projections
(`src/pipeline/prediction-ledger.ts:250` skips `!proj.date`), so a LOW `CADENCE=…` sentinel —
which projects "possible activity" with `date: null` (`projections.ts`) — never enters the
precision metric. **This is the key protection, and Change 1 alone secures it.** A recall metric
(real runs we failed to predict) *would* otherwise count the ~41% of runs on the unmodelled
secondary day as false-negatives — but recall is **not implemented today** (`score-prediction-ledger.ts`
computes precision only and flags recall as a deferred follow-up), so there is no denominator to
fix yet. Change 2 is the design note for when recall is built.

---

## 4. Proposal

### Change 1 — *express* the mixed cadence  ✅ SHIPPED

- ✅ Added optional `confidence?: "HIGH" | "MEDIUM" | "LOW"` to `KennelScheduleRuleSeed`
  (`prisma/seed-data/kennels.ts`). Defaults to `HIGH` for a parseable RRULE (no existing seed changes).
- ✅ **Pass 3** (`planSeedRule` in `scripts/backfill-schedule-rules.ts`) now detects `CADENCE=…` /
  `FREQ=LUNAR` sentinels (`isCadenceSentinel`), stores them **verbatim** (never `normalizeRRule`,
  which would reorder `CADENCE` to the tail and break the engine's `startsWith` checks), and forces
  LOW confidence; parseable rules honour `rule.confidence ?? "HIGH"`.
- ✅ `projections.ts:explainSentinel` renders `CADENCE=WEEKLY;BYDAY=XX` as
  "Sometimes runs on {Day}s — verify closer to your trip" (projected as a single `date: null`
  possible-activity entry, like the other sentinels).

A kennel can now carry a dominant dated day **and** an occasional LOW secondary weekday on the
same row set. Desert H3 ships as:

```ts
scheduleRules: [
  { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "19:00", confidence: "MEDIUM", label: "Monday evening (most weeks)" },
  // LOW sentinel: "sometimes Sundays" — possible activity, never a fixed/snapshotted date.
  { rrule: "CADENCE=WEEKLY;BYDAY=SU", confidence: "LOW", label: "Sunday afternoon (cooler months)" },
],
```

Monday is **MEDIUM, not HIGH** — it's the plurality (59%) but not every week, so HIGH would
overstate it. End-to-end projection (verified): four dated MEDIUM Mondays over four weeks +
one `date: null` "Sometimes runs on Sundays" possible-activity. Because LOW sentinels are never
date-scored, the Sunday adds **zero** false MISSes to precision.

*Alternative considered (Design B):* a single multi-`BYDAY` "one run per week on MO **or** SU"
rule where the engine picks the day per week. More expressive but materially more engine
complexity; Design A reuses the existing LOW-sentinel plumbing and is what shipped.

### Change 2 — *measure* it fairly  ⏸ DEFERRED (blocked on recall existing)

Recall is **not implemented** — `scripts/score-prediction-ledger.ts` computes precision only and
explicitly flags recall as a deferred follow-up. There is no recall denominator to fix today, so
building this now would be speculative against non-existent code. Precision is already protected
by Change 1 (LOW sentinels never snapshotted), which was the actual pollution risk.

When recall **is** built, it must treat a real event on a weekday covered by an active LOW
`CADENCE=…` sentinel as **"cadence-covered", not a false-negative** (optionally tracking a
lightweight cadence-confirmation rate). A forward-looking note to that effect is left in
`scripts/score-prediction-ledger.ts` so the future implementer sees it where recall will live.

---

## 5. Status & history

**Onboarding (#2294):** Desert H3 shipped with **flat fields only** (Pass-2 MEDIUM Monday rule), the
Sunday shift in `scheduleNotes`, and the full 2018–2021 venue history backfilled — a clean interim
that didn't over-project while this enhancement was designed.

**This change:** Change 1 implemented (per-rule confidence + Pass-3 sentinel acceptance + projection
rendering) with TDD (`planSeedRule` + `projectTrails`/`explainSentinel` tests), and Desert H3
re-seeded with the explicit `[MEDIUM Monday, LOW Sunday-sentinel]` pair. The kennel page + Travel
Mode now surface "usually Mondays 7 PM" as dated MEDIUM projections plus "sometimes Sundays" as
possible activity. **Post-merge: `npx prisma db seed` re-runs Pass 3** to write the two rules to prod
(replacing the interim single Pass-2 Monday rule).

**Still open:** Change 2 (recall) — deferred until a recall metric is built (see §4).

---

## 6. Appendix — raw schedule sample (live Hare Line, 2025-07 → 2026-06)

```
2025-08-17 Sun 19:00   2025-11-09 Sun 16:30   2026-01-11 Sun 14:00   2026-05-10 Sun 17:30
2025-08-31 Sun 18:00   2025-11-16 Sun 16:30   2026-01-25 Sun 17:00   2026-05-24 Sun 17:00
2025-09-07 Sun 18:00   2025-11-30 Sun 16:00   2026-04-19 Sun 15:00   2026-05-31 Sun 17:00
2025-10-12 Sun 15:45   2025-12-14 Sun 16:00   2026-05-03 Sun 16:00   2026-06-07 Sun 18:00
2025-10-19 Sun 15:45   2026-01-04 Sun 16:00                          2026-06-14 Sun 18:00
(all other weeks: Monday 19:00–22:00)
```
