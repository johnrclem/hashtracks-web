# Source Onboarding Playbook

How to add a new data source to HashTracks. This playbook captures patterns learned from onboarding 138 sources across 8 adapter types.

> **See also:** [`docs/regional-research-prompt.md`](regional-research-prompt.md) — Chrome-assisted 3-stage workflow for discovering and onboarding entire regions at once.

---

## The Reusable Pipeline (same every time)

Every source flows through the same pipeline regardless of adapter type:

```
Source → Adapter.fetch() → RawEventData[] → fingerprint dedup → RawEvent (immutable)
                                                ↓
                                        kennel resolver → source-kennel guard → Event upsert
```

- **Fingerprint dedup**: SHA-256 of `date|kennelTag|runNumber|title` prevents duplicate RawEvents
- **Kennel resolver**: `kennelCode exact match → shortName exact match → alias case-insensitive → pattern fallback → flag unmatched`
- **Source-kennel guard**: Resolved kennel must be linked to the source via `SourceKennel` — blocks events for unlinked kennels and generates a `SOURCE_KENNEL_MISMATCH` alert
- **ScrapeLog**: Every scrape run is audited with timing, event counts, and error details
- **Force rescrape**: `force` param deletes existing RawEvents and re-processes from scratch
- **`RawEventData`** is the universal contract between any adapter and the pipeline

## What Varies Per Source (the adapter-specific work)

| Concern | HTML Scraper | Browser-Rendered HTML | Google Calendar | Google Sheets | iCal Feed | Blogger API | Ghost Content API | WordPress.com API | Meetup | Hash Rego | Static Schedule |
|---------|-------------|----------------------|----------------|--------------|-----------|-------------|-------------------|--------|-----------|
| Data access | HTTP GET + Cheerio parse | `browserRender()` → Cheerio parse (NAS Playwright service). Supports `frameUrl` for cross-origin iframe content (Wix Table Master). | Calendar API v3 | Sheets API (tabs) + CSV export (data) | HTTP GET + node-ical parse | Blogger API v3 (blog ID discovery + posts endpoint) | Ghost Content API (public key, JSON with full HTML) | Meetup public REST API | HTTP GET + Cheerio parse (index + detail pages) | None (generates from RRULE) |
| Auth needed | None | None (internal `BROWSER_RENDER_KEY`) | API key | API key (tab discovery only) | None | API key (same `GOOGLE_CALENDAR_API_KEY`) | None (public read-only key embedded in page) | None (public groups) | None | None |
| Kennel tags | Regex patterns on event text | Hardcoded per adapter (single-kennel) | `config.kennelPatterns` (multi-kennel) or `config.defaultKennelTag` (single-kennel) or hardcoded SUMMARY regex (Boston) | Column-based rules from config JSON | `config.kennelPatterns` (regex on SUMMARY) or `config.defaultKennelTag` | Hardcoded per adapter (single-kennel Blogspot blogs) | Hardcoded per adapter (single-kennel Ghost blogs) | `config.kennelTag` (single kennel, all events) | Per-event from Hash Rego data, filtered by `config.kennelSlugs` | `config.kennelTag` (single kennel) |
| Date format | Site-specific (ordinals, DD/MM/YYYY, US dates) | Site-specific (JS-rendered content, parsed after render) | ISO 8601 timestamps | Multi-format: M-D-YY, M/D/YYYY | ISO 8601 / DTSTART | API returns ISO 8601 `published`; post body parsed with site-specific logic | API returns ISO 8601 `published_at`; post body HTML parsed for trail date | ISO 8601 (`local_date`) | Site-specific HTML parsing | Generated from RRULE |
| Routing | URL-based (`htmlScrapersByUrl` in registry) | URL-based (`htmlScrapersByUrl` — same as HTML Scraper) | Shared adapter (single class) | Shared adapter (config-driven) | Shared adapter (config-driven) | URL-based (reuses `htmlScrapersByUrl` routing, Blogger API is primary fetch with HTML fallback) | URL-based (reuses `htmlScrapersByUrl` routing, Ghost API is primary fetch with HTML fallback) | Shared adapter (config-driven) | Shared adapter (config-driven) | Shared adapter (config-driven) |
| Complexity | High (structural HTML, site-specific) | Medium (browser render + Cheerio parse) | Medium (clean API) | Low (column mapping) | Low-Medium (config-driven, but iCal quirks) | Medium (shared `fetchBloggerPosts()` utility + site-specific body parsing) | Medium (Ghost API + trail section isolation + body parsing) | Low (config-driven, AI-assisted) | Medium (index + detail page scraping) | Lowest (no external fetch, pure config) |

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

**For browser-rendered sites with cross-origin iframes (Wix Table Master, etc.):**
```bash
# Use frameUrl to extract iframe content from within the parent page
curl -s -X POST https://proxy.hashtracks.xyz/render \
  -H "X-Render-Key: $BROWSER_RENDER_KEY" \
  -d '{"url":"https://example.com","waitFor":"iframe","frameUrl":"wix-visual-data","timeout":25000}'
# Returns the iframe's rendered HTML (not the parent page)
# Use compId in frameUrl to target a specific iframe when multiple exist
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
- **CRITICAL: Check for kennelCode collisions** before choosing codes. Many kennels share abbreviations across regions. Run this check for EVERY proposed code:
  ```bash
  grep -i '"your-proposed-code"' prisma/seed-data/kennels.ts prisma/seed-data/aliases.ts
  ```
  If a collision exists, add a region suffix: `sah3-se`, `ch3-dk`, `oh3-no`, `ah3-nl`, `mh3-tn`, etc. This must be done *before* writing any seed data — catching collisions in PR review wastes time.

  **Known collision-prone abbreviations** (check these especially carefully):
  - `ah3` (Austin, Amsterdam, Aloha), `bh3` (Berlin, Boulder, Bristol, Buffalo)
  - `ch3` (Chicago, Copenhagen, Charlotte, Charleston), `dh3` (Denver, Dublin, Dallas)
  - `eh3` (Enfield, Edinburgh, Eugene), `fch3` (Flour City, Fort Collins)
  - `lh3` (London, Lakeland), `mh3` (Minneapolis, Munich, Memphis, Miami)
  - `oh3` (Oregon, Oslo, Ohio), `rh3` (Reading, Richmond, Renegade, Rhode Island, Rumson)
  - `sh3` (Stuttgart, Seattle, Summit), `sah3` (San Antonio, Stockholm Absolut)
  - `swh3` (Sir Walter, Portland SW), `th3` (Tidewater, Thirstday, Tokyo)

### 3. Pre-research metadata harvest (for new kennels)

Before adding kennels to the seed, harvest metadata from two external directories. These provide aliases, schedule details, founding info, and lineage data that would otherwise require manual research per kennel.

**HHH Genealogy Project** (primary for aliases + lineage):
Open `https://genealogy.gotothehash.net/index.php?r=chapters/list&country=United%20States&state=STATE_NAME` (use full state name, URL-encoded spaces). For each kennel, the detail page provides:
- Full name and **aliases** ("Also known as") — add these directly to `kennelAliases` in seed
- Active/inactive status — skip inactive kennels unless you have evidence they're active
- First run date — use for `foundedYear`
- Schedule (day of week, frequency) — use for `scheduleDayOfWeek`, `scheduleFrequency`
- Founder and parent hash lineage — useful context for regional onboarding
- Runner type (Mixed/Men-only) — note in kennel description if relevant

**Half-Mind.com** (primary for schedule details + contact info):
Open `https://half-mind.com/regionalwebsite/p_list1.php?state=XX` (2-letter state abbreviation). For each kennel detail page:
- Schedule with day, time, and **seasonal variations** — captures details Genealogy misses
- Lat/lng coordinates — useful for verifying kennel region assignment
- Website URL and Facebook URL — starting points for Step 6 (adapter discovery)
- Hash cash amount — add to kennel seed data
- Email, hotline, contacts — not needed for seed but useful for outreach

**Priority order**: Check Genealogy first (richer alias data), then Half-Mind (richer schedule/contact data). Cross-reference both — neither is complete alone.

> **Note**: The main gotothehash.net site is defunct (subpages return 522 errors). Only the homepage and `genealogy.gotothehash.net` subdomain are functional.

### 4. Add kennels + aliases to seed (if new)

In `prisma/seed.ts`:
- Add kennel entries to the `kennels` array with `shortName`, `fullName`, `region`
- Add aliases to the `kennelAliases` record (case-insensitive matching)
- Run `npx prisma db seed` to create them

### 5. Choose or build adapter type

Existing adapter types:
- `HTML_SCRAPER` — For websites with event tables/lists (Cheerio parsing). Each site gets its own adapter class, routed by URL pattern in `htmlScrapersByUrl`. Currently: hashnyc, bfm, hashphilly, cityhash (Makesweat), westlondonhash, londonhash, barneshash, och3, slash-hash, chicago, thirstday, sfh3, ewh3, dch4, ofh3, hangover, shith3, enfieldhash, northboro (browser-rendered). Also includes `GenericHtmlAdapter` for config-driven CSS selector scraping.
- `HTML_SCRAPER` (Blogger API) — For Blogger/Blogspot-hosted sites. Uses Blogger API v3 as primary fetch method with HTML scraping fallback. The adapter is still registered as `HTML_SCRAPER` and routed via `htmlScrapersByUrl`, but internally calls `fetchBloggerPosts()` from `src/adapters/blogger-api.ts`. Currently: enfieldhash.org (EH3), ofh3.com (OFH3). **Prerequisite**: Enable the Blogger API in GCP Console and use the same `GOOGLE_CALENDAR_API_KEY`.
- `GOOGLE_CALENDAR` — For Google Calendar API v3 feeds. Single shared adapter, configured via `Source.config` JSON (kennelPatterns, defaultKennelTag). **Note**: By default, all-day events are skipped (holidays/travel blocks). If a calendar uses all-day events for real runs (e.g., NOH3), add `includeAllDayEvents: true` to the source config. Currently: 50+ sources across US, Europe, Japan.
- `GOOGLE_SHEETS` — For published Google Sheets (config-driven, reusable without code changes). Column mappings, kennel tag rules, start time rules in `Source.config`. Currently: Summit H3, W3H3.
- `ICAL_FEED` — For standard iCal (.ics) feeds via `node-ical`. Config-driven kennelPatterns + skipPatterns. Currently: SFH3 MultiHash aggregator, CCH3, BAH3.
- `MEETUP` — For public Meetup.com groups. Single shared adapter, config-driven (no code changes needed). Config requires `groupUrlname` (extracted from URL) and `kennelTag` (single kennel shortName). Currently: 5 live sources (Miami, Savannah, VT, CT, Charleston). **No API key required** — uses Meetup's public REST API.
- `HASHREGO` — For kennels listed on hashrego.com. Config-driven with `kennelSlugs` array (multi-kennel). Currently: 8 kennels (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3).
- `HARRIER_CENTRAL` — For kennels listed on hashruns.org (Harrier Central). Config-driven with `cityNames`, `kennelUniqueShortName`, `publicKennelId`, `defaultKennelTag`, or `kennelPatterns`. Returns rich data: event name, run number, date/time, lat/lng coordinates, hares, location descriptions. Currently: Tokyo H3. Known kennels on platform: Tokyo H3, SeaMon H3, Glasgow H3, City Hash, London H3, WLH3, Puget Sound H3, Rain City H3, Seattle H3, Morgantown H3, New Town H3, East End London H3, Brussels Manneke Piss H3, Amsterdam H3, Lisbon H3, Nairobi H3, Taiwan H3.
- `HTML_SCRAPER` (WordPress REST API) — For WordPress-hosted sites with public REST API. Uses shared `fetchWordPressPosts()` from `src/adapters/wordpress-api.ts`. Title contains event name/date, body contains labeled fields (Hare, Location, Date, Time). Currently: EWH3, DCH4, Voodoo H3, KCH3, BruH3. **Check first**: `curl -s "https://site.com/wp-json/wp/v2/posts?per_page=3" | python3 -m json.tool` — if it returns JSON posts, use this pattern.
- `HTML_SCRAPER` (Substack API) — For Substack-hosted newsletters. Public API at `{domain}/api/v1/archive` (listing) + `{domain}/api/v1/posts/{slug}` (detail with body_html). No auth required. Parse event date from title, time from subtitle, location from Google Maps links in body. Currently: STLH3. **Check**: `curl -s "https://site.com/api/v1/archive?limit=3"` — if it returns JSON array of posts, use this pattern.
- `STATIC_SCHEDULE` — For kennels without scrapeable web sources (Facebook-only). Generates placeholder events from RRULE recurrence rules — no external fetch. Config-driven with `rrule`, `defaultTitle`, `defaultLocation`, `startTime`, `kennelTag`. Currently: 28 sources across FL, GA, SC, MA, NJ, RI, TX. **Cannot express lunar recurrence** (full/new moon schedules). **Seasonal schedule switching** (e.g., summer Thursday / winter Wednesday) **is supported via `BYMONTH` on disjoint per-season sources** — see the seasonal-switch pattern in step 6 below; NOSE H3 is the reference example.

If none fit, create a new adapter implementing `SourceAdapter` from `src/adapters/types.ts`.

### 6. Implement or configure the adapter

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

**For Static Schedule (no code needed, no external fetch):**
For Facebook-only kennels with known recurrence patterns. Events are generated locally from RRULE rules:
```typescript
config: {
  rrule: "FREQ=WEEKLY;BYDAY=SA",  // every Saturday
  kennelTag: "WildH3",
  defaultTitle: "Wildcard H3 Weekly Hash",
  startTime: "14:00",
  defaultLocation: "TBA — check Facebook group",
}
```
Complex patterns are supported:
```typescript
// 1st and 3rd Sunday of every month
config: { rrule: "FREQ=MONTHLY;BYDAY=1SU,3SU", ... }
// Every other Saturday
config: { rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=SA", ... }
```

**Seasonal schedule switching (canonical pattern):** kennels that change run day with the seasons (e.g. summer Thursday / winter Wednesday) are encoded as **two source records sharing the same `kennelTag`, each scoped to disjoint months via `BYMONTH`**. The two RRULEs together must cover the full year with no overlap. Reference: NOSE H3 in `prisma/seed-data/sources.ts` lines 184–214 — summer Thursdays use `BYMONTH=5,6,7,8,9,10` (May–Oct), winter Wednesdays use `BYMONTH=1,2,3,4,11,12` (Nov–Apr). The block below is the full runnable seed shape; copy and adapt for new seasonal-switch kennels.

```typescript
// Source 1 — summer schedule (NOSE H3 actual seed)
{
  name: "NOSE Hash Static Schedule (Summer Thursdays)",
  url: "https://www.facebook.com/groups/NOSEHash",
  type: "STATIC_SCHEDULE" as const,
  trustLevel: 3,
  scrapeFreq: "weekly",
  scrapeDays: 90,
  config: {
    kennelTag: "nose-h3",
    rrule: "FREQ=WEEKLY;BYDAY=TH;BYMONTH=5,6,7,8,9,10",
    startTime: "19:00",
    defaultTitle: "NOSE H3 Weekly Run",
    defaultLocation: "North NJ",
    defaultDescription: "Summer schedule: Thursdays 7pm in North NJ. ...",
  },
  kennelCodes: ["nose-h3"],
},
// Source 2 — winter schedule (NOSE H3 actual seed)
{
  name: "NOSE Hash Static Schedule (Winter Wednesdays)",
  url: "https://www.facebook.com/groups/NOSEHash#winter-wed",
  type: "STATIC_SCHEDULE" as const,
  trustLevel: 3,
  scrapeFreq: "weekly",
  scrapeDays: 90,
  config: {
    kennelTag: "nose-h3",
    rrule: "FREQ=WEEKLY;BYDAY=WE;BYMONTH=1,2,3,4,11,12",
    startTime: "19:00",
    defaultTitle: "NOSE H3 Weekly Run",
    defaultLocation: "North NJ",
    defaultDescription: "Winter schedule: Wednesdays 7pm in North NJ. ...",
  },
  kennelCodes: ["nose-h3"],
},
```

Note the `url` field on the second source — adding a fragment (`#winter-wed`) keeps the two source URLs distinct so the seed upsert treats them as separate rows. Each source is scraped/scheduled independently; the merge pipeline produces one event per real run because the two `BYMONTH` ranges never produce a date for the same kennel on the same day. A single-source `seasons` schema was considered and rejected — see [`facebook-integration-strategy.md`](facebook-integration-strategy.md) decision log entry 2026-04-30 for the full rationale.

**For new HTML scrapers:**
1. Create `src/adapters/html-scraper/{site-name}.ts` implementing `SourceAdapter`
2. Export pure parsing functions for unit testing (e.g., `parseDateFromTitle()`, `parseRunCard()`)
3. Add URL pattern to `htmlScrapersByUrl` in `src/adapters/registry.ts`
4. Create `src/adapters/html-scraper/{site-name}.test.ts` with embedded HTML fixtures

**For browser-rendered HTML scrapers (Wix, SPAs):**
1. Same as HTML scrapers above, but use `fetchBrowserRenderedPage()` instead of `fetchHTMLPage()`
2. Set `waitFor` to a CSS selector that indicates content has loaded (e.g., `.ms_event`, `iframe[title='Table Master']`)
3. For cross-origin iframes: use `frameUrl` parameter with URL substring match (e.g., `frameUrl: "comp-ksnfhbg7"`)
4. For multiple iframes on one page: use the iframe's `compId` in the `frameUrl` to target the correct one
5. Wix pages may never reach `networkidle` — the server uses `domcontentloaded` + `waitForSelector` instead

**For completely new adapter types:**
- Implement the `SourceAdapter` interface: `{ type, fetch(source, options?) }`
- Return `ScrapeResult`: `{ events, errors, errorDetails?, structureHash?, diagnosticContext? }`
- Register in `src/adapters/registry.ts`

### 7. Add kennel tag extraction logic

How does this source identify which kennel an event belongs to? Common patterns:
- **Text patterns**: Regex on event title/description (hashnyc, Boston Calendar)
- **Column-based**: Dedicated column values (Google Sheets)
- **Calendar-based**: Different calendars for different kennels

### 8. Add pattern matching to kennel resolver

If the adapter produces kennel tags that don't exactly match `shortName` or existing aliases, add fallback patterns to `mapKennelTag()` in `src/pipeline/kennel-resolver.ts`.

**Important**: Longer/more specific patterns BEFORE shorter ones (e.g., "summit full moon" before "summit").

### 9. Add source to seed

In `prisma/seed.ts`, add to the `sources` array:
```typescript
{
  name: "Human-readable name",
  url: "source URL or identifier",
  type: "GOOGLE_SHEETS" as const,
  trustLevel: 7,          // 1-10
  scrapeFreq: "daily",
  config: { ... },         // adapter-specific config (optional)
  kennelCodes: [...],      // linked kennels (by kennelCode) — CRITICAL for source-kennel guard
}
```

**Scrape frequency**: Use `"daily"` for all non-static sources (Google Calendar, Sheets, HTML scrapers, iCal feeds, Meetup). Only `STATIC_SCHEDULE` sources should use `"weekly"` — they generate events from RRULEs with no external fetch.

**Important**: `kennelCodes` controls which kennels the source can create events for. The merge pipeline **blocks** events for any kennel not in this list. If a source covers multiple kennels, list them all. If you're unsure, add the kennel and verify — the `SOURCE_KENNEL_MISMATCH` alert will tell you if events are being blocked.

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

### 10. Test locally

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

### 11. Deploy + force scrape

```bash
git add . && git commit && git push
# Vercel auto-deploys from main
# Trigger force scrape from admin UI
```

### 12. Review data quality

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
- **Key lesson**: `kennelCodes` in seed is critical — it controls the source-kennel guard. Missing a kennel link means events get silently blocked with a `SOURCE_KENNEL_MISMATCH` alert.

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

### Sources #26-33: Florida (MEETUP + GOOGLE_CALENDAR + HTML_SCRAPER + STATIC_SCHEDULE)

- **Types**: `MEETUP` (x1) + `GOOGLE_CALENDAR` (x2) + `HTML_SCRAPER` (x1) + `STATIC_SCHEDULE` (x4)
- **Coverage**: 29 kennels across Miami, Key West, Orlando, Tampa/St Pete, Palm Beach, Fort Lauderdale, Jacksonville, Gainesville
- **Adapters**: Miami H3 Meetup (zero-code), Key West + O2H3 Google Calendars (config-only), West Central FL Hash Calendar (new HTML scraper at `src/adapters/html-scraper/wcfh-calendar.ts`), 4 static schedules for Facebook-only kennels
- **Key lesson**: Large states benefit from a mix of adapter types — Meetup and Calendar for kennels with structured data, STATIC_SCHEDULE for the rest. This hybrid approach maximized coverage with minimal new code.
- **Key lesson**: Meetup venue names often contain garbled data (doubled city name, embedded state abbreviation). The `cleanVenueName()` utility in the Meetup adapter normalizes these.

### Sources #34-44: Georgia (MEETUP + HTML_SCRAPER + STATIC_SCHEDULE)

- **Types**: `MEETUP` (x1) + `HTML_SCRAPER` (x1) + `STATIC_SCHEDULE` (x9)
- **Coverage**: 20 kennels across Atlanta metro and Savannah
- **Adapters**: Savannah H3 Meetup (zero-code), Atlanta Hash Board (new HTML scraper at `src/adapters/html-scraper/atlanta-hash-board.ts`), 9 static schedules for Atlanta-area kennels
- **Key lesson**: When a region has a central hash board website, scraping it provides coverage for multiple kennels at once (similar to hashnyc.com aggregator pattern).

### Sources #45-49: New England + Dublin (MEETUP + HTML_SCRAPER + STATIC_SCHEDULE)

- **Types**: `MEETUP` (x2) + `HTML_SCRAPER` (x3) + `STATIC_SCHEDULE` (x1)
- **Coverage**: Vermont (VTH3, BurH3), Rhode Island (RIH3), Connecticut (CTH3), Dublin Ireland (DH3)
- **Adapters**: Von Tramp + Narwhal Meetups (zero-code), Burlington (`src/adapters/html-scraper/burlington-hash.ts`) + RIH3 (`src/adapters/html-scraper/rih3.ts`) + Dublin (`src/adapters/html-scraper/dublin-hash.ts`) HTML scrapers, RIH3 static schedule
- **Key lesson**: Dublin H3 was the first non-US/UK kennel, demonstrating the platform's ability to expand internationally with standard HTML scraping patterns.

### Sources #50-58: Ohio (MEETUP + GOOGLE_CALENDAR + HTML_SCRAPER)

- **Types**: `MEETUP` (x2) + `GOOGLE_CALENDAR` (x6) + `HTML_SCRAPER` (x1)
- **Coverage**: 9 kennels across Dayton, Cincinnati, Columbus, Cleveland, Akron
- **Adapters**: Cleveland + Cincinnati Meetups (zero-code), 6 Google Calendars (config-only), Renegade H3 (`src/adapters/html-scraper/renegade-h3.ts` — new Webador CMS adapter)
- **Regions**: 6 new regions (Ohio STATE_PROVINCE + 5 metros), demonstrating state→metro hierarchy pattern
- **Webador platform**: Renegade H3 (renegadeh3.com) uses Webador CMS with a consistent `#NNN - MM/DD/YY - Title` event header format. Detail lines parsed for Hares, Where, Hash Cash, etc. Exportable pure parsing functions for unit testing.
- **Key lesson**: Webador is a new CMS platform (like Makesweat, Ghost, DigitalPress) with predictable HTML structure. Look for the `#number - date - title` header pattern on Webador-hosted hash sites.

### Sources #59-69: Oregon (GOOGLE_CALENDAR — Chrome-assisted discovery)

- **Types**: `GOOGLE_CALENDAR` (x11)
- **Coverage**: 12 kennels across Portland, Salem, Eugene, Bend — zero prior coverage
- **Adapters**: Zero new adapter code — all config-driven Google Calendar sources
- **Discovery method**: Chrome-assisted 3-stage workflow (see `docs/regional-research-prompt.md`):
  1. Found `oregonhhh.org` regional hub via web search
  2. Extracted 14 base64-encoded Google Calendar IDs from the embedded iframe via Chrome `javascript_tool`
  3. Identified each calendar by querying the Google Calendar API for recent events
  4. Verified kennel activity, extracted metadata from individual websites
- **Aggregator pattern**: Oregon Hashing Calendar (`cae3r4u2uhucmmi9rvq5eu6obg@group.calendar.google.com`) is a multi-kennel aggregator using `kennelPatterns` for OH3/TGIF/Cherry City. Individual kennel calendars added as higher-trust secondary sources.
- **Key lesson**: Chrome-assisted discovery dramatically accelerates regional onboarding. Calendar IDs embedded in iframes can be extracted programmatically using `javascript_tool` instead of manual browser inspection. Combined with Google Calendar API event queries to identify unnamed calendars, this enables full region onboarding in a single session.
- **Key lesson**: Half-Mind.com (`half-mind.com/regionalwebsite/p_list1.php?state=XX`) is a valuable aggregator for initial kennel discovery — provides kennel names, run days, and website URLs for most US states.
- **Key lesson**: When regional calendars embed multiple calendar IDs and the Chrome extension blocks the raw values (cookie/base64 filtering), use `atob()` to decode base64 calendar IDs or extract just the hostname/path to confirm it's a Google Calendar, then use the Calendar API to identify calendars by their event content.

### UK Adapter Patterns (Norfolk, Mersey Thirstdays, Bull Moon)

**Norfolk H3** (WordPress Block Theme + residential proxy):
- WAF-blocked sites need `safeFetch({ useResidentialProxy: true })` with browser-like headers
- WordPress Block Theme post loops: parse `<ul class="wp-block-post-template"> > li` elements
- Norfolk-specific volunteer prompt "It could be you?" is not a real hare name — filter alongside TBC/TBA

**Mersey Thirstdays** (IONOS/Jimdo static HTML, multi-page):
- IONOS WYSIWYG editor produces deeply nested `<div style="font-size:15.4px;">` — text extraction + regex is the only reliable approach (DOM structure is unusable)
- Multi-page adapter: next-runs page (dash-separated blocks) + past-runs page (year-section archive, ~597 events)
- Past runs have 3+ format eras with REVERSED field order in oldest entries (location before hare pre-2022)
- Year markers `▲ YYYY ▲` in past-runs page assign years to entries — more reliable than chrono-node year inference
- Run number dedup: next-runs page data wins over past-runs (richer fields: postcode, venue address, nearest station)
- Key lesson: Don't defer historical data scraping to a follow-up PR — the research context (format eras, parsing strategies) is fresh during initial implementation

**Bull Moon** (Wix SPA + Table Master cross-origin iframes):
- Wix Table Master widgets render event data in cross-origin iframes (`wix-visual-data.appspot.com`)
- Iframe URLs return "unauthorized" when rendered standalone — must use `frameUrl` parameter to extract content from within the parent page context
- `frameUrl` matches iframe by URL substring — use Table Master `compId` (e.g., `comp-ksnfhbg7`) to disambiguate when multiple iframes exist on one page
- Wix pages never reach `networkidle` (continuous background requests) — server uses `domcontentloaded` for `page.goto`, then `waitForSelector` for content readiness
- NAS browser render handles one render at a time — `Promise.all` for multiple pages will get 429 on the second request, client 3-retry logic with 2s backoff handles this gracefully
- Two event series from one kennel (Bull Moon monthly Sat 12pm + T3 weekly Thu 6:45pm) — classify by Event column text, apply per-series default start times
- 2-digit year dates ("Thu, 2 Apr 26") confuse chrono-node — use manual parsing with century inference (< 70 → 20xx, ≥ 70 → 19xx)
- Key lesson: Always spike-test browser rendering against the actual site before writing the adapter — iframe discovery and rendering strategy cannot be assumed from documentation

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
12. **Source-kennel guard** blocks events for kennels not linked via `SourceKennel` — prevents cross-contamination between sources. Always verify `kennelCodes` in seed covers ALL kennels the source produces.
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
35. **Moon-phase scheduling can't be expressed as RRULE** — Kennels that run on full/new moons (Luna Ticks, Dark Side) need a custom recurrence model. For now, add them as kennel-only records (no source) and note the lunar schedule in `scheduleNotes`. (Seasonal day-of-week switches *can* be expressed — see lesson #102.)
36. **Zero-code onboarding at scale** — South Carolina onboarded 10 kennels with 9 sources and zero new adapter code. Config-driven adapters (MEETUP, STATIC_SCHEDULE) + seed data changes are sufficient for regions without structured web sources. This pattern scales to any region with known schedules.
37. **Wix/Google Sites/SPAs need headless browser rendering** — JS-rendered sites return empty containers to Cheerio. Use `fetchBrowserRenderedPage()` (wraps `browserRender()` from `src/lib/browser-render.ts`) to render via NAS-hosted Playwright, then parse normally. The adapter still uses `HTML_SCRAPER` type and URL-based routing in the registry. See `northboro-hash.ts` for the reference implementation. Config: Cloudflare Tunnel path routing `proxy.hashtracks.xyz/render` → `browser-render:3200`.
38. **Facebook Events are the biggest untapped source** — Many small-market kennels exist only on Facebook (no website, calendar, or API). Public Facebook pages show events without login, but the page is JS-rendered and returns empty HTML to standard fetch. A future `FACEBOOK_EVENTS` adapter could use the NAS headless browser with an authenticated session (persistent cookies) to scrape public page events. This would unlock dozens of currently un-scrapeable kennels. Key challenges: Facebook anti-scraping measures (behavioral analysis, CAPTCHAs), session cookie expiration requiring periodic re-auth, and fragile DOM selectors that change frequently. Until this adapter exists, use `STATIC_SCHEDULE` for Facebook-only kennels with known schedules.
39. **Data quality sanitization is centralized in the merge pipeline** — `sanitizeTitle()` and `sanitizeLocation()` run on every event during merge. Adapters should NOT reimplement placeholder filtering, URL stripping, or hare-needed detection — the pipeline handles it. But adapters SHOULD use `isPlaceholder()` defensively when constructing composite fields (e.g., skip building a location from a TBA venue name).
40. **AI-powered extraction is available as a fallback** — `extractAddressWithAi(text)` in `src/adapters/utils.ts` uses Gemini to extract an address from a long text blob. Use it when deterministic parsing fails on paragraphs containing embedded addresses. It's cached, rate-limit-aware, and returns null on failure. Follow the pattern: try deterministic parsing first, fall back to AI only when text exceeds a length threshold.
41. **Postcode dedup is a recurring pattern in UK adapters** — Makesweat, WLH3, and similar UK sites often include postcodes in both the venue name AND a dedicated postcode field. Always check `parts.some(p => p.includes(postcode))` before appending postcode to a composite location string.
42. **Inline elements need explicit space insertion before `.text()`** — Cheerio's `.text()` concatenates adjacent `<span>` elements without spaces ("AliceBob"). Use `$block.find("span, a, strong, em, b, i").after(" ")` before extracting text, then normalize with `.replace(/\s{2,}/g, " ")`.
43. **Strip nav/boilerplate elements BEFORE text extraction** — Always `$main.find("script, style, noscript, nav, header, footer, aside, [role='navigation']").remove()` before calling `.text()`. Otherwise navigation links, Google Analytics code, and footer text bleed into event data.
44. **Double-header merge support** — Some kennels legitimately hold two events on the same day (morning + evening). The `allowDoubleHeaders` flag on the merge pipeline prevents the single-event-per-kennel-per-day constraint from blocking these valid events. Set it in the source's merge config when needed.
45. **Event city backfill from reverse geocoding** — The merge pipeline automatically reverse-geocodes events with coordinates to populate `locationCity`. Adapters don't need to set city — just provide coordinates or a Maps URL.
46. **DB seed slug collision handling** — The `ensurePattern()` refactor uses a pre-check instead of P2002 retry for slug collisions during seed upserts. This is more reliable than catching unique constraint violations.
47. **Meetup venue name garbling** — Meetup venue names often contain doubled city names ("Atlanta Atlanta") or embedded state abbreviations. The adapter includes `cleanVenueName()` to normalize these. Watch for similar patterns when adding new Meetup sources.
48. **Location placeholder filtering is centralized** — `sanitizeLocation()` in the merge pipeline strips TBD/TBA/TBC, bare URLs, and registration links from all events. Adapters should NOT reimplement this check — the pipeline handles it automatically.
49. **Title suppression for generic kennel-name titles** — `getDisplayTitle()` in EventCard.tsx suppresses titles that just repeat the kennel shortName (e.g., "SPH3" or "SPH3 Hash"). Adapters don't need to filter these — the display layer handles it.
50. **Chrome-assisted discovery scales regional onboarding** — Oregon onboarded 12 kennels with 11 Google Calendar sources and zero adapter code in a single session. Use the 3-stage Chrome workflow in `docs/regional-research-prompt.md`: (1) Aggregator-first discovery (HashRego, Half-Mind, Meetup, regional calendars), (2) Deep extraction with Calendar ID extraction and metadata scraping, (3) Seed data generation. This scales far better than ad-hoc web searches.
51. **Calendar ID extraction from iframe embeds via Chrome** — Many kennel websites embed Google Calendar iframes. Use Chrome's `javascript_tool` to run `Array.from(document.querySelectorAll('iframe[src*="calendar.google.com"]')).map(f => new URL(f.src).searchParams.getAll('src'))` to extract all calendar IDs. When the extension blocks raw values as "base64 encoded data", use `atob()` to decode them in the page context. Faster and more reliable than manual URL parsing.
52. **Identify unnamed calendars via the API** — When a multi-kennel calendar embeds many IDs without labels, query each one via the Google Calendar API (`/calendars/{id}/events?maxResults=3`) and identify the kennel from the `summary` field of the calendar or its events. This is how Oregon's 14 calendar IDs were mapped to specific kennels.
53. **Half-Mind.com is a global kennel directory** — `half-mind.com/regionalwebsite/p_list1.php?state=XX` indexes kennels by US state with run days, contact info, and website URLs. Use it as a first-pass discovery step for any US region. It also flags inactive/dead kennels, saving verification time.
54. **Webador CMS has predictable event structure** — Webador-hosted hash sites (e.g., renegadeh3.com) use a consistent `#NNN - MM/DD/YY - Title` event header pattern with labeled detail lines. See `src/adapters/html-scraper/renegade-h3.ts` for the reference implementation.
55. **Zero-code regional onboarding at scale** — When a region's kennels all use Google Calendar, the entire region can be onboarded with only `seed.ts` and `region.ts` changes. Oregon (12 kennels), South Carolina (10 kennels), and Georgia (11 kennels with static schedules) all demonstrate this pattern. Config-driven adapters (Calendar, Meetup, Static Schedule) eliminate the per-source code cost.
56. **Check prod DB for kennelCode collisions, not just seed.ts** — As the kennel count grows (200+), shortName collisions across regions become common. The `@@unique([shortName, regionId])` constraint allows same shortName in different regions, but kennelCode must be globally unique. Always query the prod database before assigning codes — seed.ts may not reflect manually-created kennels.
57. **Multi-calendar aggregator pages reveal individual calendar IDs** — Sites like lbh3.org/socal aggregate 31 per-kennel Google Calendars in a custom JS frontend. Inspect the site's JavaScript (`index.js`) for the `calendars` array with `id` and `summary` fields. Each kennel gets its own `GOOGLE_CALENDAR` source with `defaultKennelTag` — no `kennelPatterns` needed. This replaces static schedules with real event data (dates, times, locations, descriptions). Always check for aggregator pages before falling back to static schedules.
58. **History pages provide massive backfill without per-page fetching** — sdh3.com/history.shtml has 7,649 events in a single `<ol>`. Parse the list items for date, title, and kennel name (in parenthetical) without fetching individual detail pages. This is far more efficient than iterating page-by-page and provides decades of event history for kennel stats. Use `includeHistory` config flag to control whether history scraping runs.
59. **JS-rendered calendar aggregators don't use iframes** — Sites like lbh3.org/socal use custom JavaScript frontends that call the Google Calendar API directly. The standard iframe check (`querySelectorAll('iframe[src*="calendar.google.com"]')`) returns empty for these pages. Always also search the page source for `@group.calendar.google.com` patterns and inspect external JS files for calendar configuration arrays. This is how we discovered 31 per-kennel Google Calendar IDs that replaced 4 planned static schedules.
60. **Check for regional aggregator subpages on kennel websites** — A kennel's website may host a regional aggregator at a subpath (e.g., lbh3.org hosts a SoCal-wide calendar at /socal/). When a kennel appears to serve as a regional hub, check paths like `/calendar/`, `/socal/`, `/events/`, `/schedule/` for multi-kennel aggregator pages. These are high-value discoveries — one page can reveal source data for 10-30 kennels.
61. **Use Half-Mind as a post-onboarding gap check** — After onboarding a region, cross-reference `half-mind.com/regionalwebsite/p_list1.php?state=XX` against your onboarded kennels. Half-Mind lists active, inactive, and dead kennels by state. This catches kennels that don't appear on Meetup, Google, or aggregator sites but are still active. California gap check revealed Sacramento (2 kennels), Santa Barbara (2 kennels), and Bakersfield as notable omissions from the initial onboarding.
62. **Double-iframe Google Sheets harelines** — Some hash sites embed Google Sheets via a double-iframe chain: `page → iframe (raw HTML) → iframe (Google Sheet pubhtml)`. Chrome's `get_page_text` and WebFetch both fail on these because the data is two iframes deep and cross-origin. To discover the Sheet IDs, inspect the intermediate iframe's HTML for `docs.google.com/spreadsheets` URLs. Once you have the Sheet ID, use CSV export directly (`/export?format=csv&gid=X` or `/d/e/.../pub?output=csv`). Example: wh3.org/harelines/ embeds per-kennel harelines this way.
63. **Three Google Sheets CSV access patterns** — The GOOGLE_SHEETS adapter now supports three URL patterns: (a) `gviz/tq?tqx=out:csv&sheet=TabName` — standard tab-based (Summit H3 pattern), (b) `export?format=csv&gid=X` — explicit tab ID via `gid` config (for non-default tabs like Puget Sound's `gid=237970172`), (c) direct `csvUrl` for anonymous `/d/e/.../pub?output=csv` sheets (Leap Year H3 pattern). Use `skipRows` config to skip title/note rows before the header row.
64. **Calendar + Sheets multi-source enrichment** — When a region has both a shared Google Calendar and per-kennel Google Sheets harelines (like wh3.org), use the Calendar as primary source (dates, times, locations, descriptions) and Sheets as secondary enrichment (run numbers, hares, themes). The merge pipeline deduplicates by date+kennel, keeping the richest data from each source.
65. **Skip inactive kennels rather than static-schedule them** — If a kennel has low activity and no good data source, skip it entirely rather than creating a STATIC_SCHEDULE. Static schedules generate placeholder events that may not reflect reality. Better to have no data than wrong data. Add them later when they become active or get a real source.
66. **Always verify event volume from iCal/feed sources before classifying as Tier 1** — Don't assume a feed contains all events. Fetch the iCal URL during research and count the VEVENT entries. WordPress Events Manager iCal feeds are typically scope=future with only ~7 events — not enough for a complete source. A site showing 50+ events on its HTML calendar but only 7 in the iCal feed needs an HTML scraper as the primary source, with iCal as secondary enrichment for future events.
67. **WordPress Events Manager AJAX pattern for month-by-month scraping** — Sites using WordPress Events Manager (identifiable by `em-calendar` CSS class and `EM` JavaScript object) support AJAX month navigation: POST to the calendar page URL with `em_ajax=1, ajaxCalendar=1, full=1, scope=all, month=M, year=YYYY`. Response is HTML with that month's events. This enables historical backfill by iterating months. Rate-limit with 300ms between requests. Example: `phoenixhhh.org` calendar yields 12 events/month vs 7 from iCal.
68. **Fetch event detail pages for missing titles** — Calendar listing views often only show titles for events with uploaded images (via `img.alt`). Events with placeholder images have no title in the listing. Rather than guessing from URL slugs (lossy), fetch the individual event detail page and extract the `<h1>` heading. Use concurrent batches (3 at a time) with delays to be a good citizen. Re-resolve kennel tag after fetching the real title.
69. **Always test adapters against real HTML, not idealized text** — The Edinburgh adapter tests passed because they used template literals with explicit newlines. But the actual Weebly page renders all run data as inline `<span>` elements within a single `<h2>` — Cheerio's `.text()` concatenates these WITHOUT newlines. Include at least one integration test using realistic HTML from the actual source site (copy from Chrome DevTools), not hand-formatted text. This catches `.text()` vs `innerText` mismatches that only manifest in production.
70. **Check for archive/history pages during research** — Dublin's `/archive` page has 186+ events in the same table format as `/hareline` (which only had 4 future events). When a site has separate hareline (future) and archive (past) pages using the same HTML structure, scrape the archive page as the primary source — it's the superset. This is the same pattern as SDH3's hareline+history dual-page approach.
71. **Always check for a structured API before scraping HTML tables** — HTML tables with year-less dates, inconsistent formatting, or mixed upcoming/past data are fragile to scrape. Before building an HTML scraper, check: (a) WordPress.com REST API (`/wp-json/` returns 404? try `public-api.wordpress.com/rest/v1.1/sites/{domain}/posts/`), (b) Blogger API v3, (c) Ghost Content API, (d) PHP/AJAX endpoints behind calendar widgets, (e) iCal/RSS feeds. API sources provide ISO dates with years, structured fields, and pagination — eliminating entire classes of date-parsing bugs. The Cape Fear adapter went through 3 PRs fighting year-less M-D dates in a hareline table before discovering the WordPress.com API was available with full ISO 8601 dates all along.
72. **WordPress.com public REST API needs no auth** — Self-hosted WordPress exposes `/wp-json/wp/v2/posts` (requires the site to enable it). WordPress.com-hosted sites (identifiable by `*.wordpress.com` CNAME or "Starter" plan badge) expose a different public API at `https://public-api.wordpress.com/rest/v1.1/sites/{domain}/posts/?number=20&fields=ID,date,title,URL,content`. No API key needed. Returns ISO 8601 dates, HTML content per post, and pagination via `next_page` token. Use the publish date's year as a chrono-node reference to resolve year-less event dates in post bodies. See `src/adapters/html-scraper/cape-fear-h3.ts` for the reference implementation.
73. **genealogy.gotothehash.net is a structured kennel database** — The HHH Genealogy Project (`genealogy.gotothehash.net`) is a Yii Framework database with ~670 US kennel records (~331 active) and ~306 UK records (~140 active). Per-kennel pages provide: full name, aliases ("Also known as"), active/inactive status, first run date, schedule, founder, parent hash lineage, descendants, runner type (Mixed/Men-only), and logos. URL pattern: `/index.php?r=chapters/list&country=United%20States&state=STATE_NAME` (use full state name, URL-encoded spaces). The "Also known as" field is uniquely valuable — it directly maps to `kennelAliases` entries in seed.ts with minimal manual work. Use it alongside Half-Mind for pre-research metadata harvesting before adding new kennels (see Step 3).
74. **gotothehash.net main site is defunct** — As of early 2026, all gotothehash.net subpages (state pages, megacenter pages, contact links) return 522 errors (doteasy.com hosting is dead). Only the homepage loads, linking to the Genealogy Project subdomain and listing Nash Hash/intercontinental events. Do not attempt to scrape gotothehash.net subpages — only `genealogy.gotothehash.net` is functional. If you encounter gotothehash.net links during research, redirect attention to the genealogy subdomain instead.
75. **Two external directories complement each other for metadata** — Half-Mind.com (lesson #53) excels at schedule details (day/time/seasonal variations), coordinates, website/Facebook URLs, hash cash, and contact info. The Genealogy Project (lesson #73) excels at aliases, founding dates, parent-child lineage, and active/inactive status. Neither is complete alone — always cross-reference both during the pre-research metadata harvest step. Priority: Genealogy first (richer alias data for seed), then Half-Mind (richer operational data for schedule fields).
76. **WordPress.com Public API helpers are already built** — `fetchWordPressComPage(domain, slug)` and `fetchWordPressComPosts(domain, opts)` in `src/adapters/wordpress-api.ts` wrap `public-api.wordpress.com/rest/v1.1/sites/{domain}/posts/`. Page-by-slug uses `posts/slug:<slug>` (note: the path is `posts/`, NOT `pages/`, even for pages). Use these instead of rolling your own fetch. Reference: `hash-horrors.ts` adapter.
77. **PWA backends often expose open REST-over-SQL APIs** — Before falling back to browser-render for an Ionic/Angular/React SPA, inspect the bundled `main.js` in Chrome DevTools Sources tab for `fetch(`/`axios.`/API hostnames. Seletar H3's `HashController.php` was discovered this way — it's a thin wrapper that accepts `{action, mapObject, sqlExtended}` and returns the full MySQL view. Unlocked 45 years of historical trails in one adapter. Lift to a shared utility only after finding a second instance.
78. **Historical backfill via strict date partitioning** — When a source exposes both future AND historical data, split the ingest: recurring adapter uses `>= CURDATE()`, one-shot backfill script uses `< CURDATE()`. The two partitions never overlap, so re-running the backfill can never collide with adapter writes — no unique constraint needed. Reference: `HISTORICAL_SQL` export in `seletar-h3.ts` + `scripts/backfill-seletar-h3-history.ts`.
79. **Sort multi-value joined fields for stable fingerprints** — If a row-based API returns participants/tags/scribes in nondeterministic order, sort them alphabetically BEFORE joining into a field like `hares: "A, B, C"`. Otherwise every re-scrape produces a fresh fingerprint and idempotency breaks. Real incident: the Seletar backfill first re-run inserted 74 duplicate RawEvents (PR #541). Fix: `[...names].sort((a, b) => a.localeCompare(b)).join(", ")`. Audit any adapter building a joined field from multiple API rows.
80. **Adapters must honor `options.days`** — The `SourceAdapter.fetch(source, options)` contract promises to respect the configured window. Never destructure as `_options` and ignore — it silently disables `source.scrapeDays`. Filter events with `buildDateWindow(options?.days ?? <default>)`. Exception: GOOGLE_CALENDAR (the API caps its own window). `grep -nR "_options" src/adapters/` to audit.
81. **Default adapter window wide when source = full archive single feed** — When the only feed contains the complete historical archive (e.g. Hash Horrors hareline back to Hash 1), default `options.days` to a wide window (`365 * 20`) so the recurring scrape doesn't silently discard the archive every run. When a separate backfill script handles the pre-CURDATE partition (Seletar), the adapter can use a tight window.
82. **Runtime payload shape validation before trusting API responses** — Never rely on `response.data as Row[]` type assertions. A 200 response with a malformed body (HTML error page, `{status:"1"}`, non-array `data`) would otherwise succeed silently with empty rows and trigger the reconciler to cancel live events. Reject non-array payloads up front with a fetch error.
83. **Whitelist PII in error diagnostics** — Never `JSON.stringify(row)` a row from a participant-returning API into `errorDetails.parse[].rawText` or error messages. TypeScript interface narrowing is compile-time only — the runtime object still has every field from the raw API response. Write a `safeRowSample()` that lists non-PII fields explicitly. Reference: `safeRowSample()` in `seletar-h3.ts`.
84. **SonarCloud regex complexity ≤ 20** — Complex single-regex tokenizers that combine alternation + lookahead blow past SonarCloud's 20-complexity ceiling. Prefer multi-pass: find section boundaries with a simple regex, then run a simpler line parser per section. Reference: two-pass `findYearHeadings` + `findRunLineStarts` in `hash-horrors.ts` (the first version with a combined regex scored 65).
85. **One-shot scripts need explicit `.env` loading** — Scripts run via `npx tsx scripts/foo.ts` do NOT auto-load `.env` the way `prisma db seed` does. Either `import "dotenv/config"` at the top of the script or document `set -a && source .env && set +a && npx tsx …` in the usage block. The Seletar backfill crashed with ECONNREFUSED on first run because of this.
86. **Run `/codex:adversarial-review` AND `/simplify` before every non-trivial PR** — Between them they catch: SonarCloud complexity, PII leaks, payload-validation gaps, idempotency hazards, hardcoded URLs, misleading comments, unused exports. Adversarial focuses on correctness/security, Simplify on reuse/efficiency/quality. This is non-negotiable workflow for adapter/seed/pipeline PRs. Skipping leads to post-push review noise from SonarCloud/Codacy/CodeRabbit/Claude bot/Gemini.
87. **Singapore = second-oldest hashing scene** — Mother Hash (KL 1938) is older, but Singapore's Father Hash (HHHS, founded 1962) is the **second hash kennel ever**. Historic-kennel exception to the "no sourceless kennels" rule: STATIC_SCHEDULE is acceptable for founding-era kennels with well-documented weekly schedules even without a per-run data source. Singapore now has 7/7 active kennels covered via 8 sources.
88. **Mother Hash (1938) is Tier 2 scrapeable, not sourceless** — `motherhash.org` is a Google Sites page but it renders two upcoming runs with fully structured labeled fields (Run #, Date, Hare, Run site, GPS, Google Maps, Waze). `stripHtmlTags(html, "\n")` yields one "Label: value" per line; parse with anchors on "Run #:". Adapter at `src/adapters/html-scraper/mother-hash.ts`. Chrome verification caught this — the Stage-2 research assumed Google Sites was sourceless. **Always run Chrome verification before classifying a kennel as "no scrapeable source".**
89. **goHash.app is a shared-adapter platform** — React SSR SaaS used by multiple hash kennels (Penang H3, HHH Penang discovered in PR #570; expect more across SEA/Oceania). Signals: footer "powered by gohash.app", asset domain `assets.gohash.app`, `<script>window.__INITIAL_STATE__ = {...}</script>` in the HTML. Data at `__INITIAL_STATE__.runs.runs[]`. One shared adapter at `src/adapters/html-scraper/gohash.ts` covers all of them config-driven. Also has SportsEvent ld+json fallback.
90. **Yii GridView hareline is a shared-adapter platform** — Multiple Malaysian kennels (PH3, KL Full Moon) self-host a Yii Framework PHP app with identical `/index.php?r=site/hareline` server-rendered GridView tables. Footer says "Powered by Yii Framework". Pagination is ASCENDING (page 1 = oldest rows) so `YiiHarelineAdapter` fetches page 1 to discover `maxPage`, then the last N pages for the scrape window. N auto-scales from `options.days`: `Math.max(2, Math.ceil((days / 7) * 1.5 / 13))`. One shared adapter at `src/adapters/html-scraper/yii-hareline.ts`. Full historical backfill via page-iteration script (`scripts/backfill-ph3-history.ts`).
91. **Canonical sourceUrl for backfills** — When a historical backfill script fetches per-page URLs (e.g. `?page=N`), pass the canonical base URL (not the paginated URL) into the shared parser. `generateFingerprint()` in `src/pipeline/fingerprint.ts` hashes `sourceUrl`, so mismatched URLs between recurring scrape and backfill produce different fingerprints for the same event → duplicate RawEvents. Reference: `scripts/backfill-ph3-history.ts` calls `parseYiiHarelinePage($, CONFIG, BASE_URL)` not `buildYiiPageUrl(baseUrl, pageNum)`.
92. **Ship unverified sources with `enabled: false`** — When the adapter passes unit tests but the live origin is unreachable during the build window (regional outage, hosting blip), seed the SOURCE with `enabled: false` and flip to `true` manually after the first successful post-merge scrape. Don't block the whole PR waiting for the origin to come back — other verified adapters in the same PR shouldn't be held hostage. Don't ship with `enabled: true` and a "we'll watch it" comment — that lets the reconciler cancel events on the first failing scrape. Reference: PR #570 shipped Petaling H3, KL Full Moon, and KL Junior H3 gated this way after the MY origins went unreachable.
93. **Malaysia is the birthplace of hashing** — Mother Hash (KL 1938) is the first hash kennel ever. Malaysia Phase 1 (PR #570) shipped 7 kennels: Mother Hash + Petaling H3 (1977) + KL Full Moon (1992) + KL Junior H3 (1982) + Penang H3 (1965) + HHH Penang (1972) + Kelana Jaya Harimau (1996). 4 live-verified, 3 gated. ~150+ Malaysian kennels remain Facebook-only and await a Phase 2 "Historic Regionals" STATIC_SCHEDULE pass (KKH3 1964, Kuching 1963, JBH3 1969, Ipoh 1965, etc.).
94. **Kuala Lumpur is a Federal Territory** — administratively state-equivalent like DC vs Maryland, NOT a metro inside Selangor. In `src/lib/region.ts`, `Kuala Lumpur, MY` is `level: "STATE_PROVINCE"` and in `STATE_GROUP_MAP` it maps to itself (`"Kuala Lumpur, MY": "Kuala Lumpur, MY"`). Selangor stays separate for actual suburb kennels (Petaling Jaya, Kelana Jaya, Subang). Verify the administrative status of Malaysian locales before parenting to a state — Putrajaya and Labuan are also Federal Territories.
95. **State abbreviations collide across countries** — AU state codes (`WA`, `SA`, `NT`, `ACT`) can collide with US state codes (`WA` = Washington) or other internal region keys. Never add 2-letter abbreviations to `inferCountry()` regex or as `REGION_SEED_DATA` aliases without first grepping all existing regions. The `REGION_MAP.set(alias, entry)` overwrites silently — WA was flipped from Washington to Western Australia until codex caught it (PR #594). Fix: use only full state/city names in `inferCountry()`, use country-qualified alias forms like `"Western Australia, Australia"`, and use `"W.Aus"` abbrev instead of `"WA"`.
96. **WordPress `admin-ajax.php` can be a clean JSON API** — Adelaide H3 uses the Ajax Event Calendar plugin's `action=get_events` endpoint (`POST /wp-admin/admin-ajax.php` with Unix-timestamp `start`/`end` params), which returns a clean JSON array. No auth/nonce/referer needed. Better than scraping the sidebar widget. The `className` field (`cat1`/`cat4`) is NOT a filter — both categories are real runs. Adapter at `src/adapters/html-scraper/adelaide-h3.ts`. Check for this pattern whenever a WordPress site has events that aren't in posts or pages.
97. **Google Sites content is often in the initial HTML** — Sydney Thirsty H3's Google Sites page was assumed to need `fetchBrowserRenderedPage()` because Google Sites is a JS-heavy framework, but Chrome verification proved the event content is server-rendered into the HTML and visible to Cheerio. Always test `document.body.innerText.length` at T=0 vs T=3s before reaching for browser-render — if no growth, Cheerio works. Reference: `src/adapters/html-scraper/sydney-thirsty-h3.ts`.
98. **SSR DataTables are Cheerio-safe** — Sydney Larrikins uses a DataTables-styled `<table>` with pagination controls, but all 19 `<tr>` rows are present in the initial HTML (SSR, not AJAX). Chrome detection: `document.querySelectorAll('table tbody tr').length` at page load shows the full row count. If DataTables is AJAX-backed, the `<tbody>` starts empty and rows arrive via fetch — Chrome can test `jQuery(table).DataTable().ajax?.url?.()` to distinguish. Reference: `src/adapters/html-scraper/larrikins.ts`.
99. **Multi-run event blocks require array return types** — Sydney Thirsty H3 publishes AGPU-style multi-day specials as "Runs (Sat and Sun) 1843 & 1844" — a single block with two run numbers. Codex caught that the parser was dropping these because it required a singular `Run #NNNN` line. Fix: parse the alternate `Runs N & M` regex and return `RawEventData[]` instead of `RawEventData | null`, emitting one event per run number. For multi-day specials (e.g. "Sat and Sun"), offset the date for the second run (+1 day) to avoid fingerprint collisions — two events with the same kennel + date deduplicate in the merge pipeline. Test the alternate format explicitly.
100. **hhh.asn.au is the Australian national kennel directory** — static HTML-frameset site listing ~220 AU kennels across 14 state-page codes with URLs and schedules. No other aggregator covers Australia — Harrier Central has zero AU kennels, HashRego has zero, Half-Mind explicitly excludes AU/Asia. Use `hhh.asn.au` as the primary Stage-2 discovery source for any AU region research. Cross-reference with `genealogy.gotothehash.net` for founding dates and aliases (195 historical AU records).
101. **Chrome verification is mandatory, not optional** — the Australia research pass classified 9 kennels as "ready to ship" but Chrome verification proved 4 were wrong (dead Meetup groups, wrong URLs, wrong source types), and discovered 3 additional kennels not in the original research. Only 2 of the original 9 shipped as-planned (with URL corrections). Without Chrome verification, the PR would have shipped 4 non-functional sources. Always run Chrome verification before committing to an implementation plan.
102. **Seasonal schedule switching uses two STATIC_SCHEDULE sources with disjoint `BYMONTH`** — kennels that change run day with the seasons (e.g. NOSE H3: summer Thursday May–Oct / winter Wednesday Nov–Apr) ship as two `STATIC_SCHEDULE` sources sharing one `kennelTag`. Reference NOSE H3 in `prisma/seed-data/sources.ts` lines 184–214 and the step-6 example. NOSE is the only validated case in the repo today; if a future onboarding case requires this pattern, follow the same shape. A single-source `seasons` schema was considered and rejected — see [`facebook-integration-strategy.md`](facebook-integration-strategy.md) decision log entry 2026-04-30 for the full rationale.

---

## Automation Opportunities

Status of automation features — many originally "future" items are now partially or fully implemented:

1. **Source discovery** ✅: Source type auto-detection from URL in admin wizard (`src/lib/source-detect.ts`); autonomous source research pipeline with Gemini search grounding discovers URLs per region (`src/pipeline/source-research.ts`)
2. **HTML structure analysis** ✅: AI-assisted HTML parsing via Gemini column mapping + container detection (`src/pipeline/html-analysis.ts`); few-shot learning from 7 existing adapter patterns (`src/adapters/html-scraper/examples.ts`)
3. **Config generation** ✅: AI-suggested config for Meetup (kennelTag from sample events), Calendar/iCal (kennelPatterns from SUMMARY analysis), Google Sheets (column auto-detection via Gemini)
4. **Kennel tag extraction** ✅: AI-powered kennel pattern suggestions in source onboarding wizard; fuzzy matching in kennel resolver with alias + pattern fallback
5. **Test generation**: Auto-generate test fixtures from real scrape samples — not yet implemented
6. **Health monitoring** ✅: Rolling-window health analysis with 6 alert types; structure hash fingerprinting detects HTML changes; auto-resolve for stable structural changes
7. **Self-healing** ✅: Alert pipeline → auto-file GitHub issues → Claude AI triage → high-confidence auto-fix PRs → CI validates → human reviews. Safe zone: adapters, seed.ts, test files only; rate-limited to 5 PRs/day.
8. **Chrome-assisted regional discovery** ✅: 3-stage workflow using Claude in Chrome for autonomous site verification, Calendar ID extraction, and metadata scraping. See `docs/regional-research-prompt.md`. First used for Oregon (12 kennels, single session, zero new code).
