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
- **Scraping:** HTTP fetch + Cheerio for static HTML; NAS-hosted headless Chrome (Playwright on external NAS, not in the app) for JS-rendered sites (Wix, Google Sites) via `browserRender()`; Blogger API v3 for Blogspot-hosted sites; GenericHtmlAdapter for config-driven CSS selector scraping; STATIC_SCHEDULE adapter for RRULE-based event generation; Meetup public REST API adapter; Harrier Central public REST API adapter (hashruns.org, config-driven)
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
- INDEXNOW_KEY=           # IndexNow API key (production only) — also served at /<key>.txt for ownership verification
- BING_SITE_VERIFICATION= # Bing Webmaster Tools msvalidate.01 token (optional, fallback if not DNS-verified)
- GOOGLE_SITE_VERIFICATION= # Google Search Console verification token (optional, fallback if not DNS-verified)

## Important Files
- `prisma/schema.prisma` — Full data model, 27 models + 20 enums (THE source of truth for types)
- `prisma/seed.ts` — 193 kennels, 600 aliases, 111 sources, 97 regions (first-class model with hierarchy)
- `prisma.config.ts` — Prisma 7 config (datasource URL, seed command)
- `src/lib/db.ts` — PrismaClient singleton (PrismaPg adapter + SSL)
- `src/lib/auth.ts` — `getOrCreateUser()` + `getAdminUser()` + `getMismanUser()` + `getRosterGroupId()` (Clerk→DB sync + admin/misman role checks)
- `src/lib/format.ts` — Shared utilities: time formatting, date formatting, participation levels, schedule formatting, social URL helpers
- `src/lib/region.ts` — Region seed data (78 regions), sync fallback lookups (timezone, colors, centroids, abbrev), region slug generation, RegionLevel hierarchy, `regionNameToData`
- `src/lib/calendar.ts` — Google Calendar URL + .ics file generation (client-side)
- `src/proxy.ts` — Clerk route protection (public vs authenticated routes) — Next.js 16 proxy convention
- `src/adapters/types.ts` — SourceAdapter interface + RawEventData types
- `src/adapters/registry.ts` — Adapter factory (SourceType → adapter instance)
- `src/adapters/html-scraper/hashnyc.ts` — hashnyc.com HTML scraper (Cheerio)
- `src/adapters/google-calendar/adapter.ts` — Google Calendar API v3 adapter (Boston Hash)
- `src/adapters/google-sheets/adapter.ts` — Google Sheets CSV adapter (Summit H3, W3H3, config-driven)
- `src/adapters/ical/adapter.ts` — iCal feed adapter (SFH3 MultiHash, node-ical)
- `src/adapters/hashrego/adapter.ts` — Hash Rego adapter (hashrego.com events, multi-kennel)
- `src/adapters/hashrego/parser.ts` — Hash Rego HTML parsing (index table, detail page, multi-day splitting)
- `src/adapters/meetup/adapter.ts` — Meetup.com public API adapter (event scraping, groupUrlname auto-detection)
- `src/adapters/harrier-central/adapter.ts` — Harrier Central public API adapter (hashruns.org, config-driven)
- `src/adapters/harrier-central/token.ts` — Time-based SHA-256 token generation for HC API
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
- `src/adapters/safe-fetch.ts` — URL-validated fetch with SSRF protection, opt-in residential proxy routing (`SafeFetchOptions`)
- `src/lib/browser-render.ts` — Headless browser rendering client (Wix, Google Sites, SPAs)
- `src/adapters/html-scraper/northboro-hash.ts` — Northboro H3 Wix site scraper (browser-rendered)
- `infra/browser-render/server.js` — NAS-hosted Playwright rendering service
- `src/adapters/html-scraper/enfield-hash.ts` — Enfield Hash blog scraper (EH3, uses Blogger API + residential proxy)
- `src/adapters/html-scraper/chicago-hash.ts` — Chicago Hash website scraper (CH3)
- `src/adapters/html-scraper/chicago-th3.ts` — Thirstday Hash website scraper (TH3)
- `src/adapters/html-scraper/sfh3.ts` — SFH3 MultiHash HTML hareline scraper (11 Bay Area kennels)
- `src/adapters/html-scraper/sdh3.ts` — SDH3 hareline + history scraper (10 SD kennels, 7,649 historical events)
- `src/adapters/html-scraper/ewh3.ts` — EWH3 WordPress trail news scraper
- `src/adapters/html-scraper/dch4.ts` — DCH4 WordPress trail posts scraper
- `src/adapters/html-scraper/ofh3.ts` — OFH3 Blogspot trail posts scraper
- `src/adapters/html-scraper/hangover.ts` — Hangover H3 DigitalPress blog scraper
- `src/adapters/html-scraper/shith3.ts` — SHITH3 website scraper (PHP REST API behind FullCalendar widget)
- `src/adapters/html-scraper/dublin-hash.ts` — Dublin H3 website hareline scraper
- `src/adapters/html-scraper/atlanta-hash-board.ts` — Atlanta Hash Board website scraper
- `src/adapters/html-scraper/wcfh-calendar.ts` — West Central Florida Hash calendar scraper
- `src/adapters/html-scraper/burlington-hash.ts` — Burlington H3 website hareline scraper (Vermont)
- `src/adapters/html-scraper/rih3.ts` — Rhode Island H3 website hareline scraper
- `src/adapters/html-scraper/soh4.ts` — SOH4 RSS+iCal adapter (Syracuse, NY)
- `src/adapters/html-scraper/halvemein.ts` — Halve Mein PHP table adapter (Capital District, NY)
- `src/adapters/html-scraper/ithaca-h3.ts` — IH3 hare-line adapter (Ithaca, NY)
- `src/adapters/html-scraper/hockessin.ts` — Hockessin H3 90s-era HTML scraper (H4, Delaware)
- `src/adapters/html-scraper/generic.ts` — Generic config-driven HTML scraper (CSS selector-based, AI-assisted setup)
- `src/adapters/html-scraper/examples.ts` — Static adapter pattern catalog for AI few-shot learning (7 layout examples)
- `src/adapters/static-schedule/adapter.ts` — STATIC_SCHEDULE adapter (RRULE-based event generation, no external fetch)
- `src/adapters/utils.ts` — Shared adapter utilities (date parsing, field extraction)
- `src/pipeline/merge.ts` — Raw→Canonical merge pipeline (fingerprint dedup + source-kennel guard)
- `src/pipeline/kennel-resolver.ts` — Alias-based kennel name resolution (with pattern fallback)
- `src/pipeline/scrape.ts` — Shared `scrapeSource()` used by cron + admin routes
- `src/pipeline/health.ts` — Rolling-window health analysis + alert generation
- `src/pipeline/reconcile.ts` — Stale event reconciliation (cancels removed source events)
- `src/pipeline/fill-rates.ts` — Per-field fill rate computation for RawEvents
- `src/pipeline/structure-hash.ts` — HTML structural fingerprinting (SHA-256)
- `src/pipeline/auto-issue.ts` — Auto-file GitHub issues from alerts (adapter resolution, rate limiting, cooldown, dedup, AGENT_CONTEXT)
- `src/pipeline/verify-fixes.ts` — Post-merge fix verification (removes pending-verification label, posts confirmation comment)
- `src/pipeline/html-analysis.ts` — Reusable HTML event analysis + Gemini column mapping (no auth, used by research pipeline)
- `src/pipeline/source-research.ts` — Autonomous source research pipeline (URL discovery, classification, analysis, proposal persistence)
- `src/app/admin/alerts/actions.ts` — Alert repair actions (re-scrape, create alias/kennel, link kennel to source, file GitHub issue)
- `src/app/admin/regions/actions.ts` — Region CRUD, merge, AI suggestions (rule-based + Gemini), hierarchy validation
- `src/app/admin/regions/page.tsx` — Admin region management page (RegionTable + RegionSuggestionsPanel)
- `src/app/admin/events/actions.ts` — Admin event management (delete, bulk delete with cascade)
- `src/app/admin/misman-requests/page.tsx` — Admin misman request approval (reuses misman server actions)
- `src/app/admin/sources/new/page.tsx` — Source onboarding wizard (multi-phase guided setup with preview)
- `src/app/admin/sources/analyze-html-action.ts` — AI HTML structure analysis + Gemini column mapping + refinement (delegates to pipeline/html-analysis)
- `src/app/admin/research/actions.ts` — Source research server actions (research, approve/reject proposals, URL update, feedback refinement)
- `src/app/admin/research/page.tsx` — Admin source research page (region-based research, proposal review/approval)
- `src/app/admin/sources/config-validation.ts` — Server-side config validation with ReDoS safety (safe-regex2)
- `src/components/kennels/QuickInfoCard.tsx` — Kennel quick info card (schedule, hash cash, website, flags)
- `src/components/kennels/SocialLinks.tsx` — Kennel social links icon row (Facebook, Instagram, X, Discord, etc.)
- `src/components/kennels/KennelStats.tsx` — Kennel computed stats (total events, oldest event, next run)
- `src/components/kennels/KennelCard.tsx` — Kennel card: shortName heading, schedule, description, founded year, next run, RegionBadge
- `src/components/kennels/KennelDirectory.tsx` — Kennel directory: search, filters, sort (A–Z / Recently Active), URL persistence
- `src/components/kennels/KennelFilters.tsx` — Filter bar: region, run day, frequency, has upcoming, country
- `src/components/admin/AlertCard.tsx` — Alert card with repair actions, context display, repair history
- `src/components/admin/ResearchDashboard.tsx` — Source research dashboard (region selector, coverage gaps, proposal table, status filters)
- `src/components/admin/ProposalApprovalDialog.tsx` — Proposal review dialog (URL edit, feedback refinement, config editor, approve/reject)
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
- `src/lib/geo.ts` — Coordinate utilities: extractCoordsFromMapsUrl (4 URL patterns), getEventCoords, haversineDistance, geocodeAddress, REGION_CENTROIDS, DISTANCE_OPTIONS; region color/centroid helpers re-exported from region.ts
- `src/lib/weather.ts` — Google Weather API fetch utility (getEventDayWeather, 30-min cache, region centroid fallback)
- `src/components/hareline/EventLocationMap.tsx` — Static map image (Google Maps Static API; accepts coords or text address fallback)
- `src/hooks/useGeolocation.ts` — Browser geolocation hook (GeoState: idle/loading/granted/denied)
- `src/components/kennels/KennelMapView.tsx` — Interactive kennel map (individual + region aggregate pins)
- `src/components/shared/NearMeFilter.tsx` — Distance filter UI (geolocation + distance options)
- `src/app/admin/kennels/backfill-action.ts` — Geocode backfill for kennel lat/lng
- `src/components/hareline/MapView.tsx` — Interactive map tab for Hareline (@vis.gl/react-google-maps, region-colored pins)
- `src/components/hareline/EventWeatherCard.tsx` — Weather forecast display (condition emoji, °F/°C, precip ≥20%)
- `src/components/providers/units-preference-provider.tsx` — °F/°C preference context (localStorage-based, useUnitsPreference hook)
- `src/lib/analytics.ts` — Typed client-side PostHog event capture wrapper (`capture()`, `identifyUser()`)
- `src/lib/analytics-server.ts` — Server-side PostHog client (`captureServerEvent()` with flush for Vercel serverless)
- `src/components/providers/posthog-provider.tsx` — PostHog client init, privacy-first config, custom pageview hook, `/ingest` reverse proxy
- `src/components/providers/posthog-identify.tsx` — PostHog + Sentry user identification on Clerk login
- `sentry.client.config.ts` — Sentry client-side initialization
- `sentry.server.config.ts` — Sentry server-side initialization
- `sentry.edge.config.ts` — Sentry edge runtime initialization
- `src/instrumentation.ts` — Next.js instrumentation hook (Sentry server/edge init + request error capture)
- `src/app/global-error.tsx` — Global error boundary with Sentry capture
- `src/app/admin/analytics/actions.ts` — Server actions for community health, user engagement, operational metrics
- `src/app/admin/analytics/page.tsx` — Admin analytics dashboard (recharts)
- `src/components/admin/AnalyticsDashboard.tsx` — Dashboard UI: charts, stat cards, tables (community/engagement/operational)
- `vercel.json` — Vercel Cron config (triggers QStash dispatch at 6:00 AM UTC)
- `src/lib/qstash.ts` — QStash Client + Receiver singletons (Upstash fan-out queue)
- `src/lib/cron-auth.ts` — Dual auth: QStash signature verification → Bearer CRON_SECRET fallback
- `src/pipeline/schedule.ts` — Shared scheduling logic (shouldScrape, frequency intervals)
- `src/app/api/cron/dispatch/route.ts` — Fan-out dispatcher: queries due sources, publishes QStash messages
- `src/app/api/cron/scrape/[sourceId]/route.ts` — Per-source scrape endpoint (called by QStash)
- `vitest.config.ts` — Test runner config (globals, path aliases)
- `src/test/factories.ts` — Shared test data builders
- `.github/workflows/ci.yml` — CI gate: type check, lint, tests on all PRs + push to main
- `.github/workflows/claude.yml` — Claude Code interactive (issue/PR @claude mentions, label_trigger: claude-fix)
- `.github/workflows/claude-issue-triage.yml` — AI triage: reads alert issue, posts confidence-scored diagnosis, labels claude-autofix or needs-human
- `.github/workflows/claude-autofix.yml` — AI fix: implements code changes, runs tests, creates PR (safe zone: adapters, seed.ts, test files only; rate-limited to 5 PRs/day)
- `.github/workflows/claude-post-merge.yml` — Post-merge: adds pending-verification label + tracking comment on linked issue

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
- `docs/self-healing-automation-plan.md` — Self-healing automation loop architecture, confidence scoring rubric, implementation roadmap
- `infra/proxy-relay/` — NAS-deployed residential proxy (Cloudflare Tunnel + Node.js forwarder)
- `infra/browser-render/` — NAS-hosted Playwright rendering service (Dockerfile + server.js). Part of proxy-relay Docker Compose stack.
- `docs/residential-proxy-spec.md` — Architecture and deployment guide for residential proxy

## Active Sources (155)

### NYC / NJ / Philly (8 sources)
- **hashnyc.com** → HTML_SCRAPER → 11 NYC-area kennels
- **Summit H3 Spreadsheet** → GOOGLE_SHEETS → 3 NJ kennels (Summit, SFM, ASSSH3)
- **Rumson H3 Static Schedule** → STATIC_SCHEDULE → Rumson H3
- **BFM Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3
- **Philly H3 Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3
- **BFM Website** → HTML_SCRAPER → BFM
- **Philly H3 Website** → HTML_SCRAPER → Philly H3
- **Hash Rego** → HASHREGO → 8 kennels (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3)

### Massachusetts (4 sources)
- **Boston Hash Calendar** → GOOGLE_CALENDAR → 5 Boston kennels
- **Happy Valley H3 Static Schedule** → STATIC_SCHEDULE → HVH3
- **PooFlingers H3 Static Schedule** → STATIC_SCHEDULE → PooFH3
- **Northboro H3 Website** → HTML_SCRAPER (browser-rendered) → NbH3

### Chicago (3 sources)
- **Chicagoland Hash Calendar** → GOOGLE_CALENDAR → 11 Chicago-area kennels
- **Chicago Hash Website** → HTML_SCRAPER → CH3 (secondary)
- **Thirstday Hash Website** → HTML_SCRAPER → TH3 (secondary)

### DC / DMV (10 sources)
- **EWH3 Google Calendar** → GOOGLE_CALENDAR → EWH3
- **SHITH3 Google Calendar** → GOOGLE_CALENDAR → SHITH3
- **SHITH3 Website** → HTML_SCRAPER → SHITH3 (PHP REST API, secondary enrichment)
- **W3H3 Hareline Spreadsheet** → GOOGLE_SHEETS → W3H3 (West Virginia)
- **Charm City H3 iCal Feed** → ICAL_FEED → CCH3 (Baltimore)
- **BAH3 iCal Feed** → ICAL_FEED → BAH3 (Baltimore/Annapolis)
- **EWH3 WordPress Trail News** → HTML_SCRAPER → EWH3 (secondary)
- **DCH4 WordPress Trail Posts** → HTML_SCRAPER → DCH4
- **OFH3 Blogspot Trail Posts** → HTML_SCRAPER → OFH3
- **Hangover H3 DigitalPress Blog** → HTML_SCRAPER → H4

### SF Bay Area (3 sources)
- **SFH3 MultiHash iCal Feed** → ICAL_FEED → 13 SF Bay Area kennels
- **SFH3 MultiHash HTML Hareline** → HTML_SCRAPER → 13 SF Bay Area kennels (secondary)
- **Surf City H3 Google Calendar** → GOOGLE_CALENDAR → SCH3 (Santa Cruz)

### Southern California (12 sources)
- **LAH3 Google Calendar** → GOOGLE_CALENDAR → LAH3
- **LBH3 Google Calendar** → GOOGLE_CALENDAR → LBH3
- **TDH3 Google Calendar** → GOOGLE_CALENDAR → TDH3
- **GAL Google Calendar** → GOOGLE_CALENDAR → GAL
- **SUPH3 Google Calendar** → GOOGLE_CALENDAR → SUPH3
- **Foothill H3 Google Calendar** → GOOGLE_CALENDAR → FtH3
- **East LA H3 Google Calendar** → GOOGLE_CALENDAR → ELAH3
- **Signal Hill H3 Google Calendar** → GOOGLE_CALENDAR → SGH3
- **OCHHH Google Calendar** → GOOGLE_CALENDAR → OCHHH
- **OC Hump Google Calendar** → GOOGLE_CALENDAR → OC Hump
- **SLOH3 Google Calendar** → GOOGLE_CALENDAR → SLOH3
- **SDH3 Hareline** → HTML_SCRAPER → 10 San Diego kennels (SDH3, CLH3, LJH3, NCH3, IRH3, Humpin', FMH3, HAH3, MH4, DRH3) + 7,649 historical events

### Washington (8 sources)
- **WA Hash Google Calendar** → GOOGLE_CALENDAR → 12 Seattle-area kennels (SH3, PSH3, NBH3, RCH3, SeaMon, TH3, SSH3, CUNTh, Taint, Giggity, SEH3, HSWTF)
- **SH3 Hareline Spreadsheet** → GOOGLE_SHEETS → SH3 (Seattle)
- **PSH3 Hareline Spreadsheet** → GOOGLE_SHEETS → PSH3 (Puget Sound)
- **NBH3 Hareline Spreadsheet** → GOOGLE_SHEETS → NBH3 (No Balls)
- **RCH3 Hareline Spreadsheet** → GOOGLE_SHEETS → RCH3 (Rain City)
- **SeaMon H3 Hareline Spreadsheet** → GOOGLE_SHEETS → SeaMon
- **Leap Year H3 Hareline Spreadsheet** → GOOGLE_SHEETS → Leap Year

### Colorado (5 sources)
- **Denver H3 Google Calendar** → GOOGLE_CALENDAR → DH3
- **Mile High Humpin Hash Calendar** → GOOGLE_CALENDAR → MiHiHuHa
- **Colorado H3 Aggregator Calendar** → GOOGLE_CALENDAR → BH3 (Boulder), MiHiHuHa (secondary)
- **Fort Collins H3 Google Calendar** → GOOGLE_CALENDAR → FCH3
- **Colorado Springs H3 Calendar** → GOOGLE_CALENDAR → PPH4, Kimchi, DIM (3 CS kennels via kennelPatterns)

### Kansas (2 sources)
- **Tornado Alley H3 Google Calendar** → GOOGLE_CALENDAR → TAH3 (Wichita)
- **Larryville H3 Google Calendar** → GOOGLE_CALENDAR → LH3 (Lawrence)

### Minnesota (1 source)
- **Minneapolis H3 Calendar** → GOOGLE_CALENDAR → MH3, T3H3 (2 kennels via kennelPatterns)

### Michigan (3 sources)
- **MoA2H3 Google Calendar** → GOOGLE_CALENDAR → MoA2H3 (Detroit/Ann Arbor)
- **DeMon H3 Google Calendar** → GOOGLE_CALENDAR → DeMon (Detroit Monday)
- **GLH3 Google Calendar** → GOOGLE_CALENDAR → GLH3 (Greater Lansing)

### Arizona (4 sources)
- **Phoenix H3 Events** → ICAL_FEED → LBH, Hump D, Wrong Way, FDTDD (4 Phoenix kennels via kennelPatterns)
- **jHavelina H3 Google Calendar** → GOOGLE_CALENDAR → jHav (Tucson)
- **Mr. Happy's H3 Google Calendar** → GOOGLE_CALENDAR → Mr. Happy's (Tucson)
- **Pedal Files Bash Google Calendar** → GOOGLE_CALENDAR → Pedal Files (Tucson bike hash)

### Hawaii (2 sources)
- **Aloha H3 Google Calendar** → GOOGLE_CALENDAR → AH3, H5 (2 Honolulu kennels via kennelPatterns)
- **Honolulu H5 Google Calendar** → GOOGLE_CALENDAR → H5

### London / UK (7 sources)
- **London Hash Run List** → HTML_SCRAPER → LH3
- **City Hash Website** → HTML_SCRAPER → CityH3
- **West London Hash Website** → HTML_SCRAPER → WLH3
- **Barnes Hash Hare Line** → HTML_SCRAPER → BarnesH3
- **Old Coulsdon Hash Run List** → HTML_SCRAPER → OCH3
- **SLASH Run List** → HTML_SCRAPER → SLH3
- **Enfield Hash Blog** → HTML_SCRAPER → EH3

### Scotland (2 sources)
- **Glasgow H3 Hareline** → HTML_SCRAPER (GenericHtml) → Glasgow H3
- **Edinburgh H3 Hareline** → HTML_SCRAPER → Edinburgh H3

### Bristol (1 source)
- **West of England Hash Run List** → HTML_SCRAPER (GenericHtml) → Bristol H3, GREY, BOGS (3 kennels)

### Ireland (1 source)
- **Dublin H3 Website Hareline** → HTML_SCRAPER → DH3

### Germany (4 sources)
- **Berlin H3 iCal Feed** → ICAL_FEED → BH3, BH3FM (2 Berlin kennels)
- **Stuttgart H3 Google Calendar** → GOOGLE_CALENDAR → SH3, DST, FM, SUPER (4 Stuttgart kennels)
- **Munich H3 Hareline Sheet** → GOOGLE_SHEETS → MH3 (Munich)
- **Frankfurt H3 Hareline** → HTML_SCRAPER → FH3, FFMH3, SHITS, DOM, Bike Hash (5 Frankfurt kennels)

### Japan (4 sources)
- **Tokyo H3 Harrier Central** → HARRIER_CENTRAL → Tokyo H3
- **KFMH3 Google Calendar** → GOOGLE_CALENDAR → KFMH3
- **Kyoto H3 Google Calendar** → GOOGLE_CALENDAR → Kyoto H3
- **Osaka H3 Google Calendar** → GOOGLE_CALENDAR → Osaka H3

### Florida (8 sources)
- **Miami H3 Meetup** → MEETUP → MH3
- **Key West H3 Google Calendar** → GOOGLE_CALENDAR → KWH3
- **O2H3 Google Calendar** → GOOGLE_CALENDAR → O2H3
- **West Central FL Hash Calendar** → HTML_SCRAPER → WCFH3 + FL kennels
- **Wildcard H3 Static Schedule** → STATIC_SCHEDULE → WildH3
- **H6 Static Schedule** → STATIC_SCHEDULE → H6
- **PBH3 Static Schedule** → STATIC_SCHEDULE → PBH3
- **GATR H3 Static Schedule** → STATIC_SCHEDULE → GATR

### Georgia (11 sources)
- **Savannah H3 Meetup** → MEETUP → SavH3
- **Atlanta Hash Board** → HTML_SCRAPER → ATL kennels
- **SCH3 Static Schedule** → STATIC_SCHEDULE → SCH3
- **HMH3 Static Schedule** → STATIC_SCHEDULE → HMH3
- **CUNT H3 ATL Static Schedule** → STATIC_SCHEDULE → CUNTH3
- **PFH3 Static Schedule** → STATIC_SCHEDULE → PFH3
- **AUGH3 Static Schedule** → STATIC_SCHEDULE → AUGH3
- **MGH4 Static Schedule** → STATIC_SCHEDULE → MGH4
- **W3H3 GA Static Schedule** → STATIC_SCHEDULE → W3H3-GA
- **CVH3 Static Schedule** → STATIC_SCHEDULE → CVH3
- **R2H3 Static Schedule** → STATIC_SCHEDULE → R2H3

### South Carolina (10 sources)
- **Charleston Heretics Meetup** → MEETUP → CHH3
- **Charleston H3 Static Schedule** → STATIC_SCHEDULE → CH3-SC
- **BUDH3 Static Schedule** → STATIC_SCHEDULE → BUDH3
- **Columbian H3 Static Schedule (1st Sunday)** → STATIC_SCHEDULE → ColH3
- **Columbian H3 Static Schedule (3rd Sunday)** → STATIC_SCHEDULE → ColH3
- **Secession H3 Static Schedule** → STATIC_SCHEDULE → SecH3
- **Palmetto H3 Static Schedule** → STATIC_SCHEDULE → PalH3
- **Upstate H3 Static Schedule** → STATIC_SCHEDULE → UH3
- **GOTH3 Static Schedule** → STATIC_SCHEDULE → GOTH3
- **Grand Strand H3 Static Schedule** → STATIC_SCHEDULE → GSH3

### Texas (10 sources)
- **Austin H3 Calendar** → GOOGLE_CALENDAR → AH3
- **Keep Austin Weird H3 Calendar** → GOOGLE_CALENDAR → KAW!H3
- **Houston Hash Calendar** → GOOGLE_CALENDAR → H4
- **Brass Monkey H3 Blog** → HTML_SCRAPER (Blogger API) → BMH3
- **Mosquito H3 Static Schedule (1st Wed)** → STATIC_SCHEDULE → Mosquito H3
- **Mosquito H3 Static Schedule (3rd Wed)** → STATIC_SCHEDULE → Mosquito H3
- **DFW Hash Calendar** → HTML_SCRAPER (PHP calendar) → DH3, DUHHH, NODUHHH, FWH3
- **Corpus Christi H3 Calendar** → GOOGLE_CALENDAR → C2H3
- *SAH3 (San Antonio) — kennel record only, no source (seasonal schedule TBD)*

### Upstate New York (6 sources)
- **Flour City H3 Google Calendar** → GOOGLE_CALENDAR → FCH3 (Rochester)
- **SOH4 Website** → HTML_SCRAPER (RSS+iCal) → SOH4 (Syracuse)
- **Halve Mein Website** → HTML_SCRAPER (PHP table) → HMHHH (Capital District)
- **IH3 Website Hareline** → HTML_SCRAPER (WordPress hare-line) → IH3 (Ithaca)
- **Buffalo H3 Google Calendar** → GOOGLE_CALENDAR → BH3 (Buffalo)
- **Hudson Valley H3 Meetup** → MEETUP → HVH3-NY (Hudson Valley)

### Pennsylvania (outside Philly) (6 sources)
- **Pittsburgh Hash Calendar** → GOOGLE_CALENDAR → PGH H3 (Pittsburgh)
- **Iron City H3 iCal Feed** → ICAL_FEED → ICH3 (Pittsburgh)
- **Nittany Valley H3 Calendar** → GOOGLE_CALENDAR → NVHHH (State College)
- **LVH3 Hareline Calendar** → GOOGLE_CALENDAR → LVH3 (Lehigh Valley)
- **Reading H3 Localendar** → ICAL_FEED → RH3 (Reading)
- **H5 Google Calendar** → GOOGLE_CALENDAR → H5 (Harrisburg)

### Delaware (1 source)
- **Hockessin H3 Website** → HTML_SCRAPER → H4 (Wilmington)

### Virginia (outside DC metro) (9 sources)
- **Richmond H3 Google Calendar** → GOOGLE_CALENDAR → RH3 (Richmond)
- **Richmond H3 Meetup** → MEETUP → RH3 (Richmond)
- **Fort Eustis H3 Google Calendar** → GOOGLE_CALENDAR → FEH3 (Hampton Roads)
- **Fort Eustis H3 Meetup** → MEETUP → FEH3 (Hampton Roads)
- **BDSM H3 Meetup** → MEETUP → BDSMH3 (Hampton Roads)
- **cHARLOTtesville H3 Meetup** → MEETUP → CvilleH3 (Charlottesville)
- **FUH3 Static Schedule** → STATIC_SCHEDULE → FUH3 (Fredericksburg)
- **Tidewater H3 Static Schedule** → STATIC_SCHEDULE → TH3 (Hampton Roads)
- **Seven Hills H3 Static Schedule** → STATIC_SCHEDULE → 7H4 (Lynchburg)

### North Carolina (6 sources)
- **SWH3 Google Calendar** → GOOGLE_CALENDAR → SWH3 (Raleigh)
- **Carolina Larrikins Google Calendar** → GOOGLE_CALENDAR → Larrikins (Raleigh)
- **Charlotte H3 Meetup** → MEETUP → CH3 (Charlotte)
- **Asheville H3 Meetup** → MEETUP → AVLH3 (Asheville)
- **Cape Fear H3 Website** → HTML_SCRAPER → CFH3 (Wilmington, NC)
- **Carolina Trash H3 Meetup** → MEETUP → CTrH3 (Fayetteville)

### New England (5 sources)
- **Von Tramp H3 Meetup** → MEETUP → VTH3 (Vermont)
- **Burlington H3 Website Hareline** → HTML_SCRAPER → BurH3 (Vermont)
- **RIH3 Static Schedule** → STATIC_SCHEDULE → RIH3 (Rhode Island)
- **RIH3 Website Hareline** → HTML_SCRAPER → RIH3 (Rhode Island)
- **Narwhal H3 Meetup (CTH3)** → MEETUP → CTH3 (Connecticut)

See `docs/source-onboarding-playbook.md` for how to add new sources.
See `docs/roadmap.md` for implementation roadmap.

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
- `rules/active-sources.md` — 146 active data sources by region (loads for adapter/pipeline work)
- `rules/important-files.md` — 200+ file references by domain area
- `rules/database.md` — Railway DB connection and Prisma workflow (loads for `prisma/*` and `.env*`)
- `rules/nas-deployment.md` — NAS Docker deployment commands (loads for `infra/*`)
- `rules/adapter-patterns.md` — Adapter coding conventions and patterns (loads for adapter work)
- `rules/testing-coverage.md` — Detailed test coverage areas (loads for test files)
- `rules/documentation-index.md` — Docs directory index (loads for `docs/*`)
- `rules/live-verification.md` — Mandatory live adapter verification (loads for adapter work)

## What NOT To Do
- Don't use Playwright **in the app** for scraping — use the NAS browser render service for JS-rendered sites, Cheerio for everything else
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ — QStash handles job fan-out for scraping
