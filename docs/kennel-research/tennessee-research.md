# Tennessee Kennel Research

**Researched:** 2026-04-07
**Shipped:** 1 new kennel (Choo-Choo H3) + reusable Tribe Events utility

## Existing Coverage
- **Bushwhackers H3** (Nashville) → GOOGLE_CALENDAR `bushwhackersh3@gmail.com`
- **Memphis H3** (`mh3-tn`) → GOOGLE_CALENDAR `memphish3@gmail.com`
- **GyNO H3** (`gynoh3`) → shares Memphis H3 calendar via `kennelPatterns`

## Aggregator Sources Found
- **Harrier Central:** No TN kennels
- **HashRego `/events` index:** Zero TN slug matches
- **half-mind.com TN list:** 11 kennels enumerated

## New Kennel Shipped

| Kennel | City | Source | Live verification |
|---|---|---|---|
| **Choo-Choo H3** (Chattanooga Choo Choo Hash House Harriers) | Chattanooga | HTML_SCRAPER via new `fetchTribeEvents` utility (The Events Calendar plugin's `/wp-json/tribe/events/v1/events`) | 12 events parsed, zero errors. Mix of "Hash" trails and "Monthly Drinking Practice" events |

### Discovery lesson
Initial probe hit `choochooh3.wixsite.com/choochooh3` (the old Wix site) which had a GCal iframe pointing at `choochooh3@gmail.com` — but that calendar was empty. **The real site is `choochooh3.com`** (user correction), running WordPress + The Events Calendar plugin with a clean JSON API. The Wix site is a stale placeholder.

Lesson added to `/research-region` skill: when a kennel's website appears to be Wix with an empty calendar, do a web search for the canonical domain — they may have migrated off Wix.

## New Reusable Utility
- `src/adapters/tribe-events.ts` — `fetchTribeEvents(siteUrl, options)` paginates through any WordPress site running "The Events Calendar" (StellarWP) plugin via its `tribe/events/v1/events` REST endpoint. Extremely common plugin — this opens the door to fast onboarding of future sites that use it.
- `src/adapters/html-scraper/choo-choo-h3.ts` — thin adapter wrapping the utility (~60 lines, fills in the kennelTag + date window filter).

## Deferred Kennels

| # | Kennel | City | Reason |
|---|--------|------|--------|
| 1 | **Music City H3** | Nashville | Site DOWN — WordPress "Error establishing a database connection" |
| 2 | **Clarksville Governators** | Clarksville/Ft Campbell | Weebly with minimal content; no calendar |
| 3 | **Knoxville H3** | Knoxville | No website |
| 4 | **PBR H3** (Post Beerpocalypse Revolution) | Nashville | FB only |
| 5 | **Tri-Cities Hash H3** | Johnson City/Kingsport | FB only |
| 6 | Black Dog H3 | Clarksville | Dead (tripod.com 502) |

## Follow-ups Flagged (NOT in scope)

### Bushwhackers H3 calendar may be stale
The existing Nashville source (`bushwhackersh3@gmail.com`) returned 11 events when queried with a 2025–2027 window — all from January–March 2025. Last update was 2025-03-04. Worth a health check.

### GyNO H3 region placement
Half-mind says GyNO is "Tennessee (statewide) — 3rd Monday monthly." Our DB attaches it to `Memphis, TN`. Flag for a reparent decision.

## Lessons Learned
1. **Wix subdomain != canonical domain.** When the Wix placeholder has an empty calendar but the kennel is clearly active per half-mind, assume they migrated off Wix and search for the real domain.
2. **Tribe Events REST API is low-hanging fruit.** Any WordPress site running The Events Calendar plugin is a single curl away from structured event data. The new `fetchTribeEvents` utility makes future adapters nearly trivial.
3. **Empty Google Calendar iframe is a skip signal**, even when the ID can be extracted. Seen in HAH3 (KY), HellHound (KY), and Choo-Choo's old Wix site — all had valid calendar IDs referenced in HTML but zero events in the calendar itself.
