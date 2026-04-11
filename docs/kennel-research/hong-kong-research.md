# Hong Kong Kennel Research

**Researched:** 2026-04-08

## Why Hong Kong matters
Hong Kong is one of the oldest and most active hashing scenes in Asia. The Hong Kong Hash House Harriers (H4) was founded on **23 February 1970** -- just 8 years after Singapore's Father Hash (HHHS, 1962) and 32 years after Mother Hash (KL, 1938). Hong Kong now has **8 weekly hashes** covering every day of the week, plus several monthly and specialty groups. The scene is almost entirely expat-driven with English as the primary language for all kennel communications. Hong Kong is a Special Administrative Region (city-state) -- no state/province subdivisions are needed, similar to the Singapore region model.

The scene has remarkable density: a hasher in Hong Kong can run every single day of the week with a different kennel (Monday HK H3 + Kowloon H3, Tuesday Ladies H4, Wednesday LSW + N2TH3, Thursday RS2H3, Friday HKFH3, Saturday Free China/Hebe, Sunday Wanchai + Sek Kong). Run numbers in the 2000s-2900s reflect decades of continuous weekly activity.

## Existing Coverage
**None.** Hong Kong is a clean slate -- zero kennels in `prisma/seed-data/kennels.ts`, zero in the production DB. No `Hong Kong` region exists in `src/lib/region.ts`.

## Aggregator Sources Found

| Aggregator | Coverage | Usable? |
|---|---|---|
| **Harrier Central API** (`hashruns.org`) | **0 kennels** -- API query for cityNames="Hong Kong" returned `[[]]` | No |
| **HashRego** (`hashrego.com/events`) | **0 HK kennels** in live index | No |
| **Meetup** | Group "Hash-House-Harrier-Kennels-in-Hong-Kong" **no longer exists** (404) | No |
| **Half-Mind.com** | USA/Central+South America/Caribbean only. Does not track Asia. | No |
| **hashhouseharriers.nl** | Europe only | No |
| **genealogy.gotothehash.net** (`?r=chapters/list&country=Hong+Kong`) | **21 kennel records** (11 active, 10 inactive). Rich for aliases, founding dates, founders, and lineage data. | Metadata only |
| **china.hash.cn/hkmacao/** | **14 HK kennels + 1 Macau kennel** listed with websites, schedules, founding dates, contacts. THE key directory. | Metadata only |
| **hashchina.wordpress.com/hong-kong-macau/** | Same 14+1 listing, slightly different details. Cross-referenced with china.hash.cn. | Metadata only |
| **gotothehash.net/hongkong.html** | Main site defunct (DNS/hosting dead) -- only genealogy subdomain works | No |
| **goHash.app** | No HK kennels found (Malaysia/SE Asia only) | No |

## New Kennels Discovered

### Source-escalation summary

Hong Kong kennels overwhelmingly use **Google Sites + embedded Google Sheets** for their harelines. No Google Calendar embeds, iCal feeds, or Meetup groups were found. The primary scrapeable sources are:
- **Google Sheets** (published CSV) -- Kowloon H3, RS2H3 (embedded in Google Sites)
- **WordPress.com public API** -- N2TH3 (580+ posts with run announcements)
- **WordPress REST API (auth-gated)** -- HKH3 (wp-json exists but returns 401)
- **Static HTML** -- LSW (datadesignfactory.com), HKH3 (homepage has next run)
- **Wix SPA** -- Full Moon Hash, Ladies H4 (JS-rendered, need browser-render)
- **Google Sites** -- Sek Kong H3, Wanchai H3, RS2H3 (hareline data in embedded Sheets)

| # | Kennel | Day | Status | Tier | Best Source | Source URL/Notes | Founded |
|---|--------|-----|--------|------|-------------|------------------|---------|
| 1 | **Hong Kong H3 (H4)** | Mon | ACTIVE | Tier 2 | HTML_SCRAPER (WordPress, auth-gated wp-json) | `hkhash.com` -- WordPress site, wp-json returns 401 on posts. Homepage shows next run (#2967). Would need HTML scraper for homepage or hareline page. | 23 Feb 1970 |
| 2 | **Kowloon H3 (KH3)** | Mon | ACTIVE | Tier 1 | GOOGLE_SHEETS | `kowloonhash.com` redirects to Google Sheets pubhtml (`2PACX-1vTy11q7Wq9JzgYS_-...`, gid=1360982932, sheet="Website"). Also: Google Sites at `sites.google.com/view/kowloon-hash-house-harriers/hareline` with sheet ID `2PACX-1vRBZeDVCHJWXqLg4n1iL3RIbO2mPE4tZE5KSPe9lzSRUzE6smhcee9LNNT6I3usaKfnvjDRUNWST-OF` (gid=1578340354). Men only. | 26 Oct 1970 |
| 3 | **Ladies of Hong Kong H3 (LH4)** | Tue | ACTIVE | Tier 2 (Wix) | HTML_SCRAPER (browser-render) | `hkladiesh4.wixsite.com/hklh4` -- Wix SPA, needs headless browser. Minimal content visible via WebFetch. Runs every Tuesday at 6:45pm. | 15 Jun 1971 |
| 4 | **Little Sai Wan H3 (LSW)** | Wed | ACTIVE | Tier 2 | HTML_SCRAPER | `datadesignfactory.com/lsw/hareline.htm` -- static HTML table. 16 upcoming runs visible (Apr-Nov 2026). Columns: Date, Run #, Hares, Description. Date format "DD Mon YY". Also `nextrun.htm` with current run details. Run #2593 on 15 Apr 2026. | 17 Jan 1979 |
| 5 | **Northern New Territories H3 (N2TH3)** | Wed | ACTIVE | Tier 1 | WordPress.com Public API | `n2th3.org` -- WordPress.com hosted. Public API at `public-api.wordpress.com/rest/v1.1/sites/n2th3.org/posts/` confirmed working. **580+ posts.** Post titles: "Run announcement NNNN -- DDth Month YYYY -- Location". Body includes: hare, start time (7pm), location, Google Maps link, transport info. Same pattern as Cape Fear adapter. | 27 Jun 1983 |
| 6 | **Royal South Side H3 (RS2H3)** | Thu | ACTIVE | Tier 1 | GOOGLE_SHEETS | `rs2h3.hk` -- Google Sites. Hareline uses embedded Google Sheet (ID: `1ActKq1DoLoUA2WfUM7Q4JF3SASG7SEG-lGjy4byIf_Q`, gid=425141890, range A2:D25). Has 4 columns of data across 24 rows. Also has attendance polling via Google Forms. Men only. | 18 May 1978 |
| 7 | **Wanchai H3 (WH3)** | Sun | ACTIVE | Tier 1 | GOOGLE_SHEETS | `wanchaih3.com` -- Google Sites. Hareline links to "WH3 Hareline (2026-27)" Google Sheet. Email: wanchaih3.hareraiser@gmail.com. 100+ regular attendees. Also hosts subpages for HKFH3, FCH3, T8H3. | 10 Apr 1988 |
| 8 | **Sek Kong H3 (SKH3)** | Sun | ACTIVE | Tier 2 | HTML_SCRAPER (Google Sites) | `sites.google.com/site/sekkongh3/home` -- Google Sites. Run #2465 on 12 Apr 2026. Has run archive (2022-2026). Sunday 4pm (3pm winter). Google Calendar config reference found in page JS but no actual calendar embed. Family-friendly. | 31 Dec 1974 |
| 9 | **HK Full Moon H3 (HKFMH3)** | Full Moon Mon | ACTIVE | Tier 2 (Wix) | HTML_SCRAPER (browser-render) | `fullmoonhash.com` -- Wix SPA. Runs on the Monday nearest the full moon at 7:30pm. Founded 29 Mar 2021. Trail locations across all HK. Needs browser-render to extract content. | 29 Mar 2021 |
| 10 | **HK Friday H3 (HKFH3)** | 2nd/3rd Fri | ACTIVE | Tier 3 | STATIC_SCHEDULE | Hosted on `wanchaih3.com/hkfh3` (returns 404 currently). Facebook group at `facebook.com/groups/197105523127`. Mixed. Meets 2nd or 3rd Friday at 7pm. Email: HKFridayHash@gmail.com. | 29 Feb 2008 |
| 11 | **Free China H3 (FCH3-HK)** | Monthly Sat | ACTIVE | Tier 3 | STATIC_SCHEDULE | Hosted on `wanchaih3.com/fch3` (returns 404). Facebook group at `facebook.com/groups/349521331889486`. Monthly Saturday at 1pm. Meet at Jaffe Rd & Fenwick St junction. | 1994 |
| 12 | **Hebe H3** | 3rd Sat monthly | ACTIVE | Tier 3 | STATIC_SCHEDULE | Facebook group at `facebook.com/groups/HebeH3/`. Monthly 3rd Saturday at 3pm. Contact: jamesahk@gmail.com. Relatively new kennel. | 14 Sep 2019 |
| 13 | **Taipa Macau H3 (TMH3)** | Sat | ACTIVE | Tier 2 | HTML_SCRAPER | `macauhash.com` -- basic HTML site. Usually every Saturday at 4pm. Sports Bar, Nam San, Taipa. Not HK proper but adjacent SAR -- could be included in an "HK + Macau" region or deferred. | 2 Jun 1998 |

### Inactive / Skipped Kennels

| Kennel | Last Activity | Reason for Skip |
|--------|--------------|-----------------|
| **HK Hash House Babes** | Jan 2019 (Run #64) | Blog dormant 7+ years. "Girls only" bimonthly hash. |
| **South Lantau H3** | Aug 2016 (Run #33) | WordPress blog dead since 2016. Family hash, monthly Saturday. |
| **Typhoon 8 H3 (T8H3)** | Variable (only when T8 signal raised) | Novelty kennel -- only runs during Typhoon Signal 8+. Inherently unpredictable, cannot be scheduled. Facebook group exists. |
| **Sai Kung Saturday H3** | Inactive per genealogy | Monthly Saturday hash, flagged inactive. |
| **HK Blood Runners H3** | Inactive per genealogy | Men-only monthly Saturday. Inactive since at least 2002. |
| **HK Hash House Horrors** | Inactive per genealogy | Children's hash. Inactive. |
| **HK Highland H3** | Inactive per genealogy | Inactive since ~1989. |
| **Chek Lap Kok H3** | Inactive per genealogy | Airport-area hash, inactive since 1991. |
| **Sek Kong HH Horrors** | Inactive per genealogy | Children's spinoff, inactive. |
| **Macau Mens Hash** | Dormant per china.hash.cn | Listed as dormant. |

## Collision Check Results

Checked every proposed kennelCode against `prisma/seed-data/kennels.ts` + `prisma/seed-data/aliases.ts`:

| Proposed Code | Status | Resolution |
|---|---|---|
| `hkh3` | FREE | **Use for Hong Kong H3** (H4) |
| `kh3` | FREE | **Use for Kowloon H3** |
| `lh4-hk` | Needed -- `lh4` FREE but ambiguous | **Use `lh4-hk` for Ladies of HK H3** (avoids future collision; `lh3` is TAKEN by London H3) |
| `lswh3` | FREE | **Use for Little Sai Wan H3** |
| `n2th3` | FREE | **Use for Northern New Territories H3** |
| `rs2h3` | FREE | **Use for Royal South Side H3** |
| `wh3-hk` | Needed -- `wh3` FREE but collision-prone | **Use `wh3-hk` for Wanchai H3** (avoids future collision with any "West H3" or similar) |
| `skh3` | FREE | **Use for Sek Kong H3** |
| `hkfmh3` | FREE | **Use for HK Full Moon H3** (avoids `fmh3` collision with SD Full Moon + SF Full Moon) |
| `hkfh3` | FREE | **Use for HK Friday H3** |
| `fch3-hk` | Needed -- `fch3` TAKEN (Fog City H3, SF) | **Use `fch3-hk` for Free China H3** |
| `hebeh3` | FREE | **Use for Hebe H3** |
| `tmh3` | FREE | **Use for Taipa Macau H3** (if included) |

## Recommended Ship List (Phase 1)

**Priority: 8 active weekly kennels covering every day of the week.**

### Tier 1 -- Config-only or existing adapter pattern (3 kennels)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **N2TH3** (Wed) | WordPress.com Public API | Same pattern as Cape Fear adapter. 580+ historical posts. Richest source in HK. |
| **Kowloon H3** (Mon) | GOOGLE_SHEETS | Domain redirects to published Google Sheet. Need to confirm CSV export works. |
| **RS2H3** (Thu) | GOOGLE_SHEETS | Google Sites with embedded Sheet. Need to confirm CSV export works. |

### Tier 2 -- Needs adapter code (4 kennels)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **HK H3 / H4** (Mon) | HTML_SCRAPER | WordPress site, wp-json auth-gated. Homepage shows current run with rich fields (location, format, time, hash cash). Could scrape homepage for "next run" + hareline page. |
| **LSW** (Wed) | HTML_SCRAPER | Static HTML table at `/hareline.htm`. Clean format: Date/Run#/Hares/Description. 16 upcoming runs. Simple Cheerio scraper. |
| **Sek Kong H3** (Sun) | HTML_SCRAPER (Google Sites) | Google Sites with run-by-run subpages. Run #2465 on 12 Apr 2026. Weekly Sunday 4pm. May need browser-render for dynamic content. |
| **Wanchai H3** (Sun) | GOOGLE_SHEETS | Google Sites with hareline linked to Google Sheet. Need to extract Sheet ID from the page. |

### Tier 3 -- Static schedule / Facebook-only (3 kennels)

| Kennel | Adapter | Notes |
|--------|---------|-------|
| **HKFH3** (2nd/3rd Fri) | STATIC_SCHEDULE | Facebook-only. Biweekly Friday 19:00. |
| **Free China H3** (Monthly Sat) | STATIC_SCHEDULE | Facebook-only. Monthly Saturday 13:00. |
| **Hebe H3** (3rd Sat monthly) | STATIC_SCHEDULE | Facebook-only. Monthly 3rd Saturday 15:00. |

### Phase 2 / Deferred

| Kennel | Reason |
|--------|--------|
| **Ladies of HK H3** (Tue) | Wix SPA -- needs browser-render. Defer until HK Phase 1 ships. |
| **HK Full Moon H3** (Monthly) | Wix SPA + lunar calendar (can't express in RRULE). Defer. |
| **Taipa Macau H3** (Sat) | Separate SAR. Could add as Phase 2 alongside Macau region. |

## Shared Adapter Opportunities

1. **WordPress.com Public API** -- N2TH3 uses the same `public-api.wordpress.com` pattern as Cape Fear H3. The existing `fetchWordPressComPage()` utility or a similar approach could be reused. N2TH3 post titles follow a consistent pattern: `"Run announcement NNNN -- DDth Month YYYY -- Location"` with body fields for hare, time, directions, map link.

2. **Google Sheets harelines** -- Kowloon H3, RS2H3, and Wanchai H3 all use Google Sheets for their harelines. The existing GOOGLE_SHEETS adapter is config-driven and could handle these with appropriate column mappings. Key question: whether the published/embedded sheets have stable public CSV export URLs.

3. **Static HTML table (LSW)** -- Simple enough to be a GenericHtmlAdapter candidate or a small custom scraper. Clean tabular format with predictable columns.

## Region Updates Needed

Hong Kong should be modeled as a **COUNTRY-level city-state**, following the Singapore precedent:

```typescript
// In src/lib/region.ts REGION_SEED_DATA:
{
  name: "Hong Kong",
  country: "Hong Kong",
  level: "COUNTRY",
  timezone: "Asia/Hong_Kong",
  abbrev: "HK",
  colorClasses: "bg-red-100 text-red-700",
  pinColor: "#dc2626",
  centroidLat: 22.28,
  centroidLng: 114.17,
},

// No state/metro subdivisions needed -- all kennels are in "Hong Kong" region
// Add to COUNTRY_GROUP_MAP in prisma/seed.ts:
// "Hong Kong": ["Hong Kong"],
```

If Macau is included in Phase 2, add a separate `"Macau"` COUNTRY-level region.

## Open Questions

1. **Google Sheets CSV export** -- Can the Kowloon H3 and RS2H3 published sheets be exported as CSV? The Kowloon domain redirects to `pubhtml` format. Need to test whether replacing `pubhtml` with `pub?output=csv` works, or if the `/d/e/` URL pattern supports CSV export. The Sheet IDs are known.

2. **HK H3 (hkhash.com) source strategy** -- The WordPress REST API is auth-gated (401). Options: (a) HTML scrape the homepage for next run only, (b) HTML scrape a hareline page (URL not yet confirmed -- `/hareline/` returned 404 via WebFetch but Google indexed it), (c) Contact the GM to request API access. Homepage scraping would give only 1 event at a time.

3. **Wanchai H3 Google Sheet ID** -- The hareline page references "WH3 Hareline (2026-27)" spreadsheet but the actual Sheet ID wasn't extractable via WebFetch (Google Sites dynamic loading). Chrome verification needed to extract the Sheet ID.

4. **Ladies of HK H3 (Wix)** -- This is the second-oldest HK kennel (1971, women-only) and runs every Tuesday. Browser-render could unlock it, but Wix SPAs are hit-or-miss. Defer to Phase 2 or attempt browser-render in Phase 1?

5. **HK Full Moon H3** -- Lunar-schedule kennel. RRULE can't express full moon dates. Same limitation as Luna Ticks (SC) and other moon-phase kennels. Ship as kennel-only (no source) with `scheduleNotes`?

## Summary

| Category | Count |
|----------|-------|
| Total kennels discovered | 21 (genealogy) / 14 (china.hash.cn active) |
| Active kennels with web presence | 12 |
| Tier 1 (config-only) | 3 (N2TH3, KH3, RS2H3) |
| Tier 2 (needs code) | 4-5 (HKH3, LSW, SKH3, WH3, + LH4/HKFMH3 deferred) |
| Tier 3 (static schedule) | 3 (HKFH3, FCH3-HK, Hebe H3) |
| Skip (inactive/dormant) | 10 |
| Phase 1 recommended | 10 kennels (7 weekly + 3 monthly/biweekly) |
| Phase 2 deferred | 3 kennels (LH4-HK, HKFMH3, TMH3) |
| New adapter code needed | ~3 adapters (HKH3 WordPress scraper, LSW table scraper, SKH3 Google Sites scraper) |
| Zero-code sources | 3-4 (N2TH3 WP.com API, KH3/RS2H3/WH3 Google Sheets, HKFH3/FCH3/Hebe STATIC_SCHEDULE) |
