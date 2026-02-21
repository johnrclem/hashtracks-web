# Test Coverage Analysis

> Generated: 2026-02-21

## Current State

- **57 test files** covering 1,140+ test cases
- **Test framework:** Vitest with globals, co-located test files (`*.test.ts`)
- **Mocking pattern:** `vi.mock()` + `vi.mocked()` with Prisma client mocking
- **Test data:** Shared factories in `src/test/factories.ts`

## What's Well-Tested

The existing suite is high-quality. These areas have thorough, edge-case-aware coverage:

| Area | Files | Tests | Quality |
|------|-------|-------|---------|
| Adapters (scrapers/parsers) | 22 | ~300+ | Excellent — realistic HTML fixtures, date/time edge cases |
| Pipeline (merge, scrape, health, kennel-resolver, fingerprint) | 5 | ~60+ | Strong — dedup logic, trust levels, source-kennel guards |
| Server actions (logbook, misman, admin CRUD) | 13 | ~250+ | Exemplary — auth checks, date boundaries, state transitions |
| Library utils (format, calendar, fuzzy, auth, invite) | 12 | ~150+ | Good — pure function coverage, role-based auth |

### Standout test files

- **`logbook/actions.test.ts`** (31 tests) — Outstanding date boundary testing, RSVP toggle logic, idempotency checks
- **`misman/roster/actions.test.ts`** (46 tests) — Thorough merge preview, duplicate scanning, user link lifecycle
- **`misman/attendance/actions.test.ts`** (30 tests) — Smart suggestions scoring, roster scope enforcement
- **`hashrego/adapter.test.ts`** (20 tests) — Multi-day event splitting, time sentinel handling, fetch mocking

---

## Coverage Gaps

### Priority 1: Critical pure functions without any tests

These are correctness-critical, easy to test, and have zero coverage:

#### `src/lib/date.ts` — UTC noon date utilities
- `getTodayUtcNoon()` and `parseUtcNoonDate()` are used throughout the codebase for event date storage
- DST transitions, leap years, and malformed input are untested
- Risk: a bug here silently corrupts every date in the system

#### `src/pipeline/fill-rates.ts` — Field completion metrics
- Pure function `computeFillRates()` — 30 LOC, zero dependencies
- Should test: empty arrays, partial fields, `runNumber` null vs undefined

#### `src/pipeline/structure-hash.ts` — HTML structural fingerprinting
- Pure function `generateStructureHash()` — deterministic SHA-256 output
- Should test: missing tables, varying row counts, class name sensitivity

### Priority 2: Complex server actions without tests

#### `src/app/admin/alerts/actions.ts` — Alert repair workflows (601 LOC, 11 functions)
- This is the largest untested file in the codebase
- Contains 4 repair workflows (rescrape, create-alias, create-kennel, link-kennel)
- Auto-resolution logic after alias/kennel creation
- GitHub issue filing with 7 alert-type-specific body templates
- Repair log appending (immutable audit trail)
- **Recommended tests:** Auth guards, repair state transitions, auto-resolution after alias creation, GitHub API error handling

#### `src/app/misman/[slug]/import/actions.ts` — CSV import preview & execution (272 LOC)
- Multi-step process: parse CSV → fuzzy-match hashers → dedup → bulk insert → hare sync
- The pure parsing logic is tested in `csv-import.test.ts`, but the server action orchestration is not
- **Recommended tests:** Preview dedup counts, createHashers flag behavior, skipDuplicates, hare sync triggering

#### `src/app/admin/sources/gemini-suggestions-action.ts` — AI-powered pattern suggestions (126 LOC)
- Gemini API integration with JSON response parsing and type-guard validation
- **Recommended tests:** Missing API key, empty input, malformed JSON response, confidence clamping

### Priority 3: API routes with scheduling logic

#### `src/app/api/cron/scrape/route.ts` — Cron frequency scheduling (94 LOC)
- Contains `shouldScrape()` function with interval logic (hourly, every_6h, daily, weekly)
- Buffer window handling (10-minute edge case tolerance)
- **Recommended tests:** Interval boundary conditions, never-scraped sources, unknown frequency fallback

#### `src/app/api/admin/scrape/route.ts` and `scrape-all/route.ts`
- Admin scrape endpoints with auth guards and error handling
- Lower priority since they mostly delegate to the well-tested `scrapeSource()` pipeline

### Priority 4: Untested adapter files

#### `src/adapters/html-scraper/bfm.ts` and `hashphilly.ts`
- Both implement `SourceAdapter` with custom date/time parsing helpers
- Every other HTML scraper has tests; these two are outliers
- **Recommended tests:** Date parsing edge cases, HTML fixture-based extraction

#### `src/adapters/hashrego/parser.ts`
- The parser functions are exercised indirectly through `adapter.test.ts`, but don't have dedicated unit tests
- Lower priority since the adapter tests cover the main paths

### Priority 5: React components (95 of 96 untested)

Only `SuggestionList.tsx` has a test file. While most components are presentational, several contain significant business logic:

- **`AttendanceForm.tsx`** — Form state management, validation, submission
- **`ImportWizard.tsx`** — Multi-step wizard with CSV preview
- **`KennelDirectory.tsx`** — Search, filtering, sorting, URL persistence
- **`EventFilters.tsx` / `KennelFilters.tsx`** — Filter state management
- **`DuplicateScanResults.tsx` / `MergePreviewDialog.tsx`** — Merge conflict display

Component testing would require adding React Testing Library / `@testing-library/react` and jsdom environment configuration. This is a larger investment that should be weighed against the team's priorities.

---

## Existing Test Quality Issues

### Minor improvements to existing tests

1. **`health.test.ts`** (10 tests) — Could test more alert type combinations (e.g., SCRAPE_FAILURE + UNMATCHED_TAGS simultaneously) and fill-rate anomaly detection
2. **`hashnyc.test.ts`** — `parseRows` only has 5 tests despite being the most complex function; could test malformed HTML structures
3. **`auth.test.ts`** — No DB/Clerk error scenarios tested (connection failures, API timeouts)
4. **`scrape.test.ts`** — No hybrid failure tests (adapter returns some events but also reports errors)

### Patterns to adopt project-wide

- The misman action tests use deeply nested mock setups that would benefit from more factory helpers in `src/test/factories.ts`
- Some tests mock `currentUser` redundantly due to internal call chains — could be simplified with a shared auth mock helper

---

## Recommended Action Plan

### Quick wins (pure functions, no mocking needed)

| File | Effort | Impact |
|------|--------|--------|
| `src/lib/date.ts` | Small | High — every date in the system depends on these |
| `src/pipeline/fill-rates.ts` | Small | Medium — quality metrics accuracy |
| `src/pipeline/structure-hash.ts` | Small | Medium — site change detection |

### Medium effort (server actions, requires DB mocking)

| File | Effort | Impact |
|------|--------|--------|
| `src/app/admin/alerts/actions.ts` | Large | High — admin repair workflows are critical |
| `src/app/api/cron/scrape/route.ts` | Medium | High — scheduling logic is error-prone |
| `src/app/misman/[slug]/import/actions.ts` | Medium | Medium — import feature accuracy |
| `src/app/admin/sources/gemini-suggestions-action.ts` | Medium | Medium — AI integration reliability |

### Adapter parity (fill gaps in otherwise-complete coverage)

| File | Effort | Impact |
|------|--------|--------|
| `src/adapters/html-scraper/bfm.ts` | Small | Low — consistency with other adapters |
| `src/adapters/html-scraper/hashphilly.ts` | Small | Low — consistency with other adapters |

### Longer-term (component testing infrastructure)

Adding React Testing Library for component tests is a significant investment. If pursued, start with the components that contain the most business logic: `AttendanceForm`, `ImportWizard`, `KennelDirectory`.
