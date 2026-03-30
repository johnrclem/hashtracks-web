End-to-end adapter creation and shipping workflow for: $ARGUMENTS

Do NOT pause for approval between steps. Complete the entire workflow autonomously.

## Steps

1. **Analyze the source** — Fetch the URL, examine HTML/API structure, identify fields
2. **Create the adapter** — Implement `SourceAdapter` interface, register in `registry.ts`
3. **Create tests** — Save HTML fixture, write unit tests, verify parsing
4. **Add seed data** — Source, SourceKennel, and Kennel records in `prisma/seed.ts`
5. **Run unit tests** — `npx vitest run {test-file}` to verify
6. **Live verification (MANDATORY)** — Fetch the real production URL, run the adapter against live HTML, validate events are extracted correctly. If live HTML differs from fixture, update the fixture. See `/verify-adapter` for details.
7. **Run full checks** — `npx tsc --noEmit && npm run lint && npm test`
8. **Report** — Summarize: adapter type, event count from live site, sample events, any issues found

## Key Principles
- Follow existing adapter patterns (check `src/adapters/html-scraper/examples.ts`)
- Dates as UTC noon, times as "HH:MM" strings
- Use kennelCode for kennelTag (not display names)
- Include historical data if available (don't defer to follow-up PRs)
- An adapter is NOT done until live verification passes
