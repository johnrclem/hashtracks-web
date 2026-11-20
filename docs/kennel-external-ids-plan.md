# R5 Plan: One Record of External Kennel Identity

**Status:** Step 1 (special events) approved by the owner on 2026-11-20; R5 itself waits for a trigger. Revised after two adversarial reviews and the owner's answers. Nothing here is built yet.
**Follows:** [`kennel-directory-mapping-review.md`](kennel-directory-mapping-review.md), recommendation R5. R1, R2, R4, R6 and R7 have shipped; see that doc's section 0.
**Evidence:** code on `main` at `f9d178fb`, read-only prod queries on 2026-11-20, the Hash Rego index as recorded in the 11-20 00:30 UTC prod scrape log, and public reads of hashrego.com.

## 1. Summary

The review proposed one `KennelExternalId` table for every directory. Smaller shipped changes have already removed most of the damage it targeted:
- discovery no longer links on its own;
- events route by account, not by name;
- a name that matches two kennels comes back unmatched;
- kennel merges carry identity across.

What is left is real but small:
- **Two stores.** Identity sits in `KennelDiscovery`, and the scraped slug sits in `SourceKennel` (one per kennel). Half-Mind identity is also copied onto `Kennel`.
- **No routing errors today.** None of the remaining gaps sends an event to the wrong kennel.

**Recommendation:**
1. **R5 itself, when a trigger in section 4 fires:** don't add a new table. Make the confirmed `KennelDiscovery` row the one identity record (section 3). That is a smaller change than the original table, and it leaves one store instead of two.
2. **Step 1, approved: special events from Hash Rego (section 5).** 17 confirmed Hash Rego accounts post events we don't scrape. Many kennels use Hash Rego only for weekends, campouts, red/green dress runs and parties, so we want them. Research on the 52 events already listed on both Hash Rego and a kennel's own source shows Hash Rego is usually the better source for cost, hares, location and title, once its own placeholders are cleaned. It also turned up a **live merge bug**: 366 events show the wrong time, because an update without a start time resets the stored timestamp to noon UTC.

   The order:
   1. fix that bug (PR 0);
   2. clean Hash Rego's placeholders in the parser (PR A);
   3. rank Hash Rego above kennels' own sources at trust 10 (PR B);
   4. add the 17 accounts (PR C).

   PRs B and C each get a per-field dry merge on a prod copy first.
3. **A deploy gap found on the way:** GATR's seed already disables its static schedule and adds a WordPress source, but prod has neither (section 6). It has nothing to do with Hash Rego and needs its own data migration.

## 2. Where things stand

| Question | Answer today | Stored in |
|---|---|---|
| Which Hash Rego account is which kennel? | 273 confirmed (LINKED) identities on 243 kennels; there are no ADDED rows | `KennelDiscovery`: `externalSource = HASHREGO`, `status`, `matchedKennelId`, unique on `(externalSource, externalSlug)` |
| Which Hash Rego accounts are scraped? | 37 accounts, one per kennel | `SourceKennel.externalSlug` on the Hash Rego source. Only the seed's `kennelSlugMap` (shipped by migration) and the source-page slug editor write it |
| Which account routes an event? | The account it was fetched from, mapped to a kennel code (R4) | Built at scrape time from `SourceKennel` (`buildKennelCodesBySlug`, `src/pipeline/scrape.ts`). It skips a slug linked to two kennels |
| Which Half-Mind listing is which kennel? | 0 linked; 6 NEW in the Georgia pilot | `KennelDiscovery` (`externalSource = HALFMIND`) **and** `Kennel.halfMindListingId` (unique), kept in step by `half-mind-actions.ts`, `admin/shared/kennel-creation.ts` and the kennel merge |

**Prod checks, 2026-11-20:**
- **Duplicates:** no two Hash Rego rows share a slug, ignoring case.
- **Scraped accounts without a matching confirmed row:** `AH4_PLH3` → ph3-atl was linked by migration. Its confirmed row is `PH3`. That is Pinelake H3's own active account, marked annual-only, with no events now. It's a plausible future second account for ph3-atl.
- **Hidden kennels:** 8 confirmed rows point at hidden kennels. One of them, `CUNTH3`, is probably wrong (review section 0).
- **Kennels with two or more confirmed accounts:** 26. Three of them matter:
  - `lbh3`: `LBH3`, `LongBeach`;
  - `rvah3`: `RH3`, `Richmond`;
  - `ph3-atl`: `PH3`, plus the scraped `AH4_PLH3`.

  `ssh3-wa`'s second account, `S-S-H3`, is only a suggestion (MATCHED).

## 3. Design for R5 (build when triggered)

### 3.1 Alternatives considered

| Option | What it is | Verdict |
|---|---|---|
| **A. New `KennelExternalId` table** (the review's sketch) | A separate identity table, with `KennelDiscovery` as the inbox | **Rejected.** Every confirmed identity would live in both tables, linked by an id. That is the duplication R5 sets out to remove, with more writers to keep in step. |
| **B. Confirmed `KennelDiscovery` row is the identity record** | Add a scraped flag to `KennelDiscovery`. Retire `SourceKennel.externalSlug` and `Kennel.halfMindListingId` | **Recommended.** The row already has the unique key, the kennel, the status and the provenance (`processedBy`/`processedAt`). It solves several accounts per kennel and gives one store, with no new table. |
| C. Do nothing | Keep two stores | Fine until a trigger in section 4 fires. |

### 3.2 Option B in detail

**Schema change, additive:**
- `KennelDiscovery.scraped Boolean @default(false)`. Meaningful on HASHREGO rows only: the scraper fetches this account.
- A partial unique index `ON "KennelDiscovery"("matchedKennelId") WHERE "externalSource" = 'HALFMIND' AND status IN ('LINKED','ADDED')`. This keeps today's one-listing-per-kennel rule and replaces the uniqueness of `Kennel.halfMindListingId`.

**Rules:**
- **Identity:** a row with status LINKED or ADDED is a confirmed identity. `matchedKennelId` on a NEW, MATCHED or DISMISSED row is only a candidate.
- **Scraping (R3 decision kept):** `scraped` is set only by the seed's `kennelSlugMap` (shipped by migration). Discovery actions and the slug editor never set it.
  - The seed owns `scraped` on every HASHREGO row, whatever wrote the row. It sets it on the listed (kennel, slug) pairs and clears it everywhere else.
  - It never changes a row's status or kennel.
  - A value may be a list of slugs, for kennels with several scraped accounts.
  - It also keeps the `SourceKennel` link the guard needs for each scraped kennel.
  - On a fresh database (local dev, `migrate reset`, tests) there are no discovery rows to flag. So for each listed (kennel, slug) pair with no row, the seed **upserts a confirmed row**, leaving existing rows' status and kennel alone. Otherwise a freshly seeded scraper would get no slugs.
- **Scraped implies confirmed:** a row with `scraped = true` must be LINKED or ADDED, enforced by a check constraint or a seed test. `AH4_PLH3` gets a discovery row in the backfill.

**Writers:**

| Writer | Change |
|---|---|
| Discovery Confirm / Link (`src/app/admin/discovery/actions.ts`) | Unchanged: sets LINKED and `matchedKennelId`. **Repointing** an already-LINKED row (the CUNTH3 fix) is an update. If the row was scraped, the action refuses and says to change the seed first. |
| Discovery Dismiss / bulk dismiss | Dismissing a confirmed row ends the identity. If the row is scraped, refuse with the same message: scraping changes only through the seed. |
| Half-Mind Link / Unlink / Add (`half-mind-actions.ts`, `admin/shared/kennel-creation.ts`) | Stop writing `Kennel.halfMindListingId`. The partial unique index does the one-listing check. |
| Seed `linkKennelsToSource` (`prisma/seed.ts`) | Sets the `scraped` flags and keeps the `SourceKennel` links, as above. It stops writing `externalSlug`. |
| Source-page slug editor | Becomes read-only for Hash Rego: it shows the scraped accounts and points to the seed map. The seed owns the flag and would silently revert an editor toggle on its next run, as it does with `externalSlug` today. |
| Kennel merge (`src/app/admin/kennels/actions.ts`) | Already moves discovery rows (R7). **Order changes:** with the partial unique index, a conflicting confirmed Half-Mind row must be reset to NEW (`matchedKennelId = null`) *before* the other rows are repointed, or the move violates the index inside the transaction. Add a test. |

**Readers:**
- **`scrape.ts`:** builds the slug list and R4's map from HASHREGO rows that are scraped and LINKED or ADDED. A slug can belong to only one row, so R4's "skip a slug linked to two kennels" check can no longer trip.
- **Half-Mind evidence:** about 17 reads in 9 files move from `Kennel.halfMindListingId` to one accessor, then to the row.

**Kennel delete:** `KennelDiscovery.matchedKennelId` already sets null on delete, so a confirmed row becomes an orphan candidate. The migration adds no new foreign key.

### 3.3 Migration

Write the dual writes and the backfill in the **same release**, so nothing confirmed between two deploys is missed:

1. **Release 1** (one migration, dry-run per `.claude/rules/prod-data-ops.md`):
   - add the column and the partial index;
   - insert a confirmed discovery row for `AH4_PLH3` (it has none), with `processedAt` set to the migration date and `processedBy` null, matching how migration `20261106210200` linked it;
   - set `scraped = true` on the 37 accounts in `SourceKennel` today;
   - for Half-Mind, mark nothing new. `Kennel.halfMindListingId` is 0 in prod, and each linked Half-Mind row already exists.

   In the same release the code writes both stores and reads the new one. Run a read-only conflict report first. It must show:
   - no case-insensitive duplicate keys;
   - no scraped slug without a confirmed row;
   - CUNTH3 fixed on the discovery page.
2. **Release 2:** drop `SourceKennel.externalSlug` and `Kennel.halfMindListingId`, after one release with no reads of either. This migration is a schema change: check that the preview build tolerates it, per the memory on schema PR previews.

**Effort:** medium. A column and an index, 6 writer sites, the scrape reader, about 17 Half-Mind read sites, tests, and two migrations.

## 4. When to build R5

Build it when any of these happens:
- **A second account of a scraped kennel starts posting events we need.** Today none does:
  - `LongBeach` and `Richmond` aren't on the Hash Rego index;
  - `PH3` (Pinelake's annual-only account) has no events now;
  - `S-S-H3` is only a suggestion.
- **Half-Mind links start to accumulate:** the pilot is reviewed and the sync covers more than Georgia.
- **A third directory with one id per kennel is added,** such as the HHH Genealogy Project.

## 5. Step 1 (approved): special events from Hash Rego

### 5.1 Owner decisions (2026-11-20)
- **Yes to special events.** Many kennels use Hash Rego only for special events, so these 17 accounts are worth scraping.
- **Hash Rego should almost always rank above a kennel's own site,** confirmed by comparing events listed on both (section 5.2).

### 5.2 Research: events listed on both Hash Rego and a kennel's own source

**Method:** read-only query, 2026-11-20. It covers every canonical event backed by a Hash Rego raw event and by at least one other source's raw. For each source it takes the latest raw event and counts non-empty fields. The Hash Rego column shows how many of its values are placeholders. The other-sources column counts any other source with a value, including their own placeholders ("Location TBD", "CAMPOUT 2026", "Red Line").

| Field | Hash Rego non-empty (placeholders) | Other sources non-empty | Notes |
|---|---|---|---|
| Cost | **48** (2: `$0`) | 5 | Hash Rego is the registration platform; others rarely list cost |
| Hares | **44** (4: `TBA`, `NA`, `Away: 3:30pm`) | 30 | They sometimes disagree: ewh3 07-09 Hash Rego "Ready Player None, Brass to Mo…" vs calendar "PhD, S2B2, VagLaw"; nych3 11-14 Hash Rego names fewer hares than HashNYC |
| Location | **47** (7: `Start Location TBA`, `TBA`, `Location TBD`) | 34 | Hash Rego often names the actual start ("Virginia Highlands Park, follow marks" where the website says "Pentagon City"), but has typos ("George Avenue/Petwork" vs the website's "Georgia Avenue/Petworth") |
| Start time | 19 | **40** | Hash Rego often has none; EWH3 never sets one. See the blocker in 5.3 |
| Title | rich event names | mixed | Other sources' weak titles: GCal "Hares needed! Email the Hare Razor…", empty WH4 sheet and BFH3 titles, "Philly Hash". Hash Rego's weak titles: EWH3's "#1521: The British are Cumming Trail, June 4, 2026, Dupont Circle (Red Line)" (date plus Metro station), "[UPDATED]" prefixes, a doubled year, and multi-day "(Day 2)" fallbacks |

**Limits of this evidence:**
- **Who has a value, not who is right.** The table counts whether each source has a value, not whether it's correct, and the disagreements above show both sides are sometimes wrong.
- **Mostly past DC events:** 39 of the 52 shared events are ewh3 (27) or wh4 (12), and only 3 are upcoming.
- **The kennels whose outcome changes most have no shared events at all:** the six that would tie with or lose to Hash Rego today (eph3, sdh3, clh3-sd, ih3, fth3, pch3). The per-field dry merges in 5.6 are therefore the real test.

**Conclusion:**
- Your instinct holds on the evidence available: Hash Rego is usually the better source for cost, hares, location and title, once its placeholders are cleaned.
- "Usually" isn't "always". Section 5.3 and the open questions cover the exceptions.
- Ranking Hash Rego first without cleaning would replace good data with "Start Location TBA" (nych3's 5-Boro Pub Crawl and Pride party, ggfm's Strawberry Moon, bfm's FEARadelphia, bfh3's Jingle Balls) and with long dated titles on every EWH3 trail.

### 5.3 Recommended trust change, and what must come first

**Blocker, already live:**
- **The bug:** when a source with equal or higher trust updates an event and sends no start time, the merge keeps `startTime` but resets `dateUtc` to UTC noon. `src/pipeline/merge.ts` around 1975 composes `dateUtc` from the incoming row's time only, then writes it unconditionally.
- **What users see:** calendars show that time (8 AM in US Eastern), and "coming up" treats the event as already started.
- **Scale today:** **366 confirmed events in 73 kennels** have a `dateUtc` that disagrees with their own start time and timezone, 56 of them upcoming. 208 of those 366 have the noon value (read-only check, 2026-11-20).
- **Why it blocks trust 10:** Hash Rego never sends EWH3's times. At 10 it would win every EWH3 trail and reset each one to noon.
- **The fix is PR 0 (5.6):** compute `dateUtc` from the incoming time, falling back to the existing event's time, and repair the 366 rows.

**Then raise Hash Rego from trust 8 to 10.**
- **Why 10:** the highest trust any enabled source uses today is 9 (11 sources, including the EWH3 website and the El Paso calendar). This puts Hash Rego above every kennel's own source, so the six kennels that tie or lose today resolve in its favour.
- **What trust controls:**
  - **Per event, all or nothing:** once Hash Rego's trust-10 raw owns an event, a lower-trust source can only fill fields that are empty. A later correction on the kennel's own site (a new time, a moved start, changed hares) is then ignored.
  - **Dates:** at 10, Hash Rego's date wins when the dates differ (`merge.ts` around 1937 and 2536). This covers weekends that start on Friday on Hash Rego and on Saturday on a calendar (gatr-h3), and plain mismatches (mh3-mn No Wimps, 01-15 vs 01-16).
  - **Descriptions:** Hash Rego always sends one, so it would replace a kennel's own text. Usually Hash Rego's is longer, but not always: MoA2H3's calendar text and two HashNYC rows are longer.
  - **Pins:** a changed location text re-geocodes, and clears the pin if the new text doesn't resolve.
- **"Almost always" has no knob today.** 10 is the schema maximum, and trust is set per source, so there's no per-kennel exception. If the dry merges show a kennel whose own source should win, an exception rule needs building (open question 2).
- **Scope:** trust is per source, so the change applies to all 54 kennels Hash Rego would cover, including the 37 scraped today. EWH3 is the biggest: its trust-9 website currently wins titles.
- **Existing events:** unchanged raws are skipped by fingerprint (`handleDuplicateFingerprint` only refreshes `dateUtc`/timezone). PR A changes the title and placeholder output, and so the fingerprint, of most Hash Rego raws. That re-merges in-window events at PR A's deploy, at trust 8. After PR B, a re-merge is needed only for raws whose fingerprints didn't change, and only after PR 0's fix.

### 5.4 What it costs
- **Requests:** one extra per-account API call per scrape for each account once it is off the index. The index lists only upcoming events, and these accounts rotate off it after their event; 32 of today's 37 accounts already go this way. Every in-window event's detail page is also fetched on every scrape. Expect up to 17 API calls plus about 20 detail pages more per daily scrape.
- **Time budget:** per-account calls share a 45-second budget (`STEP2B_BUDGET_MS`, `src/adapters/hashrego/adapter.ts`) with the index fetch. If the budget runs out, `kennelPagesStopReason = "budget_exhausted"` and reconcile is skipped for the whole source. Today's scrapes take 14–19 seconds.

### 5.5 Remaining per-kennel risks (for the 17 new accounts)

| Kennel(s) | Risk | Handling |
|---|---|---|
| `mh3-mn` | **Date mismatch:** the calendar has No Wimps on 2027-01-15, Hash Rego on 01-16 | The dry merge shows whether trust 10 moves the date or makes a duplicate. If the second, fix it by hand or hold the kennel back |
| `gatr-h3` | The Hash Rego weekend starts Friday 1/15, and a static placeholder sits on Saturday 1/16 | Fixed by the separate GATR migration (section 6), which disables the static schedule |
| `lbh3`, `rvah3` | Each has two confirmed Hash Rego accounts | Scrape the account that posts: `LBH3`, `RH3`. For lbh3, `LongBeach` looks like the official account (the kennel's own contact email, not annual-only), so check it too |
| `lbh3`, `rvah3`, `twh3` | Three events carry Hash Rego's joke price **"$6969"** | PR A treats it as no price |
| `eph3`, `gatr-h3`, `pch3`, `rvah3`, `rch3` | Their Hash Rego display names resolve to no kennel, so R4's hold-on-mismatch check can't protect them | Review their first events by hand after deploy |

### 5.6 Shipping sequence
0. **PR 0: fix `dateUtc` on update (live bug, needed before trust 10).**
   - In the merge update and enrich paths, compose `dateUtc` from `event.startTime ?? existingEvent.startTime`, and add a regression test.
   - One-shot repair of the 366 mismatched events: a dry run with counts first, per `.claude/rules/prod-data-ops.md`.
1. **PR A: Hash Rego parser cleanup** (`src/adapters/hashrego/parser.ts`), with fixtures from the real examples above.
   - **Placeholders are omitted (`undefined`), not blanked.**
     - Merge writes `""` and `null` as a clear: hares are sanitized to null, a location clear also drops the pin, and cost `""` is stored as is. Only an omitted field keeps the other source's value.
     - Cover: placeholder locations ("Start Location TBA", "TBA", "TBD", "Location TBD"), hares ("TBA", "NA", "Away: …") and the joke price "$6969". Keep "$0": some events really are free (EWH3's Drinking Practice).
     - Add a merge-level test that a trust-10 raw with an omitted field keeps a lower-trust value.
   - **Titles:**
     - Strip from the date onwards, including a Metro-station tail. Cover every format seen: "June 4, 2026, Dupont Circle (Red Line)", "7/16/2026, 2026", "30 July, 2026", "July 23rd 2026", "Thursday, October 8th, 2026, Red Line", "…Trail - Columbia Heights Metro".
     - Drop "[UPDATED]" prefixes and a doubled year.
     - For multi-day children, omit the "(Day N)" fallback title, so a calendar's real per-day trail name stays.
     - Use procedural tokenizing, not one big regex, to stay inside the Sonar S5852/S5843 limits (`.claude/rules/adapter-patterns.md`).
   - **This PR does change data:** fingerprints change, so in-window events re-merge at trust 8 on the first scrape after deploy.
   - **Clean up placeholders already stored:** a one-shot dry-run cleanup of canonical events that already store a Hash Rego placeholder, e.g. "Start Location TBA" on bfh3 10-30 and 12-12 and bfm 10-01 to 10-04. Consider teaching merge's `isPlaceholder` "Start Location TBA" and "TBA" for every source.
2. **PR B: the trust change** (8 → 10 in the seed plus a migration), after PR 0 and PR A.
   - Before merging, run a dry merge on a fresh local copy of prod for the 37 scraped kennels.
   - **Report per field:** title, description, location text, pin set or cleared, hares, cost, `dateUtc`, and date moves. Also report events that would need a re-merge.
   - If the report shows bad overwrites, stop and adjust, or decide open question 2 first.
3. **PR C: the 17 accounts** (seed `kennelCodes`/`kennelSlugMap` plus a migration).
   - Before merging, run the same per-field dry merge for all 17 at trust 10. Also report new events and same-event pairs on different dates.
   - Drop any kennel whose report shows a problem until it's handled.
   - Check reconcile: it cancels an upcoming event in a scraped kennel only when no other source backs it, which includes events with no raw events at all (`protectedByOtherSources`, `src/pipeline/reconcile.ts`). Confirm the chosen kennels have 0 upcoming events without raws; this was 0 for all 17 on 2026-11-20.
4. **After each deploy:**
   - run one prod scrape and read the ScrapeLog: expect 0 held, 0 cancelled and no `kennelPagesStopReason`;
   - check there's no `FIELD_FILL_DROP` alert on Hash Rego after PR A (the 30-point threshold is unlikely to fire, but check);
   - count events with a start time whose `dateUtc` disagrees with it (expect 0 after PR 0), and pins cleared since the deploy;
   - watch `kennelPagesStopReason` for a week after PR C.

## 6. Separate fix: seed changes that never reached prod

The seed disables "GATR H3 Static Schedule" and adds "GATR H3 WordPress Trail Posts" (`prisma/seed-data/sources.ts`, around line 2388). In prod the static schedule is still enabled and the WordPress source doesn't exist. Seed changes reach prod only through a data migration. The owner approved shipping it and sweeping for other seed changes that never reached prod. That work is its own PR, separate from this plan.

## 7. Open questions for the owner

1. **Corrections after Hash Rego owns an event:** at trust 10, a kennel's own site can only fill empty fields. Should a lower-trust source still be allowed to correct the date, time or start location (for example a calendar edit made after registration opened)? If yes, merge needs a field-specific rule.
2. **The "almost" in "almost always":** should there be a per-kennel exception that lets a kennel's own source beat Hash Rego? It doesn't exist yet. Build it only if the PR B or PR C dry merge shows a kennel that needs it.
3. **lbh3 account:** scrape `LBH3`, the one that posts, or `LongBeach`, which looks official, or both once R5 allows several accounts per kennel?
4. **R5 trigger:** is "a second account of a scraped kennel starts posting events we need", or "the Half-Mind sync covers more than Georgia", the trigger you want?
