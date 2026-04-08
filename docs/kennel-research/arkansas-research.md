# Arkansas Kennel Research

**Researched:** 2026-04-08
**Chrome-verified:** 2026-04-08 (see `chrome-verification/arkansas-2026-04-08.md`)
**Shipped:** 1 kennel (Little Rock H3) via STATIC_SCHEDULE — **first historic-kennel exception to the "no sourceless kennels" rule**

## Existing Coverage
None.

## Aggregator Sources Found
- **Harrier Central:** Probed 8 AR cities (Little Rock, Fayetteville, Bentonville, Hot Springs, Fort Smith, Jonesboro, Conway, Texarkana) — zero hits
- **HashRego /events live index:** zero AR slug matches
- **half-mind.com AR list:** 5 kennels enumerated

## New Kennel Shipped

| Kennel | City | Sources | Live verification |
|---|---|---|---|
| **Little Rock H3** (`lrh3`) | Little Rock | STATIC_SCHEDULE × 2 (weekly Sunday 15:00 + weekly Wednesday 19:00) | 26 events/source × 2 = 52 events generated in a 90-day window, all tagged `lrh3`, descriptions include the FB page URL |

### Historic-kennel exception
Per user decision documented in `feedback_sourceless_kennels` memory, LRH3 ships as the **first exception** to the "no sourceless kennels" rule. All exception criteria met:

1. ✅ **Historic / noteworthy** — Founded 1974-08-19, the **3rd US kennel** and 2nd oldest continuously hashing. Founder: Bob "Hazardous Waste" Rooke, parent lineage: Seoul H3. 50+ years of continuous operation.
2. ✅ **Verifiably active** — Facebook page (`facebook.com/littlerockhashhouseharriers`, 1.5K followers) confirmed active as of July 2025 via Chrome verification — posted about their 27th Annual HashFest Red Dress Run Weekend.
3. ✅ **Consistent recurrence** — Weekly Sunday ~3-4 PM + weekly Wednesday 7 PM, all year. Two STATIC_SCHEDULE sources with distinct RRULEs.
4. ✅ **Gap impact** — Not having this kennel would feel like a meaningful hole in coverage per user decision.

The trail location and hare details are only posted on Facebook the day of each run (or via their 501-666-HASH hotline). Both STATIC_SCHEDULE source configs put the Facebook URL in `defaultDescription` so users know where to check.

### Website note
`lrhash.com` is alive but is a hand-coded static HTML site from ~2005 (Cocoa HTML Writer meta tag) with no calendar, no iCal, no WordPress, no tribe events. The /events page lists 1-2 annual big events via RunSignup links. The /50th_anniversary subsite is a standalone Three.js page celebrating August 2024. None of it is scrapeable for weekly trails.

## Deferred Kennels

| # | Kennel | City | Status | Reason |
|---|--------|------|--------|--------|
| 1 | **Fayetteville H3** | Fayetteville | **Dormant** | FB group (273 members, public) last hash event was "Black Eyed Pea New Years Day Run 2023" (2023-01-01). Overrun with spam posts since. Likely absorbed by WOO H3 (see below). |
| 2 | **NWA H3 / WOO H3** (Wankers of Oz Hash House Harriers) | Rogers/Fayetteville area | **Active but private** | FB group `fb.com/groups/nwah3`, 384 members, **private** (can't verify monthly recurrence). Schedule: 2nd Friday 19:00. Launched June 2022. Name changed Sept 2025 (confirms active management). Covers Fayetteville/Rogers/Bentonville/Bella Vista/Springdale. Doesn't meet the historic-kennel exception bar (newer + private). |

### Fayetteville → WOO H3 absorption hypothesis
Fayetteville H3 and WOO H3 are listed as separate kennels on half-mind but cover the same geographic area. Fayetteville H3 went functionally dormant right around when WOO H3 launched (WOO H3 founded July 2022, Fayetteville H3's last FB hash event Jan 2023). Google's AI overview conflates them. This strongly suggests WOO H3 absorbed Fayetteville H3's membership.

**Not shipping an alias merge yet** — verifying would require joining the private WOO H3 FB group. Documented for future action.

## Dead Kennels
- **Christian Holy House Harriers (CH3)** — North Little Rock, marked Dead on half-mind
- **Warm Springs H3** — unspecified, marked Dead on half-mind

## Checks Performed
- [x] DB existing-coverage probe — 0 AR regions/kennels
- [x] half-mind.com AR list — 5 candidates enumerated
- [x] HashRego `/events` live index grep — 0 AR slugs (LRH3, LITTLEROCKH3, ARH3, FAYH3, NWAH3, BENTONVILLEH3, HOTSPRINGSH3, ROCKCITYH3, NATURALSTATEH3)
- [x] Harrier Central API — 8 cities probed, 0 hits
- [x] curl probe of lrhash.com homepage + /events + /contact — static HTML, no calendar/iCal/WP
- [x] WordPress REST API probe of lrhash.com — 404 (not a WP site)
- [x] Tribe events probe of lrhash.com — 404
- [x] 25 Google Calendar ID variants tried across all 3 alive kennels — all 0 items
- [x] Claude-in-Chrome second-pass verification — confirmed activity states, corrected NWA H3 → WOO H3 name, surfaced Fayetteville dormancy, validated LRH3 as historic exception
- [x] STATIC_SCHEDULE live dry-run — 52 events generated (26 Sunday + 26 Wednesday), descriptions include FB URL

## Region Updates
- New STATE_PROVINCE: `Arkansas`
- New METRO: `Little Rock, AR`
- `STATE_GROUP_MAP`: `Little Rock, AR` → `Arkansas`
- `COUNTRY_GROUP_MAP`: `Arkansas` → `United States`
- `stateMetroLinks` in `prisma/seed.ts`: `"Arkansas": ["Little Rock, AR"]`

## Future Opportunities (not in scope)
- **RunSignup adapter** — lrhash.com exposes RunSignup registration pages for LRH3's big annual events (Camp Clearfork Hashing, HashFest Red Dress, Green Dress Run Eureka Springs). RunSignup has a REST API. If we find 3+ kennels using RunSignup for annual events, worth building a new adapter type. For LRH3 alone it's 2-3 events/year — too small to justify the effort right now.
- **WOO H3 STATIC_SCHEDULE** — if we can verify activity via a different channel (joining the group, a public member posting screenshots, a website surfacing), we could add it as a second historic exception. Currently blocked on verification.
- **Fayetteville H3 → WOO H3 alias merge** — if confirmed, drop the Fayetteville H3 research doc entry and add "Fayetteville H3" as an alias for the (hypothetical) WOO H3 kennel record.

## Lessons Learned
- **Half-mind "Alive" status is not a source claim.** Little Rock H3 is marked alive on half-mind but has literally no structured web source — the listing predates the era when we'd expect calendars. Chrome verification is the right next step when the automated pass finds no source for a seemingly-active kennel.
- **First historic-kennel exception is documented.** The bar (historic + verifiably active + consistent recurrence + meaningful gap) is deliberately high to prevent the policy from drifting into "FB-only directory entries for any active kennel." See `feedback_sourceless_kennels` memory.
- **Fayetteville H3 → WOO H3 absorption pattern** is worth watching for elsewhere — small kennels sometimes get rebranded or absorbed by a larger sibling in the same area, and half-mind's data lag (years, not months) can make both look "alive" simultaneously.
