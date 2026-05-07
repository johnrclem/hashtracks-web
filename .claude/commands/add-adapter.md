Create a new HTML scraper adapter for the source at URL: $ARGUMENTS

## Steps

1. **Analyze the source HTML**
   - Fetch the URL with `curl -s` and examine the HTML structure
   - Identify: date format, event container elements, field locations (title, hares, location, time, run number)
   - Determine date locale (en-US vs en-GB) and any timezone considerations
   - **Scan for high-value optional fields** — many sources expose enrichment data adapter authors miss because they aren't in the "core" mental model. If the source lists any of the following, capture them as `RawEventData` fields (see [`adapter-patterns.md`](../rules/adapter-patterns.md) for the contract):
     - **Distance / trail length** (e.g. "Length: 3-5 Miles", "Distance: 2.69 mi", "13 km") → `trailLengthText` + parsed `trailLengthMinMiles` / `trailLengthMaxMiles`
     - **Shiggy Scale / difficulty** (typically 1–5; sometimes "🌶️🌶️🌶️" or "easy/medium/hard") → `difficulty` (validated 1–5; reject anything else with explicit `null`)
     - **Cost / hash cash** (e.g. "Cost: $5", "$10 cash / $15 card") → `cost`
     - **Free-form description** (theme, on-after venue, what to bring, station info) → `description`
     - **Full street address** (vs. just venue name) → `locationStreet`
     - **End time** → `endTime`
   - These all surface on the event card or detail panel (see `EventCard.tsx` / `EventDetailPanel.tsx` / `[eventId]/page.tsx`). Capturing them at adapter time is much cheaper than re-scraping later.

2. **Create the adapter file**
   - File: `src/adapters/html-scraper/{name}.ts`
   - Implement the `SourceAdapter` interface from `src/adapters/types.ts`
   - Return `RawEventData[]` with at minimum: `date`, `kennelTag` (use kennelCode from seed data for stable resolution)
   - Follow existing patterns — see simple examples:
     - `src/adapters/html-scraper/barnes-hash.ts` (single kennel, UK dates)
     - `src/adapters/html-scraper/city-hash.ts` (div-card layout)
     - `src/adapters/html-scraper/dublin-hash.ts` (table layout)

3. **Create the test file**
   - File: `src/adapters/html-scraper/{name}.test.ts`
   - Save a representative HTML fixture as a string constant
   - Test the parsing function directly with the fixture
   - Verify: correct date extraction (UTC noon), field mapping, edge cases

4. **Register the adapter**
   - Add to `src/adapters/registry.ts` (follow existing patterns)

5. **Add seed data**
   - Add Source record to `prisma/seed.ts` with correct SourceType
   - Add SourceKennel linking record(s)
   - Add Kennel record if it doesn't exist (with aliases)

6. **Unit tests**
   - Run `npx vitest {test-file}` to verify the new adapter
   - Run `npm test` to ensure no regressions

7. **Live verification (MANDATORY)**
   - Resolve the source URL from `prisma/seed-data/sources.ts` (the URL you added in step 5)
   - Fetch the real production URL: `curl -s "$URL"` (or `browserRender()` for JS-rendered sites)
   - Run the adapter's `fetch()` method against the live data
   - Verify: events array is non-empty, dates are valid with upcoming events, required fields populated
   - If live HTML differs from test fixture, UPDATE the fixture
   - Do NOT consider this adapter complete until live verification passes
   - See `/verify-adapter` for the full verification methodology

## Key conventions
- Dates stored as UTC noon to avoid DST issues
- `startTime` is a string "HH:MM" not a DateTime
- Use `cuid()` for all IDs
- Use Cheerio for HTML parsing (not Playwright)
- For JS-rendered sites, use `browserRender()` from `src/lib/browser-render.ts`

## Reference
- Full checklist: `docs/source-onboarding-playbook.md`
- Adapter interface: `src/adapters/types.ts`
- Few-shot examples: `src/adapters/html-scraper/examples.ts`
