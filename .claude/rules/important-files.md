---
description: File reference for HashTracks codebase — key files by domain area
globs:
  - src/adapters/**
  - src/pipeline/**
  - src/lib/**
  - src/app/admin/**
  - src/app/misman/**
  - prisma/**
---

# Important Files

## Core
- `prisma/schema.prisma` — Full data model, 27 models + 20 enums (THE source of truth for types)
- `prisma/seed.ts` — 152 kennels, 481 aliases, 69 sources, 64 regions (first-class model with hierarchy)
- `prisma.config.ts` — Prisma 7 config (datasource URL, seed command)
- `src/lib/db.ts` — PrismaClient singleton (PrismaPg adapter + SSL)
- `src/lib/auth.ts` — `getOrCreateUser()` + `getAdminUser()` + `getMismanUser()` + `getRosterGroupId()` (Clerk→DB sync + admin/misman role checks)
- `src/lib/format.ts` — Shared utilities: time formatting, date formatting, participation levels, schedule formatting, social URL helpers
- `src/lib/region.ts` — Region seed data (64 regions), sync fallback lookups (timezone, colors, centroids, abbrev), region slug generation, RegionLevel hierarchy, `regionNameToData`
- `src/lib/calendar.ts` — Google Calendar URL + .ics file generation (client-side)
- `src/proxy.ts` — Clerk route protection (public vs authenticated routes) — Next.js 16 proxy convention

## Adapters
- `src/adapters/types.ts` — SourceAdapter interface + RawEventData types
- `src/adapters/registry.ts` — Adapter factory (SourceType → adapter instance)
- `src/adapters/html-scraper/hashnyc.ts` — hashnyc.com HTML scraper (Cheerio)
- `src/adapters/google-calendar/adapter.ts` — Google Calendar API v3 adapter (Boston Hash)
- `src/adapters/google-sheets/adapter.ts` — Google Sheets CSV adapter (Summit H3, W3H3, config-driven)
- `src/adapters/ical/adapter.ts` — iCal feed adapter (SFH3 MultiHash, node-ical)
- `src/adapters/hashrego/adapter.ts` — Hash Rego adapter (hashrego.com events, multi-kennel)
- `src/adapters/hashrego/parser.ts` — Hash Rego HTML parsing (index table, detail page, multi-day splitting)
- `src/adapters/meetup/adapter.ts` — Meetup.com public API adapter (event scraping, groupUrlname auto-detection)
- `src/adapters/harrier-central/adapter.ts` — Harrier Central public API adapter (hashruns.org, config-driven, 69+ kennels)
- `src/adapters/harrier-central/token.ts` — Time-based SHA-256 token generation for Harrier Central API
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
- `src/adapters/html-scraper/generic.ts` — Generic config-driven HTML scraper (CSS selector-based, AI-assisted setup)
- `src/adapters/html-scraper/examples.ts` — Static adapter pattern catalog for AI few-shot learning (7 layout examples)
- `src/adapters/static-schedule/adapter.ts` — STATIC_SCHEDULE adapter (RRULE-based event generation, no external fetch)
- `src/adapters/utils.ts` — Shared adapter utilities (date parsing, field extraction)

## Pipeline
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

## Admin
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

## UI Components
- `src/components/kennels/QuickInfoCard.tsx` — Kennel quick info card (schedule, hash cash, website, flags)
- `src/components/kennels/SocialLinks.tsx` — Kennel social links icon row (Facebook, Instagram, X, Discord, etc.)
- `src/components/kennels/KennelStats.tsx` — Kennel computed stats (total events, oldest event, next run)
- `src/components/kennels/KennelCard.tsx` — Kennel card: shortName heading, schedule, description, founded year, next run, RegionBadge
- `src/components/kennels/KennelDirectory.tsx` — Kennel directory: search, filters, sort (A–Z / Recently Active), URL persistence
- `src/components/kennels/KennelFilters.tsx` — Filter bar: region, run day, frequency, has upcoming, country
- `src/components/admin/AlertCard.tsx` — Alert card with repair actions, context display, repair history
- `src/components/admin/ResearchDashboard.tsx` — Source research dashboard (region selector, coverage gaps, proposal table, status filters)
- `src/components/admin/ProposalApprovalDialog.tsx` — Proposal review dialog (URL edit, feedback refinement, config editor, approve/reject)

## Misman (Attendance Management)
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

## Strava Integration
- `src/lib/strava/client.ts` — Strava OAuth token management (exchange, refresh, revoke)
- `src/lib/strava/sync.ts` — Strava activity sync, date string extraction, match suggestions
- `src/app/strava/actions.ts` — Strava server actions (connect, disconnect, sync, attach to attendance)
- `src/components/logbook/StravaNudgeBanner.tsx` — Strava sync reminder banner on logbook page

## Shared UI & Utilities
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

## Analytics & Error Tracking
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

## Infrastructure & CI
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
- `docs/residential-proxy-spec.md` — Architecture and deployment guide for residential proxy
