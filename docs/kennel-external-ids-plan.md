# R5 Plan: One Record of External Kennel Identity

**Status:** Plan for owner review, 2026-11-20. Nothing here is built.
**Follows:** [`kennel-directory-mapping-review.md`](kennel-directory-mapping-review.md), recommendation R5. R1, R2, R4, R6 and R7 have shipped; see that doc's section 0.
**Evidence:** code on `main` at `f9d178fb`, read-only prod queries on 2026-11-20, and the Hash Rego index as recorded in the 11-20 00:30 UTC prod scrape log.

## 1. Summary

The review proposed one `KennelExternalId` table for every directory. Most of the damage it was meant to prevent is already fixed by smaller changes:
- discovery no longer links on its own;
- events route by account, not by name;
- a name that matches two kennels comes back unmatched;
- kennel merges carry identity across.

What is left is real but small: identity is stored in two places, and the scraper can hold only one Hash Rego account per kennel.

The prod data shows a bigger, cheaper win first:
- **17 Hash Rego accounts that an admin confirmed as kennels we track are posting upcoming events, and we don't scrape them.** Each one's profile matches its kennel's city.
- They are already on the Hash Rego index page the scraper downloads, so scraping them costs **no extra requests**.
- Tampa Bay H3 has no enabled source at all, and Gainesville (GATR) and Peach Fuzz have only a static schedule.

**Recommendation:**
1. **Step 1, now:** add those 17 accounts to the Hash Rego seed map with a data migration. No schema change.
2. **Step 2, R5 proper:** build the identity table only when a trigger in section 5 fires. The design is in section 4, so it's ready when needed.

## 2. Where things stand

| Question | Answer today | Stored in |
|---|---|---|
| Which Hash Rego account is which kennel? | 273 confirmed identities (LINKED/ADDED) on 243 kennels | `KennelDiscovery` (`externalSource = HASHREGO`, `matchedKennelId`, `status`) |
| Which Hash Rego accounts are scraped? | 37 accounts, one per kennel | `SourceKennel.externalSlug` on the Hash Rego source, written only by the seed's `kennelSlugMap` (shipped by migration) and the source-page slug editor |
| Which account routes an event? | The account it was fetched from, mapped to a kennel code (R4) | Built at scrape time from `SourceKennel` (`buildKennelCodesBySlug` in `src/pipeline/scrape.ts`), which skips a slug linked to two kennels |
| Which Half-Mind listing is which kennel? | 0 linked (6 NEW in the Georgia pilot) | `KennelDiscovery` (`externalSource = HALFMIND`) **and** `Kennel.halfMindListingId` (unique), kept in step by `half-mind-actions.ts` and the kennel merge |

Prod checks on 2026-11-20:
- no two Hash Rego rows share a slug, ignoring case;
- 1 scraped account has no confirmed row (`AH4_PLH3` → ph3-atl, linked by migration);
- 8 confirmed rows point at hidden kennels, and one of them (`CUNTH3`) is probably wrong (review section 0);
- 26 kennels have 2 or more confirmed accounts.

## 3. What is still wrong, and how much it matters

| Gap | Effect today | Size |
|---|---|---|
| **Confirmed accounts with events aren't scraped** (decision R3: linked = identity only) | Hash Rego's registration details (cost, hares, multi-day schedule) are missing for 17 kennels that post there, and Tampa Bay H3 shows nothing | 17 accounts, all on the index page; see section 6 |
| **One scraped account per kennel** (`SourceKennel` is unique per source and kennel) | A kennel can't take events from a second account, such as an event account or a joint account | 1 scraped kennel has a second confirmed account today (`ssh3-wa`: `SouthH3` scraped, `S-S-H3` suggested). The 26 multi-account kennels are otherwise unscraped |
| **Half-Mind identity in two places** | Any new writer must update both, or they drift | 0 linked listings today. About 17 read sites in 9 files use `Kennel.halfMindListingId` (cards, Travel, "How we know", status) |
| **Nothing in the database says a Hash Rego account feeds one kennel** | R4 skips such a slug at scrape time instead of failing at write time | 0 cases today |

None of these sends events to the wrong kennel today. That is why R5 can wait for a trigger, while step 1 can't wait: it is lost coverage.

## 4. Design for R5 (build when triggered)

### 4.1 One table, for confirmed identity only

```prisma
enum ExternalDirectory {
  HASHREGO
  HALFMIND
}

enum ExternalIdOrigin {
  SEED       // written by the seed's kennelSlugMap via a data migration
  ADMIN      // confirmed on /admin/discovery
  MIGRATION  // backfilled when the table was created
}

model KennelExternalId {
  id          String            @id @default(cuid())
  kennelId    String
  kennel      Kennel            @relation(fields: [kennelId], references: [id])
  directory   ExternalDirectory
  externalId  String            // as the directory spells it: "OregonH3", "1073"
  externalKey String            // lower(trim(externalId)), the matching key
  scraped     Boolean           @default(false) // HASHREGO only: the scraper fetches this account
  origin      ExternalIdOrigin
  confirmedBy String?           // admin user id; null for SEED / MIGRATION
  confirmedAt DateTime          @default(now())
  discoveryId String?           @unique // the KennelDiscovery row it was confirmed from
  createdAt   DateTime          @default(now())
  updatedAt   DateTime          @updatedAt

  @@unique([directory, externalKey]) // one directory entry belongs to at most one kennel
  @@index([kennelId, directory])     // a kennel may hold several Hash Rego accounts
}
-- plus, by hand in the migration:
-- CREATE UNIQUE INDEX ... ON "KennelExternalId"("kennelId") WHERE directory = 'HALFMIND';
--   (keeps today's one-listing-per-kennel rule)
```

**What changed from the review's original sketch:**
- **Confirmed rows only.** Suggestions and dismissals stay in `KennelDiscovery`, which keeps its role as the review inbox: the listing snapshot, candidates and status. There are no SUGGESTED or REJECTED states to keep in step with the inbox.
- **`scraped` lives on the identity row.** This keeps R3's decision (identity and scraping are separate facts) while letting one kennel scrape several accounts.
- **Only Hash Rego and Half-Mind.** Meetup groups and some Harrier Central and HashStats accounts feed several kennels, so they stay in `Source.config` (`kennelPatterns`, `kennelSlugMap`). Gemini rows are model-made names, not directory ids, so they stay out.

### 4.2 Who writes it

| Writer | Today | After R5 |
|---|---|---|
| Discovery Confirm / Link / Add (`src/app/admin/discovery/actions.ts`) | Sets the row to LINKED/ADDED | Same, plus inserts a `KennelExternalId` (`origin = ADMIN`, `scraped = false`) in the same transaction |
| Half-Mind Link / Unlink / Add (`half-mind-actions.ts`) | Sets `Kennel.halfMindListingId` | Inserts or deletes the HALFMIND row. The partial unique index does the one-listing check |
| Seed `kennelSlugMap` (`prisma/seed.ts` `linkKennelsToSource`) | Writes `SourceKennel.externalSlug`, prunes others | Upserts `scraped = true`, `origin = SEED` rows, plus the `SourceKennel` link the guard needs. It clears `scraped` only on SEED rows it no longer lists, and never deletes ADMIN identity. A value may be a string or a list of slugs |
| Source-page slug editor | Edits `SourceKennel.externalSlug` | Edits the kennel's scraped Hash Rego rows |
| Kennel merge (`src/app/admin/kennels/actions.ts`) | Moves discovery rows, the listing id and a missing slug (R7) | Repoints `KennelExternalId` rows. A HALFMIND conflict sends the merged kennel's row back to NEW, as R7 does today |

### 4.3 Who reads it

- **`scrape.ts`:** builds the slug list and R4's `slug → kennelCode` map from `scraped = true` HASHREGO rows. The unique key makes R4's "skip a slug linked to two kennels" check impossible to trip.
- **Half-Mind evidence:** the ~17 reads of `Kennel.halfMindListingId` move to the relation. Phase it: first a single accessor (`getHalfMindListingId(kennel)`), then the column drop.
- **A seed test** asserts every scraped row's kennel has a `SourceKennel` link to the Hash Rego source.

### 4.4 Migration, in three releases

1. **Additive** (one migration, with a dry run per `.claude/rules/prod-data-ops.md`):
   - create the enums, the table and the partial index;
   - backfill the 273 confirmed Hash Rego rows (`origin = MIGRATION`, `discoveryId` set);
   - set `scraped = true` on the 37 accounts in `SourceKennel` (`AH4_PLH3` has no discovery row, so insert it);
   - backfill Half-Mind from `Kennel.halfMindListingId` (0 rows today).

   Before writing, run a read-only conflict report: case-insensitive duplicate keys (0 today), the 8 rows on hidden kennels (copy them; hiding keeps identity), and `CUNTH3` (fix it on the discovery page first).
2. **Dual write and switch readers:** writers update both the old and new stores, and readers move to the table. One release with both in place.
3. **Drop:** a later migration drops `SourceKennel.externalSlug` and `Kennel.halfMindListingId`, after a release with no reads of either.

**Effort:** medium to large. Roughly 6 writer sites, the scrape reader, about 17 Half-Mind read sites, tests, and three migrations.

## 5. When to build R5

Build it when any of these happens:
- **A scraped kennel needs a second Hash Rego account**, for example a weekend event posted from an event account, or a joint account. Today the only way is to swap the slug.
- **Half-Mind links start to accumulate:** the pilot is reviewed and the sync covers more than Georgia, so the duplicated listing id has many rows to keep in step.
- **A third directory with one id per kennel is added**, such as the HHH Genealogy Project.

## 6. Step 1, now: scrape the 17 confirmed accounts that post events

Every account below is on the Hash Rego events index (prod scrape log, 2026-11-20 00:30 UTC). Each is confirmed LINKED to a kennel whose region matches the account's profile location.

| Account | Hash Rego profile | Kennel | Its other enabled sources |
|---|---|---|---|
| `CLH3` | California Larrikins, San Diego | `clh3-sd` | HTML scraper (SDH3 hareline) |
| `CTrH3` | Carolina Trash H3, Fayetteville NC | `ctrh3` | Meetup |
| `EPH3` | El Paso H3 | `eph3` | Google Calendar |
| `Foothill` | Foothill H3, Whittier CA | `fth3` | Google Calendar, Facebook |
| `GATRH3` | Gainesville Area Thirsty Runners H3 | `gatr-h3` | **static schedule only** |
| `IH3` | Ithaca H3 | `ih3` | HTML scraper |
| `jHavH3` | jHavelina H3, Tucson | `jhav-h3` | Google Calendar |
| `LBH3` | Long Beach H3 | `lbh3` | Google Calendar |
| `MPLS_H3` | Minneapolis H3 | `mh3-mn` | Google Calendar |
| `PCH3` | Panama City H3 | `pch3` | Facebook |
| `PFH3` | Peach Fuzz H3, Augusta GA | `pfh3` | **static schedule only** |
| `RCH3-OH` | Rubber City H3, Akron OH | `rch3` | Meetup |
| `RH3` | Richmond H3 | `rvah3` | Meetup |
| `SavH3` | Savannah H3 | `savh3` | Meetup |
| `SDH3` | San Diego H3 | `sdh3` | HTML scraper |
| `TBH3` | Tampa Bay H3 | `tbh3-fl` | **none** |
| `TH3` | Tidewater H3, Virginia Beach | `twh3` | HTML scraper |

**Cost:** none in requests. The scraper fetches per-account API pages only for accounts missing from the index, and all 17 are on it. Detail pages are fetched only for in-window events. The extra work is about one detail page per new event.

**How to ship it** (one PR, same pattern as #3065):
1. **Live-verify each account.** Fetch its events and check that the host display name resolves to the kennel. R4's cross-check holds any mismatch, so a wrong one is held, not published.
2. **Add the 17 to the seed's `kennelCodes` and `kennelSlugMap`,** and write a migration that adds the `SourceKennel` links with slugs. Dry-run it on prod.
3. **Check reconcile for each kennel before merging.** The Hash Rego source is `upcomingOnly`, and R4 scopes reconcile to accounts read. Confirm no existing event from another source would be cancelled: reconcile only cancels events whose raws come from Hash Rego.
4. **Check the merge's trust order.** Hash Rego is trust 8, so where a calendar or website already lists the same run, Hash Rego's title, cost and hares win. Spot-check two kennels with rich calendars (`lbh3`, `mh3-mn`) on the local DB copy before merging, so good titles aren't replaced with weaker ones.
5. **After deploy, run one prod scrape** and read the ScrapeLog: expect 0 held and 0 cancelled.

**Also before step 1:** decide `CUNTH3` (repoint to `columbia` or reset). It isn't on the index today, so it doesn't block.

## 7. Open questions for the owner

1. **Step 1 scope:** all 17, or only the kennels with no event source today (Tampa Bay, GATR, Peach Fuzz) first?
2. **Trust order:** for kennels whose own calendar is good, should Hash Rego only fill blanks? That would be a per-source trust tweak, which merge supports through field-by-field fill of empty fields.
3. **R5 trigger:** is "the Half-Mind sync covers more than Georgia" the trigger you want, or should R5 wait until a kennel actually needs two Hash Rego accounts?
