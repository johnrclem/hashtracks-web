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
- **kennelTags:** `RawEventData.kennelTags` is `string[]` (not a single tag — see PR #1105 / multi-kennel co-host spec). Always emit at least one entry. Single-kennel events: `kennelTags: [config.kennelTag]` or `kennelTags: ["nych3"]`. Multi-kennel co-hosts (Cherry City × OH3 joint trail, etc.): emit all tags; the merge pipeline writes the first as primary `EventKennel` and the rest as secondaries (`isPrimary=false`). Use `kennelCode` strings for stable resolution, not display names.
- **Registration:** Add to `src/adapters/registry.ts`

## Shared Utilities — Check Before Writing Similar Logic
The codebase has accumulated several shared helpers that adapter authors keep reinventing. Before adding regex or parsing logic to a new adapter, search these:

- **`src/adapters/utils.ts`** — `extractHashRunNumber` (`#NNN` parser with delimiter guard, see PR #1147), `chronoParseDate` (chrono wrapper with the `D MMM YY` fast-path baked in — see chrono pitfall below), `applyWeekdayShift` (pure helper for shifting dates onto a target weekday — see #1123), date utilities, field extraction.
- **`src/adapters/hare-extraction.ts`** — exports `extractHares` and `PHONE_TRAILING_RE`. Lifted out of the GCal adapter in #1215; Meetup and Phoenix HHH both import from here. The internal `DEFAULT_HARE_PATTERNS` constant is used as the fallback inside `extractHares`; pass a custom `customPatterns` array if your source needs different shapes.
- **`src/adapters/kennel-patterns.ts`** — `matchKennelPatterns(text, patterns)` implements the spec D15 precedence rule: array-typed values (`["pattern", ["kennelA", "kennelB"]]`) always win once one matches; string-only configs preserve legacy first-match-wins. Use this for any multi-source config.
- **`src/adapters/blogger-api.ts`** — `fetchBloggerPosts()` for Blogspot-hosted sites (bypasses cloud-IP 403 blocking).
- **`src/adapters/wordpress-api.ts`** — `fetchWordPressPosts()` for self-hosted WordPress REST API.
- **`src/adapters/html-scraper/gohash.ts`** — shared parser for goHash.app SaaS sites (Penang H3, HHH Penang).
- **`src/adapters/html-scraper/yii-hareline.ts`** — shared parser for Yii GridView hareline pages (Petaling H3, KL Full Moon).
- **`src/lib/geo.ts`** — `parseDMSFromLocation` (decimal + DMS coordinate parsing — used by GAL geocoder fix in #1195).
- **`src/lib/timezone.ts`** — IANA TZ utilities (`composeUtcStart`, `formatTimeInZone`).

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
- **`D MMM YY` mis-parse with chrono-node** — chrono mis-parses single-digit-day variants of the unambiguous "D MMM YY" format: `5 May 26` returns `2026-05-26` (treats year fragment as day) instead of `2026-05-05`. The Ladies H4 sawtooth bug in #1067 ate every first-of-month date. This is handled automatically by `chronoParseDate()` in `src/adapters/utils.ts` via the internal `parseDmyAbbrevDate` fast-path — adapters that already use `chronoParseDate` get the fix for free; adapters that call `chrono.parseDate()` directly should switch to the wrapper.
- **`utcRef()` helpers must not blindly append `Z`** — Blogger and self-hosted WordPress publish dates carry explicit offsets like `2026-03-22T18:07:00+07:00`. Appending `"Z"` to that produces `2026-03-22T18:07:00+07:00Z` → `Invalid Date`. Reference: CRH3 / CAH3 fix in #1076. Use `iso.endsWith("Z") ? iso : (iso.match(/[+-]\d\d:\d\d$/) ? iso : iso + "Z")` or trust the source string verbatim.
- **Title fallback must never be the hare name** — Adapters that lack an explicit title field should leave `title` undefined and let `merge.ts` synthesize `"<KennelName> Trail #N"` via `friendlyKennelName`. Setting `title = haresText` (Chiang Mai #1058) causes hare names to appear as event titles on the card and detail page, with no way to recover after the row persists. Reference fix: `parseChiangMaiLine` in #1084 plus the per-PR `scripts/backfill-chiangmai-titles.ts` cleanup.
- **Trust the canonical-detail page date over a calendar grid** — DFW Hash (#1218) had a multi-page layout where the calendar grid date and the detail-page `<h2>Wednesday, April 22, 2026</h2>` heading sometimes disagreed because the grid drifted on multi-day cells. The detail page is canonical; trust it and `console.warn` on mismatches so future drift surfaces in scrape logs (`extractDetailPageDate` in `dfw-hash.ts`).
- **Placeholder / CTA / boilerplate leakage hygiene** — Source authors put generic banner text (kennel slogans, "Hare needed", neighborhood names like "Ikebukuro" / "Akabane", quoted theme captions) where adapters expect structured data. Without a per-source guard, this leakage ends up as `title` / `locationName` / `haresText`. Pattern: introduce per-source config knobs and apply them after extraction:
  - **`staleTitleAliases`** (#1166, #1125) — list of known placeholders that map to the synthesized default title. GCal's Space City (#1125) and Tokyo HC (#1166) ship 22+ entries each.
  - **`titleStripPatterns`** (#1189) — regexes that strip emoji/decoration prefixes before the title is committed.
  - **`titleHarePattern`** (#981, #1125) — per-source regex capturing hares from varied prefix forms (`-Hare-`, `-Haré-`, `DWH-`, `with X`).
  - **`locationOmitIfMatches`** (#1183 / #1238) — case-insensitive list; matched locations drop to `undefined` so the UI renders "venue TBD" instead of leaking CTA copy.
  - **CTA filters at fetch time** (`CTA_EMBEDDED_PATTERNS` in `google-calendar/adapter.ts`, #1123) — strip placeholder titles like `"DST # - Hare Needed"` before merge.
  - When designing a new adapter, scan the source's HTML for repeating banner / nav / CTA strings and pre-empt them with these knobs rather than letting them surface in production.
- **GCal `includeAllDayEvents: true` is opt-in per source** — The Google Calendar adapter filters all-day events by default (most sources publish runs with explicit start times). Calendars that publish *only* all-day events (Eugene H3, Fort Collins's "Rex Manning Day", CUNTh's overrides) need `includeAllDayEvents: true` in the source config or every event is silently dropped. Reference: #1075 / #1149 / #1188.
- **GCal RECURRENCE-ID overrides on non-recurring masters require a second `singleEvents=false` pass** — `singleEvents=true` expands RRULE recurrences but silently drops orphan exception overrides (the epoch `19691231T160000` pattern Google uses). CUNTh had 47 of 91 events invisible until #1075 added a secondary `singleEvents=false` API call wrapped in `try/catch` that filters to override exceptions only. Pattern documented in `google-calendar/adapter.ts` `#fetchAllPages`.
- **FB hosted_events SSR shape rotates; the parser must pin to ≤5 fields** — The FACEBOOK_HOSTED_EVENTS adapter parses the GraphQL JSON island in `<script type="application/json">` tags. FB rotates the shape periodically (acknowledged in `docs/facebook-integration-strategy.md`); pinning to a small surface (`__typename:Event`, `id`, `name`, `start_timestamp`, `event_place.contextual_name`, `is_canceled`) keeps the parser robust. Each event is split across TWO related nodes that share the same `id` — a "rich" node with `__typename:Event` (name/event_place) and a "time" node (start_timestamp/is_past). The parser merges by id; both halves must be present to emit. The required request headers are `User-Agent` (browser) + `Sec-Fetch-Dest: document` + `Sec-Fetch-Mode: navigate` + `Sec-Fetch-Site: none` — missing the `Sec-Fetch-*` triplet returns HTTP 400. Reference: `src/adapters/facebook-hosted-events/`.

## Reference Adapters (good starting points)
- Simple single-kennel UK: `src/adapters/html-scraper/barnes-hash.ts`
- Div-card layout: `src/adapters/html-scraper/city-hash.ts`
- Table layout: `src/adapters/html-scraper/dublin-hash.ts`
- Few-shot examples: `src/adapters/html-scraper/examples.ts`
