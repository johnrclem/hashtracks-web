# CLAUDE.md — HashTracks

## What Is This?
HashTracks is a community platform where hashers discover upcoming runs, track
attendance, and view personal stats. Think: aggregated event calendar + personal
logbook + kennel directory.

## Quick Commands
- `npm run dev` — Start local dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm test` — Run test suite (Vitest, 115 test files)
- `npx prisma studio` — Visual database browser
- `npx prisma db push` — Push schema changes to dev DB
- `npx prisma migrate dev` — Create migration
- `npx prisma db seed` — Seed launch kennels and aliases

## Architecture
- **Framework:** Next.js 16 App Router, TypeScript strict mode
- **Database:** PostgreSQL via Prisma ORM (Railway hosted)
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS + shadcn/ui components
- **Scraping:** HTTP fetch + Cheerio for static HTML; NAS-hosted headless Chrome (Playwright on external NAS, not in the app) for JS-rendered sites (Wix, Google Sites) via `browserRender()`; Blogger API v3 for Blogspot-hosted sites; GenericHtmlAdapter for config-driven CSS selector scraping; STATIC_SCHEDULE adapter for RRULE-based event generation; Meetup public REST API adapter
- **Residential Proxy:** Optional NAS-based forward proxy for WAF-blocked targets
- **NAS Infrastructure:** Synology DS423+ at `nas-tailscale` (via Tailscale). Hosts browser render service and residential proxy relay.
- **AI:** Gemini 2.0 Flash for complex HTML parsing, parse error recovery, column auto-detection, kennel pattern suggestions
- **Kennel geocoding:** lat/lng on Kennel model, backfill via Google Geocoding API, Near Me distance filter (client-side Haversine)
- **Region hierarchy:** RegionLevel enum (COUNTRY/STATE_PROVINCE/METRO), parent-child linking
- **Analytics:** PostHog (client + server), Sentry error tracking (client + server + edge), Vercel Speed Insights
- **CI/CD:** GitHub Actions (type check + lint + tests on all PRs); Claude Code automation for issue triage + auto-fix
- **Self-healing:** Alert pipeline auto-files GitHub issues → Claude triages → high-confidence fixes auto-PR'd → CI validates
- **Deployment:** Vercel (auto-deploy from main branch)

## Data Flow
1. **Sources** (hashnyc.com, Google Calendar, Google Sheets, etc.) are scraped via QStash fan-out (dispatch → per-source jobs)
2. Each scrape produces **RawEvents** (immutable — never edit scraped data)
3. **Merge Pipeline** deduplicates RawEvents into **Canonical Events** using `kennel + date`
4. Users see Canonical Events in the **Hareline** (calendar)
5. Users log attendance in their **Logbook** ("I was there" check-in)

## Key Domain Concepts
- **Hasher** = User. Has a "Hash Name" (public) and "Nerd Name" (private).
- **Kennel** = Organization hosting runs (e.g., "NYCH3"). Has aliases for fuzzy matching.
- **Source** = Data provider. One source can feed multiple kennels (aggregator pattern).
- **RawEvent** = Immutable scraper output. Never modified after creation.
- **Event** = Canonical "golden record" shown to users. Created by merging RawEvents.
- **Attendance** = User's check-in record on an Event.

## Code Conventions
- Use `cuid()` for all IDs (Prisma default)
- Dates stored as UTC noon to avoid DST issues (see PRD Appendix F.4)
- `startTime` is a string "HH:MM" not a DateTime (many sources lack full timestamps)
- Kennel resolution: kennelCode exact match → shortName exact match → alias match → pattern match (retries kennelCode + shortName + alias) → flag for admin
- Source-kennel guard: merge pipeline blocks events for kennels not linked via `SourceKennel` → generates `SOURCE_KENNEL_MISMATCH` alert
- EventLink: extensible link table (Hash Rego, Meetup, etc.) — created by merge pipeline from `RawEventData.externalLinks` or when a second source provides a different sourceUrl
- Multi-day events: split into separate Event records linked via `parentEventId` + `isSeriesParent`, grouped by `RawEventData.seriesId`
- Kennel rename safety: renaming a kennel auto-adds the old shortName as an alias; kennelCode is immutable and unaffected by renames
- All scraper adapters implement the `SourceAdapter` interface in `src/adapters/types.ts`
- API routes return consistent shapes: `{ data, error?, meta? }`

## Environment Variables
- DATABASE_URL=           # Railway PostgreSQL connection string
- CLERK_SECRET_KEY=       # Clerk backend key
- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=  # Clerk frontend key
- NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
- NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
- GEMINI_API_KEY=         # Google AI API key (Sprint 10+)
- CRON_SECRET=            # Secret for cron auth (Bearer token fallback)
- QSTASH_TOKEN=           # Upstash QStash API token (fan-out job dispatch)
- QSTASH_CURRENT_SIGNING_KEY= # QStash signature verification (current key)
- QSTASH_NEXT_SIGNING_KEY=    # QStash signature verification (next key for rotation)
- GOOGLE_CALENDAR_API_KEY= # For Google Calendar + Sheets APIs
- NEXT_PUBLIC_GOOGLE_MAPS_API_KEY= # For MapView (interactive) + EventLocationMap (static) — browser-exposed by design
- GOOGLE_WEATHER_API_KEY= # Server-only (NOT NEXT_PUBLIC_) — same GCP project as Maps
- GITHUB_TOKEN=           # GitHub PAT with repo scope (for filing issues from alerts, user feedback, auto-issue dedup + rate limiting)
- STRAVA_CLIENT_ID=      # Strava OAuth app client ID
- STRAVA_CLIENT_SECRET=  # Strava OAuth app client secret
- NEXT_PUBLIC_APP_URL=    # Base URL for invite links (e.g., https://hashtracks.com)
- RESIDENTIAL_PROXY_URL=  # NAS residential proxy URL (for WAF-blocked scrape targets)
- RESIDENTIAL_PROXY_KEY=  # API key for residential proxy auth
- BROWSER_RENDER_URL=    # NAS browser render service URL (for JS-rendered sites + iframe extraction via frameUrl)
- BROWSER_RENDER_KEY=    # API key for browser render service auth
- NEXT_PUBLIC_POSTHOG_KEY= # PostHog project API key (browser-exposed, used by client SDK)
- POSTHOG_API_KEY=       # PostHog project API key (server-side event capture)
- NEXT_PUBLIC_SENTRY_DSN= # Sentry DSN (client + server error tracking)
- SENTRY_AUTH_TOKEN=     # Sentry auth token (build-time only, source map upload to Vercel)
- SENTRY_ORG=            # Sentry organization slug (build-time)
- SENTRY_PROJECT=        # Sentry project slug (build-time)

## Testing
- **Framework:** Vitest with `globals: true` (no explicit imports needed)
- **Config:** `vitest.config.ts` — path alias `@/` maps to `./src`
- **Run:** `npm test` (115 test files)
- **Factories:** `src/test/factories.ts` — shared builders (`buildRawEvent`, `buildCalendarEvent`, `mockUser`)
- **Mocking pattern:** `vi.mock("@/lib/db")` + `vi.mocked(prisma.model.method)` with `as never` for partial returns
- **Convention:** Test files live next to source files as `*.test.ts`
- **CI enforcement:** All PRs must pass `npx tsc --noEmit`, `npm run lint`, and `npm test` via `.github/workflows/ci.yml`

## Workflow Expectations
- **Autonomous completion:** Complete multi-step tasks end-to-end without pausing for approval between steps. Research → Plan → Execute → Verify is the standard flow.
- **Live verification:** New or modified adapters MUST be verified against the live production URL, not just mocked fixtures. See `.claude/rules/live-verification.md`.
- **Existing patterns first:** Before writing new code, check if an existing adapter, utility, or pattern already handles the case.
- **Include historical data:** When building adapters, include historical event data if the source provides it — don't defer to follow-up PRs.
- **Run checks before shipping:** Always run `npx tsc --noEmit && npm run lint && npm test` before considering work complete.

## On-Demand Context
Large reference lists are in `.claude/rules/`. They load automatically when you touch matching files:
- `rules/active-sources.md` — 150 active data sources by region (loads for adapter/pipeline work)
- `rules/important-files.md` — 200+ file references by domain area
- `rules/database.md` — Railway DB connection and Prisma workflow (loads for prisma/* and .env*)
- `rules/nas-deployment.md` — NAS Docker deployment commands (loads for infra/*)
- `rules/adapter-patterns.md` — Adapter coding conventions and patterns (loads for adapter work)
- `rules/testing-coverage.md` — Detailed test coverage areas (loads for test files)
- `rules/documentation-index.md` — Docs directory index (loads for docs/*)
- `rules/live-verification.md` — Mandatory live adapter verification (loads for adapter work)

## What NOT To Do
- Don't use Playwright **in the app** for scraping — use the NAS browser render service for JS-rendered sites, Cheerio for everything else
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ — QStash handles job fan-out for scraping
