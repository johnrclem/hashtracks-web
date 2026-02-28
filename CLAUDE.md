# CLAUDE.md — HashTracks

## What Is This?
HashTracks is the "Strava of Hashing" — a community platform where hashers discover
upcoming runs, track attendance, and view personal stats. Think: aggregated event
calendar + personal logbook + kennel directory.

## Quick Commands
- `npm run dev` — Start local dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm test` — Run test suite (Vitest, 69 test files)
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
- **Scraping:** HTTP fetch + Cheerio (NOT Playwright — hash sites are static HTML); Blogger API v3 for Blogspot-hosted sites (direct HTML scraping blocked by Google)
- **AI:** Gemini 2.0 Flash for complex HTML parsing (low temp, cached results), parse error recovery, column auto-detection, kennel pattern suggestions
- **Analytics:** Vercel Web Analytics + Speed Insights
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
- GITHUB_TOKEN=           # GitHub PAT with repo scope (for filing issues from alerts + user feedback)
- STRAVA_CLIENT_ID=      # Strava OAuth app client ID
- STRAVA_CLIENT_SECRET=  # Strava OAuth app client secret
- NEXT_PUBLIC_APP_URL=    # Base URL for invite links (e.g., https://hashtracks.com)

## Important Files
- `prisma/schema.prisma` — Full data model, 25 models + 17 enums (THE source of truth for types)
- `prisma/seed.ts` — 79 kennels, 246 aliases, 29 sources, 26 regions (first-class model with hierarchy)
- `prisma.config.ts` — Prisma 7 config (datasource URL, seed command)
- `src/lib/db.ts` — PrismaClient singleton (PrismaPg adapter + SSL)
- `src/lib/auth.ts` — `getOrCreateUser()` + `getAdminUser()` + `getMismanUser()` + `getRosterGroupId()` (Clerk→DB sync + admin/misman role checks)
- `src/lib/format.ts` — Shared utilities: time formatting, date formatting, participation levels, schedule formatting, social URL helpers
- `src/lib/region.ts` — Region seed data (26 regions), sync fallback lookups (timezone, colors, centroids, abbrev), region slug generation
- `src/lib/calendar.ts` — Google Calendar URL + .ics file generation (client-side)
- `src/middleware.ts` — Clerk route protection (public vs authenticated routes)
- `src/adapters/types.ts` — SourceAdapter interface + RawEventData types
- `src/adapters/registry.ts` — Adapter factory (SourceType → adapter instance)
- `src/adapters/html-scraper/hashnyc.ts` — hashnyc.com HTML scraper (Cheerio)
- `src/adapters/google-calendar/adapter.ts` — Google Calendar API v3 adapter (Boston Hash)
- `src/adapters/google-sheets/adapter.ts` — Google Sheets CSV adapter (Summit H3, W3H3, config-driven)
- `src/adapters/ical/adapter.ts` — iCal feed adapter (SFH3 MultiHash, node-ical)
- `src/adapters/hashrego/adapter.ts` — Hash Rego adapter (hashrego.com events, multi-kennel)
- `src/adapters/hashrego/parser.ts` — Hash Rego HTML parsing (index table, detail page, multi-day splitting)
- `src/adapters/meetup/adapter.ts` — Meetup.com public API adapter (event scraping, groupUrlname auto-detection)
- `src/adapters/wordpress-api.ts` — WordPress REST API utility (shared by EWH3, DCH4 — bypasses HTML scraping blocks)
- `src/adapters/html-scraper/bfm.ts` — BFM (Ben Franklin Mob) website scraper
- `src/adapters/html-scraper/hashphilly.ts` — Philly H3 website scraper
- `src/adapters/html-scraper/london-hash.ts` — London Hash run list scraper (LH3)
- `src/adapters/html-scraper/city-hash.ts` — City Hash website scraper (CityH3)
- `src/adapters/html-scraper/west-london-hash.ts` — West London Hash website scraper (WLH3)
- `src/adapters/html-scraper/barnes-hash.ts` — Barnes Hash hare line scraper (BarnesH3)
- `src/adapters/html-scraper/och3.ts` — Old Coulsdon Hash run list scraper (OCH3)
- `src/adapters/html-scraper/slash-hash.ts` — SLASH run list scraper (SLH3)
- `src/adapters/blogger-api.ts` — Blogger API v3 utility (fetchBloggerPosts — shared by Blogspot adapters)
- `src/adapters/html-scraper/enfield-hash.ts` — Enfield Hash blog scraper (EH3, uses Blogger API)
- `src/adapters/html-scraper/chicago-hash.ts` — Chicago Hash website scraper (CH3)
- `src/adapters/html-scraper/chicago-th3.ts` — Thirstday Hash website scraper (TH3)
- `src/adapters/html-scraper/sfh3.ts` — SFH3 MultiHash HTML hareline scraper (11 Bay Area kennels)
- `src/adapters/html-scraper/ewh3.ts` — EWH3 WordPress trail news scraper
- `src/adapters/html-scraper/dch4.ts` — DCH4 WordPress trail posts scraper
- `src/adapters/html-scraper/ofh3.ts` — OFH3 Blogspot trail posts scraper
- `src/adapters/html-scraper/hangover.ts` — Hangover H3 DigitalPress blog scraper
- `src/adapters/utils.ts` — Shared adapter utilities (date parsing, field extraction)
- `src/pipeline/merge.ts` — Raw→Canonical merge pipeline (fingerprint dedup + source-kennel guard)
- `src/pipeline/kennel-resolver.ts` — Alias-based kennel name resolution (with pattern fallback)
- `src/pipeline/scrape.ts` — Shared `scrapeSource()` used by cron + admin routes
- `src/pipeline/health.ts` — Rolling-window health analysis + alert generation
- `src/pipeline/reconcile.ts` — Stale event reconciliation (cancels removed source events)
- `src/pipeline/fill-rates.ts` — Per-field fill rate computation for RawEvents
- `src/pipeline/structure-hash.ts` — HTML structural fingerprinting (SHA-256)
- `src/app/admin/alerts/actions.ts` — Alert repair actions (re-scrape, create alias/kennel, link kennel to source, file GitHub issue)
- `src/app/admin/regions/actions.ts` — Region CRUD, merge, AI suggestions (rule-based + Gemini), hierarchy validation
- `src/app/admin/regions/page.tsx` — Admin region management page (RegionTable + RegionSuggestionsPanel)
- `src/app/admin/events/actions.ts` — Admin event management (delete, bulk delete with cascade)
- `src/app/admin/misman-requests/page.tsx` — Admin misman request approval (reuses misman server actions)
- `src/app/admin/sources/new/page.tsx` — Source onboarding wizard (multi-phase guided setup with preview)
- `src/app/admin/sources/config-validation.ts` — Server-side config validation with ReDoS safety (safe-regex2)
- `src/components/kennels/QuickInfoCard.tsx` — Kennel quick info card (schedule, hash cash, website, flags)
- `src/components/kennels/SocialLinks.tsx` — Kennel social links icon row (Facebook, Instagram, X, Discord, etc.)
- `src/components/kennels/KennelStats.tsx` — Kennel computed stats (total events, oldest event, next run)
- `src/components/kennels/KennelCard.tsx` — Kennel card: shortName heading, schedule, description, founded year, next run, RegionBadge
- `src/components/kennels/KennelDirectory.tsx` — Kennel directory: search, filters, sort (A–Z / Recently Active), URL persistence
- `src/components/kennels/KennelFilters.tsx` — Filter bar: region, run day, frequency, has upcoming, country
- `src/components/admin/AlertCard.tsx` — Alert card with repair actions, context display, repair history
- `src/app/misman/actions.ts` — Misman request/approve/reject + roster group request server actions
- `src/app/misman/[slug]/roster/actions.ts` — Roster CRUD + search + user linking + merge duplicates (roster group scope)
- `src/app/misman/[slug]/attendance/actions.ts` — Attendance recording, polling, quick-add, smart suggestions, audit log, hasher edit
- `src/app/misman/[slug]/history/actions.ts` — Attendance history, hasher detail, roster seeding from hares
- `src/lib/misman/suggestions.ts` — Smart suggestion scoring algorithm (pure function: frequency/recency/streak)
- `src/lib/misman/verification.ts` — Derived verification status (verified/misman-only/user-only/none)
- `src/components/misman/KennelSwitcher.tsx` — Kennel dropdown switcher for misman layout (preserves active tab)
- `src/components/misman/UserLinkSection.tsx` — User linking UI (suggest, dismiss, revoke, profile invite) on hasher detail
- `src/components/misman/UserActivitySection.tsx` — User RSVP/check-in activity display on attendance form
- `src/components/profile/KennelConnections.tsx` — Profile page kennel link requests + active connections
- `src/components/logbook/PendingLinkRequests.tsx` — Logbook banner for pending kennel link suggestions
- `src/app/invite/link/page.tsx` — Profile link invite redemption page (token-based)
- `src/app/misman/invite/actions.ts` — Invite link generation, redemption, revocation for misman onboarding
- `src/lib/invite.ts` — Invite token generation + validation helpers
- `src/app/misman/[slug]/import/actions.ts` — CSV import preview + execute for historical attendance bulk loading
- `src/lib/misman/csv-import.ts` — CSV parsing, hasher matching, record building (pure functions)
- `src/lib/misman/audit.ts` — Attendance edit audit log: AuditLogEntry type, appendAuditLog, buildFieldChanges
- `src/lib/misman/hare-sync.ts` — Auto-sync misman hare flags to EventHare records
- `src/components/misman/SuggestionList.tsx` — Tap-to-add suggestion chips on attendance form (capped at 10, backfills as consumed)
- `src/components/misman/VerificationBadge.tsx` — Verification status badge (V/M/U) on attendance rows
- `src/components/misman/DuplicateScanResults.tsx` — Scan for duplicate hashers + merge trigger
- `src/components/misman/MergePreviewDialog.tsx` — Side-by-side merge preview with stats/conflicts
- `src/components/logbook/PendingConfirmations.tsx` — Pending misman confirmations on logbook page
- `src/lib/strava/client.ts` — Strava OAuth token management (exchange, refresh, revoke)
- `src/lib/strava/sync.ts` — Strava activity sync, date string extraction, match suggestions
- `src/app/strava/actions.ts` — Strava server actions (connect, disconnect, sync, attach to attendance)
- `src/components/logbook/StravaNudgeBanner.tsx` — Strava sync reminder banner on logbook page
- `src/components/admin/RosterGroupsAdmin.tsx` — Admin roster group management (create, rename, dissolve, pending requests)
- `src/app/admin/roster-groups/actions.ts` — Roster group CRUD + roster group request approve/reject
- `src/components/feedback/FeedbackDialog.tsx` — In-app user feedback dialog (files GitHub issues with category labels)
- `src/components/ui/alert-dialog.tsx` — Radix AlertDialog wrapper (confirmation dialogs)
- `src/lib/ai/gemini.ts` — Gemini 2.0 Flash API wrapper (low-temp structured extraction, 1hr in-memory response cache, 429 rate-limit handling)
- `src/lib/ai/parse-recovery.ts` — AI fallback for scraper parse errors (prompt sanitization + confidence tracking)
- `src/lib/source-detect.ts` — Auto-detection of source type from URL (Sheets, Calendar, Hash Rego, Meetup)
- `src/lib/timezone.ts` — IANA timezone utilities (composeUtcStart, formatTimeInZone)
- `src/lib/fuzzy.ts` — Levenshtein-based fuzzy string matching for kennel tag resolution + pairwise name matching
- `src/lib/geo.ts` — Coordinate utilities: extractCoordsFromMapsUrl (4 URL patterns), getEventCoords, haversineDistance, REGION_CENTROIDS; region color/centroid helpers re-exported from region.ts
- `src/lib/weather.ts` — Google Weather API fetch utility (getEventDayWeather, 30-min cache, region centroid fallback)
- `src/components/hareline/EventLocationMap.tsx` — Static map image (Google Maps Static API; accepts coords or text address fallback)
- `src/components/hareline/MapView.tsx` — Interactive map tab for Hareline (@vis.gl/react-google-maps, region-colored pins)
- `src/components/hareline/EventWeatherCard.tsx` — Weather forecast display (condition emoji, °F/°C, precip ≥20%)
- `src/components/providers/units-preference-provider.tsx` — °F/°C preference context (localStorage-based, useUnitsPreference hook)
- `vercel.json` — Vercel Cron config (triggers QStash dispatch at 6:00 AM UTC)
- `src/lib/qstash.ts` — QStash Client + Receiver singletons (Upstash fan-out queue)
- `src/lib/cron-auth.ts` — Dual auth: QStash signature verification → Bearer CRON_SECRET fallback
- `src/pipeline/schedule.ts` — Shared scheduling logic (shouldScrape, frequency intervals)
- `src/app/api/cron/dispatch/route.ts` — Fan-out dispatcher: queries due sources, publishes QStash messages
- `src/app/api/cron/scrape/[sourceId]/route.ts` — Per-source scrape endpoint (called by QStash)
- `vitest.config.ts` — Test runner config (globals, path aliases)
- `src/test/factories.ts` — Shared test data builders

## Documentation
- `docs/source-onboarding-playbook.md` — Step-by-step guide for adding new data sources
- `docs/roadmap.md` — Implementation roadmap for source scaling, historical import, monitoring
- `docs/competitive-analysis.md` — Harrier Central competitor analysis and strategic positioning
- `docs/kennel-page-redesign-spec.md` — Kennel profile enrichment and page redesign spec
- `docs/kennel-research/` — Regional kennel research (DC, Chicago, SF Bay, London — 40+ kennels)
- `docs/misman-attendance-requirements.md` — Kennel attendance management (misman tool) requirements
- `docs/misman-implementation-plan.md` — Sprint plan for misman feature (8a-8f)
- `docs/config-driven-onboarding-plan.md` — Config-driven source onboarding design (6-phase admin wizard)
- `docs/test-coverage-analysis.md` — Test coverage gap analysis and priorities

## Active Sources (29)

### NYC / NJ / Philly (7 sources)
- **hashnyc.com** → HTML_SCRAPER → 11 NYC-area kennels
- **Summit H3 Spreadsheet** → GOOGLE_SHEETS → 3 NJ kennels (Summit, SFM, ASSSH3)
- **BFM Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3
- **Philly H3 Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3
- **BFM Website** → HTML_SCRAPER → BFM
- **Philly H3 Website** → HTML_SCRAPER → Philly H3
- **Hash Rego** → HASHREGO → 8 kennels (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3)

### Boston (1 source)
- **Boston Hash Calendar** → GOOGLE_CALENDAR → 5 Boston kennels

### Chicago (3 sources)
- **Chicagoland Hash Calendar** → GOOGLE_CALENDAR → 11 Chicago-area kennels
- **Chicago Hash Website** → HTML_SCRAPER → CH3 (secondary)
- **Thirstday Hash Website** → HTML_SCRAPER → TH3 (secondary)

### DC / DMV (8 sources)
- **EWH3 Google Calendar** → GOOGLE_CALENDAR → EWH3
- **SHITH3 Google Calendar** → GOOGLE_CALENDAR → SHITH3
- **W3H3 Hareline Spreadsheet** → GOOGLE_SHEETS → W3H3 (West Virginia)
- **Charm City H3 iCal Feed** → ICAL_FEED → CCH3 (Baltimore)
- **BAH3 iCal Feed** → ICAL_FEED → BAH3 (Baltimore/Annapolis)
- **EWH3 WordPress Trail News** → HTML_SCRAPER → EWH3 (secondary)
- **DCH4 WordPress Trail Posts** → HTML_SCRAPER → DCH4
- **OFH3 Blogspot Trail Posts** → HTML_SCRAPER → OFH3
- **Hangover H3 DigitalPress Blog** → HTML_SCRAPER → H4

### SF Bay Area (2 sources)
- **SFH3 MultiHash iCal Feed** → ICAL_FEED → 13 SF Bay Area kennels
- **SFH3 MultiHash HTML Hareline** → HTML_SCRAPER → 13 SF Bay Area kennels (secondary)

### London / UK (7 sources)
- **London Hash Run List** → HTML_SCRAPER → LH3
- **City Hash Website** → HTML_SCRAPER → CityH3
- **West London Hash Website** → HTML_SCRAPER → WLH3
- **Barnes Hash Hare Line** → HTML_SCRAPER → BarnesH3
- **Old Coulsdon Hash Run List** → HTML_SCRAPER → OCH3
- **SLASH Run List** → HTML_SCRAPER → SLH3
- **Enfield Hash Blog** → HTML_SCRAPER → EH3

See `docs/source-onboarding-playbook.md` for how to add new sources.
See `docs/roadmap.md` for implementation roadmap.

## Testing
- **Framework:** Vitest with `globals: true` (no explicit imports needed)
- **Config:** `vitest.config.ts` — path alias `@/` maps to `./src`
- **Run:** `npm test` (83 test files)
- **Factories:** `src/test/factories.ts` — shared builders (`buildRawEvent`, `buildCalendarEvent`, `mockUser`)
- **Mocking pattern:** `vi.mock("@/lib/db")` + `vi.mocked(prisma.model.method)` with `as never` for partial returns
- **Exported helpers:** Pure functions in adapters/pipeline are exported for direct unit testing (additive-only, no behavior change)
- **Convention:** Test files live next to source files as `*.test.ts`
- **Coverage areas:**
  - Adapters: hashnyc HTML parsing, Google Calendar extraction, Google Sheets CSV parsing, iCal feed parsing, Blogger API v3 utility, London HTML scrapers (CityH3, WLH3, LH3, BarnesH3, OCH3, SLH3, EH3), Chicago scrapers (CH3, TH3), DC scrapers (EWH3, DCH4, OFH3, Hangover), SF Bay (SFH3 HTML), Philly (BFM, HashPhilly), Hash Rego (index parsing, detail parsing, multi-day splitting), Meetup.com API, WordPress REST API, shared adapter utilities
  - Pipeline: merge dedup + trust levels + source-kennel guard, kennel resolution (4-stage), fingerprinting, scrape orchestration, health analysis + alert generation, event reconciliation
  - AI: Gemini API wrapper (caching, rate-limit handling), parse recovery fallback
  - Server actions: logbook CRUD, profile, kennel subscriptions, admin CRUD, misman attendance/roster/history
  - Admin: config validation (with ReDoS detection), source type detection
  - Misman: audit log, hare sync, CSV import parsing, suggestion scoring, verification status, invite tokens
  - Region: region admin CRUD, hierarchy validation, merge re-parenting, self-parent guard
  - Strava: OAuth token refresh, activity date parsing, match suggestions, privacy zone handling
  - Utilities: format helpers, calendar URL/ICS generation, auth (Clerk→DB sync), fuzzy matching, timezone utilities, geo utilities (coordinate extraction, region colors), weather forecast (API integration, date matching, null handling)

## What NOT To Do
- Don't use Playwright for scraping (Cheerio is sufficient, 100x lighter)
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ — QStash handles job fan-out for scraping