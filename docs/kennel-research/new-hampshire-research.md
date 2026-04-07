# New Hampshire Kennel Research

**Researched:** 2026-04-07
**Result:** 0 kennels shippable (all Facebook-only, dead kennel websites)

## Existing Coverage
None. DB probe for regions containing Hampshire / NH / Concord / Seacoast / Enfield returned zero NH matches.

## Aggregator Sources Found
- **Harrier Central:** No NH kennels
- **HashRego `/events` index:** Zero NH slugs (SEAH3, NHH3, UVH3, HashMpire, CONCORD, NEWHASH — all 0 matches)
- **Meetup:** No results for `site:meetup.com "New Hampshire" hash house harriers`
- **gotothehash.net:** No NH-specific entries
- **half-mind.com NH list:** 4 kennels listed, all "Alive"

## Candidate Kennels

| # | Kennel | City | Status | Source | Notes |
|---|--------|------|--------|--------|-------|
| 1 | Concord H3 | Concord | Skip | — | concordh3.com DEAD (HTTP 000); Facebook page only |
| 2 | Seacoast H3 | Seacoast Region | Skip | — | seacoasth3.com DEAD; FB group only; HM schedule "Every Other Saturday 13:00" |
| 3 | The New HashMpire H3 | NH (statewide) | Skip | — | newhashmpire.com DEAD; FB only |
| 4 | Upper Valley H3 | Enfield | Skip | — | No website ever; founded 2022, FB only |

## Checks Performed
- [x] Grep seed data / DB for NH regions and kennels — none
- [x] Harrier Central reference memory — no NH kennels
- [x] HashRego `/events` live index grep — 0 NH slug matches
- [x] Meetup search — no results
- [x] half-mind.com NH list — 4 candidates enumerated
- [x] Dead domain check — all 3 listed domains return HTTP 000
- [x] Google Calendar ID variants tried (12 total, all HTTP 404):
  - `concordh3@gmail.com`, `seacoasth3@gmail.com`, `seacoasth3hashcash@gmail.com`
  - `newhashmpire@gmail.com`, `uppervalleyh3@gmail.com`, `uvh3@gmail.com`
  - `nhh3@gmail.com`, `nhh3hashcash@gmail.com`, `ch3nh@gmail.com`
  - `concordnh@gmail.com`, `concordhhh@gmail.com`, `hashmpire@gmail.com`
- [x] Boston Hash Google Calendar does not cover NH events (Boston aggregator is MA-only)

## Conclusion
Under the "no sourceless kennels" rule, **nothing shippable in NH today.** All 4 known kennels are Facebook-only with dead web presences. This mirrors the pattern we saw in Alabama (6 kennels, only 3 shippable) and is worse — zero escape hatches here.

## Defer Until
- A kennel builds a website or adopts a Google Calendar
- A kennel appears in HashRego's live `/events` index (for registration-required events)
- User manually provides a direct calendar ID or iCal feed

## Lessons Learned
- Small-state NH is essentially a dead zone for structured data — the 4 kennels appear to rely entirely on FB for announcements.
- The Gmail Calendar ID probe (12 variants × 4 kennels worth of patterns) is fast and cheap enough to run as a batch — worth keeping in the research skill.
- Dead domain check (`curl -o /dev/null -w %{http_code}` with short timeout) is a quick first-pass filter before attempting Chrome probes.
