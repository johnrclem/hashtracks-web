# R5 Plan: One Record of External Kennel Identity

**Status:** Plan for owner review, 2026-11-20 (revised after an adversarial review). Nothing here is built.
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
2. **Separately, an optional step for special events, owner's choice (section 5):** 17 confirmed Hash Rego accounts post events we don't scrape. Those events are hash weekends, campouts, red/green dress runs and parties, not regular trails. Adding them has real costs and risks: up to 17 extra requests per scrape, trust ties that can overwrite better titles, and date mismatches that make duplicate cards. So it should go kennel by kennel, after a full dry merge, starting with the few kennels where it's clean.
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
- **Scraped accounts without a matching confirmed row:** `AH4_PLH3` → ph3-atl was linked by migration. Its confirmed row is `PH3`, whose kennel page 404s.
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
- **Scraping (R3 decision kept):** `scraped` is set only by the seed's `kennelSlugMap` (shipped by migration) and by the source-page slug editor. Discovery actions never set it.
  - The seed owns `scraped` on every HASHREGO row, whatever wrote the row. It sets it on the listed (kennel, slug) pairs and clears it everywhere else.
  - It never changes a row's status or kennel.
  - A value may be a list of slugs, for kennels with several scraped accounts.
  - It also keeps the `SourceKennel` link the guard needs for each scraped kennel.
- **Scraped implies confirmed:** a row with `scraped = true` must be LINKED or ADDED, enforced by a check constraint or a seed test. `AH4_PLH3` gets a discovery row in the backfill.

**Writers:**

| Writer | Change |
|---|---|
| Discovery Confirm / Link (`src/app/admin/discovery/actions.ts`) | Unchanged: sets LINKED and `matchedKennelId`. **Repointing** an already-LINKED row (the CUNTH3 fix) is an update. If the row was scraped, the action refuses and says to change the seed first. |
| Discovery Dismiss / bulk dismiss | Dismissing a confirmed row ends the identity. If the row is scraped, refuse with the same message: scraping changes only through the seed. |
| Half-Mind Link / Unlink / Add (`half-mind-actions.ts`, `admin/shared/kennel-creation.ts`) | Stop writing `Kennel.halfMindListingId`. The partial unique index does the one-listing check. |
| Seed `linkKennelsToSource` (`prisma/seed.ts`) | Sets the `scraped` flags and keeps the `SourceKennel` links, as above. It stops writing `externalSlug`. |
| Source-page slug editor | Toggles `scraped` on the kennel's confirmed rows. |
| Kennel merge (`src/app/admin/kennels/actions.ts`) | Already moves discovery rows (R7). The Half-Mind conflict rule stays: the merged kennel's row goes back to NEW. |

**Readers:**
- **`scrape.ts`:** builds the slug list and R4's map from HASHREGO rows that are scraped and LINKED or ADDED. A slug can belong to only one row, so R4's "skip a slug linked to two kennels" check can no longer trip.
- **Half-Mind evidence:** about 17 reads in 9 files move from `Kennel.halfMindListingId` to one accessor, then to the row.

**Kennel delete:** `KennelDiscovery.matchedKennelId` already sets null on delete, so a confirmed row becomes an orphan candidate. The migration adds no new foreign key.

### 3.3 Migration

Write the dual writes and the backfill in the **same release**, so nothing confirmed between two deploys is missed:

1. **Release 1** (one migration, dry-run per `.claude/rules/prod-data-ops.md`):
   - add the column and the partial index;
   - insert a confirmed discovery row for `AH4_PLH3`, copying `processedAt` where a source row exists;
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
  - `PH3`'s kennel page 404s;
  - `S-S-H3` is only a suggestion.
- **Half-Mind links start to accumulate:** the pilot is reviewed and the sync covers more than Georgia.
- **A third directory with one id per kennel is added,** such as the HHH Genealogy Project.

## 5. Optional: special events from 17 confirmed accounts

These 17 accounts are confirmed (LINKED) and were on the Hash Rego events index in the 11-20 00:30 UTC scrape log. Each profile's city matches its kennel's region. The live index rows are all special events: hash weekends, campouts, pub crawls, red/green dress runs, a holiday party and No Wimps. Each account has one or two.

### 5.1 What it costs
- **Requests:** one extra per-account API call per scrape for each account once it is off the index. The index lists only upcoming events, and these accounts rotate off it after their event; 32 of today's 37 accounts already go this way. Every in-window event's detail page is also fetched on every scrape. Expect up to 17 API calls plus about 20 detail pages more per daily scrape.
- **Time budget:** per-account calls share a 45-second budget (`STEP2B_BUDGET_MS`, `src/adapters/hashrego/adapter.ts`) with the index fetch. If the budget runs out, `kennelPagesStopReason = "budget_exhausted"` and reconcile is skipped for the whole source. Today's scrapes take 14–19 seconds.

### 5.2 What can go wrong

| Kennel(s) | Other source and trust | Risk |
|---|---|---|
| `eph3` | Google Calendar, **9** | Hash Rego (8) loses every conflict, so it adds little |
| `sdh3`, `clh3-sd` (SDH3 hareline), `ih3` (website), `fth3`, `pch3` (Facebook) | **8**, a tie | Whichever source changed last overwrites title, time, location and pin. Live examples: sdh3 12/05 "Land of Misfit Hashers" 18:30 vs Hash Rego "Island of Misfit Hashers 2026" 18:00; ih3 1/30 "WInterhash #12" vs "IH3 CNY WinterHash 2027" |
| `mh3-mn` | Google Calendar, 7 | **Date mismatch:** the calendar has No Wimps on 2027-01-15, Hash Rego on 01-16, giving two cards for one event |
| `gatr-h3` | Static schedule, 3 (see section 6) | The Hash Rego weekend starts Friday 1/15. The "GATR H3 Monthly Trail" placeholder sits on Saturday 1/16 next to it |
| `lbh3`, `rvah3` | Google Calendar / Meetup, 7 | Each has two confirmed Hash Rego accounts. Only the one on the index (`LBH3`, `RH3`) would be scraped, and the other stays identity only |
| `lbh3`, `rvah3`, `twh3` | — | Three events carry Hash Rego's joke price **"$6969"**. Nothing in `src/adapters/hashrego` treats it as "no price", so the card would show it |
| `eph3`, `gatr-h3`, `pch3`, `rvah3`, `rch3` | — | Their Hash Rego display names resolve to no kennel, so R4's hold-on-mismatch check can't protect them. Review their first events by hand |

Trust is set per source, and there is one Hash Rego source for all 54 kennels this would cover (37 scraped today plus these 17). Lowering Hash Rego to "fill blanks only" would change the 37 kennels already scraped too. A per-kennel trust override doesn't exist; it would be new work.

### 5.3 If you go ahead
1. **Fix the price first:** treat "$6969", "$0" and similar placeholder prices as no cost in the Hash Rego parser, with tests.
2. **Run a full dry merge** of all 17 on a fresh local copy of prod, the method R4 used. Report per kennel:
   - new canonical events;
   - fields overwritten on existing events;
   - same-event-on-a-different-date pairs.
3. **Choose kennels from that report.** Likely clean first: `tbh3-fl` (no enabled source at all), `ctrh3`, `rch3`, `savh3`, `jhav-h3`, `twh3`. Leave out `eph3` and the trust-8 ties until there is a per-kennel trust rule. Leave out `mh3-mn` and `gatr-h3` until their date and placeholder collisions are handled.
4. **Add the chosen kennels** to the seed's `kennelCodes`/`kennelSlugMap`, with a migration that adds their links and slugs. Dry-run it on prod.
5. **Check reconcile** before merging. Reconcile cancels an upcoming event in a scraped kennel only when no other source backs it, which includes events with no raw events at all (`protectedByOtherSources`, `src/pipeline/reconcile.ts`). Confirm that the chosen kennels have 0 upcoming events without raws; this was 0 for all 17 on 2026-11-20.
6. **After deploy:**
   - run one prod scrape and read the ScrapeLog: expect 0 held, 0 cancelled and no `kennelPagesStopReason`;
   - watch `kennelPagesStopReason` for a week.

## 6. Separate fix: GATR seed changes never reached prod

The seed disables "GATR H3 Static Schedule" and adds "GATR H3 WordPress Trail Posts" (`prisma/seed-data/sources.ts`, around line 2388). In prod the static schedule is still enabled and the WordPress source doesn't exist. Seed changes reach prod only through a data migration, so this needs one:
- disable the static source (or retire it with `replacedById`, per `.claude/rules/prod-data-ops.md`);
- add the WordPress source and its link;
- clean up placeholder events per the phantom-cleanup notes.

It is worth a sweep for other seed sources that never reached prod.

## 7. Open questions for the owner

1. **Special events (section 5):** do you want them at all? If yes, only after the price fix and the dry merge, starting with the clean kennels.
2. **Trust:** should Hash Rego beat a kennel's own website or Facebook (today they tie at 8), or should we build a per-kennel trust override before adding tied kennels?
3. **R5 trigger:** is "a second account of a scraped kennel starts posting events we need", or "the Half-Mind sync covers more than Georgia", the trigger you want?
4. **GATR (section 6):** ship the missing migration now, and sweep for other seed sources missing from prod?
