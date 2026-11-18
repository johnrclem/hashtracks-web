# Kennel Directory Mapping: Review and Recommendations

**Status:** Draft for owner review, 2026-11-18 (revised after an adversarial review)
**Scope:** how HashTracks maps two external kennel directories, Hash Rego and Half-Mind, to its own kennels, compared with how it resolves the kennels of its own scraped sources.
**Evidence:** code on `main` at `5f9bfbbf`, open PR [#3050](https://github.com/johnrclem/hashtracks-web/pull/3050) (Half-Mind listings, stacked on [#3043](https://github.com/johnrclem/hashtracks-web/pull/3043)), read-only prod queries run 2026-11-18 03:30–05:30 UTC, and a few public Hash Rego API reads. This review changed no code, config or data. It ran only `SELECT`s. A Hash Rego discovery sync ran in prod at 03:24 UTC, just before the queries; it was not started by this review, and it wrote the `HellgateH3` link counted below.

## 1. Summary

HashTracks has three ways of deciding "this external thing is that kennel of ours", and they share almost nothing.

- **Hash Rego** matches directory entries to kennels by fuzzy name score, and **links them on its own** at a score of 0.95 or more. The link only controls which Hash Rego accounts get scraped. The scraped events are then routed by the host kennel's *display name*, through the general name resolver.
- **Half-Mind** (PR #3050, not merged) uses the same fuzzy ranker, but **never links on its own**, stores the listing id as structured data, and only feeds kennel-status evidence.
- **Our own sources** resolve by exact kennel code, short name or alias, plus a hardcoded regex list that applies to every source.

**What the data shows:**

1. **Seven wrong Hash Rego links are live.** Fuzzy auto-matches at 0.95–0.99 replaced correct links on six kennels: DCH4, Southern Comfort (Atlanta), NOH3 (New Orleans), Wandering Soul (Birmingham), Morgantown H3 and Charleston Heretics. Oregon H3 lost its link to an event account. HashTracks now scrapes, for example, a Fort Walton Beach "SCH3" for Atlanta's Southern Comfort. One concrete miss: DCH4's "The Great 24-Hour Book Bender" on 2026-11-28 is on Hash Rego and not in HashTracks.
2. **Two seeded Hash Rego links are probably wrong in the seed itself.** `ch3` (Chicago) is mapped to the `CH3` account, which Hash Rego's own profile says is Charlotte, NC. `gfh3` (Great Falls, Virginia) is mapped to `GFH3`, which is "Great Falls Hash House Harriers (MT)".
3. **"Linked" on the discovery page doesn't mean "scraped".** An admin confirmed 260 Hash Rego links. Only 16 of them still have the matching scrape link, and 236 have none at all. At least seven code paths write the same `SourceKennel` rows (section 2.1), and they overwrite each other.
4. **Events are routed by display name, not by the link.** The resolver can't map the Hash Rego name of 18 of 37 linked accounts to the linked kennel, so their detail-page events go unmatched until someone adds an alias. That same name check is also what has blocked the wrong links so far.
5. **The alias table is a shared namespace with collisions.** 47 alias strings point at two or more kennels, 16 short names are duplicated, and 85 aliases equal another kennel's code or short name. The resolver's global fallback picks one of them with `findFirst` and no ordering.

**Recommendation, in order:**
1. Change the discovery code first, so it stops auto-linking and stops overwriting slugs (R2).
2. Then repair the wrong links with one data migration (R1).
3. Re-review the auto-matches.
4. Only then route Hash Rego events by account slug, keeping a name cross-check (R4).
5. Finally, keep every directory's external ids in one `KennelExternalId` table (R5).

R1 on its own would not stick: the next discovery sync rewrites the wrong slugs (section 5). PR #3050 already follows most of the right policy and should not be blocked. Section 5 has the ranked list.

## 2. How each mechanism works today

### 2.1 Hash Rego discovery (`/admin/discovery`)

**Finding candidates.** An admin presses **Sync Now** (`src/app/admin/discovery/actions.ts:24`). There is no cron.
- `syncKennelDiscovery` (`src/pipeline/kennel-discovery.ts:187`) fetches `hashrego.com/kennels/`.
- It parses the Google Maps JavaScript for slug, name, location and map pin (`src/adapters/hashrego/kennel-directory-parser.ts:37`).
- It enriches rows that are not yet terminal from `/api/kennels/{slug}` (`src/adapters/hashrego/kennel-api.ts`).

All 869 Hash Rego rows were created by the first sync on 2026-03-03 and 03-04, the day the pipeline shipped, and the latest sync saw 868 of them.

**Scoring.** `computeMatchResult` (`kennel-discovery.ts:445`):
- runs `fuzzyMatch` (`src/lib/fuzzy.ts:68`) on both the slug and the profile name, against every visible kennel's short name, full name and aliases;
- the score is Levenshtein similarity plus a 0.3 boost when one string contains the other (strings of 6 or more characters only), capped at 1.0;
- it then applies a geographic penalty (`kennel-discovery.ts:138`), using the **directory map pin**, not the profile's address: 0 within 100 km, −0.10 up to 500 km, −0.30, −0.45, then −0.55 beyond 5,000 km; −0.15 for a country mismatch; +0.05 for the same country within 500 km.

**Outcomes:**
- **0.95 or more → `MATCHED`.** The sync immediately upserts `SourceKennel(HASHREGO, kennel, externalSlug)` (`kennel-discovery.ts:388-401`). No human sees it first.
- **0.6 to 0.95 → `NEW`** with the top three candidates for review.
- **Below 0.6 → `NEW`** with no candidates.

`NEW` rows are scored again on every sync. `MATCHED` is sticky and never re-scored (`kennel-discovery.ts:310-318`). On every sync each `MATCHED` row also upserts its `SourceKennel`, overwriting `externalSlug` (`kennel-discovery.ts:327-343`, upsert at `:59-63`). When one kennel has two `MATCHED` rows, both write the same row, and the one processed later in directory order wins. That happens today for dch4 (`DCH4` and `Harriettes`), oh3 (`PDXGDR` and `PDXGDRH3`) and ssh3-wa.

**Admin actions on the discovery page** (`src/app/admin/discovery/actions.ts`):

| Action | Writes |
|---|---|
| Confirm (`MATCHED → LINKED`, `:221`) | Global `KennelAlias` = the slug (unless it equals the short name), `SourceKennel.externalSlug` (overwriting a different slug), row → `LINKED` |
| Link to existing kennel (`:42`) | Same as Confirm |
| Add kennel (`:77`) | New kennel, slug alias, `SourceKennel` |
| Dismiss (`:126`) | Row → `DISMISSED`. If the row was `MATCHED`, also deletes the kennel's Hash Rego `SourceKennel`, **whatever slug it holds** |

**Other writers of Hash Rego `SourceKennel` rows.** Each of these can undo a repair:

| Writer | Effect |
|---|---|
| Seed `linkKennelsToSource` (`prisma/seed.ts:514-532`) | Sets the slug for its 19 kennels from the top-level `kennelSlugMap` (`prisma/seed-data/sources.ts:1347`) and **deletes every other** Hash Rego link |
| Source edit form `updateSource` (`src/app/admin/sources/actions.ts:172-185`) | Deletes all of the source's links and re-creates them **without slugs**. The scraper then falls back to `KennelDiscovery` slugs with no status filter (`src/pipeline/scrape.ts:451-480`), so wrong `MATCHED` rows come back |
| Link from a tag (`linkKennelToSourceDirect`, `sources/actions.ts:228-245`; create-from-tag, `:400-405`) | Sets `externalSlug` to the **tag upper-cased**, so a display name becomes a fake slug |
| Slug editor (`updateSourceKennelSlug`, `sources/actions.ts:430`) | Upper-cases the slug (`OregonH3` → `OREGONH3`) |
| Alert repair "link kennel" (`src/app/admin/alerts/actions.ts:331-358`) and `createKennelFromAlert` | Creates a link with no slug |
| `scripts/backfill-hashrego-source-kennels.ts --apply` | Links **every** kennel with a `LINKED`, `ADDED` or `MATCHED` row and no link yet: about 236 kennels, hidden ones included. That silently picks R3 option (b) |
| `unlinkKennelFromSource`, `deleteKennel` (`src/app/admin/kennels/actions.ts:457`) | Delete links |

**Consumers:**
- `scrapeSource` (`src/pipeline/scrape.ts:426-481`) passes the slugs to the adapter and scopes reconcile to those kennels.
- The adapter (`src/adapters/hashrego/adapter.ts:58-130`) uses the slugs only to **choose** which events to fetch: index rows whose account is in the set, plus the per-kennel JSON API for slugs missing from the index.
- The event's kennel is then decided by **name**:
  - `kennelTags` is the detail page's "Host Kennel" display name (`src/adapters/hashrego/parser.ts:252`, `:544`, `:569`);
  - when the detail fetch fails, it is the raw account slug (`adapter.ts:548`);
  - per-day `kennelPatterns` overrides apply.
- Merge and reconcile (`src/pipeline/reconcile.ts:245`) both resolve that string through the resolver (section 2.3), and the source-kennel guard applies.

The confirmed slug → kennel link is never used for routing. Routing works because confirmation also wrote the slug as an alias, and because display-name aliases get added by hand when events go missing (memory note `reference_hashrego_kennel_routing_pitfalls`, PRs #1945 and #1947).

**Gemini rows share the table.** `src/pipeline/kennel-discovery-ai.ts` (Source Research) writes `externalSource: "GEMINI"` rows, `MATCHED` at a fuzzy score of 0.8 (`:212`). The discovery page lists every row regardless of source (`src/app/admin/discovery/page.tsx:9`), and its buttons call the Hash Rego actions. The alias `black-sheep-hhh` on `bsh3`, a Gemini-made slug, shows these actions have already been used on a Gemini row. Any Hash Rego link that wrote has since gone. PR #3050 guards Half-Mind rows from those actions but not Gemini rows.

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
  - It ranks the top three candidates by **listing name only**, with `rankDiscoveryCandidates`, which the PR extracts from the Hash Rego code. It is the same ranker and the same `kennel-discovery.ts` file that R2 below changes.
  - It never links, aliases or creates anything.
  - For linked listings it refreshes the check date, and it flags listings Half-Mind marks dead or no longer lists (`externalStatus: "missing"`).
- **Weekly cron:** `/api/cron/half-mind-sync`, Mondays at 10:00 UTC, off unless `HALF_MIND_SYNC_ENABLED=true`.
- **Review:** `src/app/admin/discovery/half-mind-actions.ts`. Every row needs an admin.
  - **Link** sets `Kennel.halfMindListingId` (a new **unique** column) and records a RUNNING `KennelConfirmation` with `via: HALF_MIND`.
  - **Unlink** clears it and reverts that listing's checks.
  - **Add listing-only kennel** warns when a candidate scores 0.8 or more.
  - **Dismiss** works on NEW rows only.
- **Consumers:** kennel status (`lastConfirmedVia`), "How we know", kennel cards, Travel, the share image, and sitemap/noindex for listing-only kennels. Half-Mind never produces events.

**Storage:** `KennelDiscovery.matchedKennelId` plus `Kennel.halfMindListingId`, kept in step by transactions in the actions.

### 2.3 Our own sources: the resolver path

1. **Adapters route first where they can.**
   - Multi-kennel sources carry `config.kennelPatterns` (regex → kennel code) and `defaultKennelTag`.
   - Harrier Central routes by patterns, then `defaultKennelTag` (`src/adapters/harrier-central/adapter.ts:997`).
   - HashStats maps external slug → kennel code through `config.kennelSlugMap`.

   All of these emit **kennel codes**.
2. **`resolveKennelTag`** (`src/pipeline/kennel-resolver.ts:143`) tries, in order:
   - kennel code (`:19`);
   - short name (`:44`);
   - alias (`:69`);
   - a hardcoded regex list of NYC, Boston, Philly, Chicago and NJ patterns (`:176-228`), then the three steps again.

   Each step looks first among kennels linked to this source, then **globally**, with `findFirst` and no ordering (`:35`, `:60`, `:86`). There is no fuzzy matching and no full-name step.
3. **The source-kennel guard** (`src/pipeline/merge.ts:883-927`) drops a primary tag that resolves to a kennel not linked to the source, and raises `SOURCE_KENNEL_MISMATCH`. Its suggested action is "Link <kennel> to this source" (`merge.ts:918`). Unresolved tags raise `UNMATCHED_TAGS`. Co-host tags are resolved but not guarded (`merge.ts:2496-2511`).
4. **Human review** happens in PRs (seed + migration) and through alert repair actions (create alias, link kennel).

### 2.4 Side by side

| | Hash Rego discovery | Half-Mind (PR #3050) | Own sources |
|---|---|---|---|
| **Input** | Directory page + profile API | Finder API, one region at a time | `RawEvent.kennelTags` from each adapter |
| **Identity key** | Account slug, mixed case (`DCH4`, `AH4_PLH3`) | Numeric listing id | Kennel code (config-routed), else free text |
| **Matching rule** | Fuzzy on slug + profile name vs short name, full name and aliases; geo penalty from the map pin | Same ranker, listing name only | Exact code → short name → alias → global regex; source-scoped, then global |
| **Auto-link** | Yes, at 0.95 or more, straight into the scraper | Never | n/a (exact matches; global fallback unordered) |
| **Stored in** | `KennelDiscovery` + `SourceKennel.externalSlug` + `KennelAlias` + seed `kennelSlugMap` | `KennelDiscovery` + `Kennel.halfMindListingId` + `KennelConfirmation` | `KennelAlias`, `Source.config`, `SourceKennel`, resolver constants |
| **Writers** | Sync, 4 discovery actions, seed, 4 source/alert admin actions | Sync + 4 Half-Mind actions | PRs, alert actions |
| **Cardinality** | One slug per kennel in the scraper; many discovery rows per kennel | One listing ↔ one kennel (unique) | Many aliases per kennel; alias strings not unique |
| **Human review** | Optional (auto-links skip it) | Every row | PRs + alerts |
| **What consumes it** | Scraper slug list, reconcile scope; routing only through aliases | Kennel status evidence, public credit, Travel | Merge, reconcile, guard |
| **Drift handling** | `lastSeenAt` only; `MATCHED` never re-scored | Dead and missing flagged | Alerts on unmatched or blocked tags |

## 3. What works, and what doesn't

### 3.1 Works

- **The source-kennel guard has held so far, but only by luck of naming.** No event from a wrongly linked account has reached a kennel page.
  - The three Seattle "Hash House Harriettes" raws sit unprocessed. That display name resolves to NYC's `harriettes-nyc`, which isn't linked to Hash Rego.
  - The guard's alert from 2026-07-11 suggests "Link Harriettes to this source". One click on that repair would publish Seattle's events on NYC Harriettes. R4 below would remove even this check unless it keeps a name cross-check.
- **The exact-1.0 auto-matches mostly look right** (15 of 22 `MATCHED` rows, for example `GndH3` → Grenada, `TBLH3` → Big Lik, `HellgateH3`). The exceptions are the two Portland Green Dress Run event accounts on `oh3`.
- **The geo penalty stops cross-continent matches.** None of the 22 auto-matches crosses a continent. It doesn't stop neighbouring-city matches, and it trusts the directory pin. Every wrong match sits there.
- **The confirmed links checked for this review name the right kennel.** Examples: `ChiH3` → Chicago, `CHH3` → Charleston Heretics, `NOH3` → New Orleans, `SoCoH3` → Southern Comfort.
- **The directory is stable.** No new Hash Rego account has appeared since March. The drift risk is renamed accounts and moved pins.
- **PR #3050's policy is the right one:**
  - review every row;
  - store the external id as typed, unique data;
  - never make aliases from ids;
  - re-check the import bar when an action runs;
  - flag dead or missing listings;
  - keep Half-Mind as evidence, not events.
- **Config-routed sources are deterministic.** Harrier Central, HashStats and the Google Calendar sources with `kennelPatterns` emit kennel codes, so the resolver's step 0 settles them.

### 3.2 Doesn't

**1. Auto-matches near the threshold are wrong, and they overwrite correct links.** Seven `MATCHED` rows scored below 1.0, all from the first sync on 2026-03-03.

| Hash Rego account | What it really is | Auto-linked to | Link it replaced |
|---|---|---|---|
| `Harriettes` (0.95) | Hash House Harriettes, Seattle (directory pin in Harrisburg, PA) | `dch4`, Washington DC | Seeded `DCH4`, also `MATCHED` at 1.0; `Harriettes` wins the write order |
| `SCH3` (0.95) | Siete Cerveza H3, Fort Walton Beach FL | `sch3-atl`, Atlanta | `SoCoH3` (`LINKED`) |
| `Noh` (0.95) | "Noh3", Fort Walton Beach FL | `noh3`, New Orleans | `NOH3` (`LINKED`) |
| `SoulH3` (0.95) | Soul H3, Memphis | `wsh3`, Birmingham AL | Seeded `WSH3` (`LINKED`) |
| `MFM` (0.96) | Morgantown Fool Moon H3, a sister kennel | `mh3-wv` | `MOTOWNH3` (`LINKED`) |
| `HHSuck` (0.99) | Happy Heretics Suck H3, Mt Pleasant SC | `chh3` | `CHH3` (`LINKED`) |
| `PhillyHash` (0.96) | "Philly Events" | `philly-h3` | none, but `PhillyH3` ("Philadelphia Hash House Harriers", the real account) sits unreviewed in `NEW` at 0.94 |

Oregon H3 also lost its seeded `OregonH3` link to the "PDX GDR" event accounts, which matched at 1.0.

The `Harriettes` score shows how near misses pass. "Harriettes" against dch4's alias "DC Harriettes" scores 0.77 plus the 0.3 containment boost, capped at 1.0. The directory pins the account in Harrisburg, about 150 km from DC, so the score drops by only 0.05, to 0.95.

**Evidence that the wrong slugs are what gets scraped:**
- every retained daily scrape log (from 2026-10-22) lists `Harriettes`, `SCH3`, `Noh` and `SoulH3`, and none lists `DCH4`, `WSH3`, `SoCoH3`, `NOH3`, `OregonH3` or `MOTOWNH3`;
- the `Harriettes` raws were scraped from 2026-07-11;
- a raw from `WSH3` shows that account was still scraped on 2026-06-03.

So the swap happened by July for `Harriettes`, and between June and October for `SoulH3`. The exact mechanism is inferred: `SourceKennel` has no timestamps.

The near-threshold `NEW` rows show the same weakness:
- `PerthHHH` "Perth Harriettes" → Perth H3 (0.94);
- `GH3` Greenville SC → Asheville H3 (0.92);
- `BBHHH` Barbados **Bike** H3 → Barbados H3 at 0.90, tied with the right kennel `bbh3`.

**2. Missed coverage, with a concrete case.** Hash Rego's API lists `DCH4`'s "THE GREAT 24-HOUR BOOK BENDER" on 2026-11-28, and `dch4` has no event that day. The other replaced accounts list nothing upcoming right now, so the cost today is one event. It grows with every campout these kennels post.

**3. Seeded slugs that point at another kennel's account.** Hash Rego's own profiles say:
- `CH3` = "Charlotte Hash House Harriers", Charlotte NC;
- `GFH3` = "Great Falls Hash House Harriers (MT)".

The seed maps them to Chicago (`ch3`) and Great Falls, Virginia (`gfh3`).

If the detail page fails, the adapter tags the event with the raw slug. `CH3` then resolves by kennel code to Chicago, and `GFH3` to the Virginia kennel. So a Charlotte or Montana event is **misrouted** when its detail fetch fails, and **dropped** when it succeeds, because neither display name resolves.

The same index-fallback path would send a Siete Cerveza event tagged `SCH3` to Southern Comfort. `SCH3` is an alias on both `sch3-atl` and `sch3-ca`, and only `sch3-atl` is linked.

Hash Rego is `gfh3`'s only source, and the kennel has 0 events.

**4. "Linked" doesn't mean scraped.** Of 260 `LINKED` rows:
- 16 have the matching `SourceKennel`;
- 8 have the kennel linked under a different slug;
- 236 have none.

Prod has 38 Hash Rego `SourceKennel` rows, against the seed's 19. The admin page shows those 236 kennels as done, but nothing scrapes them.

Why they are missing is **inferred, not proven**, because `SourceKennel` has no timestamps. Some deletion must have happened: prod has no slug-less Hash Rego rows, so even links made before the `externalSlug` column existed (commit `f51bb37b`, 2026-03-24) were later removed, not just left without a slug. The likely deleters are a full reseed's prune (`prisma/seed.ts:527-531`) or a save of the Hash Rego source form (section 2.1). Commit `e88687eb` (2026-04-08) says the scraper "only saw the 12 slugs that had been manually confirmed", which fits.

Only the 6 links confirmed on 2026-07-10 are all intact.

**5. Routing by display name needs an alias for every account.** The resolver can't map the Hash Rego name of 18 of the 37 linked accounts with a profile to the linked kennel by code, short name or alias. This ignores the hardcoded resolver patterns, which rescue BFM. Examples are `DCFMH3` "DC Full mOOn Hash House Harriers", `MRH3` "Mutha Rucker Hash House Harriers" and `VBFMH3`.

Unprocessed Hash Rego raws show the failure:

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
- 85 aliases that equal another kennel's code or short name.

The global fallback picks among these with an unordered `findFirst`.

**7. Lifecycle gaps:**
- **Hidden kennels.** 8 `LINKED` rows point at hidden kennels: `ch3-sc`, `sech3`, `h3sc`, `jrh3` (twice), `cunth3`, `survivor-h3` and `hvh3`.
- **Kennel merges.** A merge deletes the merged kennel's `SourceKennel` when the target already has one on that source, so its Hash Rego slug is lost (`src/app/admin/kennels/actions.ts:681-700`). Merges don't repoint discovery rows.
- **Missing accounts.** Hash Rego sync never flags a confirmed account that left the directory.
- **Multiple accounts.** 34 kennels have 2 or 3 Hash Rego accounts, but the scraper can hold only one per kennel.
- **Slug case.** Slugs are stored in mixed case by discovery and upper-cased by the admin editors.

**8. Unreviewed backlog.** There are 582 `NEW` Hash Rego rows:

| Best score | Rows | Likely meaning |
|---|---|---|
| 0.8 or more | 41 | Mostly kennels we already track |
| 0.6 to 0.8 | 112 | Needs a look |
| Below 0.6 | 429 | Not in HashTracks |

**9. Half-Mind PR, smaller points:**
- It adds a third storage pattern, a per-directory column on `Kennel`.
- The 1:1 unique can't hold a kennel with a duplicate listing.
- Matching ignores the listing's city and state text; coordinates still feed the geo penalty.
- Dead or missing flags show only on the admin screen; the PR lists this as a follow-up.
- The guard on the Hash Rego actions is a denylist on `HALFMIND`, so Gemini rows still reach those actions.

## 4. Where the three diverge without a good reason, and the risks

| Divergence | Why it matters | Risk |
|---|---|---|
| Hash Rego auto-links; Half-Mind and our sources never do | A fuzzy score decides what the scraper fetches | **Missed events now; misrouted events after one wrong admin click.** Wrong links stay for months because `MATCHED` is sticky and re-applied |
| Hash Rego routes by display name; config-routed sources route by external id → kennel code | The confirmed link is thrown away at routing time | **Silent drops** when a name isn't aliased; **misroutes** when a slug collides (`CH3`, `GFH3`, `SCH3`) |
| Confirmation writes the external id as a global alias; Half-Mind refuses to | Ids like `CH3` become names for every source | **Wrong resolution for unrelated sources.** The global fallback is unordered |
| One identity in four stores and about ten writers (Hash Rego), two stores (Half-Mind), or config (others) | Stores disagree, and writers overwrite each other | **Drift.** 236 confirmed links not scraped; seeded links replaced; one source-form save wipes every slug |
| One slug per kennel (Hash Rego); 1:1 (Half-Mind); many aliases (own) | Real kennels have event accounts and sister-kennel accounts | **Missed coverage** for 34 multi-account kennels; pressure to bend a sister kennel into the parent |
| Resolver ignores full name; discovery and Half-Mind match on it | Directories publish full names | **Drops** such as "Oregon Hash House Harriers" |
| Hardcoded NYC/Boston/Philly regexes apply to every source | Several are unanchored (`/moon\|moom/` → bos-moon, `/lil/`, `/special/`, `/summit/`, `/knick/`) | A tag from any region can resolve to an NYC or Boston kennel; the guard blocks it, but the event is lost |
| Dead or missing detection only for Half-Mind | Directories change; accounts close or rename | **Stale links** to accounts that no longer exist |

## 5. Recommendations, ranked

The order matters. R2 must ship **before or with** R1, and R4 must wait for R1, R2 and a re-review.

| # | Change | Value | Effort | Depends on | Unifies? |
|---|---|---|---|---|---|
| R2 | Stop auto-linking and slug overwrites in code | High | S–M | — | Policy matches Half-Mind |
| R1 | Repair the wrong Hash Rego links (data migration + seed) | High, now | S | R2 | No |
| R3 | Decide what "linked" means; make the seed and the admin forms stop deleting links | High | S | R1 | Partly |
| R4 | Route Hash Rego events by account slug, with a name cross-check | High | M | R1, R2, re-review | Yes, same path as HashStats and HC |
| R5 | One `KennelExternalId` table for directory ids | High, long term | M–L | R2; feeds R4 | **Yes, the unifying change** |
| R6 | Resolver hygiene | Medium | S–M | R4 for alias cleanup | Yes, one resolver path |
| R7 | Lifecycle: merges and hides repoint links; flag missing accounts | Medium | S | — | Yes |
| R8 | Clear the `NEW` backlog, starting with the 41 rows scoring 0.8 or more | Medium | Owner time | R2 | — |

### R2. Stop auto-linking and slug overwrites (do first)

**In `syncKennelDiscovery`:**
- drop the `SourceKennel` write for new `MATCHED` rows (`kennel-discovery.ts:388-401`);
- drop the self-heal (`:327-343`).

`MATCHED` then means "suggested", as for Half-Mind. Without this, a row reset to `NEW` simply re-scores to 0.95 on the next sync and re-links.

**In the discovery actions:**
- **Dismiss** deletes a Hash Rego link only when its slug equals the row's slug, compared case-insensitively.
- **Confirm and Link** refuse when the kennel already holds a different slug, until multi-slug support (R5) exists.
- The actions accept only `externalSource === "HASHREGO"` instead of refusing only `HALFMIND`, so Gemini rows can't create Hash Rego links.

**In the source admin:**
- `updateSource` keeps existing `externalSlug`s instead of deleting and re-creating links.
- `linkKennelToSourceDirect` and create-from-tag stop turning a tag into a slug for `HASHREGO`.
- Slugs keep their case, and comparisons are case-insensitive.

**In `scrape.ts:451-480`:** the discovery fallback reads only `LINKED` rows.

**Merge order with PR #3050:** it moves the same ranker into `rankDiscoveryCandidates` in `kennel-discovery.ts`. Land #3050 first and rebase R2 on it, or agree the order with that session.

### R1. Repair the wrong links (with or right after R2)

Ship one data migration, following `.claude/rules/prod-data-ops.md` (dry run, per-row counts, then your OK).

**Set the slug on each kennel's Hash Rego link:**

| Kennel | Correct slug | Prod today |
|---|---|---|
| `dch4` | `DCH4` | `Harriettes` |
| `wsh3` | `WSH3` | `SoulH3` |
| `noh3` | `NOH3` | `Noh` |
| `sch3-atl` | `SoCoH3` | `SCH3` |
| `mh3-wv` | `MOTOWNH3` | `MFM` |
| `chh3` | `CHH3` | `HHSuck` |
| `oh3` | `OregonH3` | `PDXGDRH3` |
| `ch3` | `ChiH3`, after you confirm it is Chicago's account | `CH3` (Charlotte) |

**For `gfh3`:** don't just drop the link. Hash Rego is its only source and it has 0 events, so either find Great Falls, Virginia's real source, or hide the kennel, per the no-sourceless-kennels rule.

**In the same migration, set these rows to `DISMISSED` in SQL**, with `matchedKennelId` left for the audit trail:
- `Harriettes`, `SCH3`, `Noh`, `SoulH3`, `MFM` and `HHSuck`;
- `PDXGDR` and `PDXGDRH3` (the event accounts, until R5);
- `CH3` is already dismissed.

`DISMISSED` is terminal, so the sync no longer touches these rows. Don't use the UI Dismiss button for this: today it deletes the kennel's link whatever slug it holds, and would delete the restored one.

**Make it survive a reseed.** Add every link you want kept to the seed's `kennelCodes` and `kennelSlugMap`: the 8 above plus the 15 other links prod scrapes that the seed doesn't list (for example `gh3-gd`, `hellgate-h3`, `oxford-h3`, `dsmh3`, `sembach-h3`, `vbfmh3`). Otherwise remove the Hash Rego prune before anyone runs `db seed` again. Today a full seed would delete 4 of the 8 repairs and those 15 links.

Best: deploy R1's migration in the same release as R2's code. If the data change lands first, then until R2 is deployed don't:
- press **Sync Now** on the discovery page;
- save the Hash Rego source form;
- click the "Link Harriettes" alert repair;
- run `scripts/backfill-hashrego-source-kennels.ts --apply`.

**After deploy:** read the next scheduled Hash Rego scrape's `ScrapeLog`. The daily scrape already covers 365 days, so DCH4's 2026-11-28 event should appear without a special run. Leave the three unprocessed Seattle raws alone; raws are immutable, and they never reached an event.

### R3. Decide what "linked" means

Today an admin link is only an identity for 236 kennels, and that happened by accident. Pick one:
- **(a) Identity and scraping are separate.** The page shows both ("same kennel" and "being scraped"). This works only if the seed lists every scraped account (R1's seed step), because of its prune.
- **(b) A confirmed link means scrape it.** The seed stops pruning links it didn't create.

Recommendation: (a) until R5 lands, then (b). Scraping all ~230 confirmed accounts costs one JSON API call per account not on the index page, with the cold-stall retry from `reference_hashrego_api_cold_stall_retry`. Check the time budget first.

### R4. Route Hash Rego events by account slug (after R1, R2 and a re-review)

Today a bad slug link is harmless only because the display name fails to resolve to the linked kennel. Routing by slug removes that check, so every remaining wrong link would publish. That makes R1, R2 and a re-review of every Hash Rego link prerequisites.

**Design:**
- Pass a `slug → kennelCode` map into `fetch`: the HashStats `kennelSlugMap` shape, built from R5's table or from `SourceKennel` until then. Normalize slug case.
- Take each event's slug from the index row's `kennelSlug`, or from the per-kennel API call that found it, not from the event-slug prefix, which is unreliable.
- Emit `kennelTags: [kennelCode]`. Keep the per-day `kennelPatterns` override.
- Change the synthetic-parent test (`parser.ts:552-554` compares `day1Code` with `parsed.kennelSlug.toLowerCase()`) to compare mapped codes. Otherwise GGFMH3-hosted events get spurious parents.
- **Keep a cross-check:** resolve the display name too. When it resolves to a *different* kennel than the map, hold the event and raise an alert instead of publishing it. This catches only some mistakes: about half the names don't resolve at all, so a wrong slug among those would still publish. The re-review is the real protection. For slugs confirmed after R2, consider also holding events whose name doesn't resolve until the first one is checked.
- Merge and reconcile (`reconcile.ts:245`) resolve the same tag, so the change applies to both, and the source-kennel guard still applies.

**This removes:**
- the need for display-name aliases (pitfall 1 in `reference_hashrego_kennel_routing_pitfalls`);
- the need to write slug aliases on confirm;
- the `CH3`, `GFH3` and `SCH3` index-fallback collisions.

**Cleanup:** the changed `kennelTags` change raw fingerprints, so the first scrape creates new immutable raws. They should merge into the same kennel and date. Verify with a dry merge on the local DB copy.

### R5. One external-id table (the unifying change)

```prisma
model KennelExternalId {
  id          String   @id @default(cuid())
  kennelId    String
  directory   ExternalDirectory   // HASHREGO | HALFMIND (later: other directories with one id per kennel)
  externalId  String              // as the directory spells it: "DCH4", "1073"
  externalKey String              // normalized for matching: lower(trim(externalId))
  state       ExternalIdState     // SUGGESTED | CONFIRMED | REJECTED
  origin      ExternalIdOrigin    // SEED | ADMIN | MIGRATION | SYNC
  confirmedBy String?
  confirmedAt DateTime?
  externalStatus String?          // the directory's own claim: alive / dead / missing
  lastSeenAt  DateTime?
  @@unique([directory, externalKey])  // one directory entry -> at most one kennel
  @@index([kennelId])                 // a kennel may hold many
}
```

**Design choices:**
- **Only directories where one entry means one kennel.** Meetup groups and some Harrier Central or HashStats accounts feed several kennels (Richmond's Meetup feeds 4, Melbourne's 5). Those stay in `Source.config` routing (`kennelPatterns`, `kennelSlugMap`), where many-to-one is natural.
- **Gemini is not a directory.** Its slugs are model-made. Its rows stay in `KennelDiscovery` as research suggestions, or move to Source Research (open question 7). Don't backfill them as ids.
- **One routing mechanism.** The table is the store. R4's slug map is built from `CONFIRMED` `HASHREGO` rows, and the Half-Mind evidence code reads `HALFMIND` rows instead of `Kennel.halfMindListingId`. The resolver isn't changed for this.
- `KennelDiscovery` stays the inbox: the raw listing snapshot and its candidates. Confirming a row writes a `CONFIRMED` row instead of an alias plus `SourceKennel.externalSlug`. `SourceKennel` keeps one job, "this source feeds this kennel", for the guard. Confirming a Hash Rego id must also ensure that link exists, or the guard blocks the kennel's events.
- The seed's `kennelSlugMap` writes `origin = SEED` rows and prunes only those.

**Migration:**
1. Create the table.
2. Write a read-only conflict report first: two kennels claiming one id, and kennels with several ids.
3. Backfill from:
   - the Hash Rego `SourceKennel` slugs (as fixed by R1);
   - the 260 Hash Rego `LINKED` rows, as `CONFIRMED`;
   - the remaining `MATCHED` rows, as `SUGGESTED`;
   - `Kennel.halfMindListingId`, if #3050 has merged;
   - optionally, the 21 Half-Mind ids in seed comments, as `SUGGESTED`.
4. Switch the readers.
5. Drop the old columns in a later migration.

**On PR #3050:** don't block it. Merge it as is and fold `Kennel.halfMindListingId` into the table in R5. Or, if you approve R5 first, swap the column for a `HALFMIND` row before it merges (open question 5).

### R6. Resolver hygiene

- **Ambiguous globals.** When the source-scoped step misses and the global step finds two or more kennels, return unmatched with reason "ambiguous" instead of `findFirst` (`kennel-resolver.ts:35`, `:60`, `:86`).
- **The regex list.** Move `KENNEL_PATTERNS` (`:176-228`) into the HashNYC, Boston, Philly, Chicago and Summit sources' `config.kennelPatterns`, so they stop applying to every source.
- **Full names.** Add a full-name step limited to kennels linked to the source.
- **Id aliases.** Stop writing ids as aliases. Once R4 makes them unnecessary, delete the slug aliases that collide (the 29 above).
- **Guard repair.** Change the guard's "Link <kennel> to this source" suggestion and the alert repair action to warn when the tag came from a different external account.

### R7. Lifecycle

- Merging or hiding a kennel repoints, or closes, its discovery rows and external ids.
- The Hash Rego sync flags confirmed accounts missing from the directory, as #3050 does for Half-Mind.
- Put the Hash Rego discovery sync on a weekly cron only after R2.

## 6. Open questions for the owner

1. **What should "linked" mean on the discovery page:** the same kennel, or "scrape this account"? Today 236 confirmed links are identity only.
2. **Should any directory ever auto-link?** Recommendation: no, suggest only.
3. **Kennels with several Hash Rego accounts.** Should event accounts (PDX GDR) feed the parent kennel? Should sister-kennel accounts (Morgantown Fool Moon, Happy Heretics Suck) become their own kennels? And should `philly-h3` move from "Philly Events" to `PhillyH3`?
4. **Two seeded slugs to confirm.** Is `ChiH3` Chicago's account? Does Great Falls, Virginia have any source, or should `gfh3` be hidden?
5. **PR #3050's storage.** Keep `Kennel.halfMindListingId` and migrate it later, or switch to the shared table before it merges?
6. **Scrape budget.** Is it acceptable to scrape all ~230 confirmed Hash Rego accounts (R3 (b)), given the per-account API calls and cold-stall retries?
7. **Gemini discovery rows.** Should they leave this table for Source Research, or stay as suggestions here?

## Appendix: queries behind the numbers

All queries ran as `SELECT` under `default_transaction_read_only=on` against prod on 2026-11-18 UTC.

- **Discovery rows by source and status:** HASHREGO 869 (NEW 582, MATCHED 22, LINKED 260, DISMISSED 5); GEMINI 27; HALFMIND 0. `Kennel.halfMindListingId` doesn't exist in prod yet.
- **Coverage:** 562 visible kennels; 236 visible kennels mapped to at least one Hash Rego account, so 326 are unmapped. 243 kennels are mapped in all (230 by an admin), and 34 have 2 or 3 accounts.
- **Scrape links:** 38 Hash Rego `SourceKennel` rows (including `HellgateH3`, written by the 03:24 UTC sync), all with a slug and all distinct. Each `LINKED`/`MATCHED` row was joined to `SourceKennel` on the matched kennel, comparing slugs case-insensitively.
- **Scrape logs:** `ScrapeLog.diagnosticContext.kennelSlugsConfigured`, retained from 2026-10-22: 29 slugs, then 30 from 11-06, then 37 from 11-09.
- **Raw events:** Hash Rego `RawEvent` grouped by `rawData.kennelTags[0]` and the resulting event's kennel: 164 raws across 12 kennels, with 10 unprocessed raws in 4 tags. The three Harriettes raws are all for 2026-10-09, scraped 07-11, 07-31 and 09-10.
- **Aliases:** `KennelAlias` grouped by `lower(alias)` across kennels, and the distinct aliases that equal another kennel's code or short name (85).
- **Hash Rego public API:** `GET /api/kennels/{slug}/events/` for the ten slugs named in section 3.2 (one request each).
