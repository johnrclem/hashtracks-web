# Australia Kennel Research

**Researched:** 2026-04-08
**Significance:** Australia is one of the world's largest hash scenes outside the US/UK. The official Australian HHH directory at **hhh.asn.au** enumerates **~220 kennels** across all states and territories. Perth in particular is historically called the "Hash Megacentre" with 20+ active metro kennels.

## Why Australia matters
Australia is the single biggest untapped region for HashTracks. The scene is mature, geographically distributed across 8 states/territories, and well-documented via a national directory. Onboarding Australia is expected to be the biggest regional push since California and should roughly double international coverage outside the US.

The 155 existing HashTracks sources currently include **zero** Australian kennels. Unlike recent regions (Singapore, Malaysia, Japan), Australia has no aggregator calendar covering multiple kennels — each kennel publishes independently, so the long tail is large but not insurmountable thanks to the national directory.

## Existing Coverage
- **0 kennels** in `prisma/seed-data/kennels.ts` (none matching AU / any AU state)
- **0 kennels** attached to any AU region in the production DB
- `src/lib/region.ts`: **Australia COUNTRY region does NOT exist in `REGION_SEED_DATA`** (contrary to task brief). The only Australia references are:
  - Line 2502: `inferCountry()` regex `/\b(australia|sydney|melbourne|brisbane|perth)\b/` → returns `"Australia"`
  - Line 2883: `COUNTRY_CODE_MAP` entry `AU: "Australia"`
  - **Action needed in implementation PR:** add `{ name: "Australia", country: "Australia", level: "COUNTRY", ... }` to `REGION_SEED_DATA`, plus state-level regions as kennels are onboarded.
  - Extend `inferCountry()` regex to include `adelaide|canberra|darwin|hobart|gold coast|newcastle|wollongong|tasmania|queensland|victoria`.

## Aggregator Sources Found

### ✅ hhh.asn.au — Australian Hash House Harriers Directory (220 kennels)
The national directory is the primary discovery vehicle. It's a static HTML-frameset site with per-state pages at `https://hhh.asn.au/byState.php?whichState={CODE}`:

| Code | State/Region | Count |
|------|---|---|
| A | ACT | 8 |
| NI | NSW — Sydney Metro | 10 |
| NO | NSW — Regional | 30 |
| NT | Northern Territory | 10 |
| QI | QLD — Brisbane | 21 |
| QO | QLD — Regional (incl. Gold Coast, Cairns, Townsville) | 46 |
| S | South Australia | 6 |
| T | Tasmania | 15 |
| TERR | Territories (Christmas Is, Cocos Is) | 2 |
| TRAV | Traveling hashes | 2 |
| VI | VIC — Melbourne | 13 |
| VO | VIC — Regional | 11 |
| WI | WA — Perth | 19 |
| WO | WA — Regional | 27 |
| **Total** | | **220** |

Each kennel entry contains: name, URL (if any), "AKA" alias, schedule freetext ("runs Monday at 1800"), contacts, and a "Last Update" date reflecting directory-listing hygiene (not kennel activity). **135 kennels have a URL**; 85 are Facebook-only or contact-only.

**Directory is not a machine-readable source by itself** — it's a discovery vector. We scrape each kennel individually.

### ❌ Harrier Central (hashruns.org)
Queried the public API directly for `cityNames=Sydney|Melbourne|Brisbane|Perth|Adelaide|Canberra|Darwin|Hobart|Gold Coast|Newcastle|Wollongong|Cairns|Townsville|Toowoomba`. **Zero events returned for all AU cities.** Harrier Central has no Australian kennels registered. Skip.

### ❌ HashRego (hashrego.com/events)
Scraped the live index — **no Australian kennels** listed. Skip.

### ⚠️ Meetup
Found **4 Australian HHH groups** with upcoming events:
- `Lakeside-Hash-House-Harriers-in-Melbourne` (Lakeside H3)
- `melbourne-new-moon-running-group` (Melbourne New Moon H3)
- `thirsty` (Sydney Thirsty H3)
- `SydneyBikeHash` (Sydney Bike Hash)

### ❌ genealogy.gotothehash.net
195 Australian kennel records returned, but the "Currently Active" label is stale — only 7 marked active (mostly WA). **Cannot be relied on for activity status**, but did not contradict hhh.asn.au discovery. Did not add unique kennels beyond the national directory.

### ❌ Facebook / `Austhhh` / `GoToTheHash`
Facebook-only groups — skipped per the no-sourceless-kennels rule.

### ❌ Direct DNS probes
Tried obvious domains (`sydneyhash.com.au`, `melbournehash.com`, etc.) — all failed DNS. AU kennels do not use predictable domain patterns.

## New Kennels Discovered — Tier Classification

Verification performed: downloaded homepages for the 34 kennels with live HTTPS status 200 and the strongest "last update" signals, then probed sub-pages for embedded Google Calendar / Meetup / iCal / Google Sheets / WordPress REST API. Representative results below; complete 220-kennel list available via `hhh.asn.au` scrape (saved locally to `/tmp/au-all.json` during research).

### Tier 1 — Config-only (structured sources)

| # | Kennel | City | State | Best Source | Source ID/URL | Notes |
|---|---|---|---|---|---|---|
| 1 | **Perth H3** | Perth | WA | **ICAL_FEED** | `http://www.perthhash.com/?ical=1` | **30 future events** out to 2027 — Run #s, times, locations. The Events Calendar plugin. Premier AU Tier 1 source. |
| 2 | **Top End Hash (Darwin)** | Darwin | NT | **ICAL_FEED** | `http://www.topendhash.com/?ical=1` | 4 upcoming events — Events Manager plugin. Live WP site. |
| 3 | **Capital Hash** (ACT) | Canberra | ACT | **GOOGLE_CALENDAR** | `i5joq71itadqf41njhm1iv0vec@group.calendar.google.com` | Base64-decoded from homepage iframe. AKA "Fat Cat Hash". |
| 4 | **Lakeside Hash** (Melbourne) | Melbourne | VIC | **MEETUP** | `Lakeside-Hash-House-Harriers-in-Melbourne` | Active Meetup group. Every Wed 18:30. |
| 5 | **Melbourne New Moon H3** | Melbourne | VIC | **MEETUP** | `melbourne-new-moon-running-group` | Active Meetup group. |
| 6 | **Sydney Thirsty H3** | Sydney | NSW | **MEETUP** | `thirsty` | Active Meetup. Every Thursday 18:30 + 1st Saturday of month. |
| 7 | **Sydney Bike Hash** | Sydney | NSW | **MEETUP** | `SydneyBikeHash` | Monthly rides around greater Sydney. |

**7 kennels ship with zero new adapter code.**

### Tier 2 — HTML scraper (WordPress REST API + custom)

**WordPress REST API (`/wp-json/wp/v2/posts`) verified live with recent content:**

| # | Kennel | City | State | Endpoint | Most recent post | Notes |
|---|---|---|---|---|---|---|
| 8 | **Gold Coast H3** | Gold Coast | QLD | `http://www.goldcoasthash.org/wp-json/wp/v2/posts` | **2026-04-07** — "Run 2499…Hare Aussie" | Weekly posts, titles contain run # + hare. Parse date from `date` field, extract run#/hare from title. Uses WordPress API pattern like EWH3. |
| 9 | **Sydney South Harbour H3 (Larrikins)** | Sydney | NSW | `https://sydney.larrikins.org/wp-json/wp/v2/posts` | **2026-02-09** — "Larrikin Run #2500 – Tuesday 09-06-2026" | Post titles include explicit run date. Extract date from title; filter by post type. |

**Other WordPress sites — posts endpoint works but content stale (no recent posts):**
- `ah3.com.au` (Adelaide H3) — last post 2014
- `perthharriettes.com` — last post 2020
- `LakesideHash.asn.au` — 2023 (Meetup is better)
- `topendhash.com` (Darwin) — 2019 posts (iCal is the live source above)
- **Action:** Prefer Meetup/iCal where both exist. Adelaide H3 is an exception — no structured source and the WP blog is dead. Either defer Adelaide or try pages endpoint / HTML hareline page.

**Other potentially-scrapeable sites (HTML tables, event pages, needs adapter work):**

| # | Kennel | City | State | URL | Platform | Notes |
|---|---|---|---|---|---|---|
| 10 | **Sydney H3 (SH3)** — "Posh Hash" | Sydney | NSW | `https://www.sh3.link/?page_id=9470` | WP (oceanwp theme), wp-json blocked via CDN | "Upcumming Runs" page has dated future events. Needs Cheerio scraper. |
| 11 | **Melbourne City H3** | Melbourne | VIC | `https://www.melctyhhh.net` | GoDaddy WP (wp-json blocked) + Google Sheet (`1LJdYOuCLN41ERZJLAkUCO6N-tpzUpiuOaofzdnENCDM`) | **Google Sheet is live and extracts as CSV** — it's a roster/attendance grid with one column per future run with run# and location going out to 2028. **Sheet is harvestable for event extraction** (date headers + location cells) — needs a custom GOOGLE_SHEETS config with hareline-column decoder. Alternative: HTML scrape `/next-run` page. |
| 12 | **Gold Coast H3 (secondary)** | Gold Coast | QLD | Same Google Sheet `1Lp0D2DOji8lMEjYI-1vvsgrYjxgTzfXDtuAHi9CDNG0` | Roster grid like Melbourne City | Less useful than WP posts source above. Skip. |
| 13 | **Humpday Hash (Hobart)** | Hobart | TAS | `https://humpdayhash.com` | Custom WP theme ("h4"), wp-json blocked | Active site. Needs HTML scraper or investigation into theme. |
| 14 | **Townsville H3** | Townsville | QLD | `http://www.tvh3.net` | WP (empty posts API) | Likely has `/runs.htm` or similar; initial probe 404'd. Needs deeper exploration. |
| 15 | **Hamersley H3** | Perth | WA | `http://www.hamersleyhash.com.au` | **Wix** | Wix site — needs browser-render adapter. |
| 16 | **Fremantle H3 (Heave Ho H6)** | Fremantle | WA | `http://www.fremantlehash.com` | **Wix** | Wix site — needs browser-render adapter. |
| 17 | **Botany Bay H3** | Sydney | NSW | `https://botanybay-h3.weebly.com/upcoming-runs.html` | Weebly | Static HTML — Cheerio scrape. |
| 18 | **Brisbane H3** | Brisbane | QLD | `http://www.brisbaneh3.com` | Unknown — HTTP 405 on HEAD | Needs GET probe. |
| 19 | **Brisbane Halfway H3** | Brisbane | QLD | `https://www.halfwayhhhbn.au` | 200 OK | Needs content inspection. |
| 20 | **Brisbane Northside H3** | Brisbane | QLD | `https://bnh3.yolasite.com` | Yola | 403 on HEAD — may work with GET + user agent. |
| 21 | **Brisbane Thirsty H3** | Brisbane | QLD | `https://www.thirstyhashbrisbane.com` | 200 OK | Inspect for event list. |
| 22 | **Eastern Suburbs H3** (Melbourne) | Melbourne | VIC | `http://www.esh3.org` | Unknown HTML | Needs inspection. |
| 23 | **Doncaster & Eltham H3** | Melbourne | VIC | `http://www.deh3.org` | Unknown HTML | Needs inspection. |
| 24 | **South of Perth H3** | Perth | WA | `http://www.southofperthhash.com` | 200 — tiny page | Needs deeper probe. |
| 25 | **Friday Hash** (Perth) | Perth | WA | `http://www.fridayhash.com` | 200 — placeholder | Needs deeper probe. |
| 26 | **West Coast H3** (Perth) | Perth | WA | `http://www.westcoasthashhouseharriers.com` | 405 on HEAD | Needs GET probe. |
| 27 | **Newcastle Full Moon H3** | Newcastle | NSW | `http://sites.google.com/site/newcastlefullmoonhhh/` | Google Sites | Needs browser-render. |
| 28 | **Central Coast H3** | NSW Central Coast | NSW | `https://sites.google.com/view/centralcoasthashers` | Google Sites (new) | Needs browser-render. |
| 29 | **Northern Rivers H3** | Northern NSW | NSW | `http://www.nrhhh.blogspot.com` | **Blogspot** | Use `fetchBloggerPosts()` helper. Shared adapter exists. |
| 30 | **Ballarat H3** | Ballarat | VIC | `http://www.ballarathash.blogspot.com` | **Blogspot** | Use `fetchBloggerPosts()` helper. |
| 31 | **Burnie H3 / Chardonnay H3 / Launceston H3 / LoonR / Samford H3** | Various | TAS/QLD | `*.blogspot.com` | **Blogspot** | Multiple — check activity first; Blogger API for each alive blog. |

### Tier 3 — STATIC_SCHEDULE (historic-kennel exception only)

**Skipped outright** — the task brief and memory `feedback_sourceless_kennels` rule out Facebook-only and phone-only kennels. The ~85 directory entries with no URL or only a Facebook URL go here. Exception: **Sydney H3 (SH3)** and **Melbourne H3** are historic (Sydney founded 1967 — one of the oldest outside Singapore/KL). If the Tier 2 HTML scraper proves unworkable for SH3, consider a STATIC_SCHEDULE fallback with the known weekly Monday 18:30 pattern.

Candidates to potentially consider for historic exception (all weekly, multi-decade history):
- **Sydney H3** — Monday 18:30 (since 1967)
- **Melbourne H3** — Monday 19:00
- **Brisbane H3** — if confirmed active and no other source found
- **Adelaide H3** — website dead; known Monday schedule

### Skipped (Facebook-only / contact-only / dormant)

~85 kennels in the hhh.asn.au directory have no website URL at all (mail/phone only). Many have extremely stale directory "Last Update" dates (2006–2013) and no other web presence. **Representative skips:**

- Any kennel with last update before 2018 AND no URL
- Any kennel whose only URL is a Facebook group
- Dormant platforms: Tripod, 8m.com, Jigsy, Geocities, Yolasite (inactive), bigpondhosting

See `/tmp/au-all.json` for the full list if revisiting later.

## Collision Check Results

Proposed kennelCodes — **CRITICAL**: many AU kennels share abbreviations with existing seed kennels. All AU codes should get `-au` or city suffixes.

| Proposed kennelCode | Collision with | Resolution |
|---|---|---|
| `sh3` | Seattle H3 (WA, USA), Seletar H3 (SG) | Use **`sh3-au`** for Sydney H3 |
| `mh3` | Multiple (Munich, Miami, Minneapolis) | Use **`mh3-au`** for Melbourne H3; **`mh3-mel`** alternative |
| `bh3` | Berlin H3, Boulder H3, Buffalo H3 | Use **`bh3-bne`** for Brisbane H3 |
| `ph3` | Petaling H3 (MY), Phoenix | Use **`ph3-per`** for Perth H3 |
| `ah3` | Austin H3, Aloha H3 | Use **`ah3-adl`** for Adelaide H3; **`ah3-au`** as alternative |
| `ch3` | Chicago H3, Cape Fear H3, Copenhagen | Use **`ch3-cbr`** for Canberra H3 |
| `dh3` | Denver H3, Dublin H3 | Use **`dh3-dar`** for Darwin H3 |
| `h4` | Hangover H3 (DC), Houston H4 | Use **`h4-hobart`** for Hobart H4 |
| `gch3` | Gulf Coast H3 (Mobile, AL) | Use **`gch3-au`** for Gold Coast H3 |
| `lh3` | Larryville H3, London H3 | Use **`lh3-au`** or **`lakeside-h3`** for Lakeside (Melbourne) |
| `nh3` / `bnh3` | Northboro H3, NBH3 (Seattle) | Use **`bnh3-au`** for Brisbane Northside; **`nbh3-syd`** for Northern Beaches H3 (Sydney) |
| `eh3` | Enfield H3, Edinburgh | Use **`esh3-mel`** for Eastern Suburbs H3 Melbourne |
| `hh3` / `halfway` | — | Use **`halfway-h3-bne`** for Brisbane Halfway |
| `cap-h3` / `capital-h3` | — | `capital-h3` is safe |
| `top-end-h3` | — | `top-end-h3` safe (Darwin) |
| `sshh3` / `larrikins-syd` | — | `larrikins-syd` safe; avoid generic `larrikins` |
| `thirsty-h3-syd` | — | Safe |
| `sydneybikeh3` | — | Safe |

**Collision audit to run in implementation PR:**
```bash
grep -E '"(sh3|mh3|bh3|ph3|ah3|ch3|dh3|h4|gch3|lh3|nbh3|eh3|bnh3)"' prisma/seed-data/kennels.ts prisma/seed-data/aliases.ts
```

## Shared adapter opportunities

1. **WordPress REST API pattern** — reuse `fetchWordPressPosts()` from `src/adapters/wordpress-api.ts` for Gold Coast H3 and Larrikins Sydney. Extract run# and date from post title. **No new code needed beyond a thin per-kennel wrapper adapter** (pattern: EWH3, DCH4).

2. **Events Manager `?ical=1` pattern** — Perth H3 and Top End Hash both use WordPress Events Manager with the `?ical=1` query. Shared ICAL_FEED adapter covers both with just config. Consider scanning the remaining WP AU kennels for this plugin.

3. **Blogger API** — Northern Rivers H3 (NSW) and Ballarat H3 (VIC) are on Blogspot. Use `fetchBloggerPosts()`. Also check Tasmania Blogspot cluster (Burnie, Chardonnay, Launceston, LoonR, Samford Brisbane) — may yield 4-5 free kennels with zero code.

4. **Google Sheet hareline decoder** — Melbourne City and Gold Coast both use the same roster/attendance grid template with dates-as-columns and location-per-cell. **This is a novel pattern.** Building one AU-specific `GOOGLE_SHEETS` adapter config decoder could cover both — worth checking if more AU kennels share the template (look for "Hash Year 20XX-XX" header signature).

5. **Wix (browser-render)** — Hamersley and Fremantle (both Perth). Use existing `browserRender()` helper like Northboro H3.

6. **Google Sites (browser-render)** — Canberra H3, Central Coast H3, Newcastle Full Moon, and several older kennels. Use browser-render.

## Recommended Onboarding Order (Phased)

### Phase 1 — "Australian founder pack" (zero new code, config-only)
Ship the **7 Tier 1 kennels** first for maximum ROI:
1. **Perth H3** (ICAL_FEED, 30 future events) — flagship, covers the "Hash Megacentre"
2. **Top End Hash Darwin** (ICAL_FEED)
3. **Capital Hash Canberra** (GOOGLE_CALENDAR)
4. **Lakeside H3 Melbourne** (MEETUP)
5. **Melbourne New Moon H3** (MEETUP)
6. **Sydney Thirsty H3** (MEETUP)
7. **Sydney Bike Hash** (MEETUP)

This phase adds every mainland state capital that has a structured source + NT, and gives immediate coverage in Sydney, Melbourne, Perth, Darwin, and Canberra with a single small config-only PR.

### Phase 2 — "WordPress API pack" (thin wrapper adapters, ~2 new files)
Two adapters following the EWH3/DCH4 pattern:
8. **Gold Coast H3** (WP posts, weekly "Run N…Hare X" titles)
9. **Sydney South Harbour H3 / Larrikins** (WP posts with explicit dated run titles)

### Phase 3 — "Historic kennels via HTML scrape or static fallback"
10. **Sydney H3 (SH3)** — attempt Cheerio scrape of `?page_id=9470`; fall back to STATIC_SCHEDULE (weekly Monday 18:30 since 1967) as the historic exception.
11. **Melbourne H3** — similar approach; STATIC_SCHEDULE fallback (weekly Monday 19:00).
12. **Brisbane H3** — if site probes successfully.

### Phase 4 — "Tasmania + regional Blogspot cluster"
13-17. **Northern Rivers**, **Ballarat**, **Burnie**, **Chardonnay**, **Launceston** (all Blogspot, shared Blogger API adapter — verify each still has recent posts first).

### Phase 5 — "Second-tier metro kennels via HTML scraping"
Doncaster & Eltham, Eastern Suburbs, Lakeside (if Meetup insufficient), Melbourne City (Google Sheet decode), Brisbane Thirsty/Halfway/Northside, Noosa H3 Larrikins, Humpday Hash Hobart.

### Phase 6 — "Perth Hash Megacentre expansion"
Once Perth H3 iCal is stable, investigate the other ~18 Perth kennels: Hamersley (Wix), Fremantle (Wix), Friday Hash, HOSH, Hills H3, South of Perth, West Coast, Perth Harriettes, Bullsbrook, Perth Crankers, Rocky City, Mandurah.

### Phase 7 — "Long tail via directory scrape"
Systematically walk the remaining ~40 hhh.asn.au entries with live URLs. Expect Tier 2/Tier 3 mix. Many will require per-kennel HTML adapters.

## Skipped Kennels (for now)

- All ~85 directory entries with no URL or Facebook-only (per sourceless-kennels rule)
- Christmas Island & Cocos Island H3s (interesting but likely dormant — `hash.org.cx` and `cocoshhh.com` need probing later)
- All Genealogy-only entries not in hhh.asn.au (likely defunct)
- Anything last-updated in directory before 2018 with no structured source signal

## Region Updates Needed

When implementing Phase 1:

1. **Add Australia as COUNTRY region** in `src/lib/region.ts` `REGION_SEED_DATA`:
```typescript
{
  name: "Australia",
  country: "Australia",
  level: "COUNTRY",
  timezone: "Australia/Sydney",
  abbrev: "AU",
  colorClasses: "bg-amber-100 text-amber-700",
  pinColor: "#f59e0b",
  centroidLat: -25.27,
  centroidLng: 133.78,
},
```

2. **Add state-level regions** as each Phase 1 kennel lands (NSW, VIC, QLD, WA, SA, ACT, TAS, NT). Each STATE_PROVINCE under parent `"Australia"`.

3. **Add metro regions**: Sydney NSW, Melbourne VIC, Brisbane QLD, Perth WA, Adelaide SA, Canberra ACT, Darwin NT, Hobart TAS, Gold Coast QLD. METRO level under the state.

4. **Extend `inferCountry()` regex** (line 2502):
```typescript
if (/\b(australia|sydney|melbourne|brisbane|perth|adelaide|canberra|darwin|hobart|gold coast|newcastle|wollongong|cairns|tasmania|queensland|victoria|west(ern)? australia|northern territory|nsw|vic|qld)\b/.test(lower)) return "Australia";
```

5. **Add states to `COUNTRY_GROUP_MAP` + `STATE_GROUP_MAP`** per memory `feedback_country_group_map`.

## Open questions for user review

1. **Phase 1 scope.** Is the 7-kennel Tier 1 pack the right first PR, or do you want me to include Gold Coast + Larrikins (Phase 2) in the same ship to get the first "real NSW" kennel onboarded simultaneously?
2. **SH3 fallback strategy.** Sydney H3 (1967, founding national kennel) has no structured source and blocks wp-json. Prefer (a) Cheerio scrape of `/?page_id=9470`, (b) STATIC_SCHEDULE historic exception, or (c) defer to later phase? The historic exception is the safest per the memory guardrail.
3. **Melbourne City Google Sheet.** The roster/attendance grid approach (columns=dates, cells=locations) is novel and would need a new GOOGLE_SHEETS config shape. Is it worth adding to `src/adapters/google-sheets/adapter.ts` as a new parse mode, or should we defer Melbourne City and get it from Meetup for now? Note: Melbourne City is NOT on Meetup — the Melbourne Meetup groups are Lakeside and New Moon.
4. **Adelaide H3.** Zero structured source, blog dead since 2014, no Meetup, no calendar. Skip until later or attempt `/pages` endpoint for a hareline page?
5. **hhh.asn.au long tail.** Do you want a follow-up research pass on all ~135 URL-having kennels, or is the current targeted dig sufficient for now and we revisit during Phase 7?
6. **Region hierarchy.** State-level regions only, or do you want metro-level (Sydney, Melbourne, Brisbane…) created eagerly in Phase 1 even though only 1-2 kennels will attach to each?

## Highlights

- **~220 kennels discovered** via hhh.asn.au national directory
- **135 have a live website URL**; 85 are Facebook/contact-only (skipped)
- **7 Tier 1 (config-only)** kennels verified with structured sources — Perth H3's 30-event iCal feed is the standout
- **~20 Tier 2 (HTML scraper or WP API)** kennels with active websites worth implementing
- **~90 Tier 3/skip** — Facebook-only, dormant, or last-updated before 2018
- **Aggregator status:** Harrier Central has zero AU kennels; HashRego has zero AU kennels; Meetup has 4 active AU HHH groups
- **Shared adapter wins:** WordPress API pattern covers 2+ kennels; Events Manager iCal pattern covers 2+ (and should be scanned across all WP sites); Blogger API covers 5-6 Tasmanian/regional kennels; Wix browser-render covers 2+ Perth kennels
- **kennelCode collision risk is HIGH** — Australia's common city abbreviations (sh3, mh3, bh3, ph3, ah3, ch3, dh3, h4) collide with 8+ existing kennels. Use `-au` / city suffixes across the board.

## Recommended Phase 1 ship list (7 kennels, 7 sources, zero new adapter code)

| Kennel | Source Type | Source Config |
|---|---|---|
| Perth H3 | `ICAL_FEED` | `{ defaultKennelTag: "PH3", url: "http://www.perthhash.com/?ical=1" }` |
| Top End Hash Darwin | `ICAL_FEED` | `{ defaultKennelTag: "Top End H3", url: "http://www.topendhash.com/?ical=1" }` |
| Capital Hash Canberra | `GOOGLE_CALENDAR` | `{ calendarId: "i5joq71itadqf41njhm1iv0vec@group.calendar.google.com", defaultKennelTag: "Capital H3" }` |
| Lakeside H3 Melbourne | `MEETUP` | `{ groupUrlname: "Lakeside-Hash-House-Harriers-in-Melbourne", kennelTag: "Lakeside H3" }` |
| Melbourne New Moon H3 | `MEETUP` | `{ groupUrlname: "melbourne-new-moon-running-group", kennelTag: "Melbourne New Moon H3" }` |
| Sydney Thirsty H3 | `MEETUP` | `{ groupUrlname: "thirsty", kennelTag: "Sydney Thirsty H3" }` |
| Sydney Bike Hash | `MEETUP` | `{ groupUrlname: "SydneyBikeHash", kennelTag: "Sydney Bike Hash" }` |

**PR size estimate:** ~350 lines across `src/lib/region.ts` (country + 5 state + 5 metro regions), `prisma/seed-data/kennels.ts` (7 kennels), `prisma/seed-data/aliases.ts` (aliases), `prisma/seed-data/sources.ts` (7 sources). **Zero new adapter files.** Verification via live fetch per live-verification rule is straightforward — 4 of 7 are APIs we already have 20+ production sources using.
