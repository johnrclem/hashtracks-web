# US Zero-Coverage Gap Research: KY, NV, OK, IA, UT

**Researched:** 2026-04-08
**States:** Kentucky, Nevada, Oklahoma, Iowa, Utah
**Purpose:** Close the 5 largest zero-coverage gaps in US state coverage

---

## Summary

| State | Kennels Found | Active | Shippable (Tier 1) | Tier 2 | Tier 3 / Static | Skip |
|-------|--------------|--------|---------------------|--------|------------------|------|
| Kentucky | 4 alive | 4 | 0 | 0 | 2 | 2 |
| Nevada | 5 alive | 4-5 | 0 | 0 | 3 | 1-2 |
| Oklahoma | 2 alive | 2 | 0 | 0 | 2 | 0 |
| Iowa | 3 alive | 2-3 | 0 | 0 | 2-3 | 0-1 |
| Utah | 6 alive | 5-6 | 0 | 0 | 4-5 | 1 |
| **TOTAL** | **20** | **17-20** | **0** | **0** | **13-15** | **4-6** |

**Key finding:** All 5 states have ZERO Tier 1 (config-only structured) sources. Every active kennel in these states relies on Facebook, Twitter, or word-of-mouth for event coordination. This is the "Facebook desert" pattern seen previously in Alabama and parts of the Southeast.

---

## Kentucky (Previously Researched 2026-04-07)

**Full research:** See `docs/kennel-research/kentucky-research.md`

### Existing Coverage
None. Zero KY regions, kennels, or sources in DB or seed.

### Aggregator Results
- **Half-Mind KY:** 9 kennels (4 alive, 5 dead)
- **Genealogy:** Page truncated before KY (alphabetical, stopped at CT)
- **Harrier Central:** No KY kennels
- **HashRego:** Zero KY slug matches
- **Meetup:** Louisville group returns "Group not found" (dead)

### Kennels

| # | Kennel | City | Status | Tier | Best Source | Notes |
|---|--------|------|--------|------|-------------|-------|
| 1 | Louisville H3 | Louisville | ACTIVE | 3 | STATIC_SCHEDULE | Biweekly Sat 2pm winter / 3pm summer. Website live (louisvillehashers.com). Meetup dead. No calendar. Facebook-coordinated. $5 hash cash. |
| 2 | Horse's Ass H3 | Lexington | ACTIVE | Skip | -- | Embedded GCal has 0 events. Twitter-based announcements. Calendar ID: `g2drd8u3nmknj0rubhv5d8eois@group.calendar.google.com` (empty). |
| 3 | Hellhound H3 | Lexington | ACTIVE | 3 | STATIC_SCHEDULE | Monthly full moon. Website dead (NXDOMAIN). Facebook only. |
| 4 | Lexington Lunatics H3 | Lexington | ACTIVE | Skip | -- | No website, no source ever. Half-Mind says alive, monthly full moon. |

**Proposed kennelCodes:**
- `louisville-h3` (safe, no collision)
- `hah3-ky` (Horse's Ass; avoid `hah3` which could collide)
- `hellhound-h3` (safe)

**Verdict:** 0 shippable Tier 1. Louisville H3 and Hellhound H3 could ship as STATIC_SCHEDULE if we accept Facebook-only kennels, but per project rules ("no sourceless kennels" / "STATIC_SCHEDULE is true last resort"), these are borderline. Louisville is the strongest candidate given its active biweekly schedule and website.

---

## Nevada

### Existing Coverage
None. Zero NV regions, kennels, or sources in DB or seed.

### Aggregator Results
- **Half-Mind NV:** Page form required submission, data not extractable via WebFetch
- **Genealogy:** Page truncated before NV
- **Harrier Central:** No NV kennels found
- **HashRego:** OKC W3H3 found for Oklahoma; no NV-specific slugs found
- **Meetup:** Utah Meetup dead; no NV Meetup found

### Kennels

| # | Kennel | City | Status | Tier | Best Source | Notes |
|---|--------|------|--------|------|-------------|-------|
| 1 | Las Vegas H3 (vlv!) | Las Vegas | ACTIVE | 3 | STATIC_SCHEDULE | 1st, 3rd, 5th Saturdays. Hub site lvh3.org (shared with Rat Pack, ASS H3). $5 hash cash. Facebook group: Las Vegas HHH. No calendar/Meetup. |
| 2 | Atomic Shit Show H3 (ASS H3) | Las Vegas | ACTIVE | 3 | STATIC_SCHEDULE | 2nd & 4th Friday nights, 7:30pm. Founded March 2018. Website assh3.com (connection refused). Facebook group: ASSH3. |
| 3 | Rat Pack H3 | Las Vegas | SEMI-ACTIVE | Skip | -- | Founded 2000. "Oldest semi-active hash in Las Vegas." Special events only (NYD Hangover Hash, Dead Elvis Hash). No regular schedule. |
| 4 | Reno H3 | Reno | ACTIVE | 3 | STATIC_SCHEDULE | Monthly. Website renoh3.com (connection refused). "Biggest little hash in the world." |
| 5 | CarSin City H3 | Reno/Carson City | UNKNOWN | Skip | -- | Facebook page exists (facebook.com/carsincityh3). Activity status unclear. |

**Proposed kennelCodes:**
- `lv-h3` (Las Vegas; avoid `lvh3` which is TAKEN by Lehigh Valley)
- `ass-h3` (Atomic Shit Show; globally unique)
- `rat-pack-h3` (safe)
- `reno-h3` (safe)
- `carsin-city-h3` (safe, if needed)

**Collision risks:**
- `lvh3` is TAKEN (Lehigh Valley H3, PA) -- must use `lv-h3`
- `rh3` is TAKEN (Reading H3, PA) -- Reno must use `reno-h3`

**Verdict:** 0 shippable Tier 1. Las Vegas H3 (vlv!) and ASS H3 have predictable biweekly/monthly schedules suitable for STATIC_SCHEDULE. Reno H3 is monthly but schedule details are sparse (website down). The lvh3.org hub site exists but has no calendar embed or structured feed.

---

## Oklahoma

### Existing Coverage
None. Zero OK regions, kennels, or sources in DB or seed.

### Aggregator Results
- **Half-Mind OK:** Form required, not extractable
- **Genealogy:** Page truncated before OK
- **Harrier Central:** No OK kennels
- **HashRego:** `OKCW3H3` kennel found -- legacy profile exists with basic info (est. 1999, biweekly Saturdays, $5). No upcoming events listed on HashRego.
- **Meetup:** No OK Meetup groups found

### Kennels

| # | Kennel | City | Status | Tier | Best Source | Notes |
|---|--------|------|--------|------|-------------|-------|
| 1 | Oklahoma City Wild Wild West H3 | Oklahoma City | ACTIVE | 3 | STATIC_SCHEDULE | Biweekly Saturdays. Winter 2pm, Summer 4-6pm. Est. 1999. $5. Facebook: OklahomaCityWildWildWestHashHouseHarriers. Email: okcw3h3@gmail.com. No website, no calendar. HashRego legacy profile exists (no events). Annual Green Dress Run (St. Patrick's Day). |
| 2 | Tulsa H3 | Tulsa | ACTIVE | 3 | STATIC_SCHEDULE | Biweekly Saturdays. Winter 2pm, Summer 4pm. Facebook group: tulsah3. Twitter: @tulsahhh. DP (down-down party) Thursday before trail. Annual Green Dress Run. |

**Proposed kennelCodes:**
- `okc-w3h3` (matches HashRego slug OKCW3H3; safe)
- `tulsa-h3` (safe, no collision)

**Verdict:** 0 shippable Tier 1. Both kennels are Facebook-coordinated with predictable biweekly Saturday schedules. STATIC_SCHEDULE is viable for both. The Oklahoma Interhash (OKIH) 2022 event was on HashRego, suggesting the community is real and active. Tried `{kennelname}@gmail.com` calendar variants -- okcw3h3@gmail.com exists (email found on HashRego) but no Google Calendar detected.

---

## Iowa

### Existing Coverage
None. Zero IA regions, kennels, or sources in DB or seed.

### Aggregator Results
- **Half-Mind IA:** Form required, not extractable
- **Genealogy:** Page truncated before IA
- **Harrier Central:** No IA kennels
- **HashRego:** No IA kennel slugs found
- **Meetup:** Des Moines H3 Meetup returns "Group not found" (dead)
- **Chicago H3 Iowa links page:** Lists 3 Iowa kennels with Facebook groups

### Kennels

| # | Kennel | City | Status | Tier | Best Source | Notes |
|---|--------|------|--------|------|-------------|-------|
| 1 | Greater Des Moines H3 | Des Moines | ACTIVE | 3 | STATIC_SCHEDULE | Facebook: DesMoinesHashHouseHarriers (also DSMHHH). Meetup dead. No website. "Greater Des Moines H3 serving Des Moines & Polk County." |
| 2 | Quad Cities H3 | Davenport/Rock Island | ACTIVE | 3 | STATIC_SCHEDULE | Website qch3.com (navigation hub, events on FB). Facebook: quadcitiesh3. Also facebook.com/groups/413296825594. Founded 2010-01-01. 300+ named members, 650+ trails run. Annual Red Dress Run charity event. |
| 3 | CRapids H3 | Cedar Rapids | DORMANT? | 3 | STATIC_SCHEDULE | Website crapids.pycks.com (basic). Facebook: facebook.com/groups/crapids. "CRapids H3 serving Cedar Rapids & Linn County." Activity level unclear. |
| 4 | Iowa Shitty H3 | Iowa City | DORMANT | Skip | -- | Tumblr blog (ich3.tumblr.com) indicates uncertainty about next run. Past meetups at Sanctuary Pub, 405 S. Gilbert St., 6pm. Likely dormant or very irregular. |

**Proposed kennelCodes:**
- `dsm-h3` (Des Moines; safe, no collision)
- `qc-h3` (Quad Cities; avoid `qch3` which is an alias for QCH4/Queen City)
- `crapids-h3` (Cedar Rapids; safe, unique)
- `ic-h3` (Iowa City; avoid `ich3` which is TAKEN by Iron City H3, Pittsburgh)

**Collision risks:**
- `ich3` is TAKEN (Iron City H3, Pittsburgh) -- Iowa City/Iowa Shitty must use `ic-h3`
- `qch3` is an ALIAS for Queen City H4 (Cincinnati) -- Quad Cities must use `qc-h3`

**Verdict:** 0 shippable Tier 1. Des Moines and Quad Cities are the best candidates for STATIC_SCHEDULE. QCH3 has a website with some content but events are Facebook-only. CRapids is marginal -- activity unclear. Iowa Shitty appears dormant.

---

## Utah

### Existing Coverage
None. Zero UT regions, kennels, or sources in DB or seed.

### Aggregator Results
- **Half-Mind UT:** Form required, not extractable
- **Genealogy:** Page truncated before UT
- **Harrier Central:** No UT kennels
- **HashRego:** FWH3 (Fair Weather H3) had a 2022 Hash Prom event. WH3 Whoreman Campout 2023 and Rainbow Dress 2024 events found.
- **Meetup:** Whoreman H3 Meetup ("Hash-House-Harriers-in-SLUT") returns "Group not found" (dead)

### Kennels

The Utah hash scene is organized under the **Whoreman H3** umbrella (whoremanh3.com), which serves as the hub for all Salt Lake area kennels. Facebook group: facebook.com/groups/UtahH3.

| # | Kennel | City | Status | Tier | Best Source | Notes |
|---|--------|------|--------|------|-------------|-------|
| 1 | Wasatch H3 | Salt Lake City | ACTIVE | 3 | STATIC_SCHEDULE | Founding hash in SLC (since 1991). "Mix of short trails, long trails, theme events, bar crawls, destination hiking." Schedule varies. |
| 2 | Lotsa Damn Shiggy (LDS) H3 | Salt Lake City | ACTIVE | 3 | STATIC_SCHEDULE | Thursday nights. Website ldsh3.com (SSL expired). Dedicated site suggests regular schedule. |
| 3 | SL,UT Discovery H3 | Salt Lake City | ACTIVE | 3 | STATIC_SCHEDULE | Pick-up style trails on/near every full moon. "Locations chosen by the Hare-Raiser, hares selected by a spin of the Sacred Bottle." |
| 4 | SLOSH (Salt Lake Old School Hash) | Salt Lake City | ACTIVE | 3 | STATIC_SCHEDULE | Sunday, once per month. Events include Hash Prom, bike hash, snowshoe hash. |
| 5 | Fair Weather H3 | Salt Lake City | ACTIVE? | Skip | -- | Listed on Whoreman site. HashRego event from 2022. Activity level unclear. May be seasonal. |
| 6 | Missionary Position BASH | Salt Lake City | ACTIVE? | Skip | -- | Listed on Whoreman site. Event #57 "Tour de Franzia" (14-mile trail) documented. Irregular/special events. |

**Proposed kennelCodes:**
- `wasatch-h3` (safe, no collision)
- `lds-h3` (safe)
- `slut-h3` (SL,UT Discovery; safe, memorable)
- `slosh-h3` (safe)
- `fw-h3-ut` (Fair Weather; with suffix to avoid generic collision)
- `mp-bash` (Missionary Position BASH; safe)

**Collision risks:**
- `wh3` is not taken as a kennelCode but could confuse with WH3 aliases in other contexts
- `slh3` is TAKEN (SLASH, London) -- cannot use for SLOSH

**Verdict:** 0 shippable Tier 1. Utah has the richest scene of any of these 5 states (6 kennels, 4 with identifiable schedules), but everything coordinates through Facebook/Whoreman hub. LDS H3 (Thursday nights) and SLOSH (monthly Sunday) have the most predictable schedules for STATIC_SCHEDULE. The Whoreman website exists but has no calendar widget, Google Calendar embed, or iCal feed.

---

## Aggregator Cross-Reference Summary

| Aggregator | KY | NV | OK | IA | UT |
|-----------|----|----|----|----|-----|
| Half-Mind | 9 kennels (4 alive) | Not extractable | Not extractable | Not extractable | Not extractable |
| Genealogy | Not reachable (truncated) | Not reachable | Not reachable | Not reachable | Not reachable |
| Harrier Central | 0 | 0 | 0 | 0 | 0 |
| HashRego | 0 events | 0 events | OKCW3H3 legacy profile | 0 events | WH3/FWH3 events (2022-2024) |
| Meetup | Dead (Louisville) | None found | None found | Dead (Des Moines) | Dead (Whoreman/SLUT) |
| Google Calendar | HAH3 calendar empty | No embeds found | No embeds found | No embeds found | No embeds found |

---

## kennelCode Collision Check

| Proposed Code | Collides With | Resolution |
|--------------|---------------|------------|
| `lvh3` | Lehigh Valley H3 (PA) | Use `lv-h3` |
| `ich3` | Iron City H3 (Pittsburgh) | Use `ic-h3` for Iowa City |
| `qch3` | QCH4 alias (Queen City, Cincinnati) | Use `qc-h3` for Quad Cities |
| `rh3` | Reading H3 (PA) | Use `reno-h3` |
| `slh3` | SLASH (London) | Use `slosh-h3` for SLOSH |

All other proposed codes are globally unique.

---

## Recommended Ship List

### Priority 1: STATIC_SCHEDULE candidates (strongest regular schedules)

These kennels have predictable, documented schedules that could ship as STATIC_SCHEDULE:

| # | Kennel | State | Schedule | Confidence |
|---|--------|-------|----------|------------|
| 1 | Louisville H3 | KY | Biweekly Saturday 2pm (winter) / 3pm (summer) | HIGH |
| 2 | OKC Wild Wild West H3 | OK | Biweekly Saturday 2pm (winter) / 4pm (summer) | HIGH |
| 3 | Tulsa H3 | OK | Biweekly Saturday 2pm (winter) / 4pm (summer) | HIGH |
| 4 | Las Vegas H3 (vlv!) | NV | 1st, 3rd, 5th Saturdays | HIGH |
| 5 | ASS H3 | NV | 2nd & 4th Friday 7:30pm | HIGH |
| 6 | LDS H3 | UT | Weekly Thursday evenings | MED |
| 7 | SLOSH | UT | Monthly Sunday | MED |
| 8 | Wasatch H3 | UT | Variable (not fixed schedule) | LOW |
| 9 | SL,UT Discovery H3 | UT | Monthly, near full moon | MED |
| 10 | Greater Des Moines H3 | IA | Unknown frequency | LOW |
| 11 | Quad Cities H3 | IA | Unknown frequency | LOW |
| 12 | Reno H3 | NV | Monthly | MED |

### Priority 2: Deferred (need schedule confirmation)

| Kennel | State | Issue |
|--------|-------|-------|
| Hellhound H3 | KY | Monthly full moon, but no web presence |
| CRapids H3 | IA | Activity level unclear |
| Fair Weather H3 | UT | Possibly seasonal/inactive |
| Missionary Position BASH | UT | Irregular special events |
| CarSin City H3 | NV | Activity unclear |

### Skip (no data source possible)

| Kennel | State | Reason |
|--------|-------|--------|
| Horse's Ass H3 | KY | Calendar exists but empty; Twitter-only |
| Lexington Lunatics | KY | No web presence ever |
| Rat Pack H3 | NV | Semi-active, special events only |
| Iowa Shitty H3 | IA | Dormant |

---

## Shared Adapter Opportunities

**None.** All shippable kennels in these 5 states would use the existing STATIC_SCHEDULE adapter. Zero new adapter code needed.

This is the same pattern seen in Georgia (11 static schedule kennels) and South Carolina (10 static schedule kennels). The STATIC_SCHEDULE adapter handles all of these with config-only changes.

---

## Open Questions

1. **Should we ship STATIC_SCHEDULE kennels for these states?** The "no sourceless kennels" memory note says "Only add kennels with real data sources; no Facebook-only directory entries." However, STATIC_SCHEDULE IS a real source type in the system -- it generates events from RRULE config without external fetch. GA and SC have 21 combined STATIC_SCHEDULE sources already. The question is whether biweekly-Saturday-at-2pm is sufficient signal when the only verification is Facebook posts.

2. **Louisville H3 WordPress REST API:** The site runs WordPress. Previous research (2026-04-07) found `/wp/v2/posts` has only 1 post from 2021 and `/wp/v2/pages` has "Mismanagement" + "Regional Kennels" only. Not viable as a data source.

3. **Horse's Ass H3 calendar reactivation:** Calendar ID `g2drd8u3nmknj0rubhv5d8eois@group.calendar.google.com` is known and verified working (just empty). If they resume posting events, this is an instant Tier 1 GOOGLE_CALENDAR source.

4. **Utah Whoreman hub as future scraper target:** whoremanh3.com could potentially become an HTML_SCRAPER source if they add event listings to the site. Currently it's metadata-only.

5. **Des Moines and Quad Cities schedule details:** Need Facebook verification to confirm frequency and day of week before shipping STATIC_SCHEDULE.

---

## Lessons Learned

1. **The "Facebook desert" is real in middle America.** All 5 states follow the same pattern: kennels are active on the ground, have Facebook groups for coordination, but publish zero structured data (no calendars, no Meetup, no websites with harelines). This is structurally different from coastal/metro kennels.

2. **Meetup attrition is accelerating.** Louisville, Des Moines, and Utah all had Meetup groups that now return 404. Meetup's pricing changes have pushed small clubs off the platform.

3. **Half-Mind "Alive" means people-alive, not data-alive.** A kennel marked "Alive" on Half-Mind may have zero digital presence beyond Facebook.

4. **Utah has the richest scene but worst data.** 6 active kennels under one umbrella (Whoreman), but no structured data source for any of them. A partnership with the Whoreman mismanagement to adopt Google Calendar would unlock the entire state.

5. **HashRego has legacy profiles but no events.** OKC W3H3 and Utah Fair Weather/Whoreman have HashRego kennel profiles, but no upcoming events listed. HashRego is used for special events (Interhash, campouts, Red Dress Runs) not regular trails.

6. **Genealogy gotothehash.net lists alphabetically and truncates.** The state filter doesn't work -- it returns ALL US kennels starting from Alabama and cuts off around Connecticut/Colorado due to page size. Not useful for targeted state research.
