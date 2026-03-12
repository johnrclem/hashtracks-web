# Source Onboarding Playbook

How to add a new data source to HashTracks. This playbook captures patterns learned from onboarding 40 sources across 8 adapter types.

---

## The Reusable Pipeline (same every time)

Every source flows through the same pipeline regardless of adapter type:

```
Source → Adapter.fetch() → RawEventData[] → fingerprint dedup → RawEvent (immutable)
                                                ↓
                                        kennel resolver → source-kennel guard → Event upsert
```

- **Fingerprint dedup**: SHA-256 of `date|kennelTag|runNumber|title` prevents duplicate RawEvents
- **Kennel resolver**: `shortName exact match → alias case-insensitive → pattern fallback → flag unmatched`
- **Source-kennel guard**: Resolved kennel must be linked to the source via `SourceKennel` — blocks events for unlinked kennels and generates a `SOURCE_KENNEL_MISMATCH` alert
- **ScrapeLog**: Every scrape run is audited with timing, event counts, and error details
- **Force rescrape**: `force` param deletes existing RawEvents and re-processes from scratch
- **`RawEventData`** is the universal contract between any adapter and the pipeline

## What Varies Per Source (the adapter-specific work)

| Concern | HTML Scraper | Browser-Rendered HTML | Google Calendar | Google Sheets | iCal Feed | Blogger API | Ghost Content API | Meetup | Hash Rego |
|---------|-------------|----------------------|----------------|--------------|-----------|-------------|-------------------|--------|-----------|
| Data access | HTTP GET + Cheerio parse | `browserRender()` → Cheerio parse (NAS Playwright service) | Calendar API v3 | Sheets API (tabs) + CSV export (data) | HTTP GET + node-ical parse | Blogger API v3 (blog ID discovery + posts endpoint) | Ghost Content API (public key, JSON with full HTML) | Meetup public REST API | HTTP GET + Cheerio parse (index + detail pages) |
| Auth needed | None | None (internal `BROWSER_RENDER_KEY`) | API key | API key (tab discovery only) | None | API key (same `GOOGLE_CALENDAR_API_KEY`) | None (public read-only key embedded in page) | None (public groups) | None |
| Kennel tags | Regex patterns on event text | Hardcoded per adapter (single-kennel) | `config.kennelPatterns` (multi-kennel) or `config.defaultKennelTag` (single-kennel) or hardcoded SUMMARY regex (Boston) | Column-based rules from config JSON | `config.kennelPatterns` (regex on SUMMARY) or `config.defaultKennelTag` | Hardcoded per adapter (single-kennel Blogspot blogs) | Hardcoded per adapter (single-kennel Ghost blogs) | `config.kennelTag` (single kennel, all events) | Per-event from Hash Rego data, filtered by `config.kennelSlugs` |
| Date format | Site-specific (ordinals, DD/MM/YYYY, US dates) | Site-specific (JS-rendered content, parsed after render) | ISO 8601 timestamps | Multi-format: M-D-YY, M/D/YYYY | ISO 8601 / DTSTART | API returns ISO 8601 `published`; post body parsed with site-specific logic | API returns ISO 8601 `published_at`; post body HTML parsed for trail date | ISO 8601 (`local_date`) | Site-specific HTML parsing |
| Routing | URL-based (`htmlScrapersByUrl` in registry) | URL-based (`htmlScrapersByUrl` — same as HTML Scraper) | Shared adapter (single class) | Shared adapter (config-driven) | Shared adapter (config-driven) | URL-based (reuses `htmlScrapersByUrl` routing, Blogger API is primary fetch with HTML fallback) | URL-based (reuses `htmlScrapersByUrl` routing, Ghost API is primary fetch with HTML fallback) | Shared adapter (config-driven) | Shared adapter (config-driven) |
| Complexity | High (structural HTML, site-specific) | Medium (browser render + Cheerio parse) | Medium (clean API) | Low (column mapping) | Low-Medium (config-driven, but iCal quirks) | Medium (shared `fetchBloggerPosts()` utility + site-specific body parsing) | Medium (Ghost API + trail section isolation + body parsing) | Low (config-driven, AI-assisted) | Medium (index + detail page scraping) |

---

## Step-by-Step Checklist

Do this every time you add a new source:

### 1. Analyze the data FIRST

Fetch real data before writing any code. Examine structure, identify field mappings, understand edge cases.

**For HTML sources:**
```bash
curl -s "https://example.com/?days=30" | head -200
# Look for: CSS classes, heading patterns, date formats, table structure
```

**For Google Calendar:**
```bash
curl "https://www.googleapis.com/calendar/v3/calendars/{calendarId}/events?key={key}&maxResults=5"
```

**For Google Sheets:**
```bash
# Tab discovery
curl "https://sheets.googleapis.com/v4/spreadsheets/{sheetId}?fields=sheets.properties.title&key={key}"

# Data (public CSV export, no auth)
curl "https://docs.google.com/spreadsheets/d/{sheetId}/gviz/tq?tqx=out:csv&sheet={tabName}"
```

**For Meetup groups:**
```bash
curl -s "https://api.meetup.com/savannah-hash-house-harriers/events" | jq '.[0]'
# Look for: name, local_date, local_time, venue.name, venue.address_1, description
# No API key needed — public groups are accessible without auth
```

**For browser-rendered (Wix/SPA) sources:**
```bash
curl -s -X POST https://proxy.hashtracks.xyz/render \
  -H "X-Render-Key: $BROWSER_RENDER_KEY" \
  -d '{"url":"https://example.com","waitFor":"body"}' | head -200
# Look for: rendered text content, event patterns, CSS classes
```

**For iCal feeds:**
```bash
curl -s "https://example.com/calendar.ics" | head -100
# Look for: VEVENT blocks, SUMMARY format, DTSTART format, LOCATION, DESCRIPTION
```

### 2. Identify kennels

- What kennels does this source cover?
- Do they already exist in our DB? (check `prisma/seed.ts`)
- One source can feed multiple kennels (aggregator pattern)

### 3. Add kennels + aliases to seed (if new)

In `prisma/seed.ts`:
- Add kennel entries to the `kennels` array with `shortName`, `fullName`, `region`
- Add aliases to the `kennelAliases` record (case-insensitive matching)
- Run `npx prisma db seed` to create them

### 4. Choose or build adapter type

Existing adapter types:
- `HTML_SCRAPER` — For websites with event tables/lists (Cheerio parsing). Each site gets its own adapter class, routed by URL pattern in `htmlScrapersByUrl`. Currently: hashnyc, bfm, hashphilly, cityhash (Makesweat), westlondonhash, londonhash, barneshash, och3, slash-hash, chicago, thirstday, sfh3, ewh3, dch4, ofh3, hangover, shith3, enfieldhash, northboro (browser-rendered). Also includes `GenericHtmlAdapter` for config-driven CSS selector scraping.
- `HTML_SCRAPER` (Blogger API) — For Blogger/Blogspot-hosted sites. Uses Blogger API v3 as primary fetch method with HTML scraping fallback. The adapter is still registered as `HTML_SCRAPER` and routed via `htmlScrapersByUrl`, but internally calls `fetchBloggerPosts()` from `src/adapters/blogger-api.ts`. Currently: enfieldhash.org (EH3), ofh3.com (OFH3). **Prerequisite**: Enable the Blogger API in GCP Console and use the same `GOOGLE_CALENDAR_API_KEY`.
- `GOOGLE_CALENDAR` — For Google Calendar API v3 feeds. Single shared adapter, configured via `Source.config` JSON (kennelPatterns, defaultKennelTag). Currently: Boston, BFM, Philly, Chicagoland, EWH3, SHITH3.
- `GOOGLE_SHEETS` — For published Google Sheets (config-driven, reusable without code changes). Column mappings, kennel tag rules, start time rules in `Source.config`. Currently: Summit H3, W3H3.
- `ICAL_FEED` — For standard iCal (.ics) feeds via `node-ical`. Config-driven kennelPatterns + skipPatterns. Currently: SFH3 MultiHash aggregator, CCH3, BAH3.
- `MEETUP` — For public Meetup.com groups. Single shared adapter, config-driven (no code changes needed). Config requires `groupUrlname` (extracted from URL) and `kennelTag` (single kennel shortName). Currently: Hash Rego lists some Meetup-hosted kennels. **No API key required** — uses Meetup's public REST API.
- `HASHREGO` — For kennels listed on hashrego.com. Config-driven with `kennelSlugs` array (multi-kennel). Currently: 8 kennels (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3).

If none fit, create a new adapter implementing `SourceAdapter` from `src/adapters/types.ts`.

### 5. Implement or configure the adapter

**For Google Sheets (no code needed):**
Just add a new source record with config JSON to the seed. The adapter reads column mappings, kennel tag rules, and start time rules from `Source.config`:

```typescript
config: {
  sheetId: "...",
  columns: { runNumber: 0, specialRun: 1, date: 2, hares: 3, location: 4, title: 6, description: 9 },
  kennelTagRules: { default: "Summit", specialRunMap: { "ASSSH3": "ASSSH3" }, numericSpecialTag: "SFM" },
  startTimeRules: { byDayOfWeek: { "Mon": "19:00", "Sat": "15:00" }, default: "15:00" },
}
```

**For iCal feeds (config-driven):**
Add a new source with `type: "ICAL_FEED"` and config for kennel matching:
```typescript
config: {
  kennelPatterns: [
    ["^SFH3", "SFH3"],
    ["^GPH3", "GPH3"],
  ],
  defaultKennelTag: "SFH3",
  skipPatterns: ["^Hand Pump", "^Workday"], // events to exclude entirely
}
```

**For Meetup groups (config-driven, AI-assisted):**
Use the **Admin → Sources → New** wizard. Paste the Meetup group URL (e.g., `https://www.meetup.com/savannah-hash-house-harriers/events/`). The wizard will:
1. Auto-detect the source type as `MEETUP`
2. Auto-populate `groupUrlname` from the URL
3. Fire an AI suggestion that fetches sample events and suggests the proper `kennelTag`
4. Accept the suggestion → both fields populated, ready to test

The resulting config is simple:
```typescript
config: {
  groupUrlname: "savannah-hash-house-harriers",
  kennelTag: "SavH3",    // all events from this group map to this kennel
}
```
**Note**: If the kennel doesn't exist yet, create it first via Admin → Kennels (or the quick-create in the wizard), then re-test.

**For Hash Rego (config-driven, multi-kennel):**
```typescript
config: {
  kennelSlugs: ["BFMH3", "EWH3", "WH4", "GFH3"],  // Hash Rego kennel identifiers
}
```

**For new HTML scrapers:**
1. Create `src/adapters/html-scraper/{site-name}.ts` implementing `SourceAdapter`
2. Export pure parsing functions for unit testing (e.g., `parseDateFromTitle()`, `parseRunCard()`)
3. Add URL pattern to `htmlScrapersByUrl` in `src/adapters/registry.ts`
4. Create `src/adapters/html-scraper/{site-name}.test.ts` with embedded HTML fixtures

**For completely new adapter types:**
- Implement the `SourceAdapter` interface: `{ type, fetch(source, options?) }`
- Return `ScrapeResult`: `{ events, errors, errorDetails?, structureHash?, diagnosticContext? }`
- Register in `src/adapters/registry.ts`

### 6. Add kennel tag extraction logic

How does this source identify which kennel an event belongs to? Common patterns:
- **Text patterns**: Regex on event title/description (hashnyc, Boston Calendar)
- **Column-based**: Dedicated column values (Google Sheets)
- **Calendar-based**: Different calendars for different kennels

### 7. Add pattern matching to kennel resolver

If the adapter produces kennel tags that don't exactly match `shortName` or existing aliases, add fallback patterns to `mapKennelTag()` in `src/pipeline/kennel-resolver.ts`.

**Important**: Longer/more specific patterns BEFORE shorter ones (e.g., "summit full moon" before "summit").

### 8. Add source to seed

In `prisma/seed.ts`, add to the `sources` array:
```typescript
{
  name: "Human-readable name",
  url: "source URL or identifier",
  type: "GOOGLE_SHEETS" as const,
  trustLevel: 7,          // 1-10
  scrapeFreq: "daily",
  config: { ... },         // adapter-specific config (optional)
  kennelShortNames: [...], // linked kennels — CRITICAL for source-kennel guard
}
```

**Important**: `kennelShortNames` controls which kennels the source can create events for. The merge pipeline **blocks** events for any kennel not in this list. If a source covers multiple kennels, list them all. If you're unsure, add the kennel and verify — the `SOURCE_KENNEL_MISMATCH` alert will tell you if events are being blocked.

For multi-kennel Google Calendar sources, use `kennelPatterns` config:
```typescript
config: {
  kennelPatterns: [
    ["BFM|Ben Franklin|BFMH3", "BFM"],
    ["Philly Hash|hashphilly", "Philly H3"],
  ],
  defaultKennelTag: "BFM",  // fallback for unrecognized events
}
```

### 9. Test locally

```bash
# Seed the new kennels and source
npx prisma db seed

# Start dev server
npm run dev

# Trigger scrape from admin UI: /admin/sources
# Or write a quick test script with dotenv + adapter.fetch()
```

Verify:
- Event count is reasonable
- Kennel tags resolve correctly (no unmatched)
- Dates parse to correct YYYY-MM-DD format
- Run numbers, hare names, locations populated
- No errors in scrape results

### 10. Deploy + force scrape

```bash
git add . && git commit && git push
# Vercel auto-deploys from main
# Trigger force scrape from admin UI
```

### 11. Review data quality

- Check hareline for new events with correct kennel attribution
- Check kennel pages: `/kennels/{slug}`
- Compare a few events against the original source to verify accuracy

---

## Source-Specific Reference

### Source #1: hashnyc.com (HTML Scraper)

- **Type**: `HTML_SCRAPER`
- **Coverage**: 11 NYC-area kennels
- **Adapter**: `src/adapters/html-scraper/hashnyc.ts` (880+ lines)
- **Challenges**: Complex structural HTML, multi-tier hare extraction, 37 kennel regex patterns
- **Key lesson**: Regex ordering matters (longer strings before shorter substrings)

### Source #2: Boston Hash Calendar (Google Calendar)

- **Type**: `GOOGLE_CALENDAR`
- **Coverage**: 5 Boston-area kennels (BoH3, BoBBH3, Beantown, Bos Moon, Pink Taco)
- **Adapter**: `src/adapters/google-calendar/adapter.ts`
- **Challenges**: Kennel tag extraction from SUMMARY field, date/time from ISO strings
- **Key lesson**: Extract local date/time directly from ISO string, never through `new Date()` UTC conversion
- **Key lesson**: iCal feeds return limited history; use Calendar API v3 instead

### Source #3: Summit H3 Spreadsheet (Google Sheets)

- **Type**: `GOOGLE_SHEETS`
- **Coverage**: 3 NJ kennels (Summit, SFM, ASSSH3)
- **Adapter**: `src/adapters/google-sheets/adapter.ts` (config-driven, reusable)
- **Config**: Column indices, kennel tag rules, start time inference rules stored in `Source.config` JSON
- **Challenges**: Multi-format dates across tabs, tab rotation (new tab each year)
- **Key lesson**: Tab discovery via Sheets API is more robust than guessing tab names
- **Key lesson**: Column positions are consistent even when headers vary between tabs

### Source #4 & #5: BFM + Philly H3 (Multi-Source Philadelphia)

- **Type**: `GOOGLE_CALENDAR` (x2) + `HTML_SCRAPER` (x2)
- **Coverage**: BFM and Philly H3 (Philadelphia)
- **Adapters**:
  - `src/adapters/google-calendar/adapter.ts` — reused with `kennelPatterns` config (multi-kennel calendars)
  - `src/adapters/html-scraper/bfm.ts` — WordPress site: current trail + special events page
  - `src/adapters/html-scraper/hashphilly.ts` — simple label:value page, one event at a time
- **Multi-source strategy**: Calendar provides schedule backbone; website scraper enriches with location, hares, trail numbers. Merge pipeline deduplicates via fingerprint.
- **Key lesson**: WordPress Gutenberg text runs together without newlines — use known field labels (`When:`, `Where:`, `Hare:`) as delimiters via lookahead regex, not `\n`
- **Key lesson**: Regional aggregate calendars contain events from MULTIPLE kennels — don't use `defaultKennelTag` alone. Use `kennelPatterns` config with regex→tag tuples for SUMMARY-based matching, with `defaultKennelTag` as fallback only.
- **Key lesson**: URL-based routing in the adapter registry (`htmlScrapersByUrl`) allows multiple HTML scrapers to coexist under the same `HTML_SCRAPER` source type
- **Key lesson**: Instagram scraping is not viable (auth required, ToS violation, actively blocked) — manual CSV import is the practical backfill approach
- **Key lesson**: Some sites only show one event (hashphilly.com/nexthash/) — still worth scraping for fields the calendar lacks (trail number, venue name)
- **Key lesson**: `kennelShortNames` in seed is critical — it controls the source-kennel guard. Missing a kennel link means events get silently blocked with a `SOURCE_KENNEL_MISMATCH` alert.

### Sources #6 & #7: Chicagoland + DC (Google Calendar Aggregators)

- **Type**: `GOOGLE_CALENDAR`
- **Coverage**: 11 Chicago kennels, 2 DC kennels (EWH3, SHITH3)
- **Adapter**: Reused `src/adapters/google-calendar/adapter.ts` with `kennelPatterns` config
- **Key lesson**: Regional aggregator calendars are the most efficient way to onboard many kennels at once — one source can feed 10+ kennels with config-only changes
- **Key lesson**: Single-kennel calendars can use `defaultKennelTag` alone (no patterns needed)

### Source #8: W3H3 Hareline (Google Sheets)

- **Type**: `GOOGLE_SHEETS`
- **Coverage**: W3H3 (Jefferson County, WV)
- **Adapter**: Reused `src/adapters/google-sheets/adapter.ts` with config JSON
- **Key lesson**: Google Sheets adapter scales to new sources with zero code changes — just add config with column indices and kennel tag rules
- **Key lesson**: `tabs` config lets you target specific sheet tabs (e.g., `["W3H3 Hareline"]` instead of auto-discovering all tabs)

### Source #9: SFH3 MultiHash (iCal Feed — new adapter type)

- **Type**: `ICAL_FEED`
- **Coverage**: 11 Bay Area kennels (SFH3, GPH3, EBH3, SVH3, FHAC-U, Agnews, BARH3, MarinH3, FCH3, SFFMH3, VMH3)
- **Adapter**: `src/adapters/ical/adapter.ts` (new adapter type using `node-ical` library)
- **Config**: `kennelPatterns` (regex→tag tuples on SUMMARY) + `skipPatterns` (exclude non-hash events) + `defaultKennelTag`
- **Challenges**:
  - `node-ical`'s dependency chain (`rrule-temporal` → `@js-temporal/polyfill` → `jsbi`) uses `BigInt` which Turbopack mangles during build. **Fix**: Add `serverExternalPackages: ["node-ical"]` to `next.config.ts`
  - iCal VEVENT `SUMMARY` often contains kennel prefix + event name in one line
  - Some events are organizational (hand pump, workday) — use `skipPatterns` to exclude them
- **Key lesson**: When adding npm packages with native/polyfill dependencies, test the production build (`npm run build`) early — dev mode and tests may work fine while Turbopack bundling fails
- **Key lesson**: `skipPatterns` config is important for aggregator feeds that include non-event entries

### Sources #10-12: London HTML Scrapers (UK expansion)

- **Type**: `HTML_SCRAPER` (x3)
- **Coverage**: CityH3 (makesweat.com/cityhash), WLH3 (westlondonhash.com), LH3 (londonhash.org)
- **Adapters**:
  - `src/adapters/html-scraper/city-hash.ts` — Makesweat SPA via `browserRender()` (`.ms_event`, `.ms_venue_name/address/postcode/ptransport`). Switched from cityhash.org.uk to Makesweat for richer structured venue data (full addresses, postcodes, transport info). Events appear twice in DOM — deduped by Makesweat event ID from `makesweatevent-{id}` CSS class.
  - `src/adapters/html-scraper/west-london-hash.ts` — WordPress block templates with pagination
  - `src/adapters/html-scraper/london-hash.ts` — Minimal HTML, text-block parsing around anchor links
- **UK-specific patterns**:
  - **Ordinal dates**: "24th Feb 2026", "21st of February" — strip st/nd/rd/th suffixes, parse month names
  - **UK postcodes**: Regex `[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}` for venue addresses → auto-generate Google Maps URL
  - **Station info**: UK hashes reference nearby stations — stored in `description` field ("Nearest station: X")
  - **P-trail format**: London Hash uses "Follow the P trail from STATION to PUB" — parsed for both location and station
  - **Fixed start times**: Each kennel has a known default (LH3: "12:00", CityH3: "19:00", WLH3: "19:15")
- **Challenges**:
  - **WLH3 pagination**: WordPress "Next Page" links — adapter follows up to 3 pages with dedup
  - **LH3 minimal markup**: Runs are text blocks anchored by `<a href="nextrun.php?run=XXXX">` links, requiring text-window extraction between consecutive anchors
  - **Regex false matches**: Run number "2820" in text block caused date regex to match "20" + "Sydenham" as month. **Fix**: Negative lookbehind `(?<!\d)` prevents matching digits inside larger numbers
  - **Location parsing for year-dash headings**: "Run Number 2081 – 19 February 2026-Clapham Junction" — need regex that distinguishes dash after run number (`2081 –`) from dash after year (`2026-Clapham`). **Fix**: Match `20\d{2}[-–—]([A-Za-z].+)$` requiring year prefix and letter start
- **Key lesson**: When building HTML scrapers, always export pure parsing functions (e.g., `parseDateFromTitle`, `parseRunCard`) for direct unit testing — catch regex bugs before integration
- **Key lesson**: Use embedded HTML fixture strings in tests rather than fetching live sites — faster, deterministic, and captures known edge cases
- **Key lesson**: Use `domhandler`'s `AnyNode` type (not `cheerio.AnyNode`) — Cheerio doesn't re-export it in all versions
- **Key lesson**: Makesweat-powered clubs have structured venue data (name, address, postcode, transport) that's richer than the WordPress embed on the club's own site
- **Key lesson**: Makesweat event IDs in class names (`makesweatevent-{id}`) are stable identifiers for dedup and external links
- **Audit**: Only CityH3 confirmed using Makesweat among current London kennels (Barnes, OCH3, SLASH sites are down; WLH3, LH3, EH3 don't use Makesweat)

### Source #13: OFH3 (Blogger API — Blogspot site)

- **Type**: `HTML_SCRAPER` (internally uses Blogger API v3 with HTML scraping fallback)
- **Coverage**: OFH3 (ofh3.com — DC/Frederick area)
- **Adapter**: `src/adapters/html-scraper/ofh3.ts` — Monthly US hash, parses Hares/When/Cost/Where/Trail Type/Shiggy/On-After labels
- **Shared utility**: `src/adapters/blogger-api.ts` — `fetchBloggerPosts()` discovers blog ID, fetches posts via Blogger API v3
- **Why Blogger API**: Google/Blogger blocks server-side requests from cloud provider IPs (Vercel, AWS, etc.) with HTTP 403 Forbidden. The Blogger API v3 authenticates via API key and bypasses this IP-based blocking.
- **Fallback**: If the Blogger API is unavailable (missing API key, API not enabled), adapter falls back to direct HTML scraping
- **Prerequisites**: Enable the Blogger API in GCP Console (https://console.cloud.google.com/apis/library/blogger.googleapis.com). Uses the same `GOOGLE_CALENDAR_API_KEY` — no new env var needed.
- **Diagnostics**: `diagnosticContext.fetchMethod` indicates `"blogger-api"` or `"html-scrape"` to show which path was used
- **Key lesson**: Blogger/Blogspot sites should always use the Blogger API v3 — direct HTML scraping will fail from cloud-hosted servers
- **Key lesson**: The Blogger API returns post body as HTML in the `content` field, so existing Cheerio-based body parsers work unchanged — just load `post.content` instead of scraping the full page
- **Key lesson**: Blog ID discovery (`/blogs/byurl`) needs to happen before posts can be fetched — build this into the shared utility, not per-adapter

### Source #14: Enfield Hash (EH3) — SPA with static content file

- **Type**: `HTML_SCRAPER` (direct HTML scraping with residential proxy)
- **Coverage**: EH3 (enfieldhash.org — London)
- **Adapter**: `src/adapters/html-scraper/enfield-hash.ts` — Monthly UK hash (3rd Wednesday, 7:30 PM), parses Date/Pub/Station/Hare labels + unstructured prose
- **SPA workaround**: `enfieldhash.org` is a client-side SPA — the HTML shell has an empty `<div id="content">` and JavaScript loads content via `fetch("home.html")`. Cheerio can't execute JS, so the adapter fetches `home.html` directly. The content file has the same `.paragraph-box` + `<h1>` structure the parser expects.
- **Residential proxy**: Required — the site's WAF blocks cloud provider IPs. Uses `USE_RESIDENTIAL_PROXY = true` with `safeFetch()`.
- **URL variants**: `tryFetchWithUrlVariants()` tries www/non-www and http/https variants (shared `buildUrlVariantCandidates()` utility)
- **Date handling**: Year-less dates ("Wed 25 February") use ±6 month inference via `inferYear()`; explicit years ("18th March 2026") trust chrono-node
- **Key lesson**: SPA sites need content URL discovery — if a site loads content dynamically via `fetch()`, inspect the network requests to find the actual content URL and fetch it directly instead of the SPA shell
- **Key lesson**: Not all hash sites are Blogger/Blogspot — verify the actual platform before assuming which API to use. EH3 is a custom SPA hosted on enfieldhash.org, NOT a Blogspot site.

### Source #15: Hangover Hash (H4) — Ghost Content API

- **Type**: `HTML_SCRAPER` (internally uses Ghost Content API with HTML scraping fallback)
- **Coverage**: H4 (hangoverhash.digitalpress.blog — DC area, monthly)
- **Adapter**: `src/adapters/html-scraper/hangover.ts` — Parses run number from title (`#214 - Trail Name`), Date/Hare/Location/HashCash/distances from body
- **Ghost Content API**: DigitalPress is a Ghost CMS host. The Ghost Content API is publicly accessible with a read-only key embedded in every page response (in the `ghost-portal` script tag's `data-key` attribute). One API call (`/ghost/api/content/posts/`) returns structured JSON with full HTML per post, replacing 1 listing + N detail page fetches.
- **Trail section isolation**: H4 posts contain two sections separated by `<hr>`: prelubes (events before the main trail) and the trail itself. `extractTrailSection(html)` strips everything before `<hr>` so `chronoParseDate` doesn't pick up prelube dates instead of the trail date.
- **Date extraction**: Labeled `Date:` / `When:` fields → chrono-node fallback on trail section text → `published_at` from API as last resort
- **HTML scraping fallback**: If the Ghost API returns 0 events (API unavailable, key rotated), falls back to the existing HTML scraping path
- **Key lesson**: Ghost CMS sites expose a public Content API — look for `data-key` and `data-api` attributes on the portal script tag. The Content API returns structured JSON with full HTML, eliminating CSS selector fragility.
- **Key lesson**: When a blog post contains multiple events (prelubes + main trail), isolate the relevant section before parsing to avoid extracting wrong dates/fields. Use structural markers like `<hr>` separators.

### Source #16: SHITH3 Website (PHP REST API)

- **Type**: `HTML_SCRAPER` (internally uses PHP REST API — JSON, not HTML scraping)
- **Coverage**: SHITH3 (shith3.com — Northern Virginia, weekly Tuesday)
- **Adapter**: `src/adapters/html-scraper/shith3.ts` — PHP API listing + per-event detail fetch
- **Multi-source strategy**: SHITH3 already has a Google Calendar source (trustLevel 7). The website source (trustLevel 8) provides much richer data — hares, full address, trail description, distances, on-after venue — that the calendar lacks. The merge pipeline deduplicates via `kennel + date` fingerprint, with the website source winning on field precedence.
- **API discovery**: The FullCalendar widget on `shith3.com/events.php` calls two PHP endpoints:
  - **Listing**: `GET /php/get-events.php?start=YYYY-MM-DD&end=YYYY-MM-DD` → JSON array with title, start/end times, type, lookup_id
  - **Detail**: `GET /php/get-event.php?id={lookup_id}&type=t` → Full event JSON with TRAIL, TITLE, LOCATION, hares, TIDBIT, ONONON, NOTES, MAPLINK
- **Type filtering**: Listing includes non-trail events (type `"m"` for meetings, etc.) — filter to `type === "t"` only
- **Sequential detail fetches**: ~26 events for a 90-day window; detail requests are sequential (not parallel) to avoid hammering the server, matching the Hash Rego pattern
- **Run number accuracy**: Listing titles sometimes contain typos ("Trail 11921" instead of "1196") — the adapter uses `TRAIL` from the detail response as the authoritative run number
- **Distance parsing**: `NOTES` field contains distances in `R = 4.5 mi\nW = 2.7 mi` format — parsed into structured `Runners: X mi, Walkers: Y mi`
- **Location URL**: Uses `MAPLINK` if non-empty, otherwise generates a Google Maps search URL from the address
- **Fallback**: When a detail fetch fails (HTTP error or network error), falls back to listing-only data (date, title, start time, run number from title)
- **No structureHash**: JSON API responses don't need HTML structural fingerprinting
- **Key lesson**: PHP REST APIs behind FullCalendar widgets are a rich data source — inspect the network requests on calendar pages to discover structured JSON endpoints that provide far more data than the calendar feed itself
- **Key lesson**: When a source has both a Google Calendar feed and a website API, the website API typically has richer data (hares, locations, descriptions). Add both as sources with the website at a higher trust level to let the merge pipeline enrich events automatically.

### Sources #17-25: South Carolina (MEETUP + STATIC_SCHEDULE — zero-code onboarding)

- **Types**: `MEETUP` (x1) + `STATIC_SCHEDULE` (x8)
- **Coverage**: 10 kennels across 4 metros (Charleston, Columbia, Greenville, Myrtle Beach) — zero prior coverage
- **Adapters**: No new adapter code — reuses existing MEETUP and STATIC_SCHEDULE adapters entirely
- **Regions**: 5 new regions added (1 STATE_PROVINCE + 4 METRO), demonstrating the state→metro hierarchy pattern
- **KennelCode conflicts**: Charleston's CH3 collided with Chicago's `ch3` — resolved with region suffix `ch3-sc`. Palmetto H3 avoided `ph3` (taken by Pinelake H3) with `palh3`. Secession H3 used `sech3` instead of `sh3` for clarity.
- **Moon-phase gap**: Luna Ticks H3 (LTH3) runs on full/new moons — RRULE can't express lunar recurrence. Added as kennel-only (no source). Future roadmap item: `FREQ=LUNAR;PHASE=FULL` support.
- **Key lesson**: Small-market regions are predominantly Facebook-only kennels — STATIC_SCHEDULE is the right source type for these. It provides placeholder events on the hareline so users know when runs happen, even without automated real-data scraping.
- **Key lesson**: Meetup remains the highest-ROI automated source where available. One Meetup source (Charleston Heretics, 344 past events) provides more historical data than all 8 static schedule sources combined.
- **Key lesson**: KennelCode conflicts become more common as coverage expands. Always check existing kennelCodes before assigning — use region suffixes (`-sc`, `-atl`, `-fl`) to disambiguate when shortNames collide across regions.
- **Key lesson**: STATE_PROVINCE regions provide organizational hierarchy — metros like "Charleston, SC" parent to "South Carolina" which parents to "USA". This enables future state-level filtering and grouping.

---

## Data Quality Pipeline (applies to ALL adapters)

The merge pipeline includes built-in data quality sanitization. Adapter authors should understand these tools to avoid duplicating work or producing data that gets silently stripped.

### Automatic Sanitization (merge pipeline)

These run on every event during `mergeRawEvents()` in `src/pipeline/merge.ts`:

- **`sanitizeTitle(title)`**: Strips titles that are just "Hares Needed", "Need a hare", email addresses, or similar admin content. Returns null for empty/placeholder titles.
- **`sanitizeLocation(location)`**: Strips TBD/TBA/TBC/Registration placeholders, bare URLs (`https://...`), and `Registration: URL` values. Returns null for non-meaningful locations.
- **`isPlaceholder(value)`**: Matches `tbd`, `tba`, `tbc`, `n/a`, `needed`, `required`, `registration`, `?`, `??` (case-insensitive, trimmed). Used by both adapters and the merge pipeline.

Adapters should **not** reimplement these checks — the pipeline handles them. But adapters CAN use `isPlaceholder()` to avoid storing obviously-placeholder venue names (e.g., CityH3 skips venue construction when venueName is a placeholder).

### Shared Adapter Utilities (`src/adapters/utils.ts`)

- **`stripPlaceholder(value)`**: Returns undefined if value is empty or a placeholder. Convenience for `stripPlaceholder(cell) ?? fallback`.
- **`extractUkPostcode(text)`**: Regex for UK postcodes (`SE11 5JA`, `EC1A 1BB`, etc.). Used by UK adapters to extract postcode from venue text.
- **`chronoParseDate(text, locale, ref, options)`**: Natural-language date parsing via chrono-node. Supports UK (`en-GB`) and US (`en-US`) locales. Use `forwardDate: true` for year-less dates that should resolve forward.
- **`parse12HourTime(text)`**: Converts `"4:00 pm"` → `"16:00"`. Returns undefined if no match.
- **`extractAddressWithAi(text)`**: Gemini-powered fallback for extracting a street address from a long text blob. Use when deterministic parsing fails (e.g., venue address embedded in a paragraph). Returns null if no address found or AI unavailable. Currently used by WLH3 for 120+ char paragraphs containing postcodes.
- **`fetchHTMLPage(url)`** / **`fetchBrowserRenderedPage(url)`**: Discriminated union results (`ok: true` with `$`, `html`, `structureHash` | `ok: false` with error result). Every HTML adapter should use these instead of raw `safeFetch()`.
- **`decodeEntities(text)`**: Decodes HTML entities (named, hex, decimal) + normalizes `&nbsp;` to space. Use on all text extracted from HTML.
- **`googleMapsSearchUrl(query)`**: Generates Google Maps search URL from a location string.

### Common Data Quality Patterns

When building a new adapter, watch for these issues (all have been encountered in production):

| Issue | Pattern | Fix |
|-------|---------|-----|
| Postcode duplication | Venue name contains postcode AND postcode field appended | Check `parts.some(p => p.includes(postcode))` before appending |
| Description bleed into location | Regex captures trailing text after pub name | Add `.replace(/\s+(?:followed by|then on to|and then|details|more info)\b.*/i, "")` |
| Nav/script text in event fields | Cheerio `.text()` includes nav, scripts, GA | Remove `script, style, noscript, nav, header, footer, aside, [role='navigation']` before `.text()` |
| Hare names run together | Adjacent `<span>` elements produce "AliceBob" | Use `$block.find("span, a, strong, em, b, i").after(" ")` then `.replace(/\s{2,}/g, " ")` |
| "HARES NEEDED" as title | Source puts volunteer requests in title field | Handled by `sanitizeTitle()` — no adapter work needed |
| Registration URL as location | Spreadsheet puts signup link in location column | Handled by `sanitizeLocation()` — no adapter work needed |
| Long paragraph as location | Paragraph containing a postcode stored as venue address | Use length guard (120 chars) + `extractAddressWithAi()` fallback |
| Generic title repeats kennel name | Title is just "SPH3" or "SPH3 Hash" | Handled by `getDisplayTitle()` in EventCard.tsx — suppresses and shows fallback |

### Reverse Geocoding

The merge pipeline automatically reverse-geocodes events with coordinates to populate `locationCity` (e.g., "Brooklyn, NY"). This happens in `resolveCoords()` → `reverseGeocode()`. Adapters don't need to set `locationCity` — just provide coordinates (`latitude`/`longitude`) or a `locationUrl` (Google Maps link), and the pipeline handles the rest.

The display layer (`getLocationDisplay()` in `EventCard.tsx`) deduplicates city from location name — if the adapter puts city in the location string AND reverseGeocode adds it as `locationCity`, the display won't show it twice.

---

## Lessons Learned

1. **Analyze data BEFORE writing code** — prevents wrong assumptions about structure
2. **Server-side date formatting on Vercel runs in UTC** — always specify `timeZone` explicitly
3. **Google API key** works for both Calendar and Sheets APIs (same Google Cloud project)
4. **Config-driven adapters** (like Google Sheets) eliminate code changes for similar sources
5. **Kennel resolver pattern order matters** — specific patterns before general (ASSSH3 before Summit)
6. **Multi-format date parsing** is common; build flexible parsers that handle variations
7. **`new Date()` is dangerous for date-only strings** — use string comparison for date filtering
8. **WordPress text lacks newlines between fields** — use label-based delimiters, not line breaks
9. **`kennelPatterns` config** for multi-kennel calendars — regex→tag tuples in `Source.config` for SUMMARY-based matching, with `defaultKennelTag` as fallback. `defaultKennelTag` alone is only safe for truly single-kennel calendars.
10. **URL-based adapter routing** (`htmlScrapersByUrl` in registry) scales HTML_SCRAPER to multiple sites
11. **Multi-source enrichment** works well — calendar for schedule, website for details, merge pipeline handles dedup
12. **Source-kennel guard** blocks events for kennels not linked via `SourceKennel` — prevents cross-contamination between sources. Always verify `kennelShortNames` in seed covers ALL kennels the source produces.
13. **Admin event management** (`/admin/events`) enables bulk cleanup of misattributed events — filter by kennel + source + date range, preview before delete
14. **Regional aggregate calendars are common** — don't assume a calendar named after one kennel only contains that kennel's events. Query real data first.
15. **Test production builds early** when adding npm packages — Turbopack bundling can break with BigInt/polyfill dependencies that work fine in dev/test. Use `serverExternalPackages` in `next.config.ts` to externalize problematic packages.
16. **Export pure parsing functions** from scrapers for direct unit testing — regex bugs are easier to find in isolated tests than in full adapter integration tests
17. **Negative lookbehind `(?<!\d)`** prevents regex false matches on digits embedded in larger numbers (e.g., "20" inside "2820")
18. **Embedded HTML fixtures in tests** beat live fetching — faster, deterministic, and you can craft edge cases. Always mock `globalThis.fetch` in adapter tests.
19. **UK date formats** are different from US — ordinal suffixes (st/nd/rd/th), "of" separator, DD/MM/YYYY ordering. Build region-aware date parsers.
20. **Pagination in HTML scrapers** needs both mock coverage (multiple fetch responses) and a safety cap (max pages) to prevent infinite loops
21. **iCal feeds** are common in the hashing world — many organizations use Google Calendar → .ics export. The `ICAL_FEED` adapter type with config-driven kennelPatterns handles this pattern well.
22. **Config-driven adapters scale best** — Google Sheets, Google Calendar, and iCal adapters all add new sources with zero code changes. Prefer config over code for sources with similar structure.
23. **Google/Blogger blocks cloud provider IPs** — Blogspot/Blogger sites return 403 Forbidden to server-side requests from Vercel, AWS, GCP, and other cloud IPs. This is a platform-level block (bot detection), not a header issue. Use the **Blogger API v3** instead of direct HTML scraping for any Blogspot-hosted source.
24. **Blogger API v3 uses the same Google API key** — Enable the Blogger API in GCP Console, then use `GOOGLE_CALENDAR_API_KEY` (same key as Calendar/Sheets). No new env var needed. Blog ID discovery via `/blogs/byurl` + post fetching via `/blogs/{id}/posts`.
25. **Always add HTML scraping fallback for Blogger API sources** — If the API key is missing or the Blogger API isn't enabled, the adapter should fall back to direct HTML scraping. This ensures the scraper works in development environments without API keys (though it will still 403 from cloud IPs).
26. **Meetup sources need zero code changes** — The MEETUP adapter is fully config-driven. The admin wizard auto-detects the source type from the URL, auto-populates `groupUrlname`, and uses AI to suggest the `kennelTag`. No API key required — Meetup's public REST API is unauthenticated for public groups.
27. **AI config suggestion bootstraps Meetup onboarding** — The Meetup adapter requires both `groupUrlname` and `kennelTag` in config, but the AI suggestion flow extracts `groupUrlname` from the URL and uses it as a placeholder to fetch sample events. Gemini then analyzes event titles against known kennels to suggest the proper `kennelTag`. This solves the chicken-and-egg problem where config is needed to fetch, but fetching is needed to suggest config.
28. **SPA sites need content URL discovery** — If a site loads content dynamically via JavaScript `fetch()`, Cheerio sees an empty container. Inspect the network requests (or the JS source) to find the actual content URL and fetch it directly. Example: `enfieldhash.org` loads `home.html` via SPA shell.
29. **Ghost CMS sites expose a public Content API** — Look for `data-key` and `data-api` attributes on the `ghost-portal` script tag. The Content API (`/ghost/api/content/posts/`) returns structured JSON with full HTML per post, eliminating CSS selector fragility. The API key is read-only and safe to hardcode.
30. **Multi-section blog posts need section isolation** — When a post contains multiple events (e.g., prelubes + main trail), isolate the relevant section before parsing to avoid extracting wrong dates/fields. Structural markers like `<hr>` separators are reliable delimiters.
31. **PHP REST APIs behind FullCalendar widgets** — Many hash websites use FullCalendar.js with PHP endpoints that return structured JSON. Inspect network requests on calendar pages to discover these APIs — they typically provide far richer data than Google Calendar feeds (hares, full addresses, descriptions, distances, on-after venues).
32. **Listing + detail fetch pattern** — When an API provides a listing endpoint with IDs and a detail endpoint per event, fetch detail sequentially (not in parallel) to be a good API citizen. Always implement a listing-only fallback when detail fetches fail — partial data is better than no data.
33. **STATIC_SCHEDULE is the default for Facebook-only kennels** — Most small-market kennels have no website, calendar, or API — just a Facebook group. STATIC_SCHEDULE sources generate placeholder events from RRULE patterns, giving users visibility into the schedule even without automated scraping.
34. **KennelCode conflicts need region suffixes** — As coverage expands, shortName collisions across regions become common (e.g., CH3 in both Chicago and Charleston). Use region suffixes on the `kennelCode` (e.g., `ch3-sc`, `ph3-atl`) to disambiguate. The `shortName` stays clean for display.
35. **Moon-phase scheduling can't be expressed as RRULE** — Kennels that run on full/new moons (Luna Ticks, Dark Side) need a custom recurrence model. For now, add them as kennel-only records (no source) and note the lunar schedule in `scheduleNotes`.
36. **Zero-code onboarding at scale** — South Carolina onboarded 10 kennels with 9 sources and zero new adapter code. Config-driven adapters (MEETUP, STATIC_SCHEDULE) + seed data changes are sufficient for regions without structured web sources. This pattern scales to any region with known schedules.
37. **Wix/Google Sites/SPAs need headless browser rendering** — JS-rendered sites return empty containers to Cheerio. Use `fetchBrowserRenderedPage()` (wraps `browserRender()` from `src/lib/browser-render.ts`) to render via NAS-hosted Playwright, then parse normally. The adapter still uses `HTML_SCRAPER` type and URL-based routing in the registry. See `northboro-hash.ts` for the reference implementation. Config: Cloudflare Tunnel path routing `proxy.hashtracks.xyz/render` → `browser-render:3200`.
38. **Facebook Events are the biggest untapped source** — Many small-market kennels exist only on Facebook (no website, calendar, or API). Public Facebook pages show events without login, but the page is JS-rendered and returns empty HTML to standard fetch. A future `FACEBOOK_EVENTS` adapter could use the NAS headless browser with an authenticated session (persistent cookies) to scrape public page events. This would unlock dozens of currently un-scrapeable kennels. Key challenges: Facebook anti-scraping measures (behavioral analysis, CAPTCHAs), session cookie expiration requiring periodic re-auth, and fragile DOM selectors that change frequently. Until this adapter exists, use `STATIC_SCHEDULE` for Facebook-only kennels with known schedules.
39. **Data quality sanitization is centralized in the merge pipeline** — `sanitizeTitle()` and `sanitizeLocation()` run on every event during merge. Adapters should NOT reimplement placeholder filtering, URL stripping, or hare-needed detection — the pipeline handles it. But adapters SHOULD use `isPlaceholder()` defensively when constructing composite fields (e.g., skip building a location from a TBA venue name).
40. **AI-powered extraction is available as a fallback** — `extractAddressWithAi(text)` in `src/adapters/utils.ts` uses Gemini to extract an address from a long text blob. Use it when deterministic parsing fails on paragraphs containing embedded addresses. It's cached, rate-limit-aware, and returns null on failure. Follow the pattern: try deterministic parsing first, fall back to AI only when text exceeds a length threshold.
41. **Postcode dedup is a recurring pattern in UK adapters** — Makesweat, WLH3, and similar UK sites often include postcodes in both the venue name AND a dedicated postcode field. Always check `parts.some(p => p.includes(postcode))` before appending postcode to a composite location string.
42. **Inline elements need explicit space insertion before `.text()`** — Cheerio's `.text()` concatenates adjacent `<span>` elements without spaces ("AliceBob"). Use `$block.find("span, a, strong, em, b, i").after(" ")` before extracting text, then normalize with `.replace(/\s{2,}/g, " ")`.
43. **Strip nav/boilerplate elements BEFORE text extraction** — Always `$main.find("script, style, noscript, nav, header, footer, aside, [role='navigation']").remove()` before calling `.text()`. Otherwise navigation links, Google Analytics code, and footer text bleed into event data.

---

## Automation Opportunities

Future areas where onboarding could be more automated:

1. **Source discovery**: Given a kennel URL, auto-detect source type (HTML, calendar link, .ics feed, spreadsheet) and suggest adapter
2. **HTML structure analysis**: AI-assisted parsing of unknown HTML structures to generate adapter code
3. **Config generation**: Auto-generate Google Sheets/Calendar config by sampling the data and detecting column patterns
4. **Kennel tag extraction**: Use NLP/fuzzy matching to auto-map event text to kennel tags
5. **Test generation**: Auto-generate test fixtures from real scrape samples
6. **Health monitoring**: Auto-tune alert thresholds based on historical scrape patterns
7. **Self-healing**: Auto-fix common issues (alias mismatches, date format changes) without manual intervention
