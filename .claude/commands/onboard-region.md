Full regional onboarding workflow for: $ARGUMENTS

Research all kennels in the target region, create adapters, verify them live, and prepare for commit.

## Steps

1. **Research the region**
   - Check `prisma/seed.ts` for existing kennels in this region (skip duplicates)
   - Use WebSearch to find Hash House Harrier kennels in the area
   - For each kennel found: identify name, code, schedule, links, and best data source
   - Follow the source-researcher skill methodology

2. **Prioritize sources**
   - Group kennels by shared sources (aggregator pattern)
   - Order: GOOGLE_CALENDAR > GOOGLE_SHEETS/MEETUP > ICAL_FEED > HTML_SCRAPER > STATIC_SCHEDULE
   - Start with aggregator sources that cover multiple kennels

3. **Create adapters** (use subagents for parallelism where possible)
   - For each source: create adapter file, test file, seed data
   - Follow the `/add-adapter` workflow for HTML scrapers
   - For Google Calendar/Sheets/iCal/Meetup: follow existing adapter patterns

4. **Live verification (MANDATORY for each adapter)**
   - Run `/verify-adapter` for each new adapter
   - All adapters must produce events from the live production URL
   - Fix any that fail before proceeding

5. **Run full checks**
   - `npx tsc --noEmit && npm run lint && npm test`

6. **Update sources rule**
   - Run `/update-sources-rule` to sync `.claude/rules/active-sources.md` with seed data

7. **Report**
   - Summary: region name, kennels onboarded, sources created, total events from live verification
   - Any kennels that couldn't be onboarded and why
