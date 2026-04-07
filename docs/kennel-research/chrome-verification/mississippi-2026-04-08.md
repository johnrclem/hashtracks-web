# Mississippi Chrome Verification — 2026-04-08

Re-checked the 3 deferred Mississippi kennels via Claude in Chrome to confirm the automated research pass didn't miss anything.

## Result
**All 3 confirmed sourceless.** Chrome found additional context (activity status, kennel codes, FB group privacy, dead-domain successors) but no usable structured data sources.

## Per-kennel findings

| Kennel | Activity Status | Best Non-FB Presence | Notes |
|---|---|---|---|
| **Biloxi H3** | **Dormant** — last FB post 2023-09-11 | HashRego slug `biloxih3` (old campout events only) | 18+ months inactive on FB; biloxih3.com archive.org has only 2 captures from 2008 |
| **Jackson H3 (JXNH3)** | **Likely active** — members RSVP'd to DallasH3 Texas Interhash 2026 | Dead Google Sites: `sites.google.com/site/queencityhash` (404) | Private FB group "Jackson, Mississippi (MS) Hash House Harriers (JXNH3)", 325 members. Revived 2018 by "Spelunk My Abyss". Schedule: monthly Saturday 14:00 |
| **OUCH3** | **Active** — confirmed via 35th-birthday-run announcement on RunOxford FB group, 2026-01-19 | Dead phpwebhosting site (`ouch3.phpwebhosting.com`) | Private FB group, 363 members. ouch3.com domain repurposed by The Local Voice newspaper. Founded 1991-01-19. Contact `naturehumphries@gmail.com` |

## Newly captured facts (not in original research doc)
- **Jackson H3 actually goes by JXNH3** — the abbreviation we should use if we ever ship them
- **OUCH3's last verified activity is 2026-01-19** (their 35th birthday run) — most active of the three
- **Biloxi H3's email is `biloxih3@gmail.com`** — confirms the GCal variant we tried, no surprise hit
- **All three FB groups are private** — even FB-event scraping wouldn't work without membership

## STATIC_SCHEDULE candidates (if policy ever changes)
None of these have structured data, but if the "no FB-only kennels" rule were ever relaxed, these would be the order:
1. **OUCH3** — Last Saturday + 1st Sunday at 1:00 PM (actively running, well-documented schedule)
2. **JXNH3** — Monthly Saturday at 2:00 PM (likely active, less verified)
3. **Biloxi H3** — Skip until they show signs of life (18+ months dormant)

## Chrome prompt used
The full prompt that produced these findings is captured below for reference.

---

I'm helping verify hash kennel data for HashTracks (a Hash House Harriers event aggregator). I need your help re-checking 3 Mississippi kennels that came back as "no scrapeable sources" in an automated research pass. Before you start, please skim these two docs from the project so you understand what counts as a usable source and the discovery patterns we use:

- **Research methodology & discovery checklist:** https://github.com/johnrclem/hashtracks-web/blob/main/docs/regional-research-prompt.md
- **Source onboarding playbook (adapter types & priority):** https://github.com/johnrclem/hashtracks-web/blob/main/docs/source-onboarding-playbook.md

The TL;DR of what counts as a "good source" (in priority order):
1. Google Calendar with a public ID
2. Meetup group with active events
3. iCal feed (`.ics` or `webcal://`)
4. Harrier Central API (`hashruns.org`) — already checked, no MS hits
5. WordPress site exposing The Events Calendar plugin (`/wp-json/tribe/events/v1/events`)
6. WordPress REST API for posts/pages
7. Any HTML page with structured event listings (table, list, JSON-in-script)
8. STATIC_SCHEDULE with a known recurrence + anchor date

Facebook-only / Instagram-only kennels are **not** usable — the merge pipeline can't ingest FB events, and per project policy we don't add directory-style entries.

## The 3 kennels to re-check

**1. Biloxi H3 — Biloxi, MS**
- Half-mind says alive, "Variable Saturday 1:00 PM"
- Their own statement: *"Biloxi H3 isn't dead, we've just been lost on trail!"*
- `biloxih3.com` returns NXDOMAIN
- Things to try: archive.org for biloxih3.com, search `"Biloxi H3" hash`, FB page check, see if they appear on the Gulf Coast H3 (Mobile, AL) calendar `gch3hash@gmail.com`

**2. Jackson H3 — Jackson, MS (sometimes "Magnolia H3")**
- Half-mind says alive, "Monthly Saturday 2:00 PM year-round"
- Facebook only per half-mind
- Things to try: search FB for Jackson Hash House Harriers, check pinned posts for calendar/website links, search `"Jackson MS H3" calendar`

**3. OUCH3 — Oxford University-Community Hash House Harriers, Oxford, MS**
- Half-mind lists `ouch3.com` but the domain has been **repurposed** to "The Local Voice — Roundabout Oxford & Ole Miss" newspaper
- Half-mind says alive, "Last Saturday and 1st Sunday at 1:00 PM"
- Things to try: `oxfordhash.com` / `oxfordh3.com` / `olemissh3.com`, FB search for "Oxford University Community H3", Ole Miss club registry

## Google Calendar ID variants I already tried (all returned 0 events)
`biloxih3@gmail.com`, `biloxih3hashcash@gmail.com`, `biloxihash@gmail.com`, `jacksonh3@gmail.com`, `jacksonh3hashcash@gmail.com`, `jacksonmsh3@gmail.com`, `magnoliah3@gmail.com`, `ouch3@gmail.com`, `ouch3hashcash@gmail.com`, `oxfordh3@gmail.com`, `oxfordh3ms@gmail.com`

## What I need back
For each kennel, report one of:
- A working source (verify upcoming events exist)
- A current website (note platform)
- Confirmed dead

Skip Facebook, Instagram, WhatsApp, Discord, and email-only contacts.
