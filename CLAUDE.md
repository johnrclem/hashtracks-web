# CLAUDE.md — HashTracks

## What Is This?
HashTracks is a community platform where hashers discover upcoming runs, track
attendance, and view personal stats. Think: aggregated event calendar + personal
logbook + kennel directory.

## Quick Commands
- `npm run dev` — Start local dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm test` — Run test suite (Vitest, 109 test files)
- `npx prisma studio` — Visual database browser
- `npx prisma db push` — Push schema changes to dev DB
- `npx prisma migrate dev` — Create migration
- `npx prisma db seed` — Seed launch kennels and aliases

## Database (Railway)
- **Host:** `trolley.proxy.rlwy.net:18763` (public TCP proxy → PostgreSQL)
- **Connection:** `DATABASE_URL` in `.env` and `.env.local` (both must stay in sync)
- **Prisma config:** `prisma.config.ts` loads `DATABASE_URL` via `dotenv/config` (reads `.env`)
- **Node version:** Prisma 7 requires Node 20+ — run `eval "$(fnm env)" && fnm use 20` before any `npx prisma` command
- **Schema sync:** `npx prisma db push` runs automatically during Vercel builds, but **`npx prisma db seed` must be run manually** when new seed data is added (regions, kennels, sources, aliases)
- **Direct access:** The Railway DB is reachable from the dev environment (no VPN/SSH needed) — just ensure Node 20 is active

## Architecture
- **Framework:** Next.js 16 App Router, TypeScript strict mode
- **Database:** PostgreSQL via Prisma ORM (Railway hosted)
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS + shadcn/ui components
- **Scraping:** HTTP fetch + Cheerio for static HTML; NAS-hosted headless Chrome (Playwright on external NAS, not in the app) for JS-rendered sites (Wix, Google Sites) via `browserRender()`; Blogger API v3 for Blogspot-hosted sites (direct HTML scraping blocked by Google); GenericHtmlAdapter for config-driven CSS selector scraping (AI-assisted setup); STATIC_SCHEDULE adapter for RRULE-based event generation (no external fetch); Meetup public REST API adapter (5 live sources)
- **Residential Proxy:** Optional NAS-based forward proxy for WAF-blocked targets (Cloudflare Tunnel, see `docs/residential-proxy-spec.md`)
- **AI:** Gemini 2.0 Flash for complex HTML parsing (low temp, cached results), parse error recovery, column auto-detection, kennel pattern suggestions, HTML structure analysis with few-shot learning from existing adapter patterns
- **Kennel geocoding:** lat/lng on Kennel model, backfill via Google Geocoding API, Near Me distance filter (client-side Haversine)
- **Region hierarchy:** RegionLevel enum (COUNTRY/STATE_PROVINCE/METRO), parent-child linking
- **Analytics:** Vercel Web Analytics + Speed Insights
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
- Kennel resolution: shortName exact match → alias match → pattern match (retries shortName + alias) → flag for admin
- Source-kennel guard: merge pipeline blocks events for kennels not linked via `SourceKennel` → generates `SOURCE_KENNEL_MISMATCH` alert
- EventLink: extensible link table (Hash Rego, Meetup, etc.) — created by merge pipeline from `RawEventData.externalLinks` or when a second source provides a different sourceUrl
- Multi-day events: split into separate Event records linked via `parentEventId` + `isSeriesParent`, grouped by `RawEventData.seriesId`
- Kennel rename safety: renaming a kennel auto-adds the old shortName as an alias
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
- BROWSER_RENDER_URL=    # NAS browser render service URL (for JS-rendered sites)
- BROWSER_RENDER_KEY=    # API key for browser render service auth

## Important Files & Sources
See `.claude/rules/important-files.md` for the full file reference (organized by domain area).
See `.claude/rules/active-sources.md` for the complete 69-source catalog.

## Testing
- **Framework:** Vitest with `globals: true` (no explicit imports needed)
- **Config:** `vitest.config.ts` — path alias `@/` maps to `./src`
- **Run:** `npm test` (109 test files)
- **Factories:** `src/test/factories.ts` — shared builders (`buildRawEvent`, `buildCalendarEvent`, `mockUser`)
- **Mocking pattern:** `vi.mock("@/lib/db")` + `vi.mocked(prisma.model.method)` with `as never` for partial returns
- **Exported helpers:** Pure functions in adapters/pipeline are exported for direct unit testing (additive-only, no behavior change)
- **Convention:** Test files live next to source files as `*.test.ts`
- **Coverage areas:**
  - Adapters: hashnyc HTML parsing, Google Calendar extraction, Google Sheets CSV parsing, iCal feed parsing, Blogger API v3 utility, London HTML scrapers (CityH3, WLH3, LH3, BarnesH3, OCH3, SLH3, EH3), Chicago scrapers (CH3, TH3), DC scrapers (EWH3, DCH4, OFH3, Hangover), SF Bay (SFH3 HTML), Philly (BFM, HashPhilly), Northboro HTML scraper (browser-rendered, Wix parsing), Hash Rego (index parsing, detail parsing, multi-day splitting), Meetup.com API, WordPress REST API, generic HTML adapter (config parsing, row extraction, locale handling), shared adapter utilities
  - Pipeline: merge dedup + trust levels + source-kennel guard, kennel resolution (4-stage), fingerprinting, scrape orchestration, health analysis + alert generation, event reconciliation, auto-issue filing (adapter resolution, rate limiting, cooldown, dedup, AGENT_CONTEXT sanitization), post-merge fix verification
  - AI: Gemini API wrapper (caching, rate-limit handling, search grounding), parse recovery fallback, HTML structure analysis (container detection, few-shot examples, column mapping)
  - Research: source research pipeline (URL discovery, dedup, classification, concurrency), research server actions (approve/reject, URL update, feedback refinement), HTML analysis pipeline extraction
  - Server actions: logbook CRUD, profile, kennel subscriptions, admin CRUD, misman attendance/roster/history
  - Admin: config validation (with ReDoS detection), source type detection
  - Misman: audit log, hare sync, CSV import parsing, suggestion scoring, verification status, invite tokens
  - Region: region admin CRUD, hierarchy validation, merge re-parenting, self-parent guard
  - Strava: OAuth token refresh, activity date parsing, match suggestions, privacy zone handling
  - Utilities: format helpers, calendar URL/ICS generation, auth (Clerk→DB sync), fuzzy matching, timezone utilities, geo utilities (coordinate extraction, region colors), weather forecast (API integration, date matching, null handling)
- **CI enforcement:** All PRs must pass `npx tsc --noEmit`, `npm run lint`, and `npm test` via `.github/workflows/ci.yml`

## What NOT To Do
- Don't use Playwright **in the app** for scraping — use the NAS browser render service for JS-rendered sites, Cheerio for everything else
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ — QStash handles job fan-out for scraping