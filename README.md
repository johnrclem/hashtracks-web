# HashTracks

A community platform where hashers discover upcoming runs, track attendance, and view personal stats. Think: aggregated event calendar + personal logbook + kennel directory.

**Live:** [hashtracks.xyz](https://hashtracks.xyz)

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL (Railway) via Prisma 7
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS v4 + shadcn/ui
- **Analytics:** PostHog (event tracking, privacy-first), Sentry (error tracking), Vercel Speed Insights
- **Testing:** Vitest (129 test files, 3200+ tests)
- **Deployment:** Vercel (auto-deploy from `main`, daily cron scrapes)

## Local Development

**Prerequisites:** Node.js 20+

```bash
git clone https://github.com/johnrclem/hashtracks-web.git
cd hashtracks-web

# Set up environment
cp .env.example .env.local
# Fill in DATABASE_URL and Clerk keys in .env.local

# Install and generate
npm install
npx prisma generate
npx prisma db seed

# Run
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Key Commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start dev server |
| `npm run build` | Production build |
| `npm test` | Run test suite (109 test files) |
| `npx prisma studio` | Visual database browser |
| `npx prisma db push` | Push schema changes to DB |
| `npx prisma db seed` | Seed kennels, aliases, and sources |

## Features

### Hareline (Event Calendar)
- Aggregated event list, calendar, and **map** views from 150+ data sources
- Filters: time scope (upcoming/past), region, kennel, day of week (apply across all views)
- Master-detail layout with side panel on desktop
- Region-colored badges, calendar export (Google Calendar + .ics)
- Event detail pages include a static location map and **weather forecast** (0–10 days out, with °F/°C toggle)

### The Logbook (Attendance Tracking)
- "I Was There" one-click check-in with participation level (Run, Hare, Both, etc.)
- "I'm Going" RSVP for future events with auto-upgrade on check-in
- Activity links (Strava, Garmin, etc.) and personal trail notes
- Stats dashboard: per-kennel, per-region breakdowns with milestone markers

### Kennel Directory
- Browse and search 190+ kennels across 97 regions (US, UK, Ireland, Germany)
- Rich kennel profiles: schedule, social links, hash cash, dog-friendly/walkers-welcome flags
- Filters: region, run day, frequency, has upcoming, country
- Sort: A–Z (grouped by region) or Recently Active

### Misman Tool (Kennel Attendance Management)
- Per-kennel mismanagement dashboard with role-based access
- Mobile attendance form: event selector, hasher search, quick-add, per-hasher toggles (paid, hare, virgin, visitor)
- Smart suggestions: weighted scoring (frequency/recency/streak) surfaces likely attendees as tap-to-add chips
- Kennel roster: per-kennel hasher directory with stats, user linking (fuzzy match), duplicate merge
- Roster groups: shared rosters across related kennels (e.g., NYC Metro, Philly Area)
- Attendance history: per-event and per-hasher views with date filtering and pagination
- Historical CSV import: matrix-format upload with fuzzy hasher matching
- Audit log: field-level change tracking on attendance records
- Invite links: secure token-based misman onboarding with 7-day expiry
- Logbook sync: pending confirmations link misman records to user logbook entries

### Source Engine
- 7 source types: HTML Scraper, Google Calendar, Google Sheets, iCal Feed, Hash Rego, Meetup, Static Schedule (RRULE-based); HTML Scraper includes implementation variants: browser-rendered (Wix/SPA), WordPress REST API, Blogger API, and generic config-driven CSS selector scraping
- 150+ live sources feeding 190+ kennels across 25+ regions (US coast-to-coast, UK, Ireland, Germany)
- Automated daily scrapes via Vercel Cron
- Merge pipeline with fingerprint dedup, trust levels, and kennel alias resolution
- Event reconciliation: detects and cancels stale events when sources change
- AI recovery layer: Gemini-powered parse error fallback with confidence tracking
- Shared adapter utilities for date parsing and field extraction

### Source Health Monitoring
- Rolling-window health analysis (event counts, field fill rates, structure fingerprints)
- 6 alert types: event count anomaly, field fill drop, structure change, scrape failure, consecutive failures, unmatched tags
- AI-assisted alert classification and repair suggestions
- Self-healing alert actions: one-click re-scrape, unmatched tag resolver with fuzzy matching, GitHub issue creation
- Self-healing automation loop: critical alerts auto-create GitHub issues → Claude AI triages with confidence scoring → high-confidence issues trigger auto-fix PRs → CI validates → human reviews
- Structured error display: per-adapter fetch/parse/merge error breakdown with row-level context
- Performance timing: fetch vs merge duration split per scrape
- Per-adapter diagnostic context (row counts, calendar IDs, sheet tabs)

### Admin Tools
- Source onboarding wizard: multi-phase guided setup with source type auto-detection, config panels, and live preview
- Source coverage dashboard: kennel-to-source mapping matrix
- Config validation with ReDoS safety and per-adapter field enforcement
- Source management: scrape triggers, lookback configuration, structured scrape logs
- Kennel CRUD with auto-alias on rename, duplicate detection, kennel merge tool
- Alert dashboard with acknowledge/snooze/resolve workflow and repair history
- **Analytics dashboard:** community health, user engagement, and operational metrics with recharts
- Misman request queue with approve/reject and invite link generation
- Roster group management: create, rename, dissolve, approve requests
- CI enforcement: type checking, linting, and tests required on all PRs via GitHub Actions

### User Feedback
- In-app "Send Feedback" dialog (bug report, feature request, question, other)
- Auto-creates GitHub issues with `user-feedback` + category labels
- Auto-captures current page URL for context

### Timezone & Units Preferences
- User-selectable timezone display (event local time / my local time)
- Temperature units toggle: °F / °C (localStorage-persisted, defaults to °F)
- Header dropdowns for quick switching; event cards and detail pages respect both preferences

## Data Sources (150+)

| Region | Sources | Kennels |
|--------|---------|---------|
| NYC / NJ / Philly | 8 sources (hashnyc.com, Summit Sheets, Calendars, websites, Hash Rego) | 17 kennels |
| Massachusetts | 4 sources (Boston Calendar, static schedules, Northboro browser-rendered) | 11 kennels |
| Chicago | 3 sources (Chicagoland Calendar, CH3 + TH3 websites) | 11 kennels |
| DC / DMV | 10 sources (Calendars, iCal feeds, WordPress blogs, Sheets) | 19 kennels |
| SF Bay Area | 3 sources (SFH3 iCal + HTML, Surf City Calendar) | 13 kennels |
| Southern California | 12 sources (Google Calendars, SDH3 hareline) | 20+ kennels |
| Washington | 8 sources (WA Hash Calendar, Sheets for 6 kennels) | 12 kennels |
| Colorado | 5 sources (Denver, Boulder, Ft Collins, CO Springs Calendars) | 8 kennels |
| Texas | 10 sources (Austin, Houston, DFW Calendars, Brass Monkey blog) | 10+ kennels |
| London / UK + Scotland | 9 sources (HTML scrapers, GenericHtml) | 12 kennels |
| Germany | 4 sources (Berlin iCal, Stuttgart + Munich Calendars, Frankfurt scraper) | 12 kennels |
| Ireland | 1 source (Dublin H3 website) | 1 kennel |
| Florida | 8 sources (Meetup, Calendars, WCFH3 scraper, static schedules) | 29 kennels |
| Georgia | 11 sources (Meetup, Atlanta Hash Board, static schedules) | 20 kennels |
| South Carolina | 10 sources (Meetup, static schedules) | 10 kennels |
| Virginia | 9 sources (Calendars, Meetup, static schedules) | 9 kennels |
| North Carolina | 6 sources (Calendars, Meetup, website) | 6 kennels |
| Upstate New York | 6 sources (Calendars, Meetup, HTML scrapers) | 6 kennels |
| Pennsylvania | 6 sources (Calendars, iCal feeds) | 6 kennels |
| New England | 5 sources (Meetup, websites, static schedule) | 5 kennels |
| Other (AZ, HI, MN, MI, DE) | 10+ sources | 15+ kennels |

## Documentation

- [`docs/roadmap.md`](docs/roadmap.md) — Implementation roadmap and what's next
- [`docs/source-onboarding-playbook.md`](docs/source-onboarding-playbook.md) — How to add new data sources
- [`docs/misman-attendance-requirements.md`](docs/misman-attendance-requirements.md) — Misman tool requirements
- [`docs/config-driven-onboarding-plan.md`](docs/config-driven-onboarding-plan.md) — Source onboarding wizard design
- [`docs/test-coverage-analysis.md`](docs/test-coverage-analysis.md) — Test coverage gap analysis
- [`docs/self-healing-automation-plan.md`](docs/self-healing-automation-plan.md) — Self-healing automation architecture
- [`CLAUDE.md`](CLAUDE.md) — AI assistant context (architecture, conventions, file map)

## Project Status

**Sprints 1-10 complete.** See [`docs/roadmap.md`](docs/roadmap.md) for the full roadmap.

### Completed
- **Sprint 1:** Scaffold — Prisma 7, Clerk auth, seeded DB, Vercel deployment
- **Sprint 2:** Kennel directory — browse, search, subscribe, profiles, admin tools
- **Sprint 3:** Source engine — adapter framework, hashnyc.com scraper, merge pipeline
- **Sprint 4:** Hareline — event list & calendar views, filters, event detail pages
- **Post-sprint polish:** Tooltips, AM/PM times, filter URL persistence, Google Calendar adapter (Boston), Google Sheets adapter (Summit H3)
- **Sprint 5:** The Logbook — attendance tracking, check-in, stats, milestones
- **Sprint 6:** UX polish — loading skeletons, calendar export, dynamic titles, region badges
- **Sprint 7:** Per-source scrape windows, "I'm Going" RSVP
- **Source monitoring:** Health analysis, structural fingerprinting, admin alerts, self-healing actions
- **Scrape logging:** Structured errors across all adapters, performance timing, diagnostic context
- **Sprints 8a-8f:** Misman tool — schema, dashboard, attendance form, roster, history, roster groups, duplicate merge
- **Sprint 9:** Audit log, hare sync, CSV import, invite links, attendance UX polish
- **Admin polish:** Kennel merge UI, roster group admin, invite from admin page
- **Kennel identity:** Permanent kennelCode field, source-scoped resolver, duplicate merges
- **EventLink + Hash Rego:** EventLink model, Hash Rego adapter, multi-day event splitting
- **Source expansion:** 29 sources across 6 regions — DC/DMV, Chicago, SF Bay, London adapters
- **Refactoring:** Shared adapter utilities, function decomposition, ActionResult types
- **Hasher-kennel linking:** Profile invites, user-side visibility, misman activity awareness
- **Source onboarding wizard:** Multi-phase admin UI for config-driven source creation with live preview
- **AI recovery layer:** Gemini-powered parse error fallback, column auto-detection, kennel pattern suggestions
- **Event reconciliation:** Stale event detection and cancellation when sources change
- **Meetup adapter:** Meetup.com public API adapter — 5 live sources (Miami, Savannah, VT, CT, Charleston)
- **Static Schedule adapter:** RRULE-based event generation for Facebook-only kennels — 26 live sources
- **BFM + Philly H3 scrapers:** benfranklinmob.com and hashphilly.com HTML adapters
- **User feedback:** In-app dialog auto-filing GitHub issues with category labels
- **Timezone preferences:** User-selectable timezone display with header dropdown
- **Analytics:** PostHog (client + server event tracking, privacy-first, `/ingest` reverse proxy), Sentry error tracking, Vercel Speed Insights, admin analytics dashboard at `/admin/analytics`
- **Config validation:** Server-side validation with ReDoS protection for all source types
- **Map-based discovery (PR #95):** Interactive Map tab on Hareline with Google Maps JS, region-colored pins, EventLocationMap static image, coordinate extraction from Maps URLs
- **Weather forecast + units toggle (PR #97):** Google Weather API forecast on upcoming events, °F/°C toggle, text-address fallback
- **Self-healing automation:** CI gate, auto-issue filing from alerts, Claude AI triage + auto-fix workflows
- **Design refresh:** Homepage redesign (PR #205), EventCard redesign (PR #219), Kennel profile pages (PR #210), Logbook visualizations (PR #211), Nav & Chrome overhaul (PRs #214-226)
- **SHITH3 website adapter:** PHP REST API scraper for richer event data (hares, locations, distances)
- **Kennel scaling:** Florida (29 kennels, 8 sources), Georgia (20 kennels, 11 sources), South Carolina (10 kennels, 10 sources), New England + Dublin expansion
- **Double-header support:** Multiple events per kennel per day with `allowDoubleHeaders` flag
- **Hidden kennels:** Admin hide/unhide kennels from public directory
- **Rolling weeks calendar:** Week-based calendar navigation with time filter
- **Data quality hardening:** Location cleanup, venue dedup, placeholder filtering, event city backfill from coordinates
- **DB seed automation:** Slug collision handling, `ensurePattern()` refactor
- **Dublin H3 adapter:** First Ireland-based kennel (HTML scraper)
- **Massive source expansion:** 150+ sources across 25+ regions — Southern CA, Washington, Colorado, Texas, Virginia, North Carolina, Upstate NY, Pennsylvania, Germany, Scotland, Arizona, Hawaii, Minnesota, Michigan, Delaware
- **Strava integration:** OAuth connect, activity sync, match suggestions, privacy zone handling
- **Near Me filter:** Geolocation-based distance filtering on hareline and kennel directory
- **Kennel map view:** Interactive Google Maps with region-colored pins and aggregate markers
- **Source research pipeline:** AI-powered URL discovery, classification, and proposal workflow
- **GenericHtml adapter:** Config-driven CSS selector scraping with AI-assisted setup
- **Open Graph + social sharing:** Metadata, og:image, Twitter cards
