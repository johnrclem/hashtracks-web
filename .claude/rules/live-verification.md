---
description: MANDATORY live adapter verification against production websites before shipping
globs:
  - src/adapters/**
---

# Live Adapter Verification (MANDATORY)

When you create or modify an adapter, you MUST verify it against the live source URL before considering the work complete. Unit tests with mocked HTML fixtures are necessary but NOT sufficient.

## After unit tests pass:

1. **Find the source URL** -- look up the source in `prisma/seed.ts` to get the production URL
2. **Fetch the live HTML:**
   - For static HTML sites: `curl -s "$URL"` and pipe through the adapter's parse function
   - For JS-rendered sites (Wix, Google Sites): use `browserRender()` or WebFetch
   - For API-based adapters (Google Calendar, Meetup, etc.): call the API endpoint directly
3. **Validate the output:**
   - Events array is non-empty
   - Dates are valid and include upcoming events (not all in the past)
   - Required fields are populated: `date`, `kennelTag`
   - `startTime` (if present) is in `"HH:MM"` format
   - No obviously broken parsing (garbled text, wrong field mapping)
4. **Compare fixture vs live:**
   - If the live HTML structure differs from your test fixture, UPDATE the fixture
   - Structural changes (new CSS classes, different container elements) must be reflected in tests
5. **Report results:**
   - Log: event count, date range of events, sample event with all fields
   - If verification fails, diagnose and fix the adapter before shipping

## Never ship an adapter that only passes against mocked fixtures.

This rule exists because production websites change their HTML structure, and fixtures can become stale. A passing unit test against a fixture does NOT guarantee the adapter works against the live site.
