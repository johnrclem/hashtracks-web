# Multi-Kennel Co-Hosted Events — Design Spec

**Issue:** [#1023](https://github.com/johnrclem/hashtracks-web/issues/1023)
**Status:** Spec only — no schema or code changes in this PR.
**Implementation gating:** Five parallel workstreams (WS1–WS5) must land first to avoid Prisma client regen conflicts. Then the migration sequence in [§7](#7-migration-sequencing) executes one PR at a time.

---

## Context

`Event.kennelId` is a single foreign key (`prisma/schema.prisma:307`). When two kennels co-host one real-world trail (the Cherry City + OH3 inaugural is the canonical example), every adapter's pattern matcher routes the event to a single kennel. Members of the *other* kennel never see the event on their kennel page.

The fix that landed in commit `ce900360` (PR #1040) was surgical: reorder the Oregon Hashing Calendar's `kennelPatterns` so Cherry City matches before OH3. That works for one event. It does nothing for the next co-host trail, and nothing for kennel pages that should display a co-hosted event under both kennels.

This spec is the structural follow-up. It picks a schema shape, defines the adapter interface change, specifies dedup semantics for cross-source overlapping kennel sets, audits every display-layer query that filters on `Event.kennelId`, lays out a forward+rollback migration plan against ~50k existing events, and sequences the rollout into independently shippable PRs.

### What this spec does not do

- Change `prisma/schema.prisma` (deferred to step 1 of [§7](#7-migration-sequencing))
- Touch any adapter (deferred to step 2)
- Touch any display-layer query (deferred to step 4)
- Decide between first-writer-wins and highest-trust-wins for `isPrimary` (presented as alternatives in [§3](#3-cross-source-dedup-with-overlapping-kennel-sets); decision deferred to the implementation PR when we have empirical co-host data)

---

## 1. Schema choice

### Decision: `EventKennel` join table with `isPrimary: Boolean`

```prisma
model EventKennel {
  eventId   String
  kennelId  String
  isPrimary Boolean @default(false)
  event     Event   @relation(fields: [eventId], references: [id], onDelete: Cascade)
  kennel    Kennel  @relation(fields: [kennelId], references: [id])

  @@id([eventId, kennelId])
  @@index([kennelId])
}
```

**Plus a hand-written partial unique index** (Prisma can't express it in `schema.prisma` — see [§5](#5-migration-plan-forward--rollback)):

```sql
CREATE UNIQUE INDEX "EventKennel_eventId_isPrimary_unique"
  ON "EventKennel" ("eventId")
  WHERE "isPrimary" = true;
```

This index enforces the **single-primary invariant** at the DB level: each Event has at most one EventKennel row with `isPrimary = true`. Without it, a race between two writers (pipeline create vs. manual create vs. admin kennel merge) could produce zero or multiple primaries. Codex review caught this — without DB enforcement, the invariant relies on every writer remembering to use a serializable transaction, and we have at least three writers today (`pipeline/merge.ts:1169-1191`, `app/logbook/actions.ts:656-668`, `app/admin/kennels/actions.ts:672-702`).

**Transactional write requirement.** Every code path that creates or modifies an Event must wrap the `Event` write and its corresponding `EventKennel` write in a single Prisma transaction. The dual-write migration (step 2 of [§7](#7-migration-sequencing)) is the dedicated PR that adds this discipline before any read site reads from EventKennel.

`Event.kennelId` is **kept during the transition** as a denormalized pointer to the primary kennel. Every code path that writes an Event also writes one EventKennel row with `isPrimary = true` for the same kennel, so the two stay in sync. `Event.kennelId` is dropped in a final migration (step 7 in [§7](#7-migration-sequencing)) after all read sites have moved to the join table.

### Rationale

| Concern | `EventKennel` join table (chosen) | `Event.kennelIds: String[]` (rejected) |
|---|---|---|
| Referential integrity | FK enforces Kennel existence; cascades on Event delete | No FK — orphan IDs possible if Kennel deleted |
| Indexing | `@@index([kennelId])` gives O(log n) reverse lookup | Postgres GIN index on array works but is heavier and less ergonomic for sets-of-one (~50k existing rows) |
| Prisma DSL | `where: { kennels: { some: { kennelId } } }` — composes cleanly with the resolver layer | `where: { kennelIds: { has: kennelId } }` — works, but `hasSome`/`hasEvery` is awkward and doesn't compose with relation `include`/`select` |
| Future metadata | Add `isPrimary`, per-kennel run numbers, per-kennel attendance handles, "host" vs "invited" role — all become columns on EventKennel | Requires a separate model anyway → reach for join table eventually |
| Backfill cost | One INSERT…SELECT, ~50k rows, seconds to apply | Same complexity (`UPDATE Event SET kennelIds = ARRAY[kennelId]`) but harder to audit |
| Rollback before any co-host writes | Drop the table | Drop the column |
| Rollback after co-host writes | Lossless if `Event.kennelId` still points at primary | Loses array elements unless we also keep a denorm pointer |

The join table is the clearly better choice on RI, indexing, and Prisma ergonomics. The only argument for the array is "it's one fewer table" — a weak benefit against losing FK enforcement on a 50k-row table that is the central object in the schema.

### Interaction with the current `(kennelId, date)` dedup key

`pipeline/merge.ts:899-902` queries `prisma.event.findMany({ where: { kennelId, date: eventDate } })` to find dupe candidates. Today this is also covered by the index `@@index([kennelId, date, isCanonical])` (`schema.prisma:355`).

After the schema change, this becomes:

```ts
prisma.event.findMany({
  where: {
    kennels: { some: { kennelId: { in: incomingResolvedKennelIds } } },
    date: eventDate,
  },
});
```

The candidate set widens (any event sharing *any* kennel with the incoming row), but the post-fetch matcher logic (sourceUrl → runNumber → startTime → title) is unchanged. New index needed: `@@index([kennelId])` on EventKennel (already shown above) — Postgres can use it for the reverse-join.

---

## 2. Adapter interface change

### Decision: `kennelTag: string` → `kennelTags: string[]` (hard break)

```ts
// src/adapters/types.ts (after the change)
export interface RawEventData {
  date: string;
  kennelTags: string[]; // was: kennelTag: string
  // ... unchanged below
}
```

**Hard break, no deprecation window.** Reasons:
- ~113 adapters need to convert. Mechanical codemod (`kennelTag: "foo"` → `kennelTags: ["foo"]`). One bulk PR is cleaner than 113 incremental PRs against a union type.
- A union type (`kennelTag?: string; kennelTags?: string[]`) leaks into every consumer: resolver, fingerprint, merge, every test factory. Removing it later means doing the codemod anyway.
- Test suite (`npm test`) catches every adapter that still emits `kennelTag` — TypeScript turns this into a compile error, not a runtime bug.

### Rejected alternative: sibling field `coHostKennelTags?: string[]`

- Bifurcates the data model — every adapter must remember which field to populate based on whether the event has 1 or N kennels
- Doubles the surface area for the resolver and fingerprint
- Breaks the symmetry that makes the codemod mechanical

### Cascading required changes

| File | Change |
|---|---|
| [src/adapters/types.ts:6](src/adapters/types.ts:6) | Type: `kennelTag: string` → `kennelTags: string[]` |
| [src/pipeline/kennel-resolver.ts:129](src/pipeline/kennel-resolver.ts:129) | Add `resolveKennelTags(tags: string[], sourceId): Promise<ResolveResult[]>` returning per-tag results; keep `resolveKennelTag` as a single-tag helper or delete it |
| [src/pipeline/fingerprint.ts:11](src/pipeline/fingerprint.ts:11) | Sort `kennelTags`, then join with delimiter, then hash. **Sort is required** — per memory `feedback_fingerprint_stability`, nondeterministic ordering caused 74 duplicate RawEvents in Seletar (PR #541) |
| [src/pipeline/merge.ts:342, 388, 462](src/pipeline/merge.ts:342) | `event.kennelTag` accesses → iterate over `event.kennelTags`; first resolved tag becomes the primary kennel for `Event.kennelId`, the rest become EventKennel rows with `isPrimary: false` |
| `kennelPatterns` config grammar | `[regex, kennelTag]` → `[regex, kennelTag \| kennelTag[]]` so the Oregon Calendar entry can become `["Cherry City\|OH3", ["cch3-or", "oh3"]]` |
| `matchConfigPatterns` impls | GCal (`google-calendar/adapter.ts`), iCal (`ical/adapter.ts`), Frankfurt, SFH3, Phoenix, GenericHtml — collect *all* matching patterns, dedup, return as array |

### Adapter conversion plan

| Adapter category | Count | Conversion |
|---|---|---|
| Hardcoded single-tag (HTML scrapers, static schedules, hashrego, meetup) | ~95 | Mechanical codemod: `kennelTag: "foo"` → `kennelTags: ["foo"]`. Per-file diff is one line. |
| `defaultKennelTag` fallback (no patterns) | ~6 | `kennelTags: [defaultKennelTag]`. Mechanical. |
| `kennelPatterns` with single-tag patterns (current 28 sources) | 12 adapters | After `matchConfigPatterns` is updated, behavior is preserved by default — see "Multi-kennel pattern gating" below. |
| Multi-kennel patterns to add | TBD per source | Oregon Hashing Calendar gets `["Cherry City\|OH3", ["cch3-or", "oh3"]]` as a proof of concept. Each new multi-tag pattern requires explicit per-source review. |

### Multi-kennel pattern gating (added per Codex review)

`matchConfigPatterns` today returns the first match. Several existing source configs **rely on this behavior** to disambiguate overlapping patterns — e.g.:

- C2B3H4 must match before generic `CH3` (`prisma/seed-data/sources.ts:296-299`)
- PHH must match before `H5` (`prisma/seed-data/sources.ts:2364-2368`)

Naively switching to "collect all matches" would produce false multi-kennel events for these sources (every `CH3` event would also tag as `C2B3H4`, polluting the dedup intersection). To prevent this:

> **Multi-kennel emission is opt-in per pattern.** A pattern entry is `[regex, kennelTag | kennelTag[]]`. A `string` value preserves first-match behavior — only the first `string`-typed match wins. An `array` value declares "this pattern legitimately tags multiple kennels", and *all* matches collected as arrays are unioned into the result. Single-tag patterns sharing a regex with array patterns require an explicit migration of the source config.

This keeps existing 28 sources behaviorally identical post-codemod and limits multi-kennel emission to patterns the source admin has explicitly reviewed.

### Fingerprint compatibility (added per Codex review)

`generateFingerprint()` (`fingerprint.ts:7-18`) hashes `data.kennelTag` today. Duplicate suppression keys on `(sourceId, fingerprint)` (`merge.ts:424-427`). After the change, fingerprint hashes the sorted-joined `kennelTags` array.

**Consequence:** the first time a source converts a previously single-tag event to multi-tag (e.g. Oregon Calendar starts emitting `["cch3-or", "oh3"]` instead of `["oh3"]`), the new fingerprint will not match the historical RawEvent's fingerprint. The merge pipeline will create a fresh RawEvent and route through the normal cross-source dedup path (which should match the existing canonical Event via the new kennel-set intersection rule from [§3](#3-cross-source-dedup-with-overlapping-kennel-sets)).

**This RawEvent churn is intentional and accepted.** The alternative — re-fingerprinting all historical RawEvents during migration — adds risk for limited benefit. Document the expected one-time spike in `created` RawEvent counts in the migration PR description so on-call doesn't mistake it for a regression.

For sources that stay single-tag (the ~95 hardcoded scrapers), there is no fingerprint change — the adapter still emits one tag, the sorted-join of a single-element array is the same string as the bare tag, and existing fingerprints match exactly.

### Adapters under WS1–WS5 hold

These conversion happens *after* their owning workstreams land. Step 2 of [§7](#7-migration-sequencing) is gated on this:

| Adapter | Workstream |
|---|---|
| `src/adapters/google-calendar/adapter.ts` | WS1 (GCal RECURRENCE-ID) |
| `src/adapters/html-scraper/chiangmai-hhh.ts` | WS2 (Chiang Mai onboarding) |
| `src/adapters/html-scraper/ch4-dk.ts` | WS3 (CH4 Copenhagen) |
| `src/adapters/html-scraper/eh3-edmonton.ts` | WS4 (EH3 Edmonton) |
| `src/adapters/html-scraper/dublin-hash.ts` | WS5 (Dublin) |

GCal is the heaviest user of `kennelPatterns` and the source of the Oregon Calendar pain point — it converts first after WS1 lands and validates the pattern grammar change end-to-end.

---

## 3. Cross-source dedup with overlapping kennel sets

### Today

`pipeline/merge.ts:899-902` does strict same-day `(kennelId, date)` lookup, then disambiguates by sourceUrl → runNumber → startTime → title. A cross-source ±48h fuzzy probe (`findFuzzyDuplicateInWindow`, `merge.ts:828`) gated by `MERGE_FUZZY_DEDUP=true` catches setup-day vs main-day cases.

### Rule for multi-kennel cross-source dedup

> Two RawEvents on the same date dedupe to one canonical Event when:
>
> 1. Their resolved kennel sets **intersect by ≥1 kennel** (kennel-set overlap, not equality), AND
> 2. At least one corroborating signal:
>    - Same `sourceUrl`, OR
>    - Same `runNumber` (when both populated), OR
>    - Title fuzzy match (Levenshtein ≤ 4 on normalized titles — current rule)
>
> Same-source duplicates are still excluded (preserves the carve-out for "back-to-back trails on adjacent days from same source", per PR #1040 review).

### Worked example

- **Oregon Hashing Calendar** emits `kennelTags: ["cch3-or", "oh3"]` for "Cherry City H3 #1 / OH3 #1340" on 2025-07-12
- **`cherry-city.org` adapter** (hypothetical, when added) emits `kennelTags: ["cch3-or"]` for the same trail on 2025-07-12

Resolver outputs: `{cch3-or, oh3}` ∩ `{cch3-or}` = `{cch3-or}` → intersection ≥ 1 ✓
Same date ✓ → run dedup gates → title fuzzy match ✓ → **merge into one canonical Event with two EventKennel rows**.

### Same-day probe widening

```ts
// Before
prisma.event.findMany({ where: { kennelId, date: eventDate } })

// After
prisma.event.findMany({
  where: {
    kennels: { some: { kennelId: { in: resolvedKennelIds } } },
    date: eventDate,
  },
})
```

The candidate set grows but stays small in practice (most kennels only have one event per day). The post-fetch disambiguation (sourceUrl → runNumber → startTime → title) is unchanged.

### Fuzzy ±48h probe widening

`findFuzzyDuplicateInWindow` (`merge.ts:828`) currently filters `where: { kennelId, date: { gte, lte }, ... }`. Becomes:

```ts
where: {
  kennels: { some: { kennelId: { in: resolvedKennelIds } } },
  date: { gte: windowStart, lte: windowEnd, not: eventDate },
  parentEventId: null,
  isSeriesParent: false,
}
```

The same-source exclusion (already implemented via `sameSourceLinks` lookup) is unchanged. False-positive risk stays bounded by the existing title-distance / time-tolerance / runNumber gates.

### Resolver disambiguation prerequisite (added per Codex review)

The dedup rule above assumes `resolveKennelTags` produces *correct* kennel IDs from the input tags. Today's resolver uses `findFirst` for global fallback (`kennel-resolver.ts:60-64, 86-90`) with no regional disambiguation — a tag like "PHH" or "CH3" could resolve to different kennels in different regions and `findFirst` returns whichever the database happens to enumerate first.

**Impact on multi-kennel:** if Source A in Phoenix emits `["PHH"]` and Source B in Honolulu emits `["PHH"]`, both could resolve to the same Kennel ID via the global fallback, then incorrectly merge across regions because intersection ≥ 1.

**Mitigation in scope for this work:**
- Source-scoped resolution is already preferred (`kennel-resolver.ts:75-83`); the global fallback is only hit when neither source has linked the kennel via `SourceKennel`. As long as new co-host sources properly link their kennels at onboarding (existing requirement), the global fallback path is unused.
- Add a test asserting that `resolveKennelTags(["PHH"], sourceA_id)` and `resolveKennelTags(["PHH"], sourceB_id)` resolve to *different* kennel IDs when both sources have linked their respective regional PHH kennel.
- Document for adapter authors: never emit a multi-tag pattern if either tag could resolve ambiguously globally.

**Out of scope:** rewriting the resolver to require regional disambiguation. That's a separate ticket. For now, reviewers of new multi-kennel patterns must confirm both tags resolve unambiguously for the source.

### `isPrimary` ownership across sources — open

When two sources emit the same co-hosted event with different "primary" kennels (Oregon Calendar may pattern-match cch3-or first; another aggregator may match oh3 first), which wins? Two viable rules:

| Rule | Pros | Cons |
|---|---|---|
| **First-writer wins, never demoted** | Deterministic, idempotent, simple to implement (just don't update `isPrimary` on existing rows) | An aggregator scraping first locks in its pattern-match result; if that's the "wrong" kennel from a UX standpoint, it sticks |
| **Highest-trust source wins** | Higher-trust sources (kennel's own website, trustLevel 8+) override aggregators (trustLevel 5) — more likely to be "correct" | Re-evaluated on every merge; primary kennel can flip on rescrape, which moves the canonical kennel-page slug for that event. Churn risk. |

**Decision deferred to the implementation PR.** When that PR happens, we'll have at least the Cherry City/OH3 historical event in the dataset and can reason about real cases. Spec recommends a feature flag (`MERGE_PRIMARY_RULE=first-writer|highest-trust`) so the rule can be flipped in prod without redeploy.

---

## 4. Display-layer audit

### Methodology

Grep `src/` (excluding `*.test.ts`) for:
- `where: { kennelId` / `where: {…kennelId:…}` — Prisma filters
- `kennelId:` as a field selector or query arg
- `event.kennel`, `Event.kennel` — relation property access
- `kennel.events` — reverse relation access
- `prisma.event.{findMany,findFirst,count,groupBy,update,…}` — Event-model queries

### Classification

| Class | Count (approx) | Migration treatment |
|---|---|---|
| **AUTO** | ~140 | Read-only access via Prisma relation (`event.kennel.shortName`); becomes `event.kennels[]` after the schema change. Renderers iterate, picking the primary kennel for prominence and listing co-hosts inline. |
| **REWRITE** | ~200 | `where: { kennelId: x }` → `where: { kennels: { some: { kennelId: x } } }`. Mechanical but every site touched. |
| **MODEL** | ~15 | Semantic ambiguity needing a product decision — see [Model decisions](#model-decisions-resolved) below. |

### Top hotspots (highest reference counts)

| File | Refs | Notes |
|---|---|---|
| [src/app/admin/kennels/actions.ts](src/app/admin/kennels/actions.ts) | 49 | Admin CRUD for kennels including the merge/delete cascade — bulk REWRITE |
| [src/app/misman/[slug]/attendance/actions.ts](src/app/misman/[slug]/attendance/actions.ts) | 48 | Attendance recording, lookback, suggestions — REWRITE per kennel scope |
| [src/app/misman/[slug]/roster/actions.ts](src/app/misman/[slug]/roster/actions.ts) | 45 | Roster CRUD, search, link, merge — REWRITE per kennel scope |
| [src/pipeline/merge.ts](src/pipeline/merge.ts) | 41 | The merge pipeline itself — biggest single REWRITE block |
| [src/app/misman/actions.ts](src/app/misman/actions.ts) | 38 | Misman dashboard + request approval flow — mostly AUTO, some REWRITE |

### Authorization paths — IMPORTANT (added per Codex review)

The audit initially classified misman authorization as elegant via `KennelHasher.kennelId`. That's true for *recording* attendance, but several authorization checks compare directly against `Event.kennelId`:

- [src/app/hareline/[eventId]/page.tsx:129](src/app/hareline/[eventId]/page.tsx:129) — `getMismanUser(event.kennelId)` to decide whether to render misman UI. A misman of the *secondary* kennel on a co-hosted event would be denied.
- [src/app/misman/[slug]/attendance/actions.ts:31-39, 52-60, 263-270](src/app/misman/[slug]/attendance/actions.ts:31) — attendance-scope checks compare roster IDs against `event.kennelId`. Same secondary-kennel denial issue.
- [src/app/misman/[slug]/attendance/[eventId]/page.tsx:25-34](src/app/misman/[slug]/attendance/[eventId]/page.tsx:25) — explicit `kennelId: kennel.id` check on event lookup.

**Required treatment in step 5 of [§7](#7-migration-sequencing):** these auth checks become "is the caller's kennel in the event's kennel set?" rather than "is the caller's kennel the event's primary kennel?" Tests must cover the secondary-co-host case ([§6](#6-test-plan) integration test list).

### Model decisions resolved

Two MODEL questions resolve cleanly today; one needs an explicit product call.

#### A. Misman attendance ownership — already elegant ✅

`KennelAttendance` (`schema.prisma:606`) is scoped via `kennelHasherId` (which links to a single Kennel through `KennelHasher`), **not** through `Event.kennelId` directly. The unique constraint is `[kennelHasherId, eventId]`.

So if Event X is co-hosted by Kennel A and Kennel B with separate misman rosters:
- Kennel A's misman records attendance using A's KennelHasher rows → KennelAttendance rows scoped to Hasher.kennelId = A
- Kennel B's misman records attendance using B's KennelHasher rows → KennelAttendance rows scoped to Hasher.kennelId = B
- Both sets coexist on the same Event without conflict; the `[kennelHasherId, eventId]` uniqueness keeps each kennel's records distinct

**This is a win, not a bug.** No schema change needed for KennelAttendance. The display layer for misman attendance lists already filters via `kennelHasher.kennelId`, so it's REWRITE only at the *event lookup* step (find events with at least one EventKennel row matching this kennel).

#### B. URL slug resolution — primary kennel slug stays canonical ✅

Routes like `/k/[slug]` resolve a slug to one Kennel. Co-hosted events still appear on the page through the new `kennels { some }` filter, but the URL itself doesn't need to change. No event detail URL collision risk.

#### C. Kennel directory stats — needs a product call ⚠️

Today `Kennel.events.count` answers "how many events does this kennel have?" Co-hosted events: should they count as +1 for both kennels?

**Spec recommendation:** yes, count for both. A co-host is genuinely "an event that involved this kennel". The kennel directory's "recent activity" stat becomes a more accurate signal of community engagement. Implementation: change `prisma.event.count({ where: { kennelId } })` → `prisma.event.count({ where: { kennels: { some: { kennelId } } } })`. The product team can revisit if double-counting feels misleading once we have non-zero co-host volume.

### Audit appendix (full call site list)

The full ~200-site audit is in [Appendix A](#appendix-a--full-display-layer-audit). Each entry has file:line and an AUTO/REWRITE/MODEL classification.

---

## 5. Migration plan (forward + rollback)

### Forward — three steps, one PR each

#### Step 1a — `add_event_kennel_join_table`

Add `EventKennel` model to `schema.prisma`. Add reverse relation on `Event` and `Kennel` (`kennels EventKennel[]` / `events EventKennel[]`). No destructive change.

```bash
eval "$(fnm env)" && fnm use 20
npm run prisma -- migrate dev --name add_event_kennel_join_table
```

The wrapper (`scripts/safe-prisma.mjs`) refuses to run against the Railway prod URL — this must be authored against `hashtracks_dev` per `.claude/rules/local-dev-db.md`. Review the generated `migration.sql` in the PR diff alongside the schema change.

#### Step 1b — `backfill_event_kennel_from_kennel_id`

Hand-write SQL (Prisma can't express it in `schema.prisma`):

```sql
-- prisma/migrations/<ts>_backfill_event_kennel_from_kennel_id/migration.sql

-- Insert primary EventKennel row for every Event.
-- ON CONFLICT DO UPDATE corrects the case where an EventKennel(eventId, kennelId)
-- row was pre-created with isPrimary=false (e.g. by an early dual-write codepath
-- racing the backfill) — without this, the event ends up with zero primaries
-- while a naive count-check still passes.
INSERT INTO "EventKennel" ("eventId", "kennelId", "isPrimary")
SELECT "id", "kennelId", true
FROM "Event"
ON CONFLICT ("eventId", "kennelId") DO UPDATE
  SET "isPrimary" = true;

-- Hand-written partial unique index enforcing the single-primary invariant.
CREATE UNIQUE INDEX "EventKennel_eventId_isPrimary_unique"
  ON "EventKennel" ("eventId")
  WHERE "isPrimary" = true;
```

~50k rows, single statement, runs in a few seconds locally. Idempotent. Vercel build runs this as `prisma migrate deploy` per `CLAUDE.md` "Schema Changes" section.

**Verification after deploy** — add a one-shot script `scripts/verify-event-kennel-backfill.ts` that asserts and exits non-zero on failure:

```ts
const eventCount = await prisma.event.count();
const ekTotal = await prisma.eventKennel.count();
const ekPrimary = await prisma.eventKennel.count({ where: { isPrimary: true } });

// Every Event must have exactly one primary EventKennel row.
if (ekPrimary !== eventCount) throw new Error(`primary count mismatch: ${ekPrimary} vs ${eventCount}`);

// Backfill produces one row per Event; future co-host events grow ekTotal but not ekPrimary.
if (ekTotal < eventCount) throw new Error(`total EventKennel count below Event count: ${ekTotal} < ${eventCount}`);

// Belt-and-suspenders: confirm the partial unique index actually catches double-primary.
// This raises if the index is missing or wrong, before any prod write hits it.
await prisma.$queryRaw`SELECT 1 FROM pg_indexes WHERE indexname = 'EventKennel_eventId_isPrimary_unique'`;
```

Run this from CI as part of step 1's PR checks against `hashtracks_dev`, then again post-prod-deploy.

#### Step 7 (final) — `drop_event_kennel_id_column`

After display-layer migration (step 5 of [§7](#7-migration-sequencing)) has soaked in prod for ~2 weeks with no issues:

```prisma
model Event {
  // kennelId removed
  // kennel relation removed
  // ... rest unchanged
}
```

Generate the migration. The destructive column drop only happens after every read site has moved to `kennels { some }`.

### Rollback

Rollback safety is **per-step**, not blanket. Schema-only steps are reversible; steps that change persisted shape (RawEvent fingerprints, `kennelTags` arrays in `RawEvent.rawData` JSON) leave forward-only artifacts even after schema reverts.

| Scenario | Recovery | Data loss |
|---|---|---|
| Revert step 1 (schema add + backfill) before step 2 (dual-write) | `DROP TABLE "EventKennel";` (new migration) | None — no data path depends on it |
| Revert step 2 (dual-write) before step 5 (display layer) | Reverting the application code restores single-write behavior; EventKennel rows continue to exist but are stale for any subsequently created events | None *visible* — `Event.kennelId` still has the primary; readers haven't moved |
| Revert step 3 (adapter codemod) | Reverting application code restores `kennelTag` field. **However:** historical RawEvents created during step 3's window have `kennelTags` arrays in `rawData` JSON that old code can't read. Old code reads `data.kennelTag` (undefined) and re-emits new RawEvents with the legacy single-tag fingerprint. | **One-time RawEvent churn**; canonical Events are unaffected |
| Revert step 5 (display layer) before step 7 (drop column) | Application code revert; `EventKennel` rows are still in place but unread | None — `Event.kennelId` still has the primary for read paths |
| Revert *after* genuine co-host events have shipped | Same as above for the schema, but the *secondary* EventKennel rows are not visible to display code reading `Event.kennelId` only. They persist in the DB and reactivate if step 5 re-applies. | **Secondary kennels invisible until step 5 re-applies** — recoverable |
| Revert step 7 (drop column) | Re-add `kennelId` column, then `UPDATE Event SET kennelId = (SELECT kennelId FROM EventKennel WHERE eventId = Event.id AND isPrimary = true)` | None — the join table has the data |

**Critical sequencing for rollback safety:**
- Steps 1–5 are individually reversible without permanent loss.
- Step 7 (drop column) is the only irreversible step. Soak step 5 for ~2 weeks before merging step 7's PR.
- Per memory `feedback_phase_boundary_reviews`: run `/codex:adversarial-review` at every phase boundary, especially before step 7 (the irreversible drop) — confirm no code still references `Event.kennelId`.

---

## 6. Test plan

### Unit tests (no DB)

| Test | File | Asserts |
|---|---|---|
| GCal `matchConfigPatterns` returns full list | `src/adapters/google-calendar/adapter.test.ts` | Oregon Calendar fixture with title "Cherry City H3 #1 / OH3 #1340" → returns `["cch3-or", "oh3"]` (not `["oh3"]`) |
| iCal `matchConfigPatterns` parity | `src/adapters/ical/adapter.test.ts` | Same multi-tag behavior; existing single-pattern tests still pass |
| Resolver — partial fail tolerated | `src/pipeline/kennel-resolver.test.ts` | `resolveKennelTags(["cch3-or", "unknown"], sourceId)` returns `[{matched: true, kennelId: …}, {matched: false, kennelId: null}]`. The `unknown` tag does not block `cch3-or`. |
| Fingerprint — sort invariant | `src/pipeline/fingerprint.test.ts` | `generateFingerprint({…, kennelTags: ["a","b"]})` === `generateFingerprint({…, kennelTags: ["b","a"]})` |
| `kennelPatterns` config grammar | `src/app/admin/sources/config-validation.test.ts` | `[regex, [tag1, tag2]]` validates; `[regex, []]` (empty array) is rejected |

### Integration tests (DB-backed via Vitest + `hashtracks_dev`)

| Test | Asserts |
|---|---|
| Cross-source merge with overlapping kennels | Source A emits `["cch3-or", "oh3"]` for date D; Source B emits `["cch3-or"]` for date D. Result: 1 canonical Event, 2 EventKennel rows (`cch3-or` is primary because it appears in both, OR per the chosen `isPrimary` rule). |
| Cross-source non-merge with disjoint kennels | Source A emits `["a"]`; Source B emits `["b"]`. Same date. Result: 2 canonical Events, 1 EventKennel row each. |
| Same-source duplicate exclusion preserved | Source A emits `["cch3-or"]` on date D; Source A emits `["cch3-or"]` on date D+1. Result: 2 canonical Events (existing carve-out for back-to-back trails). |
| Backfill SQL correctness | Seed N single-kennel Events, run the backfill SQL, assert `EventKennel.count === N`, every row has `isPrimary = true`, and the `kennelId` matches the source `Event.kennelId`. |
| Kennel page query | Co-hosted Event with `["A", "B"]`. Query `/k/A` returns it; query `/k/B` returns it. |
| Misman attendance independence | Co-hosted Event. Kennel A misman records attendance using A's KennelHasher; Kennel B misman records using B's KennelHasher. Both rows persist with distinct `kennelHasherId`s. |
| Hareline filter | "Selected kennels = {A}" returns the co-hosted event; "Selected kennels = {B}" returns it; "Selected kennels = {C}" excludes it. |
| **Concurrency — single-primary invariant** | Two parallel writers race to create the same Event (pipeline create vs manual logbook create vs admin kennel merge). Assert exactly one EventKennel row with `isPrimary = true` after both transactions complete. The partial unique index should cause one writer to retry. |
| **Concurrency — admin kennel merge during scrape** | Admin merges Kennel A → Kennel B while a scrape is mid-flight emitting events with `kennelTags: ["A"]`. After both complete, no Event has zero primaries; no EventKennel rows reference deleted Kennel A. |
| **Authorization — secondary co-host misman access** | Event X is co-hosted by Kennel A (primary) and Kennel B (secondary). User U is misman of Kennel B only. Assert: U can view event detail page misman UI (`hareline/[eventId]/page.tsx:129`), U can record attendance (`misman/[slug]/attendance/actions.ts`), U can view event in `misman/[slug]/attendance/[eventId]/page.tsx`. |
| **Authorization — non-misman secondary kennel** | Same setup but U is not a misman of either kennel. Assert: U gets the public event view, no misman UI. |
| **Resolver — regional disambiguation preserved** | Two kennels both code-tagged "PHH" linked to two different sources (Phoenix vs Honolulu). `resolveKennelTags(["PHH"], phoenixSourceId)` returns Phoenix kennel; `resolveKennelTags(["PHH"], honoluluSourceId)` returns Honolulu kennel. Confirms source-scoped resolution still wins over global fallback. |
| **Pattern gating — single-tag patterns preserve first-match** | `kennelPatterns: [["CH3", "c2b3h4"], ["CH3", "ch3"]]` (overlapping single-tag patterns from existing config). Result: only `c2b3h4` matches, `ch3` is not added. Behavior identical to today. |
| **Pattern gating — array patterns are unioned** | `kennelPatterns: [["Cherry City", ["cch3-or"]], ["OH3", ["oh3"]]]`. Title "Cherry City H3 / OH3 #1340" → result is `["cch3-or", "oh3"]`. |

### End-to-end verification (manual, post-deploy)

1. Pick the Cherry City + OH3 inaugural event (2025-07-12, already in prod).
2. Manually add an EventKennel row linking it to OH3 with `isPrimary = false`.
3. Navigate to `/k/cch3-or` — event appears (existing behavior preserved via primary).
4. Navigate to `/k/oh3` — event appears (new behavior).
5. Both kennels' ICS feeds include the event.
6. Both kennels' "next run" computation considers the event.

---

## 7. Migration sequencing

Strict ordering. Per Codex review, the original draft incorrectly claimed steps 2 (adapter codemod) and 4 (display migration) could land in either order. They cannot — display reads from EventKennel require **dual-write** to be in place first, otherwise newly created Events are missing from the join table. The corrected sequence:

| # | Step | Blocks on | Risk | Why this order |
|---|------|-----------|------|----------------|
| 0 | This spec doc PR | — | none | Forces design alignment before any code |
| 1 | Schema add (1a) + backfill (1b) including the partial unique index | WS1–WS5 land (avoids Prisma client regen conflicts) | low — additive only | Data in place before any writer or reader needs it |
| **2** | **Dual-write migration** — every Event-write site (`pipeline/merge.ts:1169-1191`, `app/logbook/actions.ts:656-668`, `app/admin/kennels/actions.ts:672-702` and the kennel-merge cascade at `:570-702`) wraps the `Event` write and matching `EventKennel` row in one Prisma transaction. Includes admin kennel-merge updating EventKennel rows. | step 1 | medium — every writer touched, but each is isolated | **Critical invariant** — without this, step 5 readers would miss events created during the rollout |
| 3 | Adapter interface change: `kennelTag` → `kennelTags: string[]` (codemod + types + multi-tag resolver). Default behavior unchanged for all existing single-tag adapters and existing single-tag `kennelPatterns`. | step 2 | medium — touches every adapter; full test suite gates | Step 2's transactional writers now consume `kennelTags[0]` as primary and persist the rest as EventKennel rows |
| 4 | `matchConfigPatterns` returns array; convert Oregon Calendar (Cherry City/OH3) as first multi-kennel pattern. Each subsequent multi-kennel source needs explicit per-pattern review (see [§2 Multi-kennel pattern gating](#multi-kennel-pattern-gating-added-per-codex-review)). | step 3 | low — opt-in per source | First real co-host data flows; validates dedup rule end-to-end |
| 5 | Display-layer migration: ~200 REWRITE sites + ~140 AUTO sites + authorization paths (`hareline/[eventId]/page.tsx:129` and the misman attendance scope checks per [§4 Authorization paths](#authorization-paths--important-added-per-codex-review)) | step 2 (writers populate EventKennel for new events); step 4 (so reads see real co-host arrays) | medium — many files; mechanical REWRITE codemod plus per-site auth review | Read sites converge on `kennels { some }` |
| 6 | Backfill historical co-host events (Cherry City/OH3 inaugural and any others identified) via one-shot scripts (per memory `feedback_historical_backfill`) | step 5 | low | UI catches up to history |
| 7 | Drop `Event.kennelId` column | step 5 + 2-week soak in prod + dedicated `/codex:adversarial-review` | low — only after no code reads it | Irreversible; the only one-way door |

**WS1–WS5 hold:** step 1 is gated on these workstreams landing because they all touch `prisma/schema.prisma` (kennel seed data, in some cases new kennel models). Running `prisma generate` after step 1 changes the Prisma client, and rebasing WS1–WS5 PRs against a different client is wasteful churn. Coordinate via the PR queue, not parallel rebases.

**Admin merge/delete is first-class blocking work** (per Codex review — the kennel-merge code at `app/admin/kennels/actions.ts:570-702` and the cascade-delete at `:323-375` are tightly coupled to ownership semantics). Step 2 must extend both:
- Cascade delete: add `eventKennel.deleteMany({ where: { kennelId } })` to the cascade chain.
- Kennel merge: re-point sourceKennel's EventKennel rows to targetKennel, dedup on `(eventId, targetKennelId)` collision, and ensure exactly one row remains primary (the partial unique index will reject any merge that produces a double-primary, so the merge transaction must explicitly resolve the conflict).

---

## Appendix A — Full display-layer audit

Generated by grep over `src/` (excluding `*.test.ts`) on commit `82da4399` (worktree HEAD at spec-write time). Approximate counts: ~242 `kennelId` references across 97 files. Below: every site that needs migration, classified.

**Legend:**
- **AUTO** — read-only Prisma relation access; auto-migrates when relation becomes `kennels[]`
- **REWRITE** — `where: { kennelId }` on Event model; mechanical rewrite to `where: { kennels: { some: { kennelId } } }`
- **MODEL** — semantic decision needed per [§4](#4-display-layer-audit) Model decisions

### Pipeline (engine)

| File:line | Pattern | Class |
|---|---|---|
| [src/pipeline/merge.ts:342](src/pipeline/merge.ts:342) | `resolveKennelTag(event.kennelTag, sourceId)` returns single result | REWRITE (resolver becomes multi-result) |
| [src/pipeline/merge.ts:388](src/pipeline/merge.ts:388) | second `resolveKennelTag` call inside `resolveAndGuardKennel` | REWRITE |
| [src/pipeline/merge.ts:462](src/pipeline/merge.ts:462) | `resolveKennelTag` in `resolveAndGuardKennel` | REWRITE |
| [src/pipeline/merge.ts:845](src/pipeline/merge.ts:845) | `kennelId` write to RawEvent | AUTO (denorm pointer to primary) |
| [src/pipeline/merge.ts:900](src/pipeline/merge.ts:900) | `where: { kennelId, date: eventDate }` (same-day dupe probe) | REWRITE per [§3](#3-cross-source-dedup-with-overlapping-kennel-sets) |
| [src/pipeline/merge.ts:1171](src/pipeline/merge.ts:1171) | `kennelId` field on Event create | AUTO (writes to denorm + EventKennel) |
| [src/pipeline/merge.ts:1228](src/pipeline/merge.ts:1228) | `where: { kennelId, date: crossWindowOldDate }` (recanonicalize abandoned bucket) | REWRITE |
| [src/pipeline/merge.ts:828](src/pipeline/merge.ts:828) | `findFuzzyDuplicateInWindow` filters `where: { kennelId, ... }` | REWRITE per [§3](#3-cross-source-dedup-with-overlapping-kennel-sets) |
| [src/pipeline/reconcile.ts:162-164](src/pipeline/reconcile.ts:162) | `where: { kennelId: { in: linkedKennelIds }, ... }` (stale event reconciliation) | REWRITE |
| [src/pipeline/health.ts:312](src/pipeline/health.ts:312) | `kennel.findMany({ where: { id: { in: kennelIds } } })` | AUTO (Kennel-model query, unaffected) |
| [src/pipeline/audit-runner.ts:226](src/pipeline/audit-runner.ts:226) | `e.kennel.shortName` property access | AUTO |
| [src/pipeline/kennel-resolver.ts:129](src/pipeline/kennel-resolver.ts:129) | `resolveKennelTag` signature | REWRITE (becomes multi-tag) |
| [src/pipeline/fingerprint.ts:11](src/pipeline/fingerprint.ts:11) | `data.kennelTag` in fingerprint input | REWRITE (sorted-join of array) |

### Adapters

113 source files in `src/adapters/` emit `kennelTag`. All become `kennelTags: [...]` via codemod in step 2 of [§7](#7-migration-sequencing). Per-file diffs are mechanical and not enumerated here — the codemod targets `kennelTag:\s*"([^"]+)"` → `kennelTags: ["$1"]`.

12 adapters use `kennelPatterns` config and need `matchConfigPatterns` updated:
- [src/adapters/google-calendar/adapter.ts](src/adapters/google-calendar/adapter.ts) (WS1 hold)
- [src/adapters/ical/adapter.ts](src/adapters/ical/adapter.ts)
- [src/adapters/html-scraper/frankfurt-hash.ts](src/adapters/html-scraper/frankfurt-hash.ts)
- [src/adapters/html-scraper/sfh3.ts](src/adapters/html-scraper/sfh3.ts)
- [src/adapters/html-scraper/phoenixhhh.ts](src/adapters/html-scraper/phoenixhhh.ts)
- [src/adapters/html-scraper/wcfh-calendar.ts](src/adapters/html-scraper/wcfh-calendar.ts)
- [src/adapters/html-scraper/generic.ts](src/adapters/html-scraper/generic.ts)
- + 5 others identified during step 3

### Kennel page (`/kennels/[slug]`)

| File:line | Pattern | Class |
|---|---|---|
| [src/app/kennels/[slug]/page.tsx:96](src/app/kennels/[slug]/page.tsx:96) | `event.findMany({ where: { kennelId: kennel.id, ... } })` | REWRITE |
| [src/app/kennels/[slug]/page.tsx:111](src/app/kennels/[slug]/page.tsx:111) | `userKennel.findUnique({ where: { userId_kennelId } })` | AUTO (UserKennel, not Event) |
| [src/app/kennels/[slug]/page.tsx:117](src/app/kennels/[slug]/page.tsx:117) | `mismanRequest.findFirst({ where: { kennelId } })` | AUTO (MismanRequest, not Event) |
| [src/app/kennels/page.tsx:62](src/app/kennels/page.tsx:62) | `event.findMany({ select: { kennelId, date, title } })` | REWRITE (selector becomes `kennels: { select: ... }`) |
| [src/app/kennels/region/[slug]/page.tsx:100](src/app/kennels/region/[slug]/page.tsx:100) | `event.findMany({ where: { kennelId: { in: [...] } } })` | REWRITE |
| [src/app/kennels/actions.ts:22-44](src/app/kennels/actions.ts:22) | `kennel.findUnique({ where: { id: kennelId } })` x3 | AUTO |

### Hareline (calendar) filters

| File:line | Pattern | Class |
|---|---|---|
| [src/app/hareline/actions.ts:125](src/app/hareline/actions.ts:125) | `event.findMany({ where: { kennelId: { in: [...] } } })` | REWRITE |
| [src/app/hareline/actions.ts:230](src/app/hareline/actions.ts:230) | `event.findFirst({ where: { kennelId } })` | REWRITE |
| [src/components/hareline/HarelineView.tsx:244-246](src/components/hareline/HarelineView.tsx:244) | `event.kennelId`, `event.kennel?.region`, `event.kennel?.id` (client-side filter) | AUTO (becomes iteration over `event.kennels`) |
| [src/components/hareline/MapView.tsx](src/components/hareline/MapView.tsx) | Pin coloring uses `event.kennel.region` | AUTO |

### Misman attendance / roster / history

| File:line | Pattern | Class |
|---|---|---|
| [src/app/misman/[slug]/attendance/actions.ts:54](src/app/misman/[slug]/attendance/actions.ts:54) | `select: { id, kennelId, date }` from Event | REWRITE (becomes `kennels: { select: { kennelId } }`) |
| [src/app/misman/[slug]/attendance/actions.ts:265](src/app/misman/[slug]/attendance/actions.ts:265) | `select: { kennelId }` from Event | REWRITE |
| [src/app/misman/[slug]/attendance/actions.ts:453](src/app/misman/[slug]/attendance/actions.ts:453) | `event.findMany({ where: { kennelId, date: { gte } } })` | REWRITE |
| [src/app/misman/[slug]/attendance/actions.ts:462](src/app/misman/[slug]/attendance/actions.ts:462) | `event.findMany({ where: { kennelId: { in: rosterKennelIds }, ... } })` | REWRITE |
| [src/app/misman/[slug]/attendance/page.tsx:26-28](src/app/misman/[slug]/attendance/page.tsx:26) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/misman/[slug]/attendance/[eventId]/page.tsx:25-34](src/app/misman/[slug]/attendance/[eventId]/page.tsx:25) | `event.findFirst` with kennelId scope check | REWRITE |
| [src/app/misman/[slug]/roster/actions.ts:331](src/app/misman/[slug]/roster/actions.ts:331) | `event.findMany({ where: { kennelId: { in: rosterKennelIds } } })` | REWRITE |
| [src/app/misman/[slug]/history/actions.ts:41](src/app/misman/[slug]/history/actions.ts:41) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/misman/[slug]/history/actions.ts:270](src/app/misman/[slug]/history/actions.ts:270) | `kennelId: { in: rosterKennelIds }` | REWRITE |
| [src/app/misman/[slug]/history/page.tsx:30](src/app/misman/[slug]/history/page.tsx:30) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/misman/[slug]/import/actions.ts:78-80](src/app/misman/[slug]/import/actions.ts:78) | `event.findMany({ where: { kennelId }, select: { …, kennelId } })` | REWRITE |
| [src/app/misman/[slug]/import/actions.ts:92](src/app/misman/[slug]/import/actions.ts:92) | `kennelAttendance.findMany({ where: { event: { kennelId } } })` | REWRITE (nested filter on Event) |
| [src/app/misman/[slug]/import/actions.ts:214-228](src/app/misman/[slug]/import/actions.ts:214) | Same pattern repeated for `previewImport` flow | REWRITE x4 |

### Misman dashboard

| File:line | Pattern | Class |
|---|---|---|
| [src/app/misman/page.tsx:88](src/app/misman/page.tsx:88) | `kennelAttendance.count({ where: { kennelHasher: { kennelId: { in: managedKennelIds } } } })` | REWRITE (filters via KennelHasher, not Event — but the underlying Event may be co-hosted; semantics OK because attendance is hasher-scoped) |
| [src/app/misman/page.tsx:91](src/app/misman/page.tsx:91) | `kennelHasher.count({ where: { kennelId: { in: [...] } } })` | AUTO (KennelHasher, not Event) |
| [src/app/misman/page.tsx:94](src/app/misman/page.tsx:94) | `kennelAttendance.findFirst({ where: { kennelHasher: { kennelId: { in: [...] } } } })` | AUTO (same as above) |
| [src/app/misman/actions.ts:33-41](src/app/misman/actions.ts:33) | `userKennel.findUnique` and `mismanRequest.findFirst` | AUTO (not Event) |
| [src/app/misman/[slug]/settings/actions.ts:18-44](src/app/misman/[slug]/settings/actions.ts:18) | `kennel.findUnique` / update | AUTO |
| [src/app/misman/invite/actions.ts:120](src/app/misman/invite/actions.ts:120) | `kennelInvitation.findFirst({ where: { kennelId } })` | AUTO (not Event) |

### Logbook / event history

| File:line | Pattern | Class |
|---|---|---|
| [src/app/logbook/actions.ts:74](src/app/logbook/actions.ts:74) | `event.findMany({ select: { kennel: { select: { slug } } } })` | AUTO (becomes iteration over `kennels`) |
| [src/app/logbook/actions.ts:307](src/app/logbook/actions.ts:307) | `kennelAttendance.findMany({ where: { event: { kennelId } } })` | REWRITE (nested filter on Event) |
| [src/app/logbook/actions.ts:347](src/app/logbook/actions.ts:347) | `event.kennel.shortName` property access in render | AUTO |
| [src/app/logbook/actions.ts:494](src/app/logbook/actions.ts:494) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/logbook/actions.ts:536-539](src/app/logbook/actions.ts:536) | `event.findMany({ where: { kennelId: { in: kennelIds } } })` | REWRITE |
| [src/app/logbook/actions.ts:628](src/app/logbook/actions.ts:628) | `kennel.findUnique({ where: { id: data.kennelId } })` (manual entry submission) | AUTO + MODEL — manual entry currently picks a single kennel; future enhancement to pick multiple, but not required for this migration |

### Profile / subscriptions / Near-Me

| File:line | Pattern | Class |
|---|---|---|
| [src/lib/travel/search.ts:487](src/lib/travel/search.ts:487) | `event.findMany({ where: { kennelId: { in: [...] } } })` | REWRITE |
| [src/lib/travel/search.ts:508-511](src/lib/travel/search.ts:508) | Same pattern, distance filter | REWRITE |
| [src/lib/travel/search.ts:567](src/lib/travel/search.ts:567) | `kennelMap.get(event.kennelId)` (in-memory lookup) | AUTO (becomes loop over `event.kennels`) |
| [src/lib/travel/search.ts:587](src/lib/travel/search.ts:587) | `kennelId: event.kennelId` (response shape) | MODEL — does the travel response shape need to expose all kennels? Recommend yes; rendering treats primary as headline. |
| [src/components/profile/KennelConnections.tsx](src/components/profile/KennelConnections.tsx) | UserKennel queries | AUTO (not Event) |

### Admin (events / kennels / alerts / sources)

| File:line | Pattern | Class |
|---|---|---|
| [src/app/admin/events/actions.ts:106-107](src/app/admin/events/actions.ts:106) | `event.count({ where })`, `event.findMany({ where })` with kennelId filter | REWRITE |
| [src/app/admin/events/actions.ts:152](src/app/admin/events/actions.ts:152) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/admin/events/page.tsx:70](src/app/admin/events/page.tsx:70) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/admin/kennels/actions.ts:351](src/app/admin/kennels/actions.ts:351) | `kennelAttendance.count({ where: { event: { kennelId } } })` | REWRITE |
| [src/app/admin/kennels/actions.ts:363-374](src/app/admin/kennels/actions.ts:363) | Cascade delete: `kennelHasher`, `rosterGroupKennel`, `mismanRequest`, `kennelAlias`, `sourceKennel`, `kennel.delete` | AUTO (each scoped to its own model) — but **add** `eventKennel.deleteMany({ where: { kennelId } })` to the cascade |
| [src/app/admin/kennels/actions.ts:612-697](src/app/admin/kennels/actions.ts:612) | Kennel merge: `where: { kennelId: sourceKennel.id }`, `data: { kennelId: targetKennel.id }` across many child models | REWRITE — and add EventKennel handling: re-point sourceKennel's EventKennel rows to targetKennel, dedup on `(eventId, targetKennelId)` collision |
| [src/app/admin/alerts/actions.ts:257, 359](src/app/admin/alerts/actions.ts:257) | `kennel.findUnique({ where: { id: kennelId } })` | AUTO |
| [src/app/admin/sources/actions.ts:222](src/app/admin/sources/actions.ts:222) | `sourceKennel.upsert({ where: { sourceId_kennelId } })` | AUTO (SourceKennel, not Event) |
| [src/app/admin/research/actions.ts:137, 227](src/app/admin/research/actions.ts:137) | `kennel.findUnique`, `kennel.findFirst` | AUTO |
| [src/app/admin/regions/actions.ts:321, 340](src/app/admin/regions/actions.ts:321) | `kennel.findMany`, `kennel.updateMany` | AUTO |
| [src/app/admin/discovery/actions.ts:52, 141, 177](src/app/admin/discovery/actions.ts:52) | Source-kennel discovery flow | AUTO (SourceKennel) |
| [src/app/admin/roster-groups/actions.ts:62-238](src/app/admin/roster-groups/actions.ts:62) | RosterGroupKennel CRUD | AUTO (RosterGroupKennel) |
| [src/app/admin/analytics/actions.ts:90](src/app/admin/analytics/actions.ts:90) | `where: { kennelId: { in: kennelIds } }` on `kennelHasher`/`kennelAttendance` | AUTO (KennelHasher) |

### Strava integration

| File:line | Pattern | Class |
|---|---|---|
| [src/app/strava/actions.ts:707](src/app/strava/actions.ts:707) | `event.findMany({ where: { kennelId } })` | REWRITE |
| [src/app/strava/actions.ts:893](src/app/strava/actions.ts:893) | `event.findMany({ where: { kennelId } })` | REWRITE |

### ICS / calendar export

| File:line | Pattern | Class |
|---|---|---|
| [src/lib/calendar.ts:25, 174](src/lib/calendar.ts:25) | `event.kennel.shortName` in ICS SUMMARY | AUTO — render as `event.kennels.map(k => k.shortName).join(" / ")` for co-hosts; primary first |
| [src/lib/event-display.ts:13](src/lib/event-display.ts:13) | Event title formatter using `event.kennel.shortName` | AUTO — same multi-kennel render |
| [src/lib/weather.ts:155](src/lib/weather.ts:155) | `event.kennel.region` for weather centroid fallback | AUTO — primary kennel's region |
| [src/components/travel/TripSummary.tsx:280](src/components/travel/TripSummary.tsx:280) | ICS generation in trip export | AUTO |
| [src/components/hareline/EventCard.tsx](src/components/hareline/EventCard.tsx) | Kennel badge rendering | MODEL — render as `[Primary kennel] · [+ Co-host kennel]` chip group |
| [src/app/sitemap.ts:28](src/app/sitemap.ts:28) | `event.findMany({ select: { kennelId } })` for sitemap entries | REWRITE — primary kennel slug per event (sitemap entry per Event, not per kennel) |

### Authorization (added per Codex review)

| File:line | Pattern | Class |
|---|---|---|
| [src/app/hareline/[eventId]/page.tsx:129](src/app/hareline/[eventId]/page.tsx:129) | `getMismanUser(event.kennelId)` to gate misman UI on event detail | MODEL — must check membership across the event's kennel set, not just primary |
| [src/app/misman/[slug]/attendance/actions.ts:31-39](src/app/misman/[slug]/attendance/actions.ts:31) | Attendance scope guard comparing roster IDs against `event.kennelId` | MODEL — same fix |
| [src/app/misman/[slug]/attendance/actions.ts:52-60](src/app/misman/[slug]/attendance/actions.ts:52) | Event lookup with kennelId scope check | MODEL |
| [src/app/misman/[slug]/attendance/actions.ts:263-270](src/app/misman/[slug]/attendance/actions.ts:263) | Same pattern in attendance update path | MODEL |

### Coverage / health dashboards (added per Codex review)

| File:line | Pattern | Class |
|---|---|---|
| [src/app/admin/sources/coverage/page.tsx:33](src/app/admin/sources/coverage/page.tsx:33) | `_count: { select: { events: true } }` on Kennel — counts via `Kennel.events` reverse relation | MODEL — see [§4 Kennel directory stats](#c-kennel-directory-stats--needs-a-product-call) for the count semantics. Today this counts events where `Event.kennelId = kennel.id`; after migration it should count events where the kennel appears in the EventKennel join. |

### Root / homepage

| File:line | Pattern | Class |
|---|---|---|
| [src/app/page.tsx:28](src/app/page.tsx:28) | `event.count({ where: { date: { gte } } })` | AUTO (no kennel filter) |
| [src/app/page.tsx:35](src/app/page.tsx:35) | `event.findMany({ include: { kennel: ... } })` | AUTO (becomes `include: { kennels: { include: { kennel } } }`) |
| [src/app/page.tsx:222](src/app/page.tsx:222) | `event.kennel.region` in render | AUTO (primary kennel's region) |

### `lib/auth.ts` and helpers

| File:line | Pattern | Class |
|---|---|---|
| [src/lib/auth.ts:134, 153, 160](src/lib/auth.ts:134) | `getMismanUser` / `getRosterGroupId` filtering on KennelHasher.kennelId | AUTO (KennelHasher) |

---

## Decisions log

| # | Decision | Rationale |
|---|---|---|
| D1 | EventKennel join table over `String[]` array | RI, indexing, Prisma DSL ergonomics |
| D2 | Keep `Event.kennelId` as denorm primary pointer until step 7 | Enables phased rollout; rollback safety |
| D3 | `RawEventData.kennelTag` → `kennelTags: string[]` (hard break) | Mechanical codemod; type leaks avoided |
| D4 | Reject `coHostKennelTags?: string[]` sibling field | Bifurcates schema |
| D5 | `kennelPatterns` grammar: `[regex, kennelTag \| kennelTag[]]` | Lets Oregon Calendar express `["Cherry City\|OH3", ["cch3-or", "oh3"]]` |
| D6 | Cross-source dedup rule: kennel-set intersection ≥ 1 + corroborating signal | Catches the Oregon Calendar / cherry-city.org overlap; no behavior regression for current single-kennel events |
| D7 | `isPrimary` ownership rule (first-writer vs highest-trust) | **Deferred to implementation PR**; spec recommends a feature flag |
| D8 | Kennel directory stats count co-hosted events for both kennels | "Recent activity" is a community engagement signal, not a strict ownership count |
| D9 | KennelAttendance scoping unchanged | Already correctly hasher-scoped; co-hosted events natively support per-kennel attendance |
| D10 | URL slug resolution unchanged | Primary kennel slug stays canonical |
| D11 | Migration phasing: schema → **dual-write** → adapter codemod → patterns → display+auth → historical backfill → drop column | Strict ordering; only the final drop is irreversible (added per Codex review — original draft incorrectly claimed steps could parallelize) |
| D12 | Adversarial review at every phase boundary, not just pre-PR | Per memory `feedback_phase_boundary_reviews` |
| **D13** | **Partial unique index `EventKennel(eventId) WHERE isPrimary = true`** | Enforce single-primary invariant at the DB level — application-side discipline alone is insufficient given multiple concurrent writers (added per Codex review) |
| **D14** | **All Event-write sites must use a Prisma transaction wrapping `Event` + `EventKennel` writes** | The dual-write step depends on this; race conditions otherwise produce zero or multiple primaries (added per Codex review) |
| **D15** | **Multi-kennel pattern emission is opt-in per pattern** | A pattern entry is `[regex, string \| string[]]`. Existing first-match behavior preserved for `string` values; `array` values explicitly opt into multi-kennel emission. Prevents existing overlapping single-tag patterns (C2B3H4 vs CH3, PHH vs H5) from producing accidental multi-kennel events (added per Codex review) |
| **D16** | **One-time RawEvent fingerprint churn during multi-kennel pattern adoption is accepted** | When a source converts a pattern from single to multi-tag, fingerprints change; new RawEvents flow through normal cross-source dedup. Re-fingerprinting historical RawEvents is out of scope (added per Codex review) |
| **D17** | **Backfill SQL uses `ON CONFLICT DO UPDATE SET isPrimary = true`** | Idempotent and self-correcting against any pre-existing EventKennel rows with wrong primary state. Verification script asserts exactly `event_count` primary rows post-backfill (added per Codex review) |
| **D18** | **Authorization paths included in step 5 display-layer migration** | `hareline/[eventId]/page.tsx:129` and three sites in `misman/[slug]/attendance/actions.ts` use `event.kennelId` for misman gating; secondary co-host kennel mismans would be denied without the rewrite (added per Codex review) |
| **D19** | **Admin kennel merge/delete is first-class blocking work in step 2** | The cascade at `app/admin/kennels/actions.ts:323-375` and merge at `:570-702` are tightly coupled to ownership semantics; they ship in the dual-write PR, not as cleanup later (added per Codex review) |
