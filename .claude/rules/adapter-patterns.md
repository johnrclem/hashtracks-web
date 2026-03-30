---
description: Adapter coding conventions, SourceAdapter interface patterns, and scraping best practices
globs:
  - src/adapters/**
---

# Adapter Patterns & Conventions

## SourceAdapter Interface
All adapters implement `SourceAdapter` from `src/adapters/types.ts`. The `fetch(source, options?)` method returns `Promise<ScrapeResult>`, with parsed events in `ScrapeResult.events`.

## Adapter Types
- **Cheerio** (`HTML_SCRAPER`): For static HTML sites. Use `cheerio.load(html)` for parsing.
- **browserRender()** (`HTML_SCRAPER`): For JS-rendered sites (Wix, Google Sites, SPAs). Calls NAS Playwright service. Supports `frameUrl` for cross-origin iframe content.
- **Blogger API** (`HTML_SCRAPER`): For Blogspot-hosted sites. Use `fetchBloggerPosts()` from `src/adapters/blogger-api.ts`.
- **WordPress REST API** (`HTML_SCRAPER`): For WordPress sites. Use `fetchWordPressPosts()` from `src/adapters/wordpress-api.ts`.
- **GenericHtmlAdapter** (`HTML_SCRAPER`): Config-driven CSS selector scraping. No code needed -- just JSON config.
- **Google Calendar** (`GOOGLE_CALENDAR`): Uses Calendar API v3. Multi-kennel calendars use `kennelPatterns` config.
- **Google Sheets** (`GOOGLE_SHEETS`): CSV export parsing. Config-driven column mapping.
- **iCal** (`ICAL_FEED`): Standard .ics feeds via `node-ical`.
- **Meetup** (`MEETUP`): Public REST API. Auto-detects `groupUrlname`.
- **Hash Rego** (`HASHREGO`): hashrego.com scraping with multi-day event splitting.
- **Static Schedule** (`STATIC_SCHEDULE`): RRULE-based event generation. No external fetch.

## Required Conventions
- **Dates:** Store as UTC noon (`new Date(Date.UTC(year, month-1, day, 12, 0, 0))`) to avoid DST issues
- **Times:** `startTime` is a string `"HH:MM"`, not a DateTime
- **IDs:** Use `cuid()` for all generated IDs
- **kennelTag:** Use `kennelCode` from seed data for stable resolution (not display names)
- **Registration:** Add to `src/adapters/registry.ts`

## Testing Pattern
- Test file lives next to source: `{adapter}.test.ts`
- Save representative HTML as a string constant fixture
- Test the parse function directly with the fixture
- Verify: correct date extraction (UTC noon), field mapping, edge cases
- Use factories from `src/test/factories.ts`

## Reference Adapters (good starting points)
- Simple single-kennel UK: `src/adapters/html-scraper/barnes-hash.ts`
- Div-card layout: `src/adapters/html-scraper/city-hash.ts`
- Table layout: `src/adapters/html-scraper/dublin-hash.ts`
- Few-shot examples: `src/adapters/html-scraper/examples.ts`
