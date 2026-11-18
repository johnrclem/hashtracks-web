# Kennel Directory Mapping: Review and Recommendations

**Status:** Draft for owner review, 2026-11-17
**Scope:** how HashTracks maps two external kennel directories, Hash Rego and Half-Mind, to its own kennels, compared with how it resolves the kennels of its own scraped sources.
**Evidence:** code on `main` at `5f9bfbbf`, open PR [#3050](https://github.com/johnrclem/hashtracks-web/pull/3050) (Half-Mind listings, stacked on [#3043](https://github.com/johnrclem/hashtracks-web/pull/3043)), read-only prod queries run 2026-11-18 03:30–04:30 UTC, and a few public Hash Rego API reads. No code, config or data was changed to write this.

## 1. Summary

HashTracks has three ways of deciding "this external thing is that kennel of ours", and they share almost nothing.

- **Hash Rego** matches directory entries to kennels by fuzzy name score, and **links them on its own** at a score of 0.95 or more. The link only controls which Hash Rego accounts get scraped. The scraped events are then routed by the host kennel's *display name*, through the general name resolver.
- **Half-Mind** (PR #3050, not merged) uses the same fuzzy ranker, but **never links on its own**, stores the listing id as structured data, and only feeds kennel-status evidence.
- **Our own sources** resolve by exact kennel code, short name or alias, plus a hardcoded regex list that applies to every source.

**What the data shows:**

1. **Seven wrong Hash Rego links are live.** Fuzzy auto-matches at 0.95–0.99 from 2026-03-03 replaced correct links on six kennels: DCH4, Southern Comfort (Atlanta), NOH3 (New Orleans), Wandering Soul (Birmingham), Morgantown H3 and Charleston Heretics. Oregon H3 lost its link to an event account. HashTracks now scrapes, for example, Seattle's "Hash House Harriettes" for DCH4 and a Fort Walton Beach "SCH3" for Atlanta's Southern Comfort. It has done so in every retained scrape log since 2026-10-22. One concrete miss: DCH4's "The Great 24-Hour Book Bender" on 2026-11-28 is on Hash Rego and not in HashTracks.
2. **Two seeded Hash Rego links are probably wrong in the seed itself.** This is the same class of bug as the old FCH3 mix-up. `ch3` (Chicago) is mapped to the `CH3` account, which Hash Rego's own profile says is Charlotte, NC. Chicago's account is `ChiH3`. `gfh3` (Great Falls, Virginia) is mapped to `GFH3`, which is "Great Falls Hash House Harriers (MT)".
3. **"Linked" on the discovery page doesn't mean "scraped".** An admin confirmed 260 Hash Rego links. Only 16 of them still have the matching scrape link, and 236 have none at all. The seed's `kennelSlugMap` and the discovery page both write the same `SourceKennel` rows, and each overwrites the other.
4. **Events are routed by display name, not by the link.** About half of the linked accounts (18 of 37) have a Hash Rego name that the resolver can't map to the linked kennel. Their detail-page events go unmatched until someone adds an alias. Raw events from Hash Rego's "Oregon Hash House Harriers" have sat unprocessed since June: that is `oh3`'s full name, but the resolver never reads full names.
5. **The alias table is a shared namespace with collisions.** 47 alias strings point at two or more kennels, 16 short names are duplicated, and 118 aliases equal another kennel's code or short name. The resolver's global fallback picks one of them with `findFirst` and no ordering.

**Recommendation, in order:** repair the wrong links now with one data migration. Then stop auto-linking. Then route Hash Rego events by account slug instead of display name. Finally, move every directory's external ids into one `KennelExternalId` table that the scrapers, the Half-Mind evidence code and the resolver all read. PR #3050 already follows most of the right policy and should not be blocked. Section 5 has the ranked list.

## 2. How each mechanism works today

### 2.1 Hash Rego discovery (`/admin/discovery`)

**Finding candidates.** An admin presses **Sync Now** (`src/app/admin/discovery/actions.ts:24`). There is no cron. The last run was 2026-11-18 03:24 UTC, and 868 of 869 rows were seen in it.
- `syncKennelDiscovery` (`src/pipeline/kennel-discovery.ts:187`) fetches `hashrego.com/kennels/`.
- It parses the Google Maps JavaScript for slug, name, location and coordinates (`src/adapters/hashrego/kennel-directory-parser.ts:37`).
- It then enriches rows that are not yet terminal from `/api/kennels/{slug}` (`src/adapters/hashrego/kennel-api.ts`).

**Scoring.** `computeMatchResult` (`kennel-discovery.ts:445`):
- runs `fuzzyMatch` (`src/lib/fuzzy.ts:68`) on both the slug and the profile name, against every visible kennel's short name, full name and aliases;
- the score is Levenshtein similarity plus a 0.3 boost when one string contains the other (strings of 6 or more characters only);
- it then applies a geographic penalty (`kennel-discovery.ts:138`): 0 within 100 km, −0.10 up to 500 km, −0.30, −0.45, then −0.55 beyond 5,000 km; −0.15 for a country mismatch; +0.05 for the same country within 500 km.

**Outcomes:**
- **0.95 or more → `MATCHED`.** The sync immediately upserts `SourceKennel(HASHREGO, kennel, externalSlug)` (`kennel-discovery.ts:388-401`). No human sees it first.
- **0.6 to 0.95 → `NEW`** with the top three candidates for review.
- **Below 0.6 → `NEW`** with no candidates.

`MATCHED` is sticky: later syncs never re-score it (`kennel-discovery.ts:310-318`). On every sync they also re-create its `SourceKennel` row, overwriting `externalSlug` (`kennel-discovery.ts:327-343`, upsert at `:59-63`).

**Admin actions** (`src/app/admin/discovery/actions.ts`):

| Action | Writes |
|---|---|
| Confirm (`MATCHED → LINKED`, `:221`) | Global `KennelAlias` = the slug (unless it equals the short name), `SourceKennel.externalSlug`, row → `LINKED` |
| Link to existing kennel (`:42`) | Same as Confirm |
| Add kennel (`:77`) | New kennel, slug alias, `SourceKennel` |
| Dismiss (`:126`) | Row → `DISMISSED`. If the row was `MATCHED`, also deletes the kennel's Hash Rego `SourceKennel`, whichever slug it holds |

**Storage.** One mapping lives in four places:
- `KennelDiscovery.matchedKennelId` + `status`;
- `SourceKennel.externalSlug` on the HASHREGO source, one slug per kennel (`@@unique([sourceId, kennelId])`, `prisma/schema.prisma:350`);
- a global `KennelAlias` per confirmed slug;
- the seed's top-level `kennelSlugMap` on the Hash Rego entry (`prisma/seed-data/sources.ts:1347`).

The seed's `linkKennelsToSource` (`prisma/seed.ts:514-532`) sets `externalSlug` for its 19 kennels and deletes every other Hash Rego `SourceKennel` row.

**Consumers:**
- `scrapeSource` (`src/pipeline/scrape.ts:426-481`) passes the `SourceKennel` slugs to the adapter and scopes reconcile to those kennels. If there are no slugs, it falls back to discovery rows.
- The adapter (`src/adapters/hashrego/adapter.ts:58-130`) uses the slugs only to **choose** which events to fetch: index rows whose account is in the set, plus the per-kennel JSON API for slugs missing from the index.
- The event's kennel is then decided by **name**:
  - `kennelTags` is the detail page's "Host Kennel" display name (`src/adapters/hashrego/parser.ts:252`, `:544`, `:569`);
  - when the detail fetch fails, it is the raw account slug (`adapter.ts:548`);
  - per-day `kennelPatterns` overrides apply too.
- The merge pipeline resolves that string like any other tag (section 2.3) and applies the source-kennel guard.

The confirmed slug → kennel link is never used for routing. Routing works only because the confirmation also wrote the slug as an alias, and because display-name aliases get added by hand when events go missing (the memory note `reference_hashrego_kennel_routing_pitfalls`, PRs #1945 and #1947).

**Gemini rows share the table.** `src/pipeline/kennel-discovery-ai.ts` (Source Research) writes `externalSource: "GEMINI"` rows, with `MATCHED` at a fuzzy score of 0.8 (`:212`). The discovery page lists every row regardless of `externalSource` (`src/app/admin/discovery/page.tsx:9`). Its Confirm and Link buttons call the Hash Rego actions, which would write a Hash Rego `SourceKennel` with a Gemini-made slug. Prod has no such row yet. PR #3050 guards Half-Mind rows from those actions but not Gemini rows.

### 2.2 Half-Mind (PR #3050, open)

**On `main` today,** Half-Mind is used by hand only:
- research prompts and the playbook (`docs/source-onboarding-playbook.md:147`);
- the deep-dive audit prompt (`src/lib/admin/deep-dive-prompt.ts:85`);
- a Travel link (`src/components/travel/CoverageNote.tsx:7`);
- 21 listing ids that appear only as seed comments, such as `prisma/seed-data/kennels.ts:1644`, "Half-Mind #1073".

**PR #3050 adds:**
- **Fetching:** `src/adapters/half-mind/client.ts` reads `half-mind.com/api/v1/kennels.php` one region at a time. The pilot scope is Georgia. The client uses an honest User-Agent and never stores email.
- **Import bar:** a listing must be "Alive and Verified" within 365 days, have a website or Facebook link, and have coordinates.
- **Sync:** `src/pipeline/half-mind-discovery.ts` writes `KennelDiscovery` rows with `externalSource: "HALFMIND"` and `externalSlug` = the numeric listing id.
  - It ranks the top three candidates by **listing name only**, through the same `rankDiscoveryCandidates` the PR extracts from the Hash Rego code. The geo penalty still applies.
  - It never links, aliases or creates anything.
  - For linked listings it refreshes the check date, and it flags listings Half-Mind marks dead or no longer lists (`externalStatus: "missing"`).
- **Review:** `src/app/admin/discovery/half-mind-actions.ts`. Every row needs an admin.
  - **Link** sets `Kennel.halfMindListingId` (a new **unique** column) and records a RUNNING `KennelConfirmation` with `via: HALF_MIND`.
  - **Unlink** clears it and reverts that listing's checks.
  - **Add listing-only kennel** warns when a candidate scores 0.8 or more.
  - **Dismiss** works on NEW rows only.
- **Consumers:** kennel status (`lastConfirmedVia`), "How we know", kennel cards, Travel's Likely and "Other kennels near", the share image, and sitemap/noindex for listing-only kennels. Half-Mind never produces events.

**Storage:** `KennelDiscovery.matchedKennelId` plus `Kennel.halfMindListingId`, kept in step by transactions in the actions.

### 2.3 Our own sources: the resolver path

1. **Adapters route first where they can.** Multi-kennel sources carry `config.kennelPatterns` (regex → kennel code, first match wins) and `defaultKennelTag` (`prisma/seed-data/sources.ts`, applied in `src/adapters/kennel-patterns.ts`). Harrier Central routes by patterns, then `defaultKennelTag` (`src/adapters/harrier-central/adapter.ts:997`). HashStats maps external slug → kennel code through `config.kennelSlugMap`. These emit **kennel codes**.
2. **`resolveKennelTag`** (`src/pipeline/kennel-resolver.ts:143`) tries, in order:
   - kennel code (`:19`);
   - short name (`:44`);
   - alias (`:69`);
   - a hardcoded regex list of NYC, Boston, Philly, Chicago and NJ patterns (`:176-228`), then the three steps again.

   Each step looks first among kennels linked to this source, then **globally** with `findFirst` and no ordering (`:35`, `:60`, `:86`). There is no fuzzy matching and no full-name step.
3. **The source-kennel guard** (`src/pipeline/merge.ts:883-927`) drops a primary tag that resolves to a kennel not linked to the source, and raises `SOURCE_KENNEL_MISMATCH`. Unresolved tags raise `UNMATCHED_TAGS`. Co-host tags are resolved but not guarded (`merge.ts:2496-2511`).
4. **Human review** happens in PRs (seed + migration) and through alert repair actions (create alias, link kennel).

### 2.4 Side by side

| | Hash Rego discovery | Half-Mind (PR #3050) | Own sources |
|---|---|---|---|
| **Input** | Directory page + per-kennel profile API | Finder API, one region at a time | `RawEvent.kennelTags` from each adapter |
| **Identity key** | Account slug, a mixed-case string (`DCH4`, `AH4_PLH3`) | Numeric listing id | Kennel code (config-routed), else free text |
| **Matching rule** | Fuzzy on slug + profile name vs short name, full name and aliases; geo penalty | Same ranker, listing name only | Exact code → short name → alias → global regex; source-scoped, then global |
| **Auto-link** | Yes, at 0.95 or more, straight into the scraper | Never | n/a. Exact matches only, but the global fallback is unordered |
| **Stored in** | `KennelDiscovery` + `SourceKennel.externalSlug` + `KennelAlias` + seed `kennelSlugMap` | `KennelDiscovery` + `Kennel.halfMindListingId` + `KennelConfirmation` | `KennelAlias`, `Source.config`, `SourceKennel`, resolver constants |
| **Cardinality** | One slug per kennel in the scraper; many discovery rows per kennel | One listing ↔ one kennel (unique) | Many aliases per kennel; alias strings not unique |
| **Human review** | Optional (auto-links skip it) | Every row | PRs + alerts |
| **What consumes it** | Scraper slug list, reconcile scope; routing only through aliases | Kennel status evidence, public credit, Travel | Merge pipeline, guard |
| **Drift handling** | `lastSeenAt` only; `MATCHED` never re-scored | Dead and missing flagged | Alerts on unmatched or blocked tags |

## 3. What works, and what doesn't

### 3.1 Works

- **The source-kennel guard is the safety net that held.** No Hash Rego event from a wrongly linked account has landed on a kennel page in the retained data. The guard blocked the cross-region mismatches, and the bad accounts posted few events. The three Seattle "Hash House Harriettes" raws (2026-09-10 to 10-09) sit unprocessed instead of showing on DCH4.
- **The exact-1.0 auto-matches mostly look right** (15 of 22 `MATCHED` rows, for example `GndH3` → Grenada, `TBLH3` → Big Lik, `HellgateH3`). The exceptions are the two Portland Green Dress Run event accounts on `oh3`.
- **The geo penalty stops cross-continent matches.** None of the 22 auto-matches crosses a continent. It doesn't stop neighbouring-city matches, and that is where every wrong one sits.
- **The confirmed links checked for this review name the right kennel.** Examples: `ChiH3` → Chicago, `CHH3` → Charleston Heretics, `NOH3` → New Orleans, `SoCoH3` → Southern Comfort.
- **The directory is stable.** All 869 Hash Rego rows were created on 2026-03-03 and 03-04, and the latest sync saw 868 of them. The drift risk is renamed accounts and moved pins, not a flood of new ones.
- **PR #3050's policy is the right one:**
  - review every row;
  - store the external id as typed, unique data;
  - never make aliases from ids;
  - re-check the import bar when an action runs;
  - flag dead or missing listings;
  - keep Half-Mind as evidence, not events.
- **Config-routed sources are deterministic.** Harrier Central, HashStats and the Google Calendar sources with `kennelPatterns` emit kennel codes, so the resolver's step 0 settles them.

### 3.2 Doesn't

**1. Auto-matches near the threshold are wrong, and they overwrite correct links.** Seven `MATCHED` rows scored below 1.0. All were created on 2026-03-03, when the geo penalty landed.

| Hash Rego account | What it really is | Auto-linked to | Link it replaced |
|---|---|---|---|
| `Harriettes` (0.95) | Hash House Harriettes, Seattle | `dch4`, Washington DC | Seeded `DCH4` (also a `MATCHED` row, at 1.0) |
| `SCH3` (0.95) | Siete Cerveza H3, Fort Walton Beach FL | `sch3-atl`, Atlanta | `SoCoH3` (`LINKED`) |
| `Noh` (0.95) | "Noh3", Fort Walton Beach FL | `noh3`, New Orleans | `NOH3` (`LINKED`) |
| `SoulH3` (0.95) | Soul H3, Memphis | `wsh3`, Birmingham AL | Seeded `WSH3` (`LINKED`) |
| `MFM` (0.96) | Morgantown Fool Moon H3, a sister kennel | `mh3-wv` | `MOTOWNH3` (`LINKED`) |
| `HHSuck` (0.99) | Happy Heretics Suck H3, Mt Pleasant SC | `chh3` | `CHH3` (`LINKED`) |
| `PhillyHash` (0.96) | "Philly Events" | `philly-h3` | none; plausible |

Oregon H3 also lost its seeded `OregonH3` link to `PDXGDRH3`, a "PDX GDR" event account that matched at 1.0.

The `Harriettes` match shows a second weakness: the score uses the directory's map pin, not the profile. Hash Rego's directory pins that account in Harrisburg, PA (about 150 km from DC, so only −0.10 + 0.05), while its own profile says Seattle.

`SourceKennel` holds one slug per kennel, and the sync re-applies every `MATCHED` row on each run. So the wrong slug wins even after a reseed restores the right one. Every retained Hash Rego scrape log, back to 2026-10-22, lists `Harriettes`, `SCH3`, `Noh` and `SoulH3`, and none lists `DCH4`, `WSH3`, `SoCoH3`, `NOH3`, `OregonH3` or `MOTOWNH3`.

The near-threshold `NEW` rows show the same weakness:
- `PerthHHH` "Perth Harriettes" → Perth H3 (0.94);
- `GH3` Greenville SC → Asheville H3 (0.92);
- `BBHHH` Barbados **Bike** H3 → Barbados H3 (0.90), although `bbh3` exists as its own kennel.

**2. Missed coverage, with a concrete case.** Hash Rego's API lists `DCH4`'s "THE GREAT 24-HOUR BOOK BENDER" on 2026-11-28. `dch4` has no event that day. The other replaced accounts list nothing upcoming right now, so today the cost is one event. The cost grows with every campout these kennels post.

**3. Seeded slugs that point at another kennel's account.** Hash Rego's own profiles say:
- `CH3` = "Charlotte Hash House Harriers", Charlotte NC;
- `GFH3` = "Great Falls Hash House Harriers (MT)".

The seed maps them to Chicago (`ch3`) and Great Falls, Virginia (`gfh3`).

If the detail page fails, the adapter tags the event with the raw slug. `CH3` then resolves by kennel code to Chicago, and `GFH3` to the Virginia kennel. So a Charlotte or Montana event is **misrouted** whenever its detail fetch fails, and **dropped** when it succeeds, because neither display name resolves. The same index-fallback path would send a Siete Cerveza event tagged `SCH3` to Southern Comfort, since `SCH3` is an alias on both `sch3-atl` and `sch3-ca`, and only `sch3-atl` is linked.

**4. "Linked" doesn't mean scraped.** Of 260 `LINKED` rows:
- 16 have the matching `SourceKennel`;
- 8 have the kennel linked under a different slug;
- 236 have none.

Links made on every confirmation day from March to June mostly lost their scrape link. Only the 6 confirmed on 2026-07-10 are all intact, which fits a full reseed's prune (`prisma/seed.ts:527-531`) in between. Prod has 38 Hash Rego `SourceKennel` rows, against the seed's 19. The admin page shows these 236 kennels as done, but nothing scrapes them.

**5. Routing by display name needs an alias for every account.** The resolver can't map the Hash Rego name of 18 of the 37 linked accounts that have a profile to the linked kennel by code, short name or alias. This ignores the hardcoded resolver patterns, which rescue BFM. Examples are `DCFMH3` "DC Full mOOn Hash House Harriers", `MRH3` "Mutha Rucker Hash House Harriers" and `VBFMH3`.

Unprocessed Hash Rego raws show the failure as it happens:

| Raw tag | Count | Since | Fixed? |
|---|---|---|---|
| "Oregon Hash House Harriers" | 1 | 2026-06-03 | No. Exactly `oh3`'s full name, which the resolver never checks |
| "Flour City Hash House Harriers" | 4 | June | Later aliased |
| "Tuesday, Tuesday, Tuesday" | 2 | July | Later aliased |

**6. Aliases from external ids pollute a global namespace.** 228 of the 260 `LINKED` kennels carry their Hash Rego slug as an alias, and 29 of the 260 confirmed slugs also name another kennel. Slugs such as `CH3`, `SCH3`, `PH3` and `FCH3` are exactly the codes that collide across regions.

Across the whole table:
- 2,502 aliases;
- 47 alias strings on 2 or more kennels, for example `ch3` on 4 kennels and `bh3` on 6;
- 16 duplicated short names;
- 118 aliases equal another kennel's code or short name.

The global fallback picks among these with an unordered `findFirst`.

**7. Lifecycle gaps:**
- **Hidden kennels.** 8 `LINKED` rows point at hidden kennels: `ch3-sc`, `sech3`, `h3sc`, `jrh3` (twice), `cunth3`, `survivor-h3` and `hvh3`.
- **Kennel merges.** A merge deletes the merged kennel's `SourceKennel` when the target already has one on that source, so its Hash Rego slug is lost (`src/app/admin/kennels/actions.ts:681-700`). Merges don't repoint discovery rows.
- **Missing accounts.** Hash Rego sync never flags a confirmed account that left the directory.
- **Multiple accounts.** 34 kennels have 2 or 3 Hash Rego accounts, but the scraper can hold only one per kennel.

**8. Unreviewed backlog.** There are 582 `NEW` Hash Rego rows:

| Best score | Rows | Likely meaning |
|---|---|---|
| 0.8 or more | 41 | Mostly kennels we already track |
| 0.6 to 0.8 | 116 | Needs a look |
| No candidate | 429 | Not in HashTracks |

**9. Half-Mind PR, smaller points:**
- It adds a third storage pattern, a per-directory column on `Kennel`.
- The 1:1 unique can't hold a kennel with a duplicate listing.
- Matching ignores the listing's city and state text; coordinates still feed the geo penalty.
- Dead or missing flags show only on the admin screen. The PR lists this as a follow-up.
- The guard on the Hash Rego actions is a denylist on `HALFMIND`, so Gemini rows still reach those actions.

## 4. Where the three diverge without a good reason, and the risks

| Divergence | Why it matters | Risk |
|---|---|---|
| Hash Rego auto-links; Half-Mind and our sources never do | A fuzzy score decides what the scraper fetches | **Misrouted or missed events** (section 3.2, items 1–2). Wrong links stay for months because `MATCHED` is sticky |
| Hash Rego routes by display name; config-routed sources route by external id → kennel code | The confirmed link is thrown away at routing time | **Silent drops** when a name isn't aliased, and **misroutes** when a slug collides (`CH3`, `GFH3`, `SCH3`) |
| Confirmation writes the external id as a global alias; Half-Mind refuses to | Ids like `CH3` become names for every source | **Wrong resolution for unrelated sources.** The global fallback is unordered |
| One identity in four stores (Hash Rego), two (Half-Mind), or config (others) | Stores disagree, and the seed and the sync overwrite each other | **Drift.** 236 confirmed links not scraped; seeded links replaced |
| One slug per kennel (Hash Rego); 1:1 (Half-Mind); many aliases (own) | Real kennels have event accounts and sister-kennel accounts | **Missed coverage** for 34 multi-account kennels; pressure to bend a sister kennel into the parent |
| Resolver ignores full name; discovery and Half-Mind match on it | Directories publish full names | **Drops** such as "Oregon Hash House Harriers" |
| Hardcoded NYC/Boston/Philly regexes apply to every source | Several are unanchored (`/moon\|moom/` → bos-moon, `/lil/`, `/special/`, `/summit/`, `/knick/`) | A tag from any region can resolve to an NYC or Boston kennel; the guard blocks it, but the event is lost |
| Dead or missing detection only for Half-Mind | Directories change; accounts close or rename | **Stale links** to accounts that no longer exist |

## 5. Recommendations, ranked

| # | Change | Value | Effort | Unifies? | Migration or cleanup |
|---|---|---|---|---|---|
| R1 | Repair the wrong Hash Rego links | High, now | S | No | Data migration + seed edit |
| R2 | Stop auto-linking; allowlist Hash Rego actions | High | S | Policy: matches Half-Mind | One-time re-review of 22 `MATCHED` rows |
| R3 | Decide what "linked" means; stop the seed and the sync overwriting each other | High | S (decision) | Partly | None until R5 |
| R4 | Route Hash Rego events by account slug, not display name | High | M | Yes: same path as HashStats and HC | None for schema; new raws on first run |
| R5 | One `KennelExternalId` table for every directory | High, long term | M–L | **Yes, the unifying change** | Backfill + conflict report |
| R6 | Resolver hygiene: refuse ambiguous globals; scope the regex list; source-scoped full-name step; no id aliases | Medium | S–M | Yes: one resolver path | Alias cleanup |
| R7 | Lifecycle: merges and hides repoint links; flag missing accounts; scheduled sync after R2 | Medium | S | Yes | Repoint 8 rows |
| R8 | Clear the `NEW` backlog, starting with the 41 rows scoring 0.8 or more | Medium | Owner time | — | — |

### R1. Repair the wrong links now

Ship one data migration, following `.claude/rules/prod-data-ops.md` (dry run, counts, then your OK).

**Restore the scrape links:**

| Kennel | Correct slug |
|---|---|
| `dch4` | `DCH4` |
| `wsh3` | `WSH3` |
| `noh3` | `NOH3` |
| `sch3-atl` | `SoCoH3` |
| `mh3-wv` | `MOTOWNH3` |
| `chh3` | `CHH3` |
| `oh3` | `OregonH3` |

**In the same migration, take the wrong `MATCHED` rows off `MATCHED`:** `Harriettes`, `SCH3`, `Noh`, `SoulH3`, `MFM` and `HHSuck`.
- Set them to `NEW` with `matchedKennelId` null; Siete Cerveza, Soul and Fort Walton "Noh3" may be kennels worth adding.
- Leave `PDXGDR` and `PDXGDRH3` for R3/R5.
- Without this, the next discovery sync's self-heal (`kennel-discovery.ts:327-343`) writes the wrong slugs straight back.

**In the seed:**
- change `ch3: "CH3"` to `ch3: "ChiH3"`;
- resolve `gfh3`: find Great Falls VA's real account, or drop the link;
- update the `dch4`, `wsh3` and `oh3` comments to match.

**Then** run one Hash Rego scrape with `days: 365` to pick up DCH4's 2026-11-28 event. Leave the three unprocessed Seattle raws alone; raws are immutable, and they never reached an event.

### R2. Stop auto-linking

In `syncKennelDiscovery`:
- drop the `SourceKennel` write for new `MATCHED` rows (`kennel-discovery.ts:388-401`);
- drop the self-heal (`:327-343`).

`MATCHED` then means "suggested, ready to confirm", as for Half-Mind. Re-review the 22 existing `MATCHED` rows once.

Change the Hash Rego actions in `actions.ts` to accept only `externalSource === "HASHREGO"`, instead of refusing only `HALFMIND`, so Gemini rows can't create Hash Rego links. About a day with tests.

### R3. Decide what "linked" means

Today an admin link is only an identity for 236 kennels, and that happened by accident. Pick one:
- **(a) Identity and scraping are separate.** The page shows both ("same kennel" and "being scraped"), and the seed stays the list of scraped accounts.
- **(b) A confirmed link means scrape it.** The seed stops pruning links it didn't create.

Recommendation: (a) until R4 and R5 land, then (b). Scraping all ~230 confirmed accounts costs one JSON API call per account not on the index page, with the cold-stall retry from `reference_hashrego_api_cold_stall_retry`. Check the time budget first.

### R4. Route Hash Rego events by account slug

The adapter already knows each event's account: the index row's `kennelSlug`, the event-slug prefix, and the sidebar link.
- Pass a `slug → kennelCode` map from the confirmed links into `fetch`. `scrape.ts:426-481` already builds `kennelIdsBySlug`. This is the HashStats `kennelSlugMap` shape.
- Emit `kennelTags: [kennelCode]`, with the per-day `kennelPatterns` override kept.
- Use the display name only as a fallback for an unmapped slug.

**This removes:**
- the need for display-name aliases (pitfall 1 in `reference_hashrego_kennel_routing_pitfalls`);
- the need to write slug aliases on confirm;
- the `CH3`, `GFH3` and `SCH3` index-fallback collisions.

It also supports several accounts per kennel naturally.

**Cleanup:** the changed `kennelTags` change raw fingerprints, so the first scrape creates new immutable raws. The merge matches them to the same kennel and date, so canonical events don't change. Verify with a dry merge on the local DB copy.

### R5. One external-id table (the unifying change)

```prisma
model KennelExternalId {
  id          String   @id @default(cuid())
  kennelId    String
  directory   ExternalDirectory   // HASHREGO | HALFMIND | HARRIER_CENTRAL | MEETUP | HASHSTATS | GEMINI
  externalId  String              // "DCH4", "1073", ...
  state       ExternalIdState     // SUGGESTED | CONFIRMED | REJECTED
  origin      ExternalIdOrigin    // SEED | ADMIN | MIGRATION | SYNC
  confirmedBy String?
  confirmedAt DateTime?
  externalStatus String?          // alive / dead / missing (directory's own claim)
  lastSeenAt  DateTime?
  @@unique([directory, externalId])   // one external entry -> at most one kennel
  @@index([kennelId])                 // a kennel may hold many
}
```

**What each part does:**
- `KennelDiscovery` stays as the inbox: the raw listing snapshot and its candidates.
- Confirming a row writes a `CONFIRMED` `KennelExternalId` instead of an alias plus `SourceKennel.externalSlug`.
- The Hash Rego scrape reads `CONFIRMED` `HASHREGO` rows. `SourceKennel` keeps its one job, "this source feeds this kennel", for the guard.
- The Half-Mind evidence code reads `HALFMIND` rows instead of `Kennel.halfMindListingId`.
- The resolver gets one new first step: *(this source's directory, external id) → kennel*. This is the single resolver path for all id-bearing sources.
- The seed's `kennelSlugMap` writes `origin = SEED` rows and prunes only those.

**Migration:**
1. Create the table.
2. Write a read-only conflict report first. Expect the R1 kennels, if R1 hasn't run, and the 34 multi-account kennels.
3. Backfill from:
   - the 38 Hash Rego `SourceKennel` slugs;
   - 266 `LINKED`/`ADDED` discovery rows (Hash Rego and Gemini), as `CONFIRMED`;
   - 22 `MATCHED` rows, as `SUGGESTED`;
   - `Kennel.halfMindListingId`, if #3050 has merged;
   - optionally, the 21 Half-Mind ids in seed comments, as `SUGGESTED`.
4. Switch the readers.
5. Drop the old columns in a later migration.

**On PR #3050:** don't block it. Its policy matches this design. Either merge it as is and fold `Kennel.halfMindListingId` into the table in R5, or, if you approve R5 first, swap the column for a `HALFMIND` row before it merges. This is open question 5.

### R6. Resolver hygiene

- **Ambiguous globals.** When the source-scoped step misses and the global step finds two or more kennels, return unmatched with reason "ambiguous" instead of `findFirst` (`kennel-resolver.ts:35`, `:60`, `:86`).
- **The regex list.** Move `KENNEL_PATTERNS` (`:176-228`) into the HashNYC, Boston, Philly, Chicago and Summit sources' `config.kennelPatterns`, so they stop applying to every source.
- **Full names.** Add a full-name step limited to kennels linked to the source.
- **Id aliases.** Stop writing ids as aliases. Delete the slug aliases that collide (the 29 above) once R4 makes them unnecessary.

### R7. Lifecycle

- Merging or hiding a kennel repoints, or closes, its discovery rows and external ids.
- The Hash Rego sync flags confirmed accounts missing from the directory, as #3050 does.
- Put the Hash Rego discovery sync on a weekly cron only after R2.

## 6. Open questions for the owner

1. **What should "linked" mean on the discovery page:** the same kennel, or "scrape this account"? Today 236 confirmed links are identity only.
2. **Should any directory ever auto-link?** Recommendation: no, suggest only.
3. **Kennels with several Hash Rego accounts.** Should event accounts (PDX GDR) feed the parent kennel, and should sister-kennel accounts (Morgantown Fool Moon, Happy Heretics Suck) become their own kennels?
4. **Two seeded slugs to confirm.** Is `ChiH3` Chicago's account? Does Great Falls, Virginia have a Hash Rego account at all?
5. **PR #3050's storage.** Keep `Kennel.halfMindListingId` and migrate it later, or switch to the shared table before it merges?
6. **Scrape budget.** Is it acceptable to scrape all ~230 confirmed Hash Rego accounts (option (b) in R3), given the per-account API calls and cold-stall retries?
7. **Gemini discovery rows.** Should they leave this table entirely (they come from Source Research), or stay as `SUGGESTED` external ids with no directory id?

## Appendix: queries behind the numbers

All queries ran as `SELECT` under `default_transaction_read_only=on` against prod on 2026-11-18 UTC.

- **Discovery rows by source and status:** `KennelDiscovery` grouped by `externalSource`, `status`. HASHREGO 869 (NEW 582, MATCHED 22, LINKED 260, DISMISSED 5); GEMINI 27; HALFMIND 0. The column `Kennel.halfMindListingId` doesn't exist in prod yet.
- **Coverage:** 562 visible kennels; 236 visible kennels mapped to at least one Hash Rego account, so 326 are unmapped. 243 kennels are mapped in all (230 by an admin), and 34 have 2 or 3 accounts.
- **Scrape links:** 38 Hash Rego `SourceKennel` rows, all with a slug, all distinct. Each `LINKED`/`MATCHED` row was joined to `SourceKennel` on the matched kennel, comparing slugs case-insensitively.
- **Scrape logs:** `ScrapeLog.diagnosticContext.kennelSlugsConfigured`, retained from 2026-10-22: 29 slugs, then 30 from 11-06, then 37 from 11-09.
- **Raw events:** Hash Rego `RawEvent` grouped by `rawData.kennelTags[0]` and the resulting event's kennel: 164 raws across 12 kennels, with 10 unprocessed raws in 4 tags.
- **Aliases:** `KennelAlias` grouped by `lower(alias)` across kennels; joined to `Kennel` on code and short name.
- **Hash Rego public API:** `GET /api/kennels/{slug}/events/` for the ten slugs named in section 3.2 (one request each).
