# Thailand Kennel Research

**Researched:** 2026-04-08

## Why Thailand matters

Thailand is one of the **densest hashing scenes in Asia** and one of the oldest outside the founding countries. Bangkok H3 was founded on **11 June 1977** -- just 15 years after Singapore's Father Hash (HHHS, 1962) and 39 years after Mother Hash (KL, 1938). The genealogy project lists **34 active kennels** across the country, making Thailand comparable to the entire US East Coast in hashing density.

Bangkok alone has **7+ weekly/regular kennels** covering Monday through Sunday. A Bangkok-based hasher can run every day of the week with a different kennel. Pattaya (100 km southeast) has a massive expat scene with 5+ kennels. Chiang Mai has 4-5 active kennels. Phuket has 4+ including specialty hashes. Smaller scenes exist in Hua Hin/Cha-Am, Koh Samui, Chiang Rai, Songkhla, Korat, and Ubon.

The Thai hashing scene is almost entirely **expat-driven** with English as the primary language for all kennel communications and websites. Run numbers in the 2000s+ reflect decades of continuous weekly activity (e.g., Bangkok Monday H3 is at run #2207, Bangkok Harriettes at #2259, Phuket H3 at #2061).

Thailand is NOT a city-state -- it needs **country + metro-level regions**: Thailand (country), Bangkok, Pattaya, Chiang Mai, Phuket, plus potential Hua Hin and Koh Samui metros.

## Existing Coverage

**None.** Thailand has zero kennels in `prisma/seed-data/kennels.ts`, zero in the production DB. No `Thailand` region exists in `src/lib/region.ts`.

## Aggregator Sources Found

| Aggregator | Coverage | Usable? |
|---|---|---|
| **Harrier Central API** (`hashruns.org`) | **0 Thai kennels** -- API does not cover Thailand | No |
| **HashRego** (`hashrego.com/events`) | **0 Thai events** in live index | No |
| **Meetup** | **1 group found**: "Bangkok Weekend Walk and Run Adventure Group" (BSSH3, 767 members, monthly Saturday). `bangkok-hash` group returns 404 (deleted). | Yes (1 kennel) |
| **Half-Mind.com** | USA/Americas only. Does not track Asia. | No |
| **hashhouseharriers.nl** | Europe only | No |
| **genealogy.gotothehash.net** (`?r=chapters/list&country=Thailand`) | **62 kennel records** (34 active, 28 inactive). Extremely rich: aliases, founding dates, founders, parent hash lineage, runner type, schedules. | Metadata only |
| **china.hash.cn** / **hashchina.wordpress.com** | Thailand not covered (China/HK/Macau only) | No |
| **gotothehash.net** | Main site defunct | No |
| **goHash.App** | No Thai kennels found (Malaysia/SG focus) | No |
| **bangkokhash.com** | **Bangkok hub site** -- lists 10 Bangkok-area kennels with links. Hosts Thursday Hash, Full Moon Hash, and Siam Sunday subpages (all Joomla CMS). | Hub/metadata |
| **chiangmaihhh.com** | **Chiang Mai hub** -- WordPress aggregator covering 4-5 CM kennels with hareline pages. Site currently returning ECONNREFUSED. | Hub (down) |
| **bangkokmondayhhh.com/HashLinks.html** | **Thai kennel directory** -- comprehensive link list covering Bangkok, Pattaya, Phuket, Chiang Mai, Hua Hin, Songkhla. | Metadata only |

## New Kennels Discovered

### Bangkok (10 kennels)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 1 | **Bangkok Monday H3** | Mon | ACTIVE | Tier 2 | HTML_SCRAPER | `bangkokmondayhhh.com` -- custom HTML site. Hareline table with run #2207+, dates through Jul 2026. Columns: Run#, Date, Hare, Location. Has Google Maps links per run. No calendar/iCal. | 8 Mar 1982 |
| 2 | **Bangkok H3 (BH3)** | Sat | ACTIVE | Tier 2 (Wix SPA) | HTML_SCRAPER (browser-render) | `bangkokhhh.org` -- Wix SPA. Men only. Founded 1977 -- oldest Thai kennel. Needs headless browser. Parent of most Thai kennels. | 11 Jun 1977 |
| 3 | **Bangkok Harriettes** | Wed | ACTIVE | Tier 1 | WordPress.com Public API | `bangkokharriettes.wordpress.com` -- WP.com hosted. **API confirmed working** (`public-api.wordpress.com/rest/v1.1/sites/bangkokharriettes.wordpress.com/posts/`). Only 3 posts (Hareline, Welcome, Next Run) but Hareline post contains full schedule. Run #2259. Mixed. | 17 Mar 1982 |
| 4 | **Bangkok Thursday H3** | Thu | ACTIVE | Tier 2 | HTML_SCRAPER | `bangkokhash.com/thursday/` -- Joomla CMS. Run #518. Starts 6:30 PM near BTS/MRT stations. Skips full moon weeks. Run fee 50 baht. Flashlights required. | 19 Jul 2012 |
| 5 | **Bangkok Full Moon H3** | Full Moon Fri | ACTIVE | Tier 2 | HTML_SCRAPER | `bangkokhash.com/fullmoon/` -- Joomla CMS. Run #255. Monthly on Friday nearest full moon, 6:30 PM. Run fee 60 baht. Near BTS/MRT. | 31 May 2004 |
| 6 | **Siam Sunday H3** | 2nd/4th Sun | ACTIVE | Tier 2 | HTML_SCRAPER | `bangkokhash.com/siamsunday/` -- Joomla CMS. Run #653. Biweekly Sunday at 4:30 PM. Active committee, detailed run descriptions. | 14 Dec 1997 |
| 7 | **Bangkok Sabai Saturday H3 (BSSH3)** | Monthly Sat | ACTIVE | Tier 1 | MEETUP | `meetup.com/bangkok-weekend-walk-run-adventure-group/` -- 767 members. Monthly Saturday at 2:45 PM near On Nut BTS. Also has own website `bangkoksaturdayhash.com` (JS-heavy, content not extractable). | Recent (est. ~2023) |
| 8 | **Bangkok HH Bikers (BHHB)** | Monthly | ACTIVE | Tier 3 | STATIC_SCHEDULE | `bangkokbikehash.org` -- Monthly mountain bike hash, 40-50km rides. Weekend overnight trips. Facebook-primary. Founded 1992. Run #400+. | 30 Jun 1992 |
| 9 | **Bangkok Bush H3** | By exception | ACTIVE | Skip | -- | `bangkokbushhash.com` -- Wix SPA. 3-4 times per year. Too infrequent for regular scraping. | Unknown |
| 10 | **Bangkok Leap Day H3** | Quadrennial | ACTIVE | Skip | -- | Only runs Feb 29. Inaugural run 2024. Novelty kennel. | 29 Feb 2024 |

### Pattaya (5 kennels)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 11 | **Pattaya H3** | Mon | ACTIVE | Tier 2 | HTML_SCRAPER | `pattayah3.com` -- PHP-based site. Run #2145+. Weekly Monday, bus departs 3:00 PM from Buffalo Bar. Male 400 baht, female 150 baht. Has hasher directory, run stats, comprehensive archive. | 7 Jan 1984 |
| 12 | **Pattaya Jungle H3** | Sat biweekly | ACTIVE | Tier 1 | WordPress REST API | `pattayajungle.com` -- WordPress. **wp-json API confirmed working.** Run #562+. Biweekly Saturday. Rich event calendar with special events. Some spam posts mixed in. | 11 May 2003 |
| 13 | **Pattaya Monkey H3** | Sat bimonthly | ACTIVE | Tier 2 | HTML_SCRAPER | `pattayamonkeyh3.com` -- WordPress but wp-json returns 404 (API disabled). Bimonthly Saturday with occasional outstations. | 4 Oct 2005 |
| 14 | **Pattaya Dirt Road H3** | By invitation | ACTIVE | Skip | -- | Men only, by invitation. No regular public schedule. | 30 Jun 1984 |
| 15 | **Pattaya Jungle Irregular Lunar H3** | Irregular | ACTIVE | Skip | -- | Irregular, by occasion. Too infrequent. | 26 May 2005 |

### Chiang Mai (5 kennels)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 16 | **Chiang Mai H3 (CH3)** | Mon | ACTIVE | Tier 2 | HTML_SCRAPER | `chiangmaihhh.com/chhh/` -- WordPress aggregator site (currently ECONNREFUSED). Men only. Monday 4:30 PM, bus from McDonald's Thapae Gate. Oldest CM kennel. | 25 May 1981 |
| 17 | **Chiang Mai Gentlemen's H3 (CGH3)** | Mon | ACTIVE | Tier 2 | HTML_SCRAPER | `chiangmaihhh.com` subpage -- WordPress. Men only. Monday 4:30 PM, bus from Loi Kroh Soi 3. BYO hash. Founded 2020 as spinoff of CH3. | 26 Oct 2020 |
| 18 | **Chiang Mai Happy H3 (CH4)** | Thu | ACTIVE | Tier 2 | HTML_SCRAPER | `chiangmaihhh.com` subpage -- WordPress. Mixed. Thursday 4:30 PM, bus from McDonald's Thapae Gate. | 22 May 2004 |
| 19 | **Chiang Mai Saturday H3 (CSH3)** | Sat | ACTIVE | Tier 2 | HTML_SCRAPER | `chiangmaihhh.com/csh3/` -- WordPress. Mixed. Saturday 4:30 PM, bus from McDonald's Thapae Gate. | 16 Apr 1991 |
| 20 | **Chiang Mai Bunny H3 (CBH3)** | Last Tue monthly | ACTIVE | Tier 2 | HTML_SCRAPER | `chiangmaihhh.com/cbh3-hareline/` -- WordPress. Women only. Last Tuesday of month. | 24 Nov 2001 |

### Phuket (4 kennels)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 21 | **Phuket H3** | Sat | ACTIVE | Tier 2 | HTML_SCRAPER | `phuket-hhh.com` -- PHP site. Run #2061. Weekly Saturday 4:00 PM. Mixed. 40th anniversary Jun 2026. Has hareline, run stats. Also `phuketh3.com` (40th anniversary registration site). | 14 Jun 1986 |
| 22 | **Phuket Tin Men H3** | 1st Wed monthly | ACTIVE | Tier 3 | STATIC_SCHEDULE | Men only. First Wednesday monthly. Part of Phuket H3 family. No dedicated website. | 21 May 1990 |
| 23 | **Iron Pussy H3** | 2nd Wed monthly | ACTIVE | Tier 3 | STATIC_SCHEDULE | Women only. Second Wednesday monthly. Part of Phuket H3 family. | 31 Dec 2003 |
| 24 | **Phuket Mountain Bike H3** | Monthly Sun | ACTIVE | Tier 3 | STATIC_SCHEDULE | Monthly Sunday bike hash. | 25 Jun 2005 |

### Hua Hin / Cha-Am (3 kennels)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 25 | **Hua Hin H3 / Cha-Am H3** | Alt Sat | ACTIVE | Tier 1 | WordPress REST API | `cah3.net` -- WordPress. **wp-json API confirmed working.** Run #534. Alternate Saturdays between Hua Hin and Cha-Am locations. 100 baht adults / 50 baht kids. Also `h2h3-cah3.weebly.com` (secondary Weebly site). | H2H3: 8 Jul 2000 / CAH3: 13 Aug 2005 |
| 26 | **Hua Hin Full Moon H3** | Monthly | ACTIVE | Tier 2 | HTML_SCRAPER | `h2fm.site.pro` -- simple site. Monthly run nearest full moon, 5:00 PM. Run #42. 200 baht drinkers / 100 baht non-drinkers. Instagram: @hua_hin_full_moon_hash. | 1 Jun 2022 |

### Koh Samui (1 kennel)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 27 | **Koh Samui H3** | Sat | ACTIVE | Tier 2 | HTML_SCRAPER | `kohsamuihhh.com` -- WordPress (wp-json 404). Registration 3:30 PM, start 4:00 PM. Rotating island locations with GPS coords. | 15 Feb 1997 |

### Chiang Rai (1 kennel)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 28 | **Chiang Rai H3** | 3rd Sat monthly | ACTIVE | Tier 1 | Blogger API | `chiangraihhh.blogspot.com` -- Blogspot. Run #220. Monthly 3rd Saturday 3:00 PM. 100 baht. Active blog with run reports 2007-present. Aliases: "S2ATO - Start Slowly And Taper Off". | 15 Nov 2003 |

### Other Thai Regions (5 kennels)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 29 | **Songkhla H3** | Sat | DORMANT? | Tier 3 | STATIC_SCHEDULE | `songkhlah3.blogspot.com` -- blog closed Jan 2021. Run #2050 was Dec 2020. Saturday 4:30 PM. Moved to Facebook-only. Founded 1981 -- very old kennel. May still be active via FB. | 26 Oct 1981 |
| 30 | **Korat H3** | Unknown | ACTIVE | Skip | -- | No website found. Genealogy lists as active. Nakhon Ratchasima. Founded 2008. | 1 Jun 2008 |
| 31 | **Ubon H3** | 1st Sat monthly | ACTIVE | Skip | -- | No website found. First Saturday monthly. | 2 Aug 2008 |
| 32 | **Hatyai H3** | Unknown | ACTIVE | Skip | -- | No website found. Hat Yai, southern Thailand near Malaysia. | 5 Nov 2000 |
| 33 | **Nonthaburi H3** | Fri monthly | ACTIVE | Skip | -- | No website found. Men only, by invitation. Bangkok suburb. Monthly Friday. | 28 Feb 2001 |
| 34 | **Lanna Bush H3** | ~5x/year | ACTIVE | Skip | -- | Northern Thailand bush hash. Men only, by invitation. Too infrequent. | 18 Sep 2011 |

### Additional Bangkok kennels (from bangkokhash.com)

| Kennel | Notes | Status |
|--------|-------|--------|
| **Bangkok Angkaan Horny Hares H3** | Listed on bangkokhash.com but no website or details found. "Angkaan" = Tuesday in Thai. Possibly a Tuesday hash. | Unknown -- needs verification |
| **Thinking Drinking H3** | Event hash only -- runs as prelube to major events. Not a regular kennel. | Skip (event hash) |

### Inactive / Skipped Kennels (28 from genealogy)

| Kennel | Last Activity | Reason for Skip |
|--------|--------------|-----------------|
| **Bangkok HH Horrors** | Inactive | Children's hash, no longer active |
| **Ban Chang Bar Crawlers H3** | Inactive since 2009 | Pattaya spinoff, dead |
| **Banglamung Bottom Feeders H3** | Inactive | Pattaya spinoff, dead |
| **Chiang Mai Diamond H3** | Inactive since 2013 | CM spinoff, dead |
| **Chiang Mai Underground Male H3 (CUM H3)** | Inactive | CM spinoff, dead |
| **Hatyai Full Moon H3** | Inactive | Hat Yai spinoff, dead |
| **Hatyai Sunday H3** | Inactive | Hat Yai spinoff, dead |
| **Hua Cha Pedalars H3** | Inactive | Hua Hin bike hash, dead |
| **Hua Hin Bush H3** | Inactive since 2022 | Very short-lived |
| **Hua Hin Monday H3** | Inactive | Hua Hin spinoff, dead |
| **Isaan H3** | Inactive since 1998 | Northeast Thailand, dead |
| **Kamala Koba H3** | Inactive | Phuket spinoff, dead |
| **Khon Kaen H3** | Inactive since 1980 | Very early kennel, long dead |
| **Korat Knights H3** | Inactive since 2009 | Korat spinoff, dead |
| **Lampang H3** | Inactive since 1981 | Northern Thailand, long dead |
| **Pattaya Bush H3** | Inactive since 2000 | Pattaya spinoff, dead |
| **Pattaya Dirt Bike H3** | Inactive since 1991 | Pattaya bike hash, dead |
| **Pattaya FM H3** | Inactive since 1989 | Pattaya full moon, dead |
| **Phitsanuloke-1 H3** | Inactive since 1983 | Central Thailand, dead |
| **Phitsanuloke-2 H3** | Inactive since 1985 | Central Thailand, dead |
| **Phuket Island Southern H3 (PISH3)** | Inactive since 2003 | Phuket spinoff, dead |
| **Phuket Marauders H3** | Inactive since 1988 | Phuket spinoff, dead |
| **Phuket Pooying Picnic H3** | Potentially active | Listed inactive in genealogy BUT Phuket main site lists "Pooying" runs (Run #414, Apr 12 2026). **May need reclassification.** |
| **Pooying H3** | Inactive since 1990 | Phuket women's hash, dead |
| **Sadao H3** | Inactive since 2003 | Southern Thailand, dead |
| **Ubon Ratchathani H3** | Inactive since 1966 | Vietnam War era, long dead (RAAF personnel) |
| **Udorn Friday Outback H3** | Inactive since 2000 | Northeast Thailand, dead |
| **Udorn Saturday H3** | Inactive since 1999 | Northeast Thailand, dead |

**Note on Phuket Pooying:** The genealogy lists this as inactive, but `phuket-hhh.com` shows "Phuket Pooying Picnic Hash Run #414" on April 12, 2026. This appears to be a **revived or still-active sub-hash** under the Phuket H3 umbrella. Should be included as a Phuket kennel if verified.

## Collision Check Results

Checked every proposed kennelCode against `prisma/seed-data/kennels.ts` + `prisma/seed-data/aliases.ts`:

| Proposed Code | Status | Resolution |
|---|---|---|
| `bmh3-th` | Needed -- `bmh3` TAKEN (Bushman H3, Chicago + Brass Monkey, Houston) | **Use `bmh3-th` for Bangkok Monday H3** |
| `bkh3` | FREE | **Use for Bangkok H3 (BH3)** -- avoids `bh3` collision (Buffalo, Boulder) |
| `bkharriettes` | FREE | **Use for Bangkok Harriettes** |
| `bth3-bk` | Needed -- `bth3` collision-prone | **Use for Bangkok Thursday H3** |
| `bkfmh3` | FREE | **Use for Bangkok Full Moon H3** -- avoids `bfmh3` collision (Ben Franklin Mob alias) |
| `ssh3-th` | Needed -- `ssh3` collision (South Sound H3, WA) | **Use `ssh3-th` for Siam Sunday H3** |
| `bssh3` | FREE | **Use for Bangkok Sabai Saturday H3** |
| `bhhb` | FREE | **Use for Bangkok HH Bikers** |
| `pth3` | FREE | **Use for Pattaya H3** |
| `pjh3` | FREE | **Use for Pattaya Jungle H3** |
| `pmh3-pt` | Needed -- `pmh3` collision-prone | **Use for Pattaya Monkey H3** |
| `cmh3` | FREE but collision-prone | **Use `cmh3-th` for Chiang Mai H3** (avoids future collision) |
| `cgh3` | FREE | **Use for Chiang Mai Gentlemen's H3** |
| `ch4-cm` | Needed -- `ch4` collision-prone | **Use for Chiang Mai Happy H3 (CH4)** |
| `csh3-cm` | Needed -- `csh3` free but ambiguous | **Use for Chiang Mai Saturday H3** |
| `cbh3` | FREE | **Use for Chiang Mai Bunny H3** |
| `phuketh3` | FREE | **Use for Phuket H3** |
| `phtm` | FREE | **Use for Phuket Tin Men H3** |
| `ironpussy` | FREE | **Use for Iron Pussy H3** |
| `phmbh3` | FREE | **Use for Phuket Mountain Bike H3** |
| `h2h3` | FREE | **Use for Hua Hin H3** |
| `cah3` | FREE | **Use for Cha-Am H3** (or combined with H2H3) |
| `h2fmh3` | FREE | **Use for Hua Hin Full Moon H3** |
| `ksh3` | FREE | **Use for Koh Samui H3** |
| `crh3-th` | Needed -- `crh3` collision-prone | **Use for Chiang Rai H3** |
| `songkhlah3` | FREE | **Use for Songkhla H3** |

## Recommended Ship List (Phase 1)

**Priority: 15 active kennels with verifiable web sources across 5 metro areas.**

### Tier 1 -- Config-only or existing adapter pattern (4 kennels)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **Bangkok Harriettes** (Wed) | WordPress.com Public API | API confirmed working. Only 3 posts but Hareline post has full schedule. Same pattern as Cape Fear adapter. Run #2259. |
| **Pattaya Jungle H3** (Sat biweekly) | WordPress REST API | wp-json API confirmed. Run #562+. Some spam posts -- needs title/category filtering. |
| **Cha-Am H3** (Alt Sat) | WordPress REST API | wp-json API confirmed. Run posts with rich location data + GPS coords. Run #534. Also covers Hua Hin H3. |
| **BSSH3** (Monthly Sat) | MEETUP | `groupUrlname: "bangkok-weekend-walk-run-adventure-group"`. 767 members. Monthly Saturday at On Nut BTS. |

### Tier 1.5 -- Existing adapter pattern, needs verification (1 kennel)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **Chiang Rai H3** (3rd Sat monthly) | Blogger API | Blogspot blog with 17+ years of posts. Needs Blogger blog ID discovery. Run #220. |

### Tier 2 -- Needs adapter code (7 kennels)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **Bangkok Monday H3** (Mon) | HTML_SCRAPER | Custom HTML hareline table. Clean format: Run#, Date, Hare, Location + Google Maps links. 6+ months of future runs. Simple Cheerio scraper. |
| **Bangkok Thursday H3** (Thu) | HTML_SCRAPER | Joomla CMS at `bangkokhash.com/thursday/`. Run #518. Structured run details. |
| **Bangkok Full Moon H3** (Full Moon Fri) | HTML_SCRAPER | Joomla CMS at `bangkokhash.com/fullmoon/`. Run #255. |
| **Siam Sunday H3** (2nd/4th Sun) | HTML_SCRAPER | Joomla CMS at `bangkokhash.com/siamsunday/`. Run #653. |
| **Pattaya H3** (Mon) | HTML_SCRAPER | PHP site at `pattayah3.com`. Run #2145+. Comprehensive database system. |
| **Phuket H3** (Sat) | HTML_SCRAPER | PHP site at `phuket-hhh.com`. Run #2061. Hareline + run stats. |
| **Bangkok H3 (BH3)** (Sat) | HTML_SCRAPER (browser-render) | Wix SPA at `bangkokhhh.org`. Men only. Needs headless browser. Oldest Thai kennel (1977). |

### Tier 3 -- Static schedule / Facebook-only (3 kennels)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **Phuket Tin Men H3** (1st Wed) | STATIC_SCHEDULE | Men only. `FREQ=MONTHLY;BYDAY=1WE`. Part of Phuket family. |
| **Iron Pussy H3** (2nd Wed) | STATIC_SCHEDULE | Women only. `FREQ=MONTHLY;BYDAY=2WE`. Part of Phuket family. |
| **Bangkok HH Bikers** (Monthly) | STATIC_SCHEDULE | Monthly weekend bike hash. `FREQ=MONTHLY;BYDAY=1SA` (approx). Facebook-primary. |

### Phase 2 / Deferred

| Kennel | Reason |
|--------|--------|
| **Chiang Mai H3** (Mon) | chiangmaihhh.com currently ECONNREFUSED. Defer until site recovers. Could share adapter with CGH3/CH4/CSH3. |
| **Chiang Mai Gentlemen's H3** (Mon) | Same site, same issue. |
| **Chiang Mai Happy H3 (CH4)** (Thu) | Same site, same issue. |
| **Chiang Mai Saturday H3** (Sat) | Same site, same issue. |
| **Chiang Mai Bunny H3** (Last Tue) | Same site, same issue. |
| **Koh Samui H3** (Sat) | WordPress but API disabled. Needs HTML scraper for "Next Run" page. Lower priority. |
| **Pattaya Monkey H3** (Bimonthly Sat) | WordPress but API disabled. Lower frequency. |
| **Hua Hin Full Moon H3** (Monthly) | Simple site.pro page. Low priority. |
| **Songkhla H3** (Sat) | Blog closed 2021. May be FB-only now. Needs Facebook verification. |
| **Phuket Mountain Bike H3** (Monthly Sun) | Low frequency bike hash. |
| **Hua Hin H3** (Alt Sat with CAH3) | Already covered by CAH3 source -- same kennel pair alternates Saturdays. Model as single combined source with two kennelCodes. |

## Shared Adapter Opportunities

1. **Bangkok Joomla trio** -- Bangkok Thursday H3, Full Moon H3, and Siam Sunday H3 all run on the same Joomla CMS at `bangkokhash.com` with the same URL pattern (`/thursday/`, `/fullmoon/`, `/siamsunday/`). A single adapter with URL-based routing could handle all three. The page structure appears consistent across subdomains.

2. **WordPress REST API** -- Pattaya Jungle H3 and Cha-Am H3 both have confirmed wp-json APIs. Both follow standard WordPress post patterns with run details in post content. Could use the existing WordPress API utility (`fetchWordPressPosts`).

3. **WordPress.com Public API** -- Bangkok Harriettes uses wordpress.com hosting. Same pattern as Cape Fear and N2TH3 (Hong Kong). Uses `fetchWordPressComPage()`.

4. **Chiang Mai WordPress aggregator** -- When chiangmaihhh.com comes back online, ALL 5 Chiang Mai kennels could potentially be scraped from a single WordPress site with kennel-tag routing based on post categories/URL patterns (CGH3, CH3, CH4, CSH3, CBH3).

5. **Blogger API** -- Chiang Rai H3 uses Blogspot, same pattern as Enfield Hash (EH3) and OFH3. Uses `fetchBloggerPosts()`.

## Region Updates Needed

Thailand needs a **COUNTRY-level region** plus metro subdivisions:

```typescript
// In src/lib/region.ts REGION_SEED_DATA:
{
  name: "Thailand",
  country: "Thailand",
  level: "COUNTRY",
  timezone: "Asia/Bangkok",
  abbrev: "TH",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#d97706",
  centroidLat: 13.75,
  centroidLng: 100.50,
},
{
  name: "Bangkok",
  country: "Thailand",
  level: "METRO",
  timezone: "Asia/Bangkok",
  abbrev: "BKK",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#d97706",
  centroidLat: 13.76,
  centroidLng: 100.50,
  aliases: ["Bangkok, Thailand", "Krung Thep"],
},
{
  name: "Pattaya",
  country: "Thailand",
  level: "METRO",
  timezone: "Asia/Bangkok",
  abbrev: "PTY",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#d97706",
  centroidLat: 12.93,
  centroidLng: 100.88,
  aliases: ["Pattaya, Thailand", "Chonburi"],
},
{
  name: "Chiang Mai",
  country: "Thailand",
  level: "METRO",
  timezone: "Asia/Bangkok",
  abbrev: "CNX",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#d97706",
  centroidLat: 18.79,
  centroidLng: 98.98,
  aliases: ["Chiang Mai, Thailand"],
},
{
  name: "Phuket",
  country: "Thailand",
  level: "METRO",
  timezone: "Asia/Bangkok",
  abbrev: "HKT",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#d97706",
  centroidLat: 7.88,
  centroidLng: 98.39,
  aliases: ["Phuket, Thailand"],
},
{
  name: "Hua Hin",
  country: "Thailand",
  level: "METRO",
  timezone: "Asia/Bangkok",
  abbrev: "HHN",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#d97706",
  centroidLat: 12.57,
  centroidLng: 99.96,
  aliases: ["Hua Hin, Thailand", "Cha-Am"],
},

// In COUNTRY_GROUP_MAP (prisma/seed.ts):
// "Thailand": ["Bangkok", "Pattaya", "Chiang Mai", "Phuket", "Hua Hin"],
```

Additional metros (Koh Samui, Chiang Rai, Songkhla) can be added in Phase 2 as more kennels are onboarded.

## Open Questions

1. **chiangmaihhh.com status** -- The aggregator WordPress site for all 5 Chiang Mai kennels is returning ECONNREFUSED. Is this temporary downtime or permanent? If the site recovers, all 5 CM kennels could be Tier 1/2 via a single WordPress source. If dead, individual Facebook groups become the fallback. This blocks Phase 1 for Chiang Mai.

2. **Bangkok H3 (bangkokhhh.org) Wix rendering** -- The Saturday men's hash is the oldest Thai kennel (1977) and a high-priority target. It's on Wix, which requires browser-render. Will the NAS headless browser service extract usable hareline data?

3. **Phuket Pooying classification** -- Genealogy lists "Phuket Pooying Picnic H3" as inactive, but Phuket H3's site shows active runs (Run #414, Apr 2026). Is this a revived kennel or a sub-hash of Phuket H3? If active, it should be added (monthly Sunday, family-friendly).

4. **Bangkok Angkaan Horny Hares** -- Listed on bangkokhash.com but no website, schedule details, or web presence found. "Angkaan" = Tuesday in Thai, suggesting it fills the missing Tuesday slot. Needs Facebook verification.

5. **Songkhla H3 activity** -- Blog closed 2021 but kennel founded 1981 with 2050+ runs. Almost certainly still active via Facebook. Worth a STATIC_SCHEDULE with Saturday 4:30 PM if confirmed.

6. **Hua Hin H3 vs Cha-Am H3 modeling** -- These two kennels alternate Saturdays (H2H3 one week, CAH3 the next). The WordPress API at cah3.net covers both. Model as one source with two kennelCodes and `kennelPatterns`, or as two separate kennels sharing a source?

7. **Pattaya H3 scraping complexity** -- pattayah3.com has a PHP database backend with hasher directories, run stats, and comprehensive archives. The hareline data may require navigating dynamic PHP pages. Need to inspect the hareline page structure.

8. **Bangkok Joomla scraping** -- The three kennels on bangkokhash.com all use Joomla CMS. Joomla may have a REST API (similar to WordPress wp-json) that could simplify scraping. Worth checking `/api/` or `/index.php?option=com_content&format=json`.

## Summary

| Category | Count |
|----------|-------|
| Total kennels discovered | 62 (genealogy) / 34 active |
| Active kennels with web presence | 28 |
| Included in research (active + web) | 28 |
| Tier 1 (config-only / existing adapter) | 4 (Harriettes WP.com, PJH3 WP REST, CAH3 WP REST, BSSH3 Meetup) |
| Tier 1.5 (existing adapter, needs verification) | 1 (Chiang Rai Blogger) |
| Tier 2 (needs adapter code) | 12 (BKK Monday, BKK Thursday, BKK FM, Siam Sunday, BH3 Wix, Pattaya H3, Phuket H3, 5x CM if site recovers) |
| Tier 3 (static schedule) | 3 (Phuket Tin Men, Iron Pussy, BKK Bikers) |
| Skip (by-invitation / too infrequent / no source) | 8 |
| Inactive (genealogy) | 28 |
| Phase 1 recommended | 15 kennels (4 Tier 1 + 1 Tier 1.5 + 7 Tier 2 + 3 Tier 3) |
| Phase 2 deferred | 10 kennels (5x CM pending site recovery + KS, PM, HFMH3, Songkhla, Phuket MBH3) |
| New adapter code needed | ~4-5 adapters (BKK Monday HTML, BKK Joomla trio, Pattaya H3 PHP, Phuket H3 PHP, BH3 Wix) |
| Zero-code sources | 5 (Harriettes WP.com, PJH3 WP REST, CAH3 WP REST, BSSH3 Meetup, Chiang Rai Blogger) |
| New regions needed | 6 (Thailand country + 5 metros) |
