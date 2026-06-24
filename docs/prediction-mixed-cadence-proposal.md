# Proposal: model a "mixed per-weekday cadence" in Travel-Mode prediction

**Status:** proposal (design only — implementation deferred to a follow-up PR).
**Motivating data:** Desert H3 (Dubai), onboarded in the same PR as this doc.
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
which projects "possible activity" with `date: null` (`projections.ts:212`) — never enters the
precision metric. Good. **But recall** is computed from actual events lacking a covering
snapshot (`scripts/score-prediction-ledger.ts`), so the ~41% of runs that land on the
unmodelled secondary day count as **recall false-negatives** even though we deliberately chose
not to predict specific dates for them. The metric punishes the honest choice.

---

## 4. Proposal

### Change 1 — *express* the mixed cadence

- Add an optional `confidence?: ScheduleConfidence` to `KennelScheduleRuleSeed`
  (`prisma/seed-data/kennels.ts`). Default stays `HIGH` (current behaviour) so no existing seed
  changes.
- Teach **Pass 3** (`runKennelSeedPass`) to accept `CADENCE=…` sentinel rrules: when the rule's
  rrule is a sentinel, **skip `parseRRule` validation** (which throws on `CADENCE=…` today) and
  honour the rule's `confidence` (LOW for sentinels) — mirroring how Pass 2 already emits them.

This lets a kennel seed a dominant weekday at HIGH **and** a secondary weekday as a LOW
sentinel on the same row set, e.g.:

```ts
scheduleRules: [
  { rrule: "FREQ=WEEKLY;BYDAY=MO", startTime: "19:00", confidence: "HIGH", label: "Monday evening" },
  // NEW LOW sentinel: "also runs some Sundays" — projects "possible activity", never a fixed date.
  { rrule: "CADENCE=WEEKLY;BYDAY=SU", confidence: "LOW", label: "Sunday afternoon (cooler months)" },
],
```

`CADENCE=WEEKLY;BYDAY=SU` is a small addition to the sentinel family
(`CADENCE=BIWEEKLY`/`CADENCE=MONTHLY`) handled in `projections.ts:explainSentinel` — rendered as
"Sometimes runs Sundays — verify closer to your trip", projected as a single `date: null`
possible-activity entry. Because LOW sentinels are never date-scored, the secondary day adds
**zero** false MISSes to precision.

*Alternative considered (Design B):* a single multi-`BYDAY` "one run per week on MO **or** SU"
rule where the engine picks the day per week (by season or most-recent-observed). More
expressive but materially more engine complexity; Design A reuses existing LOW-sentinel
plumbing and is the recommended first step.

### Change 2 — *measure* it fairly

In the recall computation (`scripts/score-prediction-ledger.ts`): when a kennel has an active
LOW `CADENCE=…` sentinel covering weekday *W*, **exclude actual events on weekday *W* from the
recall false-negative denominator** (or bucket them as "cadence-covered, intentionally not
date-predicted"). Optionally add a lightweight **cadence-confirmation** rate — how often the
sentinel's weekday actually saw a run — so the secondary cadence is *observed* without being
*date-scored*. This stops the honest "don't guess the Sunday date" choice from tanking recall.

---

## 5. What ships now (interim) vs the follow-up

**Now (this PR):** Desert H3 is seeded with **flat fields only** — `scheduleDayOfWeek: "Monday"`,
`scheduleFrequency: "Weekly"`, plus a `scheduleNotes` line describing the seasonal Sunday-afternoon
shift. Deliberately **no `scheduleRules` array**, because (a) a HIGH Monday rule would overstate
confidence given Monday is only 59% of runs, and (b) seeding `scheduleRules` would opt the kennel
**out** of the Pass-2 derivation this proposal wants to build on. Flat fields keep it in Pass 2
(a MEDIUM Monday-weekly rule) — clean, no over-projection, the Sunday simply isn't date-predicted
yet. The full 2018–2021 venue history is backfilled so the empirical pattern is in the DB.

**Follow-up (greenlit separately):** implement Change 1 + Change 2, then re-seed Desert H3 with the
explicit `[HIGH Monday, LOW Sunday-sentinel]` pair. Scope/risk: touches `KennelScheduleRuleSeed`,
Pass 3, and the ledger recall path — all of which feed the whole kennel corpus, so it warrants its
own focused PR with its own tests (Pass-3 sentinel acceptance, recall-denominator exclusion).

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
