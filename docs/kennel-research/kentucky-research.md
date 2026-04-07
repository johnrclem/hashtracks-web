# Kentucky Kennel Research

**Researched:** 2026-04-07
**Result:** 0 kennels shippable (all alive kennels rely on dead calendars, Facebook, or Twitter)

## Existing Coverage
None. DB probe for regions matching Kentucky / KY / Louisville / Lexington / Bowling Green / Covington / Owensboro returned zero KY matches.

## Aggregator Sources Found
- **Harrier Central:** No KY kennels (per reference memory)
- **HashRego `/events` index:** Zero KY slug matches (LouH3, LEXH3, LKH3, KYH3, DerbyH3, BluegrassH3 all 0)
- **Meetup:** Louisville H3 Meetup group returns "Group not found" — dead
- **half-mind.com KY list:** 9 kennels enumerated (4 alive, 5 dead)

## Candidate Kennels

| # | Kennel | City | half-mind | Website | Verdict |
|---|--------|------|-----------|---------|---------|
| 1 | **Horse's Ass H3** | Lexington | Alive, Every Other Sat 14:00 | lexingtonhah3.org (LIVE) | Skip — embedded GCal `g2drd8u3nmknj0rubhv5d8eois@group.calendar.google.com` has **0 events** (unmaintained); site says "Follow the tweet on and on to the next Hash info" |
| 2 | **Louisville H3** | Louisville | Alive, Every Other Sat | louisvillehashers.com (LIVE, WordPress) | Skip — no calendar embed, no iframe, only a Meetup link and the Meetup group returns "Group not found" |
| 3 | **Hellhound H3** | Lexington | Alive, Monthly Full Moon | hellhoundh3.com (DEAD, NXDOMAIN) | Skip — domain dead; 2022 Wayback snapshot had no calendar either. FB/Twitter only. |
| 4 | **Lexington Lunatics H3** | Lexington | Alive, Every Full Moon | none | Skip — no website ever |
| 5 | Beaver Creek H3 | Clarksville area | Dead | — | Skip |
| 6 | Bluegrass H3 | KY | Dead | — | Skip |
| 7 | Four Roses Full Moon H3 | KY | Dead | — | Skip |
| 8 | Ft Knox Hors Hunt H3 | KY | Dead | — | Skip |
| 9 | Licking Valley H3 | Northern KY | Dead | lickingvalleyh3.com (DEAD) | Skip |

## Checks Performed
- [x] DB existing-coverage probe — zero KY kennels
- [x] half-mind.com KY list — 9 candidates enumerated
- [x] HashRego `/events` live index grep — 0 KY slug matches
- [x] Meetup — Louisville group 404
- [x] Harrier Central — no KY kennels
- [x] Chrome probe of all 4 discovered websites (lexingtonhah3.org, louisvillehashers.com, hellhoundh3.com, lickingvalleyh3.com) — 2 live, 2 dead
- [x] Extracted HAH3 calendar ID from iframe, verified empty via Calendar API
- [x] Louisville WordPress REST API probed — `/wp/v2/posts` has 1 post from 2021, `/wp/v2/pages` has only "Mismanagement" + "Regional Kennels"
- [x] 15 Google Calendar ID variants tried across all 4 alive kennels — all HTTP 404 or 0 events
- [x] Hellhound Wayback 2022 snapshot probed — no calendar present even historically

## Conclusion
Under the "no sourceless kennels" rule, **nothing shippable in KY today.** The closest miss is Horse's Ass H3, which has the scaffolding right (embedded Google Calendar on their website) but the calendar hasn't had events added in years — they moved to Twitter-based announcements. Louisville H3 is live and running but publishes nothing structured.

## Defer Until
- Horse's Ass H3 resumes posting to their Google Calendar (adapter config is ready: `g2drd8u3nmknj0rubhv5d8eois@group.calendar.google.com`)
- Louisville H3 adopts a calendar, reboots their Meetup, or the user provides a direct feed
- Hellhound revives their website or adopts a calendar

## Lessons Learned
- **Half-mind "Alive" status is about the kennel, not their data.** A kennel can be perfectly active on the ground but publish zero structured data. We encountered this in Alabama (GCH3 runs monthly but "post trail details on Facebook") and now Kentucky.
- **Empty-calendar false positives:** HAH3 had a calendar iframe on their site, curl-extracted the ID cleanly, but the calendar had 0 events. Always verify event count, not just 200 OK. Added to mental checklist for the research skill.
- **Wayback probing is low-yield for dead kennel sites** — they usually redirect to FB/Twitter by the time they appear in the archive. Not worth pursuing unless there's a specific reason to suspect an archived calendar embed.
