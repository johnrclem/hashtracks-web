# Singapore Chrome Verification — 2026-04-08

**Status:** ✅ Complete — results captured below

## Results (verbatim from Chrome)

### 1. Hash House Harriers Singapore (HHHS / Father Hash) — ACTIVE
- Wix site at `hhhs.org.sg/hareline` has a fully populated hareline table inside a `wix-visual-data.appspot.com` iframe (compId `comp-jxzijgcm`, 839×2774px). Columns: Run#, Date, Hares, Location, Notes. Spans Run #3283 (29 Dec 2025) → Run #3301 (4 May 2026), with future runs continuing.
- Homepage NEXT RUN block confirms Run #3298, Mon 13 April 2026, 6 PM, with hares + address + map + on-on + t-shirt info.
- No Google Calendar / iCal / Meetup / FB group link in the site.
- **Verdict (ship via STATIC_SCHEDULE):** The Wix iframe scraping is rich but fragile (would need browser-render of an iframe). For this PR, ship via STATIC_SCHEDULE under the historic-kennel exception (founded 1962, the 2nd kennel in the world). Future enhancement: Wix browser-render adapter.

### 2. Seletar HHH (SH3) — ACTIVE
- Two real sources found via Chrome:
  - Static homepage table: 1 upcoming run (#2373, Tue 7 Apr 2026)
  - **PWA at `sh3app.hash.org.sg`** with 14+ future runs (through Run #2387 on Tue 14 Jul 2026), backed by `HashController.php` POST API
- The `/hareline.html` 1980-2000 archive is historical only.
- **Verdict (defer):** PWA scraping is more complex than the patterns we have today (Angular SPA, would need browser-render or POST API reverse-engineering). Worth a dedicated follow-up PR.

### 3. Singapore Hash House Harriets — ACTIVE
- Website `singaporeharriets.com` confirmed DEAD (DNS failure). No alt domains.
- **Public** Facebook group at `facebook.com/groups/49667691372/`, **374 members**, very active (April 2026 posts confirmed).
- Founded 1973, women's hash with men welcomed, weekly Wednesdays 6 PM.
- **Verdict (ship via STATIC_SCHEDULE):** Meets all 4 historic-kennel exception criteria — historic (oldest women's hash in Asia), verifiably active (public FB), consistent recurrence (weekly Wed), meaningful gap (only women's hash in SG).

### 4. Thirsdae HHH — DEAD
- Website `thirsdae.hash.org.sg` is still live and explicitly states "The Thirsdae HHH is no longer active."
- Last AGM: October 2019. Founded August 2003.
- **Verdict (skip):** Confirmed dead, no action.

### 5. Kampong H3 — ACTIVE
- `kampong.hash.org.sg` is hand-coded static HTML with a "Next Run" block:
  - Run 296, Saturday 18 April 2026, 5:30 PM, Hare: Fawlty Towers, Run site: T.B.A.
  - Page last modified March 31 (2026)
- Hash cash S$20, 3rd Saturday monthly, mixed.
- FB group: `facebook.com/groups/96654980525/`
- **Verdict (ship via custom HTML_SCRAPER):** Tiny Cheerio adapter scraping the "Next Run" block. Page is reliably maintained.

### 6. Singapore Bike Hash — ACTIVE but no scrapeable source
- Google Sites page contains only archival 2005-2019 PDFs/Drive folders. No GCal embed.
- Wikipedia confirms claim of longest-running bike hash chapter (since July 1989).
- Active per Ducati forum (March 2026 post) + recent FB references.
- Schedule is irregular (~10 rides/year, not strictly fortnightly).
- **Verdict (skip):** Doesn't meet historic-kennel exception bar — fails the "consistent recurrence" criterion.

### 7. Singapore Hash House Horrors — ACTIVE
- WordPress.com hosted blog (NOT self-hosted) — `/wp-json/` returns 404 but **WordPress.com Public API** at `public-api.wordpress.com/rest/v1.1/sites/hashhousehorrors.com/posts/` returns 94 structured posts.
- `/hareline/` page has future runs: Hash 1016 (May 17), 1015 (May 3), 1014 (Apr 19, hares needed), etc.
- Children's hash, biweekly Sundays 16:30, families run together.
- FB group: `facebook.com/groups/688904981144056/`
- **Verdict (defer):** Requires building a new WordPress.com Public API utility (different from self-hosted WP REST). Worth a dedicated follow-up PR with proper test coverage.

## Summary table

| # | Kennel | Verdict | Source | Notes |
|---|---|---|---|---|
| 1 | HHHS (Father Hash) | **SHIP** | STATIC_SCHEDULE (Mon 18:00) | Historic exception — 2nd kennel ever, 1962 |
| 2 | Seletar SH3 | **DEFER** | PWA scraping needed | sh3app.hash.org.sg / HashController.php |
| 3 | Singapore Harriets | **SHIP** | STATIC_SCHEDULE (Wed 18:00) | Historic exception — public FB group, 374 members |
| 4 | Thirsdae HHH | **SKIP** | — | Confirmed dead since 2019 |
| 5 | Kampong H3 | **SHIP** | Custom HTML scraper | Static "Next Run" block |
| 6 | Singapore Bike Hash | **SKIP** | — | Irregular schedule, no current source |
| 7 | Hash House Horrors | **DEFER** | WordPress.com Public API needed | Worth its own PR |

Plus already-verified from automated pass:
| 8 | Lion City H3 | **SHIP** | Custom HTML scraper (WordPress posts) | DCH4 pattern reused |
| 9 | Singapore Sunday HHH | **SHIP** | Harrier Central (zero code) | SH3-SG kennel ID |

**This PR ships 5 kennels.** 2 deferred for follow-up. 2 confirmed dead/skipped.

---

## Original prompt (kept for traceability)

## Context

Singapore has 9 known kennels per the central directory at `hash.org.sg`. Two are already confirmed shippable via the automated pass:
- **Singapore Sunday HHH (SH3-SG)** — Harrier Central API, 1 upcoming event verified
- **Lion City HHH** — WordPress site posts weekly "Hash Run #N" entries with structured fields (Date / Hare / Map / Run Location / MRT / Bus / On-On). Latest post Hash Run #2,193 published 2026-03-31 for Friday Apr 3.

This Chrome verification round is to:
1. Confirm activity status for the 7 other kennels
2. Find scrapeable sources for any kennel that has them but isn't on Harrier Central / HashRego / WordPress
3. Specifically dig into **Father Hash (HHHS)** — the historic 1962 kennel — which uses a Wix site and might have an embedded calendar / Wix Events / Table Master widget
4. Verify whether Singapore Hash House Harriets is truly site-dead or just a domain change
5. Confirm Thirsdae HHH is genuinely dormant since May 2019 vs revived

## Chrome prompt

```
I'm helping verify hash kennel data for HashTracks (a Hash House Harriers event aggregator). I need your help re-checking 7 Singapore kennels to find scrapeable event sources we may have missed. Before you start, please skim these two docs from the project so you understand what counts as a usable source and the discovery patterns we use:

- **Research methodology & discovery checklist:** https://github.com/johnrclem/hashtracks-web/blob/main/docs/regional-research-prompt.md
- **Source onboarding playbook (adapter types & priority):** https://github.com/johnrclem/hashtracks-web/blob/main/docs/source-onboarding-playbook.md

The TL;DR of what counts as a "good source" (in priority order):
1. Google Calendar with a public ID
2. Meetup group with active events
3. iCal feed (`.ics` or `webcal://`)
4. Harrier Central API (`hashruns.org`) — already checked Singapore-wide, only 1 hit
5. WordPress site exposing The Events Calendar plugin (`/wp-json/tribe/events/v1/events`)
6. WordPress REST API for posts/pages
7. Any HTML page with structured event listings (table, list, JSON-in-script, Wix widgets)
8. STATIC_SCHEDULE with a known recurrence + anchor date

Singapore is the second-oldest hashing scene in the world (after Mother Hash in KL, Malaysia, founded 1938). The "Father Hash" — Hash House Harriers Singapore — was founded in 1962 and is the second registered hash kennel. We're motivated to onboard as much as possible.

## Already confirmed shippable (DO NOT re-check, just for context)

- ✅ **Singapore Sunday HHH (SH3-SG)** — Harrier Central API, 1 upcoming event confirmed
- ✅ **Lion City HHH** — WordPress site at lioncityhhh.com posts weekly "Hash Run #N" entries with structured fields. Latest post: Hash Run #2,193 (2026-03-31) for Friday April 3 trail.

## The 7 kennels to re-check

### 1. Hash House Harriers Singapore (HHHS / "Father Hash")
- **Founded 1962**, 2nd hash kennel ever (after Mother Hash KL 1938)
- Schedule: Mondays 6 PM, **men only**
- Website: **https://hhhs.org.sg/** — confirmed live, **Wix-built** (645KB page, "Wix.com Website Builder" generator)
- The Wix page mentions "Hareline" but my regex-based scrape can't see Wix-rendered widgets
- **Things to try in Chrome:**
  - Visit hhhs.org.sg in Chrome and look at the rendered Hareline section — Wix Events / Wix Calendar / BoomTech / Table Master iframes
  - Check `/hareline`, `/calendar`, `/runs`, `/events`, `/schedule` subpaths
  - Inspect any iframe `src` attributes — especially `wix-bookings-services.com`, `tablemaster`, `editor.wix.com/calendar`
  - Look for a Google Calendar ID embedded in any iframe
  - Search for fbcom or Meetup links in the bio / about / contact pages

### 2. Seletar Hash House Harriers (SH3, Singapore — different from SH3-SG)
- **Founded 1980**, men only, Tuesdays 6 PM
- Website: **https://seletar.hash.org.sg/** — live, very simple HTML
- The `/hareline.html` page exists and is 292KB but **only goes 1980–2000** (a 20-year historical archive, then they stopped updating)
- The `/private/hareline.html` requires auth (HTTP 401)
- **Things to try in Chrome:**
  - Look for a current/recent hareline elsewhere on the site — `/events.html`, `/private/`, the newsletter or magazine pages
  - Check if they post recent run info on Facebook
  - Verify they're still active (founded 1980, men-only, weekly Tuesdays — easy to confirm via FB)
  - If a contact email is visible (`nevercome@hash.org.sg` per the directory), no action needed

### 3. Singapore Hash House Harriets
- **Founded 1973**, women's hash, mixed welcome, Wednesdays 6 PM
- Website: **https://singaporeharriets.com/** — **DNS DEAD** (HTTP 000 from curl)
- **Things to try in Chrome:**
  - Verify singaporeharriets.com is actually dead, or if it's just temporarily down
  - Search for an alternate domain — `harriets.org.sg`, `sgharriets.com`, etc.
  - Check Facebook for "Singapore Hash House Harriets" — confirm activity, find pinned posts with calendar/website link
  - Try archive.org for singaporeharriets.com to find their last-known calendar / contact info

### 4. Thirsdae HHH
- Schedule: Thursdays 6 PM
- Website: thirsdae.hash.org.sg
- **Marked "Inactive since May 2019"** in the central directory
- **Things to try in Chrome:** confirm dead, OR confirm revival. Quick check.

### 5. Kampong HHH
- Mixed, **3rd Saturday monthly 5:30 PM**
- Website: **https://kampong.hash.org.sg/** — live (105KB, the page mentions "Hareline" somewhere)
- FB group: https://www.facebook.com/groups/96654980525/
- Tried `/hareline/` → 404
- WP REST API check returns invalid JSON (might not be WordPress)
- **Things to try in Chrome:**
  - Visit kampong.hash.org.sg in Chrome — find the hareline page, calendar, or events list
  - Check menu navigation for `Schedule`, `Hareline`, `Next Run`, `Events`
  - Inspect any iframes for embedded calendar
  - Try `/hareline.html`, `/events`, `/calendar`, `/runs`, `/schedule`
  - Check the FB group for activity

### 6. Singapore Bike Hash
- Mixed bike hash, **rides about 10 Sundays a year**
- Website: **https://sites.google.com/view/singaporebikehash/** — Google Sites (need browser render)
- Contact: bikehashsg@gmail.com (tried as a Google Calendar ID, returned 0 events)
- **Things to try in Chrome:**
  - Visit the Google Sites page — Google Sites often has embedded Google Calendar widgets that don't surface to plain HTTP
  - Look for an embedded calendar iframe pointing at `calendar.google.com/calendar/embed?src=...`
  - Look for a downloadable schedule PDF / image
  - Check if there's a Meetup or another contact channel

### 7. Singapore Hash House Horrors
- **Children's run**, alternate Sundays 4:30 PM
- Website: **https://hashhousehorrors.com/** — live (262KB)
- Contact: hhhorrors@gmail.com (tried as a Google Calendar ID, returned 0 events)
- FB group exists per the central directory
- **Things to try in Chrome:**
  - Visit hashhousehorrors.com in Chrome — find their schedule / hareline / next run page
  - Look for a calendar embed
  - Check FB for activity

## Google Calendar ID variants I already tried (all returned 0 events)
`motherhash@gmail.com`, `motherh3@gmail.com`, `singaporeh3@gmail.com`, `sgh3@gmail.com`, `shh3@gmail.com`, `sh3sg@gmail.com`, `lioncityh3@gmail.com`, `hardycurrybash@gmail.com`, `kuchingh3@gmail.com`, `sundayhash@gmail.com`, `sundayhashh3@gmail.com`, `bikehashsg@gmail.com`, `hhhorrors@gmail.com`

## Other checks already done
- **HashRego /events live index:** 0 SG slug matches
- **Harrier Central API:** Probed `cityNames=Singapore` → 1 hit (SH3-SG only)
- **DB existing-coverage:** 0 SG kennels in production
- **WordPress REST API on lioncityhhh.com:** confirmed (used to extract Hash Run posts)
- **WordPress REST API on kampong.hash.org.sg:** invalid JSON response

## What I need back

For each of the 7 kennels, please report one of:
- **A working source** — type (calendar/iCal/Meetup/WordPress/etc.) plus the canonical URL or ID. **Verify it actually contains upcoming events** before reporting it.
- **A current website with a hareline page** even if I missed it in the automated probe — give me the exact URL of the page that lists upcoming runs
- **Active but Facebook/Instagram-only** — confirm the kennel is alive (date of most recent post), note follower count, and flag whether the FB group is private or public
- **Confirmed dormant or dead** — note what you found (e.g. "FB page hasn't posted since 2023", "no website found in search")

For HHHS (Father Hash) and Kampong HHH specifically: please **inspect the rendered Wix / WordPress page in Chrome** rather than just looking at search results — the calendar widgets are JS-rendered and won't show up in raw HTML or web search snippets.

Skip Facebook, Instagram, WhatsApp, Discord, and email-only contacts as **sources** — but DO report on them as activity evidence.
```
