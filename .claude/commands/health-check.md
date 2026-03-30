Audit scraper health and diagnose failing sources.

## Steps

1. **Check recent scrape logs**
   - Query the database for recent ScrapeLog entries with errors or zero events
   - Group failures by source and error type
   - Identify sources that have been failing consistently vs one-off errors

2. **For each failing source:**
   - Fetch the live URL to check if the site is still accessible
   - Compare current HTML structure against what the adapter expects
   - Classify the failure:
     - **Site down** — temporary, skip
     - **HTML structure changed** — adapter needs update
     - **WAF/blocking** — may need residential proxy or browser render
     - **URL changed** — update source URL in seed data
     - **Date format changed** — update parser

3. **Run the debug-scraper workflow** for each fixable failure
   - Follow the `/debug-scraper` methodology
   - Fix the adapter if possible

4. **Produce a health report:**
   ```
   ## Scraper Health Report
   - Total sources checked: N
   - Healthy: N
   - Failing: N
   - Fixed this session: N

   ### Failures
   | Source | Error | Status | Action Taken |
   |--------|-------|--------|-------------|
   | ...    | ...   | ...    | ...         |
   ```

5. **Run full checks** after any fixes: `npx tsc --noEmit && npm run lint && npm test`
