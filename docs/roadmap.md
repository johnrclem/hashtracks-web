# HashTracks Roadmap

Living document tracking what's been built, what's next, and where we're headed.

Last updated: 2026-03-13

**Competitive context:** See [competitive-analysis.md](competitive-analysis.md) for detailed analysis of Harrier Central (the primary competitor), user pain points from their GitHub issues, and strategic positioning rationale behind these priorities.

---

## What's Built

### Core Platform (Sprints 1-4 + Polish)
- [x] Next.js 16 App Router, Prisma 7, Clerk auth, Railway PostgreSQL, Vercel deployment
- [x] Kennel directory with subscriptions, profiles, admin tools
- [x] Source engine: adapter framework, merge pipeline, fingerprint dedup, kennel resolver
- [x] Hareline: list/calendar views, filters (region, kennel, day, scope), URL persistence
- [x] Master-detail layout: event list + detail panel on desktop, full-page on mobile
- [x] Admin UI: source management, manual scrape trigger, scrape logs, source health

### Data Sources (69 live)

**NYC / NJ / Philly (8 sources)**
- [x] **hashnyc.com** (HTML Scraper) — 11 NYC-area kennels
- [x] **Summit H3 Spreadsheet** (Google Sheets) — 3 NJ kennels (Summit, SFM, ASSSH3)
- [x] **Rumson H3 Static Schedule** (Static Schedule) — Rumson H3 (weekly Saturday)
- [x] **BFM Google Calendar** (Google Calendar API) — BFM, Philly H3
- [x] **Philly H3 Google Calendar** (Google Calendar API) — BFM, Philly H3
- [x] **BFM Website** (HTML Scraper) — benfranklinmob.com + special events page
- [x] **Philly H3 Website** (HTML Scraper) — hashphilly.com/nexthash/
- [x] **Hash Rego** (Hash Rego) — BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3, FCH3 (multi-region aggregator)

**Massachusetts (4 sources)**
- [x] **Boston Hash Calendar** (Google Calendar API) — 5 Boston kennels
- [x] **Happy Valley H3 Static Schedule** (Static Schedule) — HVH3 (Pioneer Valley)
- [x] **PooFlingers H3 Static Schedule** (Static Schedule) — PooFH3
- [x] **Northboro H3 Website** (HTML Scraper, browser-rendered) — NbH3 (Wix site)

**Chicago (3 sources)**
- [x] **Chicagoland Hash Calendar** (Google Calendar API) — 11 Chicago-area kennels
- [x] **Chicago Hash Website** (HTML Scraper) — CH3 (secondary enrichment)
- [x] **Thirstday Hash Website** (HTML Scraper) — TH3 (secondary enrichment)

**DC / DMV (10 sources)**
- [x] **EWH3 Google Calendar** (Google Calendar API) — EWH3
- [x] **SHITH3 Google Calendar** (Google Calendar API) — SHITH3
- [x] **SHITH3 Website** (HTML Scraper) — SHITH3 (PHP REST API, secondary enrichment with hares, locations, distances)
- [x] **W3H3 Hareline Spreadsheet** (Google Sheets) — W3H3 (West Virginia)
- [x] **Charm City H3 iCal Feed** (iCal Feed) — CCH3 (Baltimore)
- [x] **BAH3 iCal Feed** (iCal Feed) — BAH3 (Baltimore/Annapolis)
- [x] **EWH3 WordPress Trail News** (HTML Scraper) — EWH3 (secondary enrichment)
- [x] **DCH4 WordPress Trail Posts** (HTML Scraper) — DCH4
- [x] **OFH3 Blogspot Trail Posts** (HTML Scraper) — OFH3
- [x] **Hangover H3 DigitalPress Blog** (HTML Scraper) — H4

**SF Bay Area (2 sources)**
- [x] **SFH3 MultiHash iCal Feed** (iCal Feed) — 13 SF Bay Area kennels
- [x] **SFH3 MultiHash HTML Hareline** (HTML Scraper) — 13 SF Bay Area kennels (secondary enrichment)

**London / UK (7 sources)**
- [x] **London Hash Run List** (HTML Scraper) — LH3
- [x] **City Hash Website** (HTML Scraper) — CityH3
- [x] **West London Hash Website** (HTML Scraper) — WLH3
- [x] **Barnes Hash Hare Line** (HTML Scraper) — BarnesH3
- [x] **Old Coulsdon Hash Run List** (HTML Scraper) — OCH3
- [x] **SLASH Run List** (HTML Scraper) — SLH3 (South London)
- [x] **Enfield Hash Blog** (HTML Scraper) — EH3

**Ireland (1 source)**
- [x] **Dublin H3 Website Hareline** (HTML Scraper) — DH3

**Florida (8 sources)**
- [x] **Miami H3 Meetup** (Meetup) — MH3
- [x] **Key West H3 Google Calendar** (Google Calendar API) — KWH3
- [x] **O2H3 Google Calendar** (Google Calendar API) — O2H3
- [x] **West Central FL Hash Calendar** (HTML Scraper) — WCFH3 + FL kennels
- [x] **Wildcard H3 Static Schedule** (Static Schedule) — WildH3
- [x] **H6 Static Schedule** (Static Schedule) — H6
- [x] **PBH3 Static Schedule** (Static Schedule) — PBH3
- [x] **GATR H3 Static Schedule** (Static Schedule) — GATR

**Georgia (11 sources)**
- [x] **Savannah H3 Meetup** (Meetup) — SavH3
- [x] **Atlanta Hash Board** (HTML Scraper) — ATL-area kennels
- [x] **SCH3 Static Schedule** (Static Schedule) — SCH3
- [x] **HMH3 Static Schedule** (Static Schedule) — HMH3
- [x] **CUNT H3 ATL Static Schedule** (Static Schedule) — CUNTH3
- [x] **PFH3 Static Schedule** (Static Schedule) — PFH3
- [x] **AUGH3 Static Schedule** (Static Schedule) — AUGH3
- [x] **MGH4 Static Schedule** (Static Schedule) — MGH4
- [x] **W3H3 GA Static Schedule** (Static Schedule) — W3H3-GA
- [x] **CVH3 Static Schedule** (Static Schedule) — CVH3
- [x] **R2H3 Static Schedule** (Static Schedule) — R2H3

**South Carolina (10 sources)**
- [x] **Charleston Heretics Meetup** (Meetup) — CHH3
- [x] **Charleston H3 Static Schedule** (Static Schedule) — CH3-SC
- [x] **BUDH3 Static Schedule** (Static Schedule) — BUDH3
- [x] **Columbian H3 Static Schedule (1st Sunday)** (Static Schedule) — ColH3
- [x] **Columbian H3 Static Schedule (3rd Sunday)** (Static Schedule) — ColH3
- [x] **Secession H3 Static Schedule** (Static Schedule) — SecH3
- [x] **Palmetto H3 Static Schedule** (Static Schedule) — PalH3
- [x] **Upstate H3 Static Schedule** (Static Schedule) — UH3
- [x] **GOTH3 Static Schedule** (Static Schedule) — GOTH3
- [x] **Grand Strand H3 Static Schedule** (Static Schedule) — GSH3

**New England (5 sources)**
- [x] **Von Tramp H3 Meetup** (Meetup) — VTH3 (Vermont)
- [x] **Burlington H3 Website Hareline** (HTML Scraper) — BurH3 (Vermont)
- [x] **RIH3 Static Schedule** (Static Schedule) — RIH3 (Rhode Island)
- [x] **RIH3 Website Hareline** (HTML Scraper) — RIH3 (Rhode Island)
- [x] **Narwhal H3 Meetup (CTH3)** (Meetup) — CTH3 (Connecticut)

### The Logbook — Sprint 5 COMPLETE
- [x] "I Was There" one-click check-in (past events only, defaults to RUN)
- [x] Participation level selector: R / H / BH / DC / BM / W / C
- [x] Edit/delete attendance with dialog
- [x] Activity link field (any URL — Strava, Garmin, AllTrails, etc.)
- [x] Notes field for personal trail notes
- [x] Attendance badges on hareline event cards and detail panel
- [x] "My Runs" page (`/logbook`) with filters (region, kennel, level)
- [x] Stats dashboard (`/logbook/stats`): totals, per-kennel, per-region, per-level breakdowns
- [x] Milestone markers (25, 50, 69, 100, 150, 200, 250, 300, 400, 500, 666, 700, 800, 900, 1000)

### "I'm Going" RSVP — Sprint 7 COMPLETE
- [x] AttendanceStatus enum: INTENDING / CONFIRMED
- [x] "I'm Going" toggle on future events, "Going" blue badge, "Confirm" button after event
- [x] checkIn() auto-upgrade: INTENDING → CONFIRMED
- [x] Stats filter: only CONFIRMED counted in stats/milestones

### Kennel Attendance Management (Misman Tool) — Sprints 8-9 COMPLETE
- [x] KennelHasher roster, KennelAttendance, Misman role per kennel
- [x] Mobile attendance form: event selector, hasher search, quick-add, per-hasher toggles (paid/hare/virgin/visitor)
- [x] Smart suggestions: weighted scoring surfaces likely attendees as tap-to-add chips
- [x] Attendance history: per-event and per-hasher views with date filtering
- [x] User linking: fuzzy-match KennelHasher → site User; logbook sync with pending confirmations
- [x] Verification badges: derived status (verified/misman-only/user-only) on attendance rows
- [x] Roster groups: shared rosters across kennels, admin CRUD, misman request flow
- [x] Merge duplicates: pairwise fuzzy scan, preview, OR-merge attendance
- [x] Audit log: JSON editLog with field-level diffs, edit history timeline
- [x] Hare→EventHare sync: auto-sync misman hare flags to structured EventHare records
- [x] Historical CSV import: matrix-format upload, fuzzy hasher matching, step-by-step wizard
- [x] Invite links: secure token-based misman onboarding (MismanInvite lifecycle)
- [x] Roster group requests: mismans request shared groups, admin approve/reject

See [misman-attendance-requirements.md](misman-attendance-requirements.md) and [misman-implementation-plan.md](misman-implementation-plan.md) for full details.

### Hasher-Kennel Linking — COMPLETE
- [x] User-side visibility: KennelConnections on profile page (accept/decline/revoke link requests)
- [x] PendingLinkRequests banner on logbook page (dismissible, benefits messaging)
- [x] Profile invite from roster: misman generates invite link, hasher redeems via /invite/link
- [x] User activity on attendance form: misman sees RSVPs/check-ins from site users with link-to-roster flow

### Source Monitoring & Self-Healing — COMPLETE
- [x] Rolling-window health analysis (event count, fill rates, structure hash, consecutive failures)
- [x] Admin alerts page with 6 alert types, filter tabs, structured context display
- [x] Self-healing actions: re-scrape, create alias/kennel, file GitHub issue — all from alert card
- [x] Repair history timeline, auto-resolve for stable structure changes
- [x] **CI gate:** GitHub Actions enforces type check + lint + tests on all PRs (`.github/workflows/ci.yml`)
- [x] **Auto-issue filing:** Critical/warning alerts auto-create GitHub issues with structured AGENT_CONTEXT (`src/pipeline/auto-issue.ts`)
- [x] **AI triage:** Claude Sonnet analyzes issues, posts confidence-scored diagnosis, labels for auto-fix or human review
- [x] **AI auto-fix:** Claude Opus implements fixes for high-confidence issues (adapters, seed.ts, test files), creates PRs validated by CI
- [x] Architecture plan with confidence scoring rubric: see [self-healing-automation-plan.md](self-healing-automation-plan.md)

### Scrape Logging — COMPLETE
- [x] Structured errors (fetch/parse/merge) across all 5 adapters
- [x] Fill rate columns with color coding, structure hash history
- [x] Sample blocked/skipped events with suggested actions
- [x] Performance timing (fetchDurationMs, mergeDurationMs)
- [x] Per-adapter diagnostic context

### UX Polish — COMPLETE
- [x] Calendar: region colors, dim past, vertical badges, grid lines, desktop side panel
- [x] Loading skeletons, dynamic page titles, region badges
- [x] Calendar export (Google Calendar URL + .ics download)
- [x] Admin: kennel merge UI with fuzzy duplicate prevention
- [x] Admin: slim source table, detail page tooltips
- [x] **Navigation pattern decision:** Misman sub-tabs (Attendance/Roster/History) vs Alert pill-filters (Open/Resolved/All) use intentionally different patterns — sub-tabs switch between distinct content views while pill-filters narrow a single list by status. The divergence is justified and should be preserved.

### Kennel Page Redesign — COMPLETE
- [x] 17 new nullable profile fields on Kennel model (schedule, social, details, flags)
- [x] QuickInfoCard component: schedule, hash cash + pay link, website, founded year, dog-friendly/walkers-welcome flags
- [x] SocialLinks component: pill-style linked buttons for Facebook, Instagram, X, Discord, mailing list, email
- [x] KennelStats component: total events, oldest event date, next run date
- [x] Redesigned `/kennels/[slug]` page with hero logo, quick info, social links, stats
- [x] Admin form expanded with Schedule, Social & Contact, Details sections (17 new fields)
- [x] Format helpers: `formatSchedule()`, `instagramUrl()`, `twitterUrl()`, `displayDomain()` + 15 tests
- [x] Seed data populated for 14 of 24 existing kennels

See [kennel-page-redesign-spec.md](kennel-page-redesign-spec.md) for full spec.

### Kennel Directory Redesign — COMPLETE
- [x] Richer cards: shortName as primary heading, schedule line, description snippet, founded year, RegionBadge
- [x] Next upcoming run per kennel (batch query, no N+1), highlighted blue if within 7 days
- [x] Filters: region multi-select, run day chips (Mon–Sun), frequency dropdown, "Has upcoming" toggle, country chips
- [x] Sort: A–Z (grouped by region) or Recently Active (flat list, next-event-date ascending)
- [x] URL persistence: all filter/sort state persisted via `window.history.replaceState()`
- [x] `formatDateShort()` helper, 14 new region colors (DC/DMV, Bay Area, London, Chicago, etc.)
- [x] Loading skeleton for kennel directory page
- [x] Removed subscriber count from cards (meaningless for new users)

### In-App Feedback — COMPLETE
- [x] "Send Feedback" dialog in app footer (signed-in users only)
- [x] Category dropdown (Bug Report, Feature Request, Question, Other) + title + description
- [x] Creates GitHub Issue via REST API with `user-feedback` + category labels
- [x] Auto-captures current page URL for bug context

### Cron & Infrastructure — COMPLETE
- [x] Vercel Cron daily scrapes (6:00 AM UTC) with CRON_SECRET auth
- [x] Per-source `scrapeFreq` with interval-based skip logic
- [x] Shared `scrapeSource()` for cron + admin routes
- [x] Vercel Web Analytics + Speed Insights integration
- [x] **Residential proxy relay** — NAS-based forward proxy for WAF-blocked scrape targets
  - Synology DS423+ NAS, Cloudflare Tunnel (`proxy.hashtracks.xyz`), zero-dep Node.js server
  - Opt-in via `useResidentialProxy: true` in safeFetch (currently Enfield Hash only)
  - Security: timing-safe auth, SSRF protection, body size caps, generic error responses
  - Domain: `hashtracks.xyz` (Cloudflare Registrar) — infra-only, not user-facing
  - See `docs/residential-proxy-spec.md` and `infra/proxy-relay/README.md`

### Source Onboarding Wizard — COMPLETE
- [x] Admin "Add Source" wizard at `/admin/sources/new` (multi-phase guided setup)
- [x] Source type auto-detection from URL (Google Sheets, Calendar, Hash Rego, Meetup)
- [x] Config panels: Calendar, iCal, Google Sheets, Hash Rego, Meetup
- [x] Server-side config validation with ReDoS safety (safe-regex2)
- [x] Test Config preview: dry-run adapter fetch with diagnostic display
- [x] Gemini-enhanced kennel pattern suggestions for Calendar/iCal sources
- [x] Inline alias creation, kennel creation, source enable/disable
- [x] Source coverage dashboard at `/admin/sources/coverage`

See [config-driven-onboarding-plan.md](config-driven-onboarding-plan.md) for full design.

### AI Recovery Layer — COMPLETE
- [x] Gemini 2.0 Flash integration for self-healing scraper errors
- [x] Parse recovery with prompt sanitization and confidence tracking (`src/lib/ai/parse-recovery.ts`)
- [x] Applied to hashnyc, OFH3, EWH3, iCal adapters
- [x] Gemini column auto-detection for Google Sheets adapter
- [x] AI-assisted alert classification

### AI Integration Enhancements — COMPLETE
- [x] Gemini response caching: in-memory 1hr TTL prevents redundant API calls (`src/lib/ai/gemini.ts`)
- [x] 429 rate-limit handling: friendly user-facing error message
- [x] Applied to region suggestions, kennel pattern suggestions, column auto-detection

### Region as First-Class Model — COMPLETE
- [x] Region Prisma model: name, slug, country, timezone, colors, pin color, centroids, optional parentId (max 2-level hierarchy)
- [x] 64 region seed records (`src/lib/region.ts`) spanning USA, UK, and Ireland (3-level hierarchy: COUNTRY/STATE_PROVINCE/METRO)
- [x] Dual-write migration: `Kennel.regionId` FK + denormalized `Kennel.region` string (backward compat)
- [x] Region admin CRUD at `/admin/regions` with table, form dialog, merge dialog
- [x] Region combobox in KennelForm (searchable, grouped by country)
- [x] RegionSuggestionsPanel: AI (Gemini) + rule-based suggestions for split/merge/rename/reassign
- [x] Sync fallback helpers for build-time and test-time access (`src/lib/region.ts`)

### Strava Integration MVP — COMPLETE
- [x] StravaConnection + StravaActivity models (OAuth tokens, activity cache)
- [x] OAuth flow with token refresh, expiration tracking
- [x] Activity sync with date string extraction (no `new Date()` — avoids timezone bugs)
- [x] Auto-suggest matches: Strava activities to canonical Events by date + region
- [x] One-click attach: normalize URL to `https://www.strava.com/activities/{id}`
- [x] Post-check-in prompt: suggest linking activity after attendance check-in
- [x] Check-in nudge banner: gentle reminder to sync Strava or check in

### Event Reconciliation — COMPLETE
- [x] Stale event detection and cancellation when sources are disabled/modified (`src/pipeline/reconcile.ts`)
- [x] ReconcileSource field tracks last reconciliation per source

### Meetup Adapter — COMPLETE
- [x] Meetup.com public API adapter — no auth required (`src/adapters/meetup/adapter.ts`)
- [x] GroupUrlname auto-detection from URLs
- [x] Config validation for Meetup-specific fields
- 5 live sources: Miami H3, Savannah H3, Von Tramp H3, Narwhal H3, Charleston Heretics

### User Feedback — COMPLETE
- [x] In-app "Send Feedback" dialog (bug report, feature request, question, other)
- [x] Auto-creates GitHub issues with `user-feedback` + category labels
- [x] Auto-captures current page URL for bug context

### Timezone Preferences — COMPLETE
- [x] User timezone preference storage (UserPreferences model, TimeDisplayPref enum)
- [x] Header timezone dropdown with regional options
- [x] Hareline and event card timezone-aware display (`src/lib/timezone.ts`)

### Codebase Refactoring (Phases 1-3) — COMPLETE
- [x] Shared adapter utilities (`src/adapters/utils.ts`): date parsing, field extraction
- [x] Function decomposition: long adapter functions split into focused helpers
- [x] Pattern standardization: ActionResult discriminated union, consistent error handling

### EventLink + Hash Rego Adapter — COMPLETE
- [x] EventLink model: extensible link table for external URLs on events (Hash Rego, Meetup, etc.)
- [x] HASHREGO adapter: index scraper + detail page parser, multi-day event splitting via seriesId
- [x] Merge pipeline: auto-creates EventLinks from externalLinks, first source "owns" sourceUrl
- [x] Series linking: multi-day events split into per-day records linked via parentEventId
- [x] Event detail page + sidebar panel render EventLink buttons
- [x] Seed: Hash Rego source with 7 kennel slugs (BFM, EWH3, WH4, GFH3, CH3, DCH4, DCFMH3)

### Hareline UX Overhaul (PR #160) — COMPLETE
- [x] Accessibility: skip nav, focus management, ARIA labels, keyboard-navigable EventCard
- [x] Filtering: distance filter (near me / custom location), kennel multi-select, time preference toggle
- [x] Calendar: month navigation, day detail panel, improved region badges
- [x] Map: distance-based clustering, region-colored pins, interactive tooltips
- [x] Geocoding in merge pipeline: text-address → lat/lng via Google Geocoding API (5s timeout, skip-if-cached)
- [x] resolveCoords() DRY helper, regionBgClass hardening, same-day isPast fix

### Static Schedule Adapter — COMPLETE
- [x] RRULE-based event generation for kennels without scrapeable web sources (Facebook-only)
- [x] 26 live sources — largest adapter type by count
- [x] Zero external fetch — generates events from recurrence rules + defaults stored in `Source.config`
- [x] Config: `rrule`, `defaultTitle`, `defaultLocation`, `defaultStartTime`, `defaultKennelTag`
- [x] Supports complex RRULE patterns (1st/3rd Sunday, every other Saturday, etc.)
- [x] Moon-phase gap: lunar recurrence (full/new moon kennels) cannot be expressed as RRULE — added as kennel-only records

### Meetup Adapter Live — COMPLETE
- [x] 5 live Meetup sources: Miami H3, Savannah H3, Von Tramp H3 (VT), Narwhal H3 (CT), Charleston Heretics
- [x] Highest-ROI automated source where available — rich historical data (100s of past events)
- [x] Zero-code onboarding via admin wizard (auto-detect from URL, AI-assisted kennelTag suggestion)

### Kennel Scaling — COMPLETE
- [x] **Florida**: 29 kennels, 8 sources (Meetup, Google Calendar, HTML scraper, static schedules)
- [x] **Georgia**: 20 kennels, 11 sources (Meetup, Atlanta Hash Board scraper, static schedules)
- [x] **South Carolina**: 10 kennels, 10 sources (Meetup + static schedules, zero new adapter code)
- [x] **New England**: Vermont (VTH3, BurH3), Rhode Island (RIH3), Connecticut (CTH3) — Meetup + HTML + static
- [x] **Dublin, Ireland**: First non-US/UK kennel (DH3, HTML scraper)
- [x] KennelCode conflict resolution with region suffixes (`ch3-sc`, `ph3-atl`, etc.)

### Design Refresh — COMPLETE
- [x] **Homepage redesign** (PR #205): animated counters, feature sections, region ticker, live event feed, /about page, /for-misman landing
- [x] **EventCard redesign** (PR #219): region-colored accents, gradient washes, RSVP glow indicators, hover animations, weather forecasts
- [x] **Kennel profile pages** (PR #210): hero section with region-colored theming, trail location heatmap, achievement-style animated stats
- [x] **Logbook visualizations** (PR #211): animated bar charts, milestone icons with progress bars, stacked participation bar, region-colored borders
- [x] **Nav & Chrome** (PRs #214-226): Outfit + JetBrains Mono fonts, Wordmark, mobile bottom nav, 3-column footer, admin/misman pill nav
- [x] **Empty states** (PR #218): standardized admin empty states

### Double-Header Support — COMPLETE
- [x] `allowDoubleHeaders` flag on merge pipeline — permits multiple events per kennel per day
- [x] Prevents single-event-per-kennel-per-day constraint from blocking valid events (e.g., morning + evening runs)

### Hidden Kennels — COMPLETE
- [x] Admin hide/unhide action on kennel records
- [x] Hidden kennels excluded from public directory but remain in database for data integrity

### Rolling Weeks Calendar — COMPLETE
- [x] Week-based calendar navigation (vs. month-only)
- [x] Time filter on hareline views

### Data Quality Hardening — COMPLETE
- [x] Three rounds of cleanup: location sanitization, venue dedup, placeholder filtering
- [x] Event city backfill from reverse geocoding coordinates
- [x] `getLocationDisplay()` deduplicates city from location name
- [x] Geocoding improvements: server-only API key, bulk coordinate resolution

### DB Seed Automation — COMPLETE
- [x] Slug collision handling with `ensurePattern()` refactor (pre-check instead of P2002 retry)
- [x] Clerk migration P2002 handling for user upserts

### SHITH3 Website Adapter — COMPLETE
- [x] PHP REST API behind FullCalendar widget — structured JSON with hares, full address, distances, on-after venue
- [x] Multi-source strategy: Calendar (trustLevel 7) + website (trustLevel 8) with merge pipeline enrichment
- [x] Sequential detail fetches to avoid server hammering

### Uncancel Events — COMPLETE
- [x] Admin action to restore previously cancelled events

### Current Stats
- 152 kennels (with rich profiles), 481 aliases, 69 sources, 64 regions (3 countries: US, UK, Ireland)
- 7 live adapter types: STATIC_SCHEDULE (26), HTML_SCRAPER (24), GOOGLE_CALENDAR (8), MEETUP (5), ICAL_FEED (3), GOOGLE_SHEETS (2), HASHREGO (1)
- 27 models, 20 enums in Prisma schema
- 109 test files, 2516 test cases

---

## Priority 1: Expand Source Coverage

**Strategic rationale:** HashTracks' automated source engine is the primary competitive moat. Harrier Central requires kennel admins to manually enter every run — their 3-year-old open issue for recurring events (#309) proves manual entry doesn't scale. Every new source adapter widens this gap permanently. More sources = more kennels = more value for every user. This is the single highest-leverage activity.

**See:** [competitive-analysis.md](competitive-analysis.md) — Theme 1: Data Entry & Event Management Pain

### Next Source Targets

Regional research complete — see [kennel-research/](kennel-research/) for detailed per-kennel data.

**Completed regions:**
- [x] **DC/DMV area** (19 kennels, 10 sources) — EWH3, SHITH3, CCH3, W3H3, DCH4, WH4, BAH3, MVH3, OFH3, DCFMH3, GFH3, DCH3, OTH4, and more
  - Sources: Google Calendars, SHITH3 PHP REST API, iCal feeds, WordPress/Blogspot scrapers, Hash Rego — see [dc-kennels.md](kennel-research/dc-kennels.md)
- [x] **Chicago area** (11 kennels, 3 sources) — CH3, TH3 + 9 via Chicagoland Calendar
  - Sources: Chicagoland Google Calendar + CH3/TH3 website scrapers — see [chicago-expanded.md](kennel-research/chicago-expanded.md)
- [x] **SF Bay Area** (13 kennels, 2 sources) — SFH3, GPH3, EBH3, SVH3, FHAC-U, FCH3, MarinH3, and more
  - Sources: SFH3 iCal feed + HTML hareline scraper, Hash Rego for FCH3 — see [sf-bay-area.md](kennel-research/sf-bay-area.md)
- [x] **London/UK** (10 kennels, 7 sources) — LH3, CityH3, WLH3, BarnesH3, OCH3, SLH3, EH3 + 3 directory-only
  - Sources: 7 HTML scrapers — see [london-kennels.md](kennel-research/london-kennels.md)
- [x] **Massachusetts** (11 kennels, 4 sources) — Boston (5 kennels via Calendar), HVH3, PooFH3 (static schedules), NbH3 (browser-rendered Wix site)
- [x] **South Carolina** (10 kennels, 10 sources) — Charleston, Columbia, Greenville, Myrtle Beach areas; Meetup + static schedules
- [x] **Florida** (29 kennels, 8 sources) — Miami, Key West, Orlando, Tampa/St Pete, Palm Beach, Fort Lauderdale, Jacksonville, Gainesville areas
- [x] **Georgia** (20 kennels, 11 sources) — Atlanta metro, Savannah; Atlanta Hash Board scraper + Meetup + static schedules
- [x] **New England** (5 kennels, 5 sources) — Vermont, Rhode Island, Connecticut; Meetup + HTML scrapers + static schedules
- [x] **Dublin, Ireland** (1 kennel, 1 source) — DH3 (HTML scraper) — first non-US/UK country

**Remaining opportunities:**
- [ ] **Hash Rego kennel directory** — scrape `/kennels/` page for new kennel discovery + auto-onboarding
- [ ] **gotothehash.net** — evaluate as a potential aggregator source (similar to hashnyc.com pattern)
- [ ] **half-mind.com event listings** — evaluate as supplementary discovery data
- [x] **Meetup.com sources** — 5 live sources (Miami, Savannah, VT, CT, Charleston); adapter supports zero-code onboarding via admin wizard
- [ ] Continue refining kennel resolver patterns as new sources reveal new name variants

**Implementation notes:**
- Follow [source-onboarding-playbook.md](source-onboarding-playbook.md) for each new source
- Config-driven Google Sheets adapter means zero code changes for similar spreadsheet sources
- HTML_SCRAPER sources require ~1-2 hours of adapter code + URL-based routing in registry
- Google Calendar sources require ~15 min of config + seed entry
- Always verify `kennelShortNames` in seed covers ALL kennels the source produces (source-kennel guard)
- Self-healing automation reduces maintenance burden: alerts auto-file issues → Claude triages/fixes CSS selector changes and alias gaps → PR → CI validates → merge

### Config-Driven Source Onboarding (Admin UI) — COMPLETE

See "Source Onboarding Wizard" in What's Built section above. The wizard supports all config-driven adapter types (Calendar, Sheets, iCal, Hash Rego, Meetup) with source type auto-detection, live preview, config validation, and Gemini-enhanced kennel pattern suggestions. HTML_SCRAPER sources still require adapter code but can have their Source record and kennel links created via the wizard.

### Historical Event Import

*Infrastructure complete (per-source `scrapeDays`). Remaining:*

- [ ] hashnyc.com: Test `?days=all` for full 8+ year archive import
- [ ] Boston Calendar: Verify 365-day window captures sufficient history
- [ ] Add admin "Import Full History" button per source
- [ ] Quality metrics dashboard: per-source event counts by year

---

## Priority 2: Strava Integration

**Status: MVP COMPLETE** (PRs #126, #128)

**Strategic rationale:** Zero hashing platforms integrate with fitness tracking apps. Harrier Central, gotothehash.net, half-mind.com — none of them connect runs to GPS data. This feature bridges the gap between hashing and fitness tracking.

**See:** [competitive-analysis.md](competitive-analysis.md) — "What HashTracks Has That HC Doesn't"

- [x] **Strava OAuth flow** — real redirect, refresh token storage, auto-refresh (`src/lib/strava/client.ts`)
- [x] **Activity history fetch + server-side cache** — StravaActivity model, date string extraction (`src/lib/strava/sync.ts`)
- [x] **Auto-suggest matches** — by date + region, privacy zone fallback to timezone
- [x] **One-click attach** — normalize URL to `https://www.strava.com/activities/{id}`
- [x] **Post-check-in prompt** — suggest linking activity after attendance check-in
- [x] **Check-in nudge banner** — gentle reminder on logbook page (`StravaNudgeBanner.tsx`)
- [x] **Rate limit handling** — 429 errors with user-friendly messaging

### Remaining Strava Work
- [ ] **Out-of-town run discovery** — Strava activities in regions with no logged attendance → suggest logging
- [ ] **Advanced matching** — distance/genre validation, multi-day event correlation
- [ ] **Queue-based sync** — needed when scaling past ~50 concurrent users

---

## Priority 3: Misman as a Growth Lever

**Strategic rationale:** The Misman tool is already more capable than HC's paid kennel admin features (smart suggestions, roster groups, audit log, verification pipeline). HC charges for less capable tools. This is a B2B growth opportunity: approach kennel mismanagement directly with "replace your Google Sheet with this — it's free and tied to the event calendar."

**See:** [competitive-analysis.md](competitive-analysis.md) — "Misman as a Growth Lever vs. HC's Kennel Admin"

### Misman Experience Refinement
- [ ] End-to-end testing with real misman users (invite, onboard, record attendance, review history)
- [ ] Address UX friction discovered during real-world usage
- [ ] Mobile testing on actual devices (attendance form is the primary mobile use case)

### Milestone Watch (New — informed by HC analysis)

**Why:** HC does this and GMs rely on it. When a hasher is one run away from a milestone (68, 99, 149, etc.), mismanagement wants to know so they can prepare the down-down. Data already exists — `getHasherDetail()` computes per-hasher run counts.

- [ ] Compute milestone proximity for all attendees when loading attendance form
  - Query: count of CONFIRMED KennelAttendance records per hasher (roster group scope)
  - Milestones: 25, 50, 69, 100, 150, 200, 250, 300, 400, 500, 666, 700, 800, 900, 1000 (same as logbook)
  - Flag hashers where `count + 1` hits a milestone
- [ ] Display milestone alert badge on attendance form
  - Banner or badge next to hasher name: "🎉 69th run!" or "⚠️ Next run is #100"
  - Show on AttendanceRow and in SuggestionList chips
- [ ] Optional: milestone summary section on misman dashboard per kennel
  - "Upcoming milestones: Mudflap (99th), Just Simon (250th)"

**Implementation notes:**
- Pure function in `src/lib/misman/milestones.ts` — takes run count, returns next milestone and distance
- Server action in attendance actions to batch-compute for current event's attendees + suggestions
- UI: small badge component, similar to VerificationBadge pattern

### Misman Self-Service Kennel Profile Editing
- [ ] Allow mismans to edit their kennel's profile fields (schedule, social links, hash cash, etc.)
- [ ] Currently admin-only — extend to MISMAN role users for their own kennels
- [ ] Reuse admin KennelForm component with role-based field restrictions

### Misman Landing/Onboarding Page
- [ ] Dedicated page explaining misman features (separate from hasher-facing marketing)
- [ ] Speak to the mismanagement pain point: "Stop manually typing hash names in a spreadsheet"
- [ ] Highlight: mobile attendance form, smart suggestions, roster groups, audit trail
- [ ] Clear CTA: "Request misman access for your kennel" or "Invite your mismanagement team"

---

## Priority 4: User Onboarding & Self-Service

**Strategic rationale:** Reduce friction for new users to get value from the platform. HC's biggest user complaint is the inability to add runs or kennels without emailing the developers. HashTracks should make self-service effortless.

### Personal CSV Import

*Different from misman CSV import (Sprint 9c) — this is for individual hasher logbook history.*

- [ ] Upload page at `/logbook/import`
- [ ] Column mapping UI: user maps their columns to HashTracks fields (date, kennel, participation level, notes, strava URL)
- [ ] Kennel name normalization via alias matching (unmatched names flagged)
- [ ] Import preview + confirm: show matched events, flagged issues
- [ ] Batch create Attendance records for matching canonical events
- [ ] Manual entries for unmatched kennels (triggers KennelRequest)

**Implementation notes:**
- Reuse patterns from misman CSV import (`src/lib/misman/csv-import.ts` — parsing, fuzzy matching, record building)
- Key difference: personal import creates `Attendance` records (not `KennelAttendance`)
- Column mapping could use the same config JSON pattern as the Google Sheets adapter

### Log Unlisted Run

**Why:** Critical for traveling hashers (HC's primary use case) and for covering kennels without sources yet. Also generates KennelRequests that signal organic demand for new source coverage.

- [ ] User logs a run for a kennel/event not in the system
- [ ] Provides: kennel name, region, country, date, participation level, notes, activity link
- [ ] Creates Attendance record linked to a special "unlisted" event
- [ ] Triggers KennelRequest for admin review if kennel doesn't exist
- [ ] Admin can later link unlisted attendance to a real kennel/event when source is added

### Manual Event Submission

- [ ] Admin manual event creation (for kennels without scrapeable sources, like Rumson)
- [ ] User event submission form (verified users, MANUAL source type)
- [ ] Events appear immediately — no approval queue for v1

---

## Priority 5: Map-Based Discovery

**Strategic rationale:** HC's #1 user testimonial is a traveling hasher who searched by radius and found a run. HC has invested years in map performance, distance filtering, and geo exploration. This is the killer feature HashTracks is missing for the traveling hasher persona. The good news: no PostGIS needed — Event model already has `latitude`, `longitude` fields and client-side distance calculation is sufficient for v1.

**See:** [competitive-analysis.md](competitive-analysis.md) — Theme: Discovery Quality

- [x] **Map tab on Hareline** — Google Maps JS (`@vis.gl/react-google-maps`), region-colored pins (filled = precise location, hollow = region centroid), click pin → EventDetailPanel, all filters apply, URL-persisted view state
- [x] **Event detail map** — Google Maps Static API image on EventDetailPanel + standalone event page; clickable → opens Google Maps; coordinate extraction from `locationAddress` Google Maps URLs in merge pipeline
- [x] **EventLocationMap text-address fallback** — Works without lat/lng; falls back to `locationName` text address for Google Maps Static API center/markers parameter (covers all hashnyc.com events and text-only sources)
- [x] **Coordinate extraction from Maps URLs** — merge pipeline calls `extractCoordsFromMapsUrl()` on `locationAddress` (supports @lat,lng, ?q=, ll=, query= URL patterns), stores precise lat/lng on Event records
- [x] **Map toggle on Kennel Directory** — interactive map with kennel pins, region-colored, click → kennel page (PR #178)
- [x] **"Near me" distance filtering on Kennel Directory** — browser geolocation + Haversine, 10/25/50/100/250 km options (PR #178)

- [ ] **Travel Mode search** (future enhancement)
  - "Runs in [City/Region] between [Date A] and [Date B]"
  - Pairs with Log Unlisted Run for runs found while traveling

---

## Priority 6: PWA & Notifications

**Strategic rationale:** HC's v2.0 rewrite leaned heavily into push notifications — smarter timing (6 hours before), RSVP→check-in reminders. HashTracks can achieve this without a native app via PWA web push. This drives retention on already-engaged users.

**See:** [competitive-analysis.md](competitive-analysis.md) — HC v2.0 features

- [ ] **PWA manifest + service worker**
  - "Add to Home Screen" prompt on mobile
  - App-like experience without app store friction
  - Offline shell with "you're offline" state (events require network)

- [ ] **Web Push notifications** (via Push API + service worker)
  - Opt-in per notification type
  - Triggers:
    - "You RSVPed — check-in window is open" (event date has passed, user has INTENDING status)
    - "Run starts in 6 hours" for RSVPed events (HC's exact heuristic)
    - Misman: "Source health alert for your kennel" (opt-in power user)
    - Misman: "Pending confirmation waiting in your logbook"
  - Backend: store push subscription per user, send via web-push npm package
  - New schema: `PushSubscription` model (userId, endpoint, keys, createdAt)

---

## Priority 7: Social Visibility & Engagement

**Strategic rationale:** HC lets users see who RSVPed and added Trail Chat in v2.0. Full social features (activity feed, kudos, comments) are v2 scope, but lightweight social signals can drive engagement now.

### "Who's Going" RSVP Visibility

- [ ] Show count of hashers with INTENDING status on event cards and detail pages
- [ ] Expandable list showing who's going (hash names, opt-in — default show count only)
- [ ] Consider privacy toggle: users can choose to show their name or be anonymous in the count

**Implementation notes:**
- Query: `Attendance.where({ eventId, status: 'INTENDING' })` with user join for hash names
- UI: badge on event card ("3 going"), expandable section on event detail page
- Minimal effort — data already exists from Sprint 7

### Event Comments (Lightweight Social Test)

- [ ] Per-event comment thread on event detail page (no DMs)
- [ ] Moderation: misman/admin can delete comments
- [ ] Use cases: ride-sharing coordination, bag drop info, theme announcements
- [ ] Opt-in notifications for replies to your comment

**Implementation notes:**
- New schema: `EventComment` model (id, eventId, userId, content, createdAt, deletedAt)
- Server actions: createComment, deleteComment, getComments (paginated)
- Keep simple — no threading, no reactions, no rich text for v1

---

## Priority 8: Data Portability & Exports

**Strategic rationale:** HC advertises "email me an Excel spreadsheet anytime." Hashers love data ownership. Export builds trust and reduces lock-in anxiety.

### Logbook CSV Export
- [ ] Download button on `/logbook/stats`
- [ ] Columns: date, kennel, run number, participation level, notes, activity link, event title, hares
- [ ] Filter-aware: exports what the user is currently viewing (filtered by kennel, region, date range)

### Misman Attendance Export
- [ ] Download button on `/misman/[slug]/history`
- [ ] Columns: event date, run number, hasher hash name, hasher nerd name, paid, hare, virgin, visitor
- [ ] Per-event and full-history export options

### Per-Kennel Payment Link (Lightweight Hash Cash)

**Why:** HC's Hash Cash is a scope trap (generates significant support burden). But "how do I pay?" is a real question at every hash. A simple payment link URL per kennel gives hashers the info without building financial tools.

- [x] `hashCash` + `paymentLink` fields on Kennel model (Kennel Page Redesign)
- [x] Displayed on kennel page QuickInfoCard with "Pay online" link
- [x] Admin-editable in kennel settings form
- [ ] Display payment link on event detail page (when kennel has one configured)

---

## Priority 9: Additional Integrations & Depth

### Event Weather Integration — PARTIALLY COMPLETE

- [x] Weather forecast on upcoming event detail pages (0–10 days)
  - Google Weather API (`weather.googleapis.com/v1/forecast/days:lookup`), 30-min Next.js fetch cache
  - Displays: condition emoji, temperature range (°F/°C toggle), precipitation probability if ≥20%
  - Coordinate fallback: uses `REGION_CENTROIDS` when event has no precise lat/lng
  - Units preference: localStorage-persisted °F/°C toggle in header (`UnitsPreferenceProvider`)
- [ ] Compact weather badge on hareline event cards (icon + temp range)

### Additional Adapter Types
- [x] **iCal feed adapter** (`ICAL_FEED`): Live with SFH3 MultiHash source (11 Bay Area kennels)
- [x] **Hash Rego adapter** (`HASHREGO`): Live with 7 DC/Philly kennel slugs, multi-day splitting
- [x] **Meetup adapter** (`MEETUP`): Public API adapter built, no live sources yet
- [x] **WordPress REST API** (`WORDPRESS_API`): Shared utility for blog-based sources (EWH3, DCH4)
- [ ] **RSS/Atom adapter** (`RSS_FEED`): For kennels with blog-style event posts (WordPress blog scrapers already cover some of this)
- [ ] **Facebook Events adapter** (`FACEBOOK_EVENTS`): Scrape public Facebook page events via NAS headless browser with authenticated session. Would unlock dozens of Facebook-only kennels (e.g., CT: SBH3, Rotten Groton; many small-market kennels). Requires: cookie/session persistence in browser render service, anti-detection measures, periodic re-auth. High-value capability — many kennels have no web presence outside Facebook.
- [ ] **hashnj.com HTML scraper**: Similar to hashnyc.com, different HTML structure
- [ ] **Gemini AI parsing**: For complex multi-day event narrative text (campout descriptions with per-day schedules)

### Event Series
*Schema fields exist on Event model: `isSeriesParent`, `parentEventId`. Scraper-side splitting + linking is complete (Hash Rego adapter). UI grouping deferred.*

- [x] Scraper support: multi-day events split into per-day records with `seriesId` → `parentEventId` linking
- [ ] Admin UI to link/unlink events in a series
- [ ] Grouped display in hareline (collapsible parent cards with children)
- [ ] Series detail page showing full weekend/campout schedule

### Logo Upload
- [ ] Image upload for kennel logos (currently URL-only field)
- [ ] Upload to cloud storage (Vercel Blob, S3, or Cloudinary)
- [ ] Image processing: resize + optimize for 64x64 display
- [ ] Update QuickInfoCard and hero section to use uploaded images

### SEO & Social Sharing
- [ ] Open Graph tags on event detail pages (title, description, kennel, date)
- [ ] OG tags on kennel pages (with logo image if available)
- [ ] Meta descriptions for search engines

### Calendar Feed Subscriptions (Per-Kennel)
- [ ] Subscribable calendar feed per kennel (auto-updating .ics URL)
- [ ] Users add once, events update automatically in their calendar app
- [ ] Builds on existing `src/lib/calendar.ts` infrastructure

---

## Long-Term: Social & Scale

### Social Features (PRD v2 — "The Circle")
- [ ] Activity feed (friends' check-ins)
- [ ] "On-On!" kudos reactions
- [ ] Comments on events (may ship earlier as Priority 7)
- [ ] Friend connections with privacy controls

### Hare Management & Nudging
**Informed by HC's "Hare Raising" tools — GMs struggle to fill hare slots.**

- [ ] "Hare needed" flag on future events
- [ ] Nudge hashers who haven't hared in N runs: "You've run 10 times since your last hare!"
- [ ] Hare volunteer signup from event detail page

### AI-Assisted Source Onboarding — Phase 1 COMPLETE (Sprint B)
- [x] **Phase 1**: AI analyzes URL/HTML → proposes CSS selectors + column mappings → admin reviews in interactive preview → corrects via dropdown reassignment or text feedback → Refine with AI → save
- [x] **Phase 2**: Autonomous agent discovers kennels + URLs → batch-analyzes → proposes sources for admin approval (Sprint D — SourceProposal model, Gemini search grounding, research pipeline, admin approval UI with feedback/refinement loop)
- [ ] **Phase 3**: Users submit source URLs → AI creates draft config → admin approves → live

### Custom Domain
- [ ] **Move HashTracks to custom domain** — currently on `hashtracks-web.vercel.app`, should be `hashtracks.com` or similar
  - Registered `hashtracks.xyz` for infra use (Cloudflare Registrar, proxy tunnel)
  - Evaluate: register `hashtracks.com` (or `.run`, `.app`) for the user-facing app
  - Update `NEXT_PUBLIC_APP_URL`, Clerk redirect URLs, Strava OAuth callback, invite links
  - Configure custom domain in Vercel dashboard (DNS: CNAME to `cname.vercel-dns.com`)

### Infrastructure Scaling
- [ ] BullMQ + Redis (if needed at 50+ sources)
- [ ] PostGIS / geo queries (if client-side distance filtering proves insufficient)
- [ ] Per-source cron scheduling (requires Vercel Pro for sub-daily intervals)
- [ ] Staggered scrape timing to avoid rate limits

---

## Technical Debt & Hardening

- [ ] Performance: pagination, React Query caching on list views
- [ ] Rate limiting on public API routes
- [ ] Double-header handling (same kennel, same day, two events)
- [ ] Email/notification integration for source health alerts

### Self-Healing Hardening (Phase 4)
- [ ] Post-merge verification: re-scrape after auto-fix PR merged, verify alert auto-resolves
- [ ] Fix success rate dashboard: per alert type, per source
- [ ] Structured logging: replace console.error with JSON logs (source ID, alert type, error category)
- [ ] PR size guard: auto-fix PRs > 500 lines changed → auto-label "needs-human"
- [ ] External monitoring: Vercel deployment failures → GitHub issue via webhook

### Admin UX Architecture

*Larger structural improvements to the admin section identified during PR #93 review. Each is a standalone PR.*

- [ ] **Admin landing/dashboard page** — central hub with at-a-glance source health, recent alerts, scrape activity, and quick-action links (currently admin lands on the sources list)
- [ ] **Breadcrumbs system** — consistent navigation breadcrumbs across admin section (e.g., Sources > Source Detail > Scrape Log) to improve wayfinding in nested views
- [ ] **Unified badge/status system** — consolidate health badges, alert severity badges, and source status indicators into shared components with consistent styling
- [ ] **Event page filter pattern consistency** — align hareline filters, admin event filters, and logbook filters to use the same filter bar component pattern for a cohesive UX

### Codebase Refactoring (Phase 4 — Structural Splits)

*Phases 1-3 complete (shared utilities, function decomposition, pattern standardization). Phase 4 items are lower-priority structural splits — each should be its own PR.*

- [ ] **Split large server action files** — one commit per file
  - `src/app/admin/kennels/actions.ts` (648 lines): CRUD vs profile fields vs helpers
  - `src/app/admin/alerts/actions.ts` (592 lines): Status lifecycle vs repair actions
  - `src/app/misman/[slug]/attendance/actions.ts` (700+ lines): Recording vs polling vs suggestions
- [ ] **Split large component files** — extract co-located sub-components
  - `src/components/admin/EventTable.tsx` (647 lines): Filter bar, table body, bulk actions
  - `src/components/admin/RosterGroupsAdmin.tsx` (582 lines): Group card, create form, pending queue
  - `src/components/admin/SourceTable.tsx` (517 lines): Row component, health badge, actions
  - `src/components/admin/KennelForm.tsx` (516 lines): Main form, alias manager, social links
  - `src/components/misman/ImportWizard.tsx` (502 lines): Per-step sub-components
- [ ] **Centralize `revalidatePath` strings** — create `src/lib/paths.ts` constants, replace 124 hardcoded calls

### Deferred (Low Priority)
- Per-kennel trust level overrides: allow different trust levels per source-kennel pair (e.g., Hash Rego high-trust for WH4 primary source, low-trust for BFM enrichment)
- Kennel Directory "Recently Active" sort: extend to include recent past events (currently only uses upcoming events)
- Location privacy / time-gated location reveal
- Hash cash amount tracking / ledger (boolean `paid` is sufficient)
- Auto-detect virgins from roster data
- Cross-kennel hasher directory
- Mobile native app (web-first + PWA is correct strategy)
- WebSocket/SSE for real-time attendance updates (polling is sufficient)
- Interactive songbook (HC #298 — cultural feature, low ROI)
- Trail Chat / full messaging (high complexity, event comments are the cheaper test)

---

## Priority 10: Kennel Onboarding Scaling

**Strategic rationale:** The biggest remaining friction in scaling HashTracks is adding new kennels. Config-driven sources (Calendar, Sheets, iCal, Meetup, Hash Rego) take ~5 min via the admin wizard, but HTML scrapers still require ~3-4 hours of custom adapter code per site. Kennel discovery is entirely manual — admin must already know a kennel exists and where its data lives. Three sprints address this:

### Sprint A: Coverage Dashboard + Auto-Aliases — COMPLETE (PR #161)
- [x] **Coverage page enhancements** — stale source flags, health bars per region, clickable kennel links, hide/unhide toggle, "hidden" filter
- [x] **Auto-alias generation** — pure `generateAliases(shortName, fullName)` integrated into `createKennel()`, auto-generates abbreviations, H3/Hash variants, geo abbreviations
- [x] **KennelForm alias chips** — "Generate Aliases" button, toast accuracy, removable pre-filled chips

### Sprint B: AI HTML Analysis — COMPLETE
- [x] **GenericHtmlAdapter** — config-driven CSS selector extraction (`src/adapters/html-scraper/generic.ts`), eliminates custom adapter code per site
- [x] **Registry routing** — `getAdapter(type, url, config?)` routes to GenericHtmlAdapter when config has `containerSelector`, named adapters take priority
- [x] **AI HTML analysis** — `analyzeHtmlStructure(url)` uses Cheerio heuristics to find candidate containers + Gemini AI for column mapping (`src/app/admin/sources/analyze-html-action.ts`)
- [x] **Few-shot learning** — static catalog of 7 existing adapter patterns (`src/adapters/html-scraper/examples.ts`) + dynamic DB configs used as Gemini few-shot examples
- [x] **GenericHtmlConfigPanel** — interactive wizard with "Analyze Page" button, sample data preview with column reassignment dropdowns, "Refine with AI" feedback loop, advanced CSS selector editing
- [x] **Config validation** — CSS selector injection prevention, required field validation
- [x] **Test coverage** — GenericHtmlAdapter tests (18), container detection tests (16), registry routing tests (5 new)

### Sprint C: Kennel Discovery + Research (Size: M)
- [ ] **Hash Rego directory scraper** — parse `hashrego.com/kennels` to extract registered kennels with metadata
- [ ] **KennelDiscovery model** — persist discovered-but-not-onboarded kennels (status: NEW → MATCHED | ADDED | DISMISSED)
- [ ] **Discovery queue admin page** at `/admin/discovery` — table with fuzzy match scores, one-click "Add to DB" / "Dismiss" / "Already exists"
- [ ] **Weekly discovery sync** — cron extension or API endpoint

### Sprint D: Autonomous Source Research — COMPLETE
- [x] **Research pipeline** — "Research kennels in [region]" orchestrates: Gemini search grounding → kennel discovery → URL classification → HTML analysis → proposal persistence (`src/pipeline/source-research.ts`)
- [x] **Admin research UI** — region-based research trigger, proposal review table with status filters, approve/reject workflow with URL editing and feedback refinement (`src/app/admin/research/`)
- [x] **AI kennel discovery** — Phase 0 discovers unknown kennels via Gemini search, persists as KennelDiscovery records with auto-create to kennel directory
- [x] **Residential proxy** — NAS-based forward proxy for WAF-blocked scrape targets, Cloudflare Tunnel (`proxy.hashtracks.xyz`), `infra/proxy-relay/`

### Global Region & Kennel Discovery (PR #178) — COMPLETE
- [x] RegionLevel enum (COUNTRY/STATE_PROVINCE/METRO) — hierarchical region tree
- [x] Country-level seed regions (USA, UK) as parents for all metro regions
- [x] Kennel lat/lng fields — geocoded via Google Geocoding API during backfill
- [x] Kennel directory map tab — interactive pins, color-coded by region, click → kennel page
- [x] Near Me distance filter — browser geolocation + Haversine distance (10/25/50/100/250 km)
- [x] Country-grouped region filters on kennel directory
- [x] KennelDiscovery model — tracks AI-discovered kennels with geocoded coordinates
- [x] Geocoding backfill action for existing kennels without coordinates

### Future Enhancements (Deferred)
- [ ] Pagination support for generic HTML adapter (multi-page URL templates)
- [ ] JS-rendered page support (headless browser fallback for JavaScript-only sites)
- [ ] HTML analysis result caching
- [ ] Auto-migration of named adapters to generic config (existing named adapters continue working as-is)

**Sprint order:** A (done) → B (done) → D (done) → Global Region (done) → C (KennelDiscovery model built, remaining: Hash Rego directory scraper, discovery queue UI)

---

## Scaling Trajectory

| Phase | Sources | Effort per Source | Code Changes |
|-------|---------|-------------------|--------------|
| **Manual** (HTML scrapers) | 30 | ~1-2 hours | Adapter code + seed + resolver |
| **Admin wizard** (COMPLETE) | 30-50 | ~5 min | None (form-based config for Calendar/Sheets/iCal/Meetup) |
| **AI HTML analysis** (Sprint B COMPLETE) | 50-100 | ~5 min | None (paste URL → AI suggests selectors → test → save) |
| **Autonomous agent** (Sprint D) | 100+ | ~1 min approval | None (agent discovers + proposes sources) |

---

## Priority Summary

| # | Feature | Strategic Driver | Effort | HC Gap Exploited |
|---|---------|-----------------|--------|------------------|
| 1 | **Expand Source Coverage** (admin wizard COMPLETE) | Widen primary moat | Ongoing (new sources via wizard) | Manual data entry |
| 2 | **Strava Integration** (OAuth + auto-match) | Unique differentiator, no competitor has this | 2-3 sprints | Zero fitness integration |
| 3 | **Misman Growth Lever** (milestone watch, landing page, real-world testing) | B2B adoption, replace Google Sheets | 1 sprint | Paid kennel admin with less capability |
| 4 | **User Onboarding** (personal CSV import, log unlisted run, manual submission) | Reduce friction, serve traveling hashers | 1-2 sprints | Walled garden onboarding |
| 5 | **Map-Based Discovery** (map tab, near-me, travel mode) | Traveling hasher killer feature | 1 sprint | App-only proximity search |
| 6 | **PWA & Notifications** (web push, add-to-home-screen) | Retention, engagement loops | 1 sprint | Native app friction |
| 7 | **Social Visibility** (who's going, event comments) | Engagement, coordination | Small per feature | RSVP visibility, Trail Chat |
| 8 | **Data Portability** (CSV exports, payment links) | Trust, data ownership, lightweight Hash Cash | Small per feature | Excel export, Hash Cash |
| 9 | **Additional Integrations** (iCal, RSS, event series, SEO) | Coverage depth, discoverability | Varies | Feature parity |
| 10 | **Kennel Onboarding Scaling** (coverage dashboard, discovery, generic HTML) | Automate growth, eliminate manual bottleneck | 3 sprints | No competitor automates source onboarding |

---

## Reference

- [Source Onboarding Playbook](source-onboarding-playbook.md) — step-by-step guide for adding sources
- [Competitive Analysis](competitive-analysis.md) — Harrier Central analysis and strategic positioning
- [Kennel Page Redesign Spec](kennel-page-redesign-spec.md) — kennel profile enrichment and page redesign spec
- [Kennel Research](kennel-research/) — regional research for DC, Chicago, SF Bay, London kennels
- [Misman Attendance Requirements](misman-attendance-requirements.md) — kennel attendance management tool requirements and decisions
- [Misman Implementation Plan](misman-implementation-plan.md) — sprint plan for misman feature
- [Config-Driven Onboarding Plan](config-driven-onboarding-plan.md) — source onboarding wizard design (6-phase)
- [Test Coverage Analysis](test-coverage-analysis.md) — test coverage gap analysis and priorities
- [Self-Healing Automation Plan](self-healing-automation-plan.md) — automation loop architecture, confidence scoring, implementation roadmap
- [HASHTRACKS_PRD.md](../HASHTRACKS_PRD.md) — original product requirements document (includes Strava API reference in Appendix C)
- [HASHTRACKS_IMPLEMENTATION_PLAN.md](../HASHTRACKS_IMPLEMENTATION_PLAN.md) — original sprint plan (Sprints 1-4 complete, evolved beyond this plan)
