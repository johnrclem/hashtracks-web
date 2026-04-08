# Singapore Kennel Research

**Researched:** 2026-04-08
**Chrome-verified:** 2026-04-08 (see `chrome-verification/singapore-2026-04-08.md`)
**Shipped:** 5 kennels via 4 source patterns. 2 deferred for follow-up. 2 confirmed dead/skipped.

## Why Singapore matters
Singapore is the second-oldest hashing scene in the world. The original Mother Hash was founded in **Kuala Lumpur, Malaysia in 1938**; the Singapore "Father Hash" (HHHS) was founded in **1962** — the **second hash kennel ever**. Singapore's foot-hash scene now spans 7+ active kennels covering every weekday plus Sundays.

## Existing Coverage
None.

## Aggregator Sources Found
- **Harrier Central:** 1 hit — Singapore Sunday HHH (`SH3-SG`) with 1 upcoming event
- **HashRego /events live index:** 0 SG slug matches
- **hash.org.sg central directory:** 9 kennels enumerated (8 active or "active", 1 explicitly inactive)

## New Kennels Shipped (5)

| # | Kennel | Founded | Source | Live verification |
|---|--------|---------|--------|-------------------|
| 1 | **Hash House Harriers Singapore (HHHS / "Father Hash")** | 1962 | STATIC_SCHEDULE (weekly Mon 18:00) — historic exception | 26 events generated, descriptions link to hareline page |
| 2 | **Singapore Hash House Harriets** | 1973 | STATIC_SCHEDULE (weekly Wed 18:00) — historic exception | 25 events generated, descriptions link to public FB group |
| 3 | **Lion City H3** | — | Custom HTML scraper (WordPress posts via `fetchWordPressPosts()`, DCH4 pattern) | 4 events parsed (Hash Run #2190–#2193), full date/hare/location/on-on data |
| 4 | **Kampong H3** | — | Custom HTML scraper (Cheerio "Next Run" block) | 1 event (Run #296, Apr 18 2026, Hare: Fawlty Towers) |
| 5 | **Singapore Sunday H3** | 1994 | HARRIER_CENTRAL `SH3-SG` (zero new code) | 1 event ("Just Another Run", Apr 12 2026) |

### Historic-kennel exception (2 kennels)
Per `feedback_sourceless_kennels` memory criteria — both HHHS and Harriets meet all 4 bars:

**HHHS (Father Hash)** — even more historically significant than LRH3 (the 3rd US kennel from PR #524). HHHS is the **2nd hash kennel in the world**. Verified active per Chrome (Run #3298 scheduled for Mon Apr 13 2026 visible on the Wix homepage NEXT RUN block). Weekly Monday recurrence, men only. The richer Wix iframe hareline (with per-run hares + locations) is deferred — out of scope for this PR.

**Singapore Hash House Harriets** — oldest women's hash in Asia (53 years running), public FB group with 374 members and confirmed activity in April 2026. Weekly Wednesday recurrence. Their original website at `singaporeharriets.com` is DNS-dead. Without the historic exception, the only women's hash in Singapore would be unrepresented.

### New adapter code
- `src/adapters/html-scraper/lion-city-h3.ts` (~170 lines) — uses `fetchWordPressPosts()` from `wordpress-api.ts`, parses emoji-prefixed body fields (Date / Hare(s) / Run Location / On-On). Models the DCH4 adapter shape. Filters non-trail posts (AGM, news, interhash) by checking for "Hash Run #" in the title.
- `src/adapters/html-scraper/kampong-h3.ts` (~120 lines) — uses `fetchHTMLPage()` + Cheerio. Locates the "Next Run" text block by string search and parses run number / date (with ordinal suffix support) / time / hares / location.
- 14 unit tests across both adapters, all passing.

## Deferred Kennels (2 — follow-up PRs)

### Singapore Hash House Horrors
- WordPress.com hosted blog (NOT self-hosted) — `/wp-json/` returns 404
- **WordPress.com Public API** at `public-api.wordpress.com/rest/v1.1/sites/hashhousehorrors.com/posts/` returns 94 structured posts
- `/hareline/` page has explicit upcoming runs: Hash 1016 (May 17), 1015 (May 3), 1014 (Apr 19), etc.
- Children's hash, biweekly Sundays 16:30
- **Why deferred:** Building a new shared utility for WordPress.com Public API is meaningful infrastructure (different surface than the self-hosted REST API in `wordpress-api.ts`). Worth a dedicated PR with proper test coverage and reuse-friendly design.

### Seletar Hash House Harriers (SH3, Singapore)
- Founded 1980, men only, weekly Tuesdays 18:00
- Best source: PWA at `sh3app.hash.org.sg` with 14+ future runs
- Backend: `HashController.php` POST endpoint (Ionic/Angular SPA, would need browser-render or POST API reverse-engineering)
- Static homepage at `seletar.hash.org.sg` has only 1 upcoming run in a simple HTML table — too low-value to justify a small adapter
- Historical archive at `/hareline.html` covers 1980–2000 only
- **Why deferred:** PWA scraping is more involved than the patterns in this PR. Worth a dedicated investigation.

## Skipped Kennels (2 — confirmed unshippable)

### Thirsdae HHH
- Website at `thirsdae.hash.org.sg` is still live and **explicitly states "no longer active"**
- Last AGM: October 2019
- **Confirmed dead since 2019.**

### Singapore Bike Hash
- Active per multiple sources (Wikipedia, recent forum posts, FB references)
- Google Sites page at `sites.google.com/view/singaporebikehash/` contains only archival 2005–2019 PDFs
- No public Google Calendar (`bikehashsg@gmail.com` returned 0 events)
- Schedule is irregular (~10 rides/year, not strictly fortnightly per the directory)
- **Doesn't meet historic-kennel exception bar** — fails the "consistent recurrence" criterion (irregular ride schedule). Skip per the "no sourceless kennels" rule.

## Region Updates
- New COUNTRY: `Singapore` (city-state, no metro distinction)
- `inferCountry()` regex updated to recognize "singapore" → "Singapore"
- No `stateMetroLinks` change needed (city-state, no state/metro intermediate)

## Checks Performed
- [x] DB existing-coverage probe — 0 SG kennels
- [x] half-mind / hash.org.sg central directory — 9 candidates enumerated
- [x] HashRego `/events` live index grep — 0 SG slugs
- [x] Harrier Central API — `cityNames=Singapore` returned 1 hit (SH3-SG)
- [x] curl probes of every listed website — hhhs.org.sg, seletar.hash.org.sg, singaporeharriets.com, thirsdae.hash.org.sg, lioncityhhh.com, kampong.hash.org.sg, sundayhash.com, sites.google.com/view/singaporebikehash, hashhousehorrors.com
- [x] WordPress REST API probe of lioncityhhh.com — `wp/v2` namespace works, `tribe/events` returns 404
- [x] WordPress REST API probe of kampong.hash.org.sg — invalid JSON (not WordPress)
- [x] 13 Google Calendar ID variants tried across all candidates — all 0 items
- [x] Claude-in-Chrome second-pass verification — confirmed activity status, surfaced 2 deferred-but-real sources (Hash Horrors WP.com API + Seletar PWA), confirmed 1 dead + 1 unshippable

## Lessons Learned
- **Dual review pattern paying off again.** Chrome surfaced the WordPress.com Public API for Hash Horrors and the Seletar PWA — both real sources our automated pass missed. Without Chrome we would have shipped just 3 kennels and called the rest sourceless.
- **Wix Visual Data iframes are a gap in our toolkit.** HHHS has a fully populated 18-row hareline table inside a `wix-visual-data.appspot.com` iframe — but we have no pattern for scraping these. Browser-render of the iframe URL is theoretically possible but fragile. Worth investigating if we hit more Wix-Visual-Data kennels later.
- **WordPress.com vs self-hosted WordPress are different beasts.** WordPress.com hosted blogs don't expose `/wp-json/` (free tier limit) but DO expose the WordPress.com Public REST API at `public-api.wordpress.com/rest/v1.1/sites/{domain}/posts/`. This is a new shared utility opportunity — captured for the Hash Horrors follow-up PR.
- **HHHS is the most historically significant kennel we've ever onboarded** — the 2nd hash kennel in the world. Even shipping it via STATIC_SCHEDULE (no per-run data) is meaningful coverage.

## Future Opportunities (not in scope)
- **WordPress.com Public API utility** — `fetchWordPressComPosts(siteDomain)` to enable Hash Horrors and any other WordPress.com hosted hash blog
- **Wix Visual Data iframe scraper** — if we encounter more Wix-built hash sites with hareline tables in `wix-visual-data.appspot.com` iframes
- **Seletar PWA scraper or HashController.php API client** — would unlock 14+ future runs from Singapore's Tuesday hash
