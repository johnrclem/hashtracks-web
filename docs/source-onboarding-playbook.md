# Source Onboarding Playbook

How to add a new data source to HashTracks. This playbook captures patterns learned from onboarding our first three sources.

---

## The Reusable Pipeline (same every time)

Every source flows through the same pipeline regardless of adapter type:

```
Source → Adapter.fetch() → RawEventData[] → fingerprint dedup → RawEvent (immutable)
                                                ↓
                                        kennel resolver → Event upsert
```

- **Fingerprint dedup**: SHA-256 of `date|kennelTag|runNumber|title` prevents duplicate RawEvents
- **Kennel resolver**: `shortName exact match → alias case-insensitive → pattern fallback → flag unmatched`
- **ScrapeLog**: Every scrape run is audited with timing, event counts, and error details
- **Force rescrape**: `force` param deletes existing RawEvents and re-processes from scratch
- **`RawEventData`** is the universal contract between any adapter and the pipeline

## What Varies Per Source (the adapter-specific work)

| Concern | HTML Scraper | Google Calendar | Google Sheets |
|---------|-------------|----------------|--------------|
| Data access | HTTP GET + Cheerio parse | Calendar API v3 | Sheets API (tabs) + CSV export (data) |
| Auth needed | None | API key | API key (tab discovery only) |
| Kennel tags | Regex patterns on event text | Regex on SUMMARY (multi-kennel) or `config.defaultKennelTag` (single-kennel) | Column-based rules from config JSON |
| Date format | Row IDs like "2024oct30" | ISO 8601 timestamps | Multi-format: M-D-YY, M/D/YYYY |
| Routing | URL-based (`htmlScrapersByUrl` in registry) | Shared adapter (single class) | Shared adapter (config-driven) |
| Complexity | High (structural HTML, site-specific) | Medium (clean API) | Low (column mapping) |

---

## Step-by-Step Checklist

Do this every time you add a new source:

### 1. Analyze the data FIRST

Fetch real data before writing any code. Examine structure, identify field mappings, understand edge cases.

**For HTML sources:**
```bash
curl -s "https://example.com/?days=30" | head -200
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
- `HTML_SCRAPER` — For websites with event tables/lists (Cheerio parsing)
- `GOOGLE_CALENDAR` — For Google Calendar API v3 feeds
- `GOOGLE_SHEETS` — For published Google Sheets (config-driven, reusable without code changes)

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

**For new adapter types:**
- Implement the `SourceAdapter` interface: `{ type, fetch(source, options?) }`
- Return `{ events: RawEventData[], errors: string[] }`
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
  kennelShortNames: [...], // linked kennels
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
  - `src/adapters/google-calendar/adapter.ts` — reused with `defaultKennelTag` config
  - `src/adapters/html-scraper/bfm.ts` — WordPress site: current trail + special events page
  - `src/adapters/html-scraper/hashphilly.ts` — simple label:value page, one event at a time
- **Multi-source strategy**: Calendar provides schedule backbone; website scraper enriches with location, hares, trail numbers. Merge pipeline deduplicates via fingerprint.
- **Key lesson**: WordPress Gutenberg text runs together without newlines — use known field labels (`When:`, `Where:`, `Hare:`) as delimiters via lookahead regex, not `\n`
- **Key lesson**: `defaultKennelTag` in `Source.config` avoids hardcoding kennel patterns for single-kennel calendars — zero code change to add another single-kennel calendar
- **Key lesson**: URL-based routing in the adapter registry (`htmlScrapersByUrl`) allows multiple HTML scrapers to coexist under the same `HTML_SCRAPER` source type
- **Key lesson**: Instagram scraping is not viable (auth required, ToS violation, actively blocked) — manual CSV import is the practical backfill approach
- **Key lesson**: Some sites only show one event (hashphilly.com/nexthash/) — still worth scraping for fields the calendar lacks (trail number, venue name)

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
9. **`defaultKennelTag` config** eliminates per-calendar regex patterns for single-kennel calendars
10. **URL-based adapter routing** (`htmlScrapersByUrl` in registry) scales HTML_SCRAPER to multiple sites
11. **Multi-source enrichment** works well — calendar for schedule, website for details, merge pipeline handles dedup
