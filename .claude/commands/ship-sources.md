Implement and ship all approved sources from: $ARGUMENTS

Takes a research file (from `/research-region`) or region name, builds all adapters, verifies live, and opens a PR.

## Required Reading
1. `docs/source-onboarding-playbook.md` — adapter types, patterns, utilities
2. The research file at `docs/kennel-research/{region}-research.md` (or as specified in $ARGUMENTS)

## Step 1: Parse Research File

Read the research file and identify:
- Which kennels to onboard (user-approved from Stage 6 of /research-region)
- Source type for each (GOOGLE_CALENDAR, MEETUP, ICAL_FEED, HARRIER_CENTRAL, HTML_SCRAPER, STATIC_SCHEDULE)
- kennelCodes (already collision-checked)
- Regions needed

## Step 2: Add Regions + Seed Data

- `src/lib/region.ts` — new country/state/metro regions, STATE_GROUP_MAP, COUNTRY_GROUP_MAP, inferCountry
- `prisma/seed-data/kennels.ts` — all kennel records
- `prisma/seed-data/aliases.ts` — all aliases
- `prisma/seed-data/sources.ts` — config-only sources (GOOGLE_CALENDAR, MEETUP, ICAL_FEED, HARRIER_CENTRAL, STATIC_SCHEDULE)

## Step 3: Build Adapters (parallelize with subagents)

For each HTML_SCRAPER source, create adapter + test file. Use existing utilities:
- `fetchHTMLPage()` — static HTML (Cheerio)
- `fetchBrowserRenderedPage()` — Wix, Google Sites, SPAs
- `fetchWordPressPosts()` — WordPress REST API (posts)
- `safeFetch()` — WordPress Pages API, Substack API, custom endpoints
- `buildDateWindow()` — ALWAYS filter by date window
- `stripPlaceholder()` — ALWAYS use for TBD/TBA filtering (not manual !== "TBD")
- `chronoParseDate()` — flexible date parsing
- `Number.parseInt()` — NEVER bare `parseInt`
- `decodeEntities()` — HTML entity decoding
- `hasAnyErrors()` — gate errorDetails on success paths

For Google Calendar sources, check if `includeAllDayEvents: true` is needed (some calendars use all-day events for real runs).

## Step 4: Registry + Source Seed Data

- `src/adapters/registry.ts` — add URL patterns to `htmlScraperEntries`
- `prisma/seed-data/sources.ts` — add HTML_SCRAPER source records

## Step 5: Live Verification (MANDATORY)

For EVERY new adapter:
1. Fetch live data from the production URL
2. Run the adapter against it (via a temporary verification test)
3. Verify: events > 0, dates valid, kennelTag correct, key fields populated
4. Show sample events to confirm correctness
5. Clean up verification test files

## Step 6: Run /simplify

Review all changed code for reuse, quality, and efficiency. Fix issues found.

## Step 7: Lint + Tests

```bash
npm run lint 2>&1 | grep "error" | grep -v "warning"
npx vitest run {all-new-test-files}
```

## Step 8: Commit, Push, Open PR

- Create feature branch: `feat/{region}-kennel-onboarding`
- Stage all files, commit with descriptive message
- Push and open PR with summary table, test plan, verification results

## Step 9: Self-Reflection (DO NOT SKIP)

After shipping, review what was learned in this onboarding batch:

1. **New adapter patterns?** → Update `docs/source-onboarding-playbook.md` adapter types section
2. **New discovery resources?** → Update `docs/regional-research-prompt.md` and `/research-region`
3. **kennelCode collisions encountered?** → Update collision-prone list in playbook
4. **Sources upgraded after research?** (e.g., HTML scraper → Google Calendar discovered later)
   → Add the missed detection pattern to the enhanced checklist in `/research-region`
5. **Documentation gaps?** → Fix them
6. **Write "Lessons Learned"** section in the research file
7. Commit doc updates alongside the PR or as a follow-up commit

## Key Principles

- An adapter is NOT done until live verification passes
- ALWAYS run /simplify before creating PR
- ALWAYS use existing utilities (not hand-rolled equivalents)
- Include historical data if the source provides it (don't defer to follow-up PRs)
- Dates as UTC noon, times as "HH:MM" strings
- Use kennelCode for kennelTag (not display names)
- NEVER skip the self-reflection step
