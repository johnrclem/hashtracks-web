Verify an adapter works against the live production source for: $ARGUMENTS

## Steps

1. **Resolve the source**
   - Search `prisma/seed.ts` for the source by name, kennel code, or URL
   - Extract the source URL and source type

2. **Fetch live data**
   - For `HTML_SCRAPER`: `curl -s "$URL"` (or `browserRender()` for JS-rendered sites, or `fetchBloggerPosts()` for Blogspot sites, or `fetchWordPressPosts()` for WordPress sites)
   - For `GOOGLE_CALENDAR`: Use the Calendar API with the calendar ID from config
   - For `GOOGLE_SHEETS`: Fetch the CSV export URL
   - For `ICAL_FEED`: `curl -s "$URL"`
   - For `RSS_FEED`: `curl -s "$URL"` to fetch RSS/Atom XML
   - For `MEETUP`: Call the Meetup API endpoint
   - For `HASHREGO`: `curl -s "$URL"`
   - For `STATIC_SCHEDULE`: No fetch needed — generate events from RRULE config

3. **Run the adapter's parse function**
   - Import the adapter and call its `fetchEvents()` or parse function with the live data
   - Use a quick vitest one-off or write a temporary test (delete temp files after verification)

4. **Validate output**
   - Events array is non-empty
   - All events have `date` (valid Date object) and `kennelTag` (non-empty string)
   - At least some dates are in the future (upcoming events exist)
   - `startTime` (if present) matches `"HH:MM"` format
   - No garbled text or broken field mapping
   - **Optional-field coverage** — if you spotted any high-value enrichment fields during source analysis (distance, Shiggy Level, cost, description, full street address, endTime — see [`add-adapter.md`](add-adapter.md) step 1), confirm they're populated in the live output. Missing them isn't a failure, but it usually means the parser didn't find the labels — worth a second look at the live HTML before shipping. For trail-length / Shiggy specifically, also exercise the unparseable cases (e.g. `Length: TBD`) and confirm the adapter emits explicit `null` for the affected numerics, not `undefined` (atomic-bundle semantics — see `adapter-patterns.md`).

5. **Report results**
   - Log: total event count, date range, adapter type
   - Show 2-3 sample events with all populated fields
   - If verification FAILS: diagnose the issue and fix the adapter
   - If live HTML differs from test fixture: update the fixture

## Quick Unit Test Command
```bash
npx vitest run --reporter=verbose {adapter-test-file}
```
Then separately verify against the live site as described above.
