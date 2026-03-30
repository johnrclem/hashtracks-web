Create a new HTML scraper adapter for the source at URL: $ARGUMENTS

## Steps

1. **Analyze the source HTML**
   - Fetch the URL with `curl -s` and examine the HTML structure
   - Identify: date format, event container elements, field locations (title, hares, location, time, run number)
   - Determine date locale (en-US vs en-GB) and any timezone considerations

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
   - Fetch the real production URL: `curl -s "$URL"` (or `browserRender()` for JS-rendered sites)
   - Run the adapter's parse function against the live HTML
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
