# Source Onboarding Playbook

How to add a new data source to HashTracks. This playbook captures patterns learned from onboarding 15 sources across 5 adapter types.

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

| Concern | HTML Scraper | Google Calendar | Google Sheets | iCal Feed | Blogger API |
|---------|-------------|----------------|--------------|-----------|-------------|
| Data access | HTTP GET + Cheerio parse | Calendar API v3 | Sheets API (tabs) + CSV export (data) | HTTP GET + node-ical parse | Blogger API v3 (blog ID discovery + posts endpoint) |
| Auth needed | None | API key | API key (tab discovery only) | None | API key (same `GOOGLE_CALENDAR_API_KEY`) |
| Kennel tags | Regex patterns on event text | `config.kennelPatterns` (multi-kennel) or `config.defaultKennelTag` (single-kennel) or hardcoded SUMMARY regex (Boston) | Column-based rules from config JSON | `config.kennelPatterns` (regex on SUMMARY) or `config.defaultKennelTag` | Hardcoded per adapter (single-kennel Blogspot blogs) |
| Date format | Site-specific (ordinals, DD/MM/YYYY, US dates) | ISO 8601 timestamps | Multi-format: M-D-YY, M/D/YYYY | ISO 8601 / DTSTART | API returns ISO 8601 `published`; post body parsed with site-specific logic |
| Routing | URL-based (`htmlScrapersByUrl` in registry) | Shared adapter (single class) | Shared adapter (config-driven) | Shared adapter (config-driven) | URL-based (reuses `htmlScrapersByUrl` routing, Blogger API is primary fetch with HTML fallback) |
| Complexity | High (structural HTML, site-specific) | Medium (clean API) | Low (column mapping) | Low-Medium (config-driven, but iCal quirks) | Medium (shared `fetchBloggerPosts()` utility + site-specific body parsing) |

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
- `HTML_SCRAPER` — For websites with event tables/lists (Cheerio parsing). Each site gets its own adapter class, routed by URL pattern in `htmlScrapersByUrl`. Currently: hashnyc, bfm, hashphilly, cityhash, westlondonhash, londonhash.
- `HTML_SCRAPER` (Blogger API) — For Blogger/Blogspot-hosted sites. Uses Blogger API v3 as primary fetch method with HTML scraping fallback. The adapter is still registered as `HTML_SCRAPER` and routed via `htmlScrapersByUrl`, but internally calls `fetchBloggerPosts()` from `src/adapters/blogger-api.ts`. Currently: enfieldhash.org (EH3), ofh3.com (OFH3). **Prerequisite**: Enable the Blogger API in GCP Console and use the same `GOOGLE_CALENDAR_API_KEY`.
- `GOOGLE_CALENDAR` — For Google Calendar API v3 feeds. Single shared adapter, configured via `Source.config` JSON (kennelPatterns, defaultKennelTag). Currently: Boston, BFM, Philly, Chicagoland, EWH3, SHITH3.
- `GOOGLE_SHEETS` — For published Google Sheets (config-driven, reusable without code changes). Column mappings, kennel tag rules, start time rules in `Source.config`. Currently: Summit H3, W3H3.
- `ICAL_FEED` — For standard iCal (.ics) feeds via `node-ical`. Config-driven kennelPatterns + skipPatterns. Currently: SFH3 MultiHash aggregator.

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
- **Coverage**: CityH3 (cityhash.org.uk), WLH3 (westlondonhash.com), LH3 (londonhash.org)
- **Adapters**:
  - `src/adapters/html-scraper/city-hash.ts` — CSS-class-based cards (`.ch-run`, `.ch-run-title`, etc.)
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

### Sources #13-14: Enfield Hash + OFH3 (Blogger API — Blogspot sites)

- **Type**: `HTML_SCRAPER` (internally uses Blogger API v3 with HTML scraping fallback)
- **Coverage**: EH3 (enfieldhash.org — London), OFH3 (ofh3.com — DC/Frederick area)
- **Adapters**:
  - `src/adapters/html-scraper/enfield-hash.ts` — Monthly UK hash (3rd Wednesday, 7:30 PM), parses Date/Pub/Station/Hare labels
  - `src/adapters/html-scraper/ofh3.ts` — Monthly US hash, parses Hares/When/Cost/Where/Trail Type/Shiggy/On-After labels
- **Shared utility**: `src/adapters/blogger-api.ts` — `fetchBloggerPosts()` discovers blog ID, fetches posts via Blogger API v3
- **Why Blogger API**: Google/Blogger blocks server-side requests from cloud provider IPs (Vercel, AWS, etc.) with HTTP 403 Forbidden. The Blogger API v3 authenticates via API key and bypasses this IP-based blocking.
- **Fallback**: If the Blogger API is unavailable (missing API key, API not enabled), both adapters fall back to direct HTML scraping
- **Prerequisites**: Enable the Blogger API in GCP Console (https://console.cloud.google.com/apis/library/blogger.googleapis.com). Uses the same `GOOGLE_CALENDAR_API_KEY` — no new env var needed.
- **Diagnostics**: `diagnosticContext.fetchMethod` indicates `"blogger-api"` or `"html-scrape"` to show which path was used
- **Key lesson**: Blogger/Blogspot sites should always use the Blogger API v3 — direct HTML scraping will fail from cloud-hosted servers
- **Key lesson**: The Blogger API returns post body as HTML in the `content` field, so existing Cheerio-based body parsers work unchanged — just load `post.content` instead of scraping the full page
- **Key lesson**: Blog ID discovery (`/blogs/byurl`) needs to happen before posts can be fetched — build this into the shared utility, not per-adapter

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
