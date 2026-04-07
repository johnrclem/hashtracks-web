# Mississippi Kennel Research

**Researched:** 2026-04-08
**Chrome-verified:** 2026-04-08 (see `chrome-verification/mississippi-2026-04-08.md`)
**Result:** 0 shippable kennels — all 3 alive kennels confirmed Facebook-only

## Existing Coverage
None.

## Aggregator Sources Found
- **Harrier Central:** Probed 9 MS cities (Jackson, Biloxi, Gulfport, Hattiesburg, Tupelo, Oxford, Starkville, Meridian, Vicksburg) — zero hits
- **HashRego /events live index:** zero MS slug matches
- **half-mind.com MS list:** 3 kennels enumerated

## Candidate Kennels

| # | Kennel | Code | City | half-mind | Activity | Website | Verdict |
|---|--------|------|------|-----------|----------|---------|---------|
| 1 | **Biloxi H3** | (would be `biloxih3`) | Biloxi | Alive, Variable Sat 13:00 | **Dormant** — last FB post 2023-09-11 | biloxih3.com DEAD (NXDOMAIN since ~2008) | Skip — 18+ months FB-inactive |
| 2 | **Jackson H3** | `jxnh3` | Jackson | Alive, monthly Sat 14:00 | Likely active (members at national events) | None — old Google Sites at `queencityhash` is 404 | Skip — private FB group only (325 members) |
| 3 | **OUCH3** (Oxford University-Community H3) | `ouch3` | Oxford | Alive, last Sat + 1st Sun 13:00 | **Active** — confirmed via 35th-birthday-run announcement 2026-01-19 | `ouch3.com` repurposed as The Local Voice newspaper; phpwebhosting site dead | Skip — private FB group only (363 members) |

## Checks Performed
- [x] DB existing-coverage probe — 0 MS regions/kennels
- [x] half-mind.com MS list — 3 candidates enumerated
- [x] HashRego `/events` live index grep — 0 MS slugs
- [x] Harrier Central API — 9 cities probed, 0 hits
- [x] curl probe of biloxih3.com → NXDOMAIN
- [x] curl probe of ouch3.com → 200 OK but content is The Local Voice newspaper (domain repurposed)
- [x] Chrome probe of biloxih3.com → confirmed NXDOMAIN
- [x] WordPress REST API probe of ouch3.com → it's not the kennel's site
- [x] 11 Google Calendar ID variants tried — all 0 items
- [x] Claude-in-Chrome second-pass verification — confirmed all 3 sourceless, captured FB activity status, JXNH3 abbreviation, founder names, last-seen evidence

## Lessons Learned
- **Three small Southern states in a row with 0 shippable kennels** (KY, MS, plus NH earlier). The pattern: small kennels with dedicated members but no tech infrastructure beyond FB groups. This is the long tail.
- **Chrome verification surfaced facts the automated pass missed** — JXNH3 abbreviation, OUCH3's exact most-recent run date, FB group membership counts. Worth the extra step on every "0 shippable" research outcome.
- **Domain repurposing is a real risk** — `ouch3.com` is now a local newspaper. The half-mind URL is years stale. When a domain returns 200 but the content isn't a hash kennel, the kennel is effectively website-less.

## STATIC_SCHEDULE candidates (deferred)
None of these have structured data, but if the "no FB-only kennels" rule were ever relaxed and we accepted STATIC_SCHEDULE entries for actively-running FB-only kennels, the order would be:
1. **OUCH3** — Last Saturday + 1st Sunday at 1:00 PM (most recently verified active, well-defined recurrence)
2. **JXNH3** — Monthly Saturday at 2:00 PM (less verified)
3. **Biloxi H3** — defer further until they show signs of life

## Defer Until
- Biloxi H3 resumes posting on FB or builds a website
- Jackson H3 (JXNH3) goes public with their group or adopts a calendar
- OUCH3 builds a new website or adopts a Google Calendar — they're actively running and most likely to onboard if asked directly
