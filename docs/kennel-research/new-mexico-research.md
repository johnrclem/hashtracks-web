# New Mexico Kennel Research

**Researched:** 2026-04-01

## Existing Coverage
None

## Aggregator Sources Found
- **Harrier Central:** No NM kennels
- **HashRego:** No NM events
- **Meetup:** No active NM groups

## New Kennels Discovered

| # | Kennel | City | Status | Tier | Best Source | Source URL/ID | Notes |
|---|--------|------|--------|------|-------------|---------------|-------|
| 1 | ABQ H3 | Albuquerque, NM | ACTIVE | 1 | GOOGLE_CALENDAR | `j19gg5vekabk94i8sn3pe892gk@group.calendar.google.com` | Website: abqh3.com. Calendar on /trail-schedule. dateTime format, trail #1144+. Also has Google Drive embed (Sheets?). Weekly Sat summer / biweekly winter. |
| 2 | Santa Fe / Los Alamos H3 | Santa Fe, NM | UNCERTAIN | Skip | — | Old site geocities.ws/nnmh3 is dead (403). Linked from ABQ site. | No current web presence found. |

## Collision Check Results
- `abqh3` — OK (no collision)

## Checks Performed
- [x] Chrome source-type detection on abqh3.com/trail-schedule — Google Calendar iframe found
- [x] Google Calendar API verified: 5+ events with dateTime, trail numbers
- [x] Harrier Central — no NM kennels
- [x] Meetup — no active groups
- [x] HashRego — no NM events

## Recommended Onboarding Order
1. ABQ H3 → GOOGLE_CALENDAR (config-only, zero code)

## Skipped Kennels
- **Santa Fe / Los Alamos H3**: Old Geocities site dead. No other web presence found.

## Lessons Learned
- The old domain `abqhhh.com` is dead. The active site is `abqh3.com` — found via user correction. The web search returned the old domain first. This reinforces why the user-assisted discovery step is critical.
