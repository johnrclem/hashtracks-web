Debug the failing scraper for: $ARGUMENTS

## Diagnosis Steps

1. **Identify the adapter**
   - Search `prisma/seed.ts` for the source record (by kennel name, URL, or source ID)
   - Find the adapter file in `src/adapters/`
   - Note the SourceType and source URL

2. **Check the live site**
   - Fetch the source URL with `curl -s` to get current HTML
   - Compare against what the adapter expects (CSS selectors, element structure)
   - Check if the site returns a WAF block page (Cloudflare, etc.)

3. **Identify the failure type**
   - **CSS selectors changed** → Site redesign, update selectors
   - **Date format changed** → Update date parsing logic
   - **WAF/bot block** → May need residential proxy or browser render
   - **Site down** → Check if temporary or permanent
   - **New fields/layout** → Adapter needs structural update

4. **Check related context**
   - Search GitHub issues: `gh issue list --label scraper-alert --search "{kennel}"`
   - Check recent ScrapeLog entries if sourceId is known
   - Look at the adapter's test file for the expected HTML structure

5. **Fix and verify**
   - Update the adapter code to match the new site structure
   - Update the test fixture with current HTML
   - Run `npx vitest {test-file}` to verify the fix
   - Run `npm test` to ensure no regressions

## Common patterns
- UK date formats: "Saturday 15th March 2026" → use `en-GB` locale parsing
- WordPress sites: Check if WordPress REST API is available (`/wp-json/wp/v2/posts`)
- Blogspot: Use Blogger API v3 via `src/adapters/blogger-api.ts`
- JS-rendered (Wix, Google Sites): Use `browserRender()` from `src/lib/browser-render.ts`
