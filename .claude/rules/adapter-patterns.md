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
- **WordPress REST API** (`HTML_SCRAPER`): For **self-hosted** WordPress sites. Use `fetchWordPressPosts()` from `src/adapters/wordpress-api.ts`.
- **WordPress.com Public API** (`HTML_SCRAPER`): For blogs hosted on wordpress.com (self-hosted `/wp-json/` returns 404). Use `fetchWordPressComPage(domain, slug)` or `fetchWordPressComPosts(domain, opts)` — hits `public-api.wordpress.com/rest/v1.1/sites/{domain}/posts/`. Page-by-slug uses `posts/slug:<slug>` (note: `posts/`, not `pages/`).
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

## Optional User-Visible Fields (Capture When Available)
Adapter authors should opportunistically populate these when the source exposes them — every one of them surfaces on the event card or detail panel and materially improves the listing:

- **`hares`** — comma-separated hare names (sanitized in merge pipeline)
- **`location`** / **`locationStreet`** / **`locationUrl`** — venue name, full street address, Google Maps URL
- **`startTime`** — `"HH:MM"` local time string (NOT a DateTime; see Conventions)
- **`endTime`** — `"HH:MM"`, same convention
- **`cost`** — free-form cost text, e.g. `"$10"`, `"$5 cash / $10 card"`, `"Free for virgins"`
- **`description`** — free-form prose (event blurb, theme, what to bring, on-after venue, station info)
- **`trailLengthText`** + **`trailLengthMinMiles`** + **`trailLengthMaxMiles`** — verbatim source string + parsed bounds (e.g. `"3-5 Miles"` → `text="3-5 Miles", min=3, max=5`; `"2.69"` → `text="2.69", min=max=2.69`). UI prefers `text` for display; min/max enables future filter/sort.
- **`difficulty`** — Shiggy Scale 1–5 (UI label is "Shiggy Level"). Adapter must validate range; reject anything outside 1–5 with `null` (see atomic-bundle semantics below).

**Atomic-bundle semantics for `trailLengthText` / `min` / `max` and `difficulty`:**
The merge pipeline treats `undefined` as "preserve existing" and `null` as "explicit clear". When an adapter sees a label with an unparseable value (e.g. `Length: TBD` or `Shiggy Scale: 7`), it must emit explicit `null` for the affected numeric fields rather than `undefined`. Without this, a transition like `3-5 Miles → TBD` leaves stale `min=3, max=5` wired to fresh `text="TBD"` (silent corruption — Codex caught this on PR #1266). Reference pattern: `parseTrailLength` + `parseShiggyScale` in `burlington-hash.ts`.

## Testing Pattern
- Test file lives next to source: `{adapter}.test.ts`
- Save representative HTML as a string constant fixture
- Test the parse function directly with the fixture
- Verify: correct date extraction (UTC noon), field mapping, edge cases
- Use factories from `src/test/factories.ts`

## Pitfalls Checklist (learned the hard way)
- **Honor `options.days`** — filter events through `buildDateWindow(options?.days ?? <default>)`. Never destructure as `_options` and ignore. Exception: GOOGLE_CALENDAR (API caps its own window). Reference: `seletar-h3.ts` fetch() post-PR #535.
- **Default window wide when source is a full-archive single feed** — e.g. Hash Horrors hareline page contains runs back to 2009; default to `365 * 20` so history isn't thrown away every scrape.
- **Sort multi-value joined fields (hares, tags, scribes)** before `join(", ")` — nondeterministic API row order otherwise produces fresh fingerprints per scrape and breaks idempotency. Seletar re-run inserted 74 dup RawEvents before PR #541 fixed it with `[...names].sort((a, b) => a.localeCompare(b)).join(", ")`.
- **Validate payload shape at runtime** — don't trust `as Row[]` type assertions. A 200 with a malformed body (HTML error page, `{status:"1"}`, non-array) must NOT silently succeed — the reconciler will cancel live events on empty rows.
- **Whitelist PII in error diagnostics** — never `JSON.stringify(row)` a row from a participant-returning API; write a `safeRowSample()` that lists non-PII fields explicitly. TS interface narrowing is compile-time only and does NOT filter the runtime object. Reference: `safeRowSample()` in `seletar-h3.ts`.
- **PWA backends often expose open JSON APIs** — before falling back to browser-render, inspect the bundled `main.js` in DevTools for fetch signatures. Seletar's `HashController.php` REST-over-SQL endpoint was discovered this way and unlocked the full 1980→present archive.
- **Historical backfill uses strict date partitioning** — adapter `>= CURDATE()`, backfill `< CURDATE()`, never overlap. Makes the one-shot script safe to re-run with no dedup index. Reference: `HISTORICAL_SQL` in `seletar-h3.ts` + `scripts/backfill-seletar-h3-history.ts`.
- **SonarCloud regex complexity ≤ 20** — prefer multi-pass tokenizers (find section boundaries with a simple regex, then per-section line parsing) over a single regex with alternation + lookahead. Reference: two-pass `findYearHeadings` + `findRunLineStarts` in `hash-horrors.ts`.
- **Sonar S5852 (ReDoS) flags any nested `\s*` in regex alternation** — even when linear in practice. The PR #1266 unit-strip regex went through 3 rewrites before passing: `/\s*\(?\s*miles?\s*\)?\s*$/i` → `/(?:\(miles?\)|miles?|mi)\s*$/i` → procedural `endsWith` loop over a longest-first unit list. When a regex would have any `\s*` adjacent to an alternation group, prefer string operations (`endsWith` / `startsWith` / `slice`) over fighting the analyzer. Reference: `stripTrailingUnit` + `TRAIL_LENGTH_UNITS` in `burlington-hash.ts`.
- **Sonar S5843 regex-complexity bumps fire fast on terminator alternations** — every `\s*` quantifier and every alternation branch counts. The threshold is 20. Reference fix: split `FIELD_TERMINATORS_RE` into three smaller regexes (`FIELD_LABEL_RE`, `FIELD_KEYWORD_RE`, `PARAGRAPH_BREAK_RE`) and use `Math.min()` of their match indices via `findFirstTerminatorIndex()` in `burlington-hash.ts`.

## Reference Adapters (good starting points)
- Simple single-kennel UK: `src/adapters/html-scraper/barnes-hash.ts`
- Div-card layout: `src/adapters/html-scraper/city-hash.ts`
- Table layout: `src/adapters/html-scraper/dublin-hash.ts`
- Few-shot examples: `src/adapters/html-scraper/examples.ts`
