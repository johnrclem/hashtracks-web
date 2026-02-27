# HashTracks

The Strava of Hashing — a community platform where hashers discover upcoming runs, track attendance, and view personal stats.

**Live:** [hashtracks-web.vercel.app](https://hashtracks-web.vercel.app)

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL (Railway) via Prisma 7
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS v4 + shadcn/ui
- **Testing:** Vitest (84 test files)
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
| `npm test` | Run test suite (84 test files) |
| `npx prisma studio` | Visual database browser |
| `npx prisma db push` | Push schema changes to DB |
| `npx prisma db seed` | Seed kennels, aliases, and sources |

## Features

### Hareline (Event Calendar)
- Aggregated event list, calendar, and **map** views from 29 data sources
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
- Browse and search 79 kennels across 21 regions (US + UK)
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
- 7 adapter types: HTML Scraper, Google Calendar API, Google Sheets CSV, iCal Feed, Hash Rego, Meetup, WordPress REST API
- 29 live sources feeding 79 kennels across 6 metro areas (NYC, Boston, Chicago, DC, SF Bay, London)
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

## Data Sources (29)

| Region | Sources | Kennels |
|--------|---------|---------|
| NYC / NJ / Philly | hashnyc.com, Summit Sheets, BFM + Philly Calendars, BFM + Philly websites, Hash Rego | 17 kennels |
| Boston | Boston Hash Calendar | 5 kennels |
| Chicago | Chicagoland Calendar, CH3 + TH3 websites | 11 kennels |
| DC / DMV | EWH3 + SHITH3 Calendars, W3H3 Sheets, CCH3 + BAH3 iCal, EWH3 + DCH4 + OFH3 + Hangover blogs | 19 kennels |
| SF Bay Area | SFH3 iCal Feed, SFH3 HTML Hareline | 13 kennels |
| London / UK | LH3, CityH3, WLH3, BarnesH3, OCH3, SLH3, EH3 websites | 10 kennels |

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
- **Meetup adapter:** Meetup.com public API adapter (ready for source onboarding)
- **BFM + Philly H3 scrapers:** benfranklinmob.com and hashphilly.com HTML adapters
- **User feedback:** In-app dialog auto-filing GitHub issues with category labels
- **Timezone preferences:** User-selectable timezone display with header dropdown
- **Vercel Analytics:** Web Analytics + Speed Insights integration
- **Config validation:** Server-side validation with ReDoS protection for all source types
- **Map-based discovery (PR #95):** Interactive Map tab on Hareline with Google Maps JS, region-colored pins (precise = filled, centroid = hollow), EventLocationMap static image on event detail pages, coordinate extraction from Maps URLs in merge pipeline
- **Weather forecast + units toggle (PR #97):** Google Weather API forecast on upcoming event pages (0–10 days), °F/°C header toggle persisted in localStorage, EventLocationMap text-address fallback (works without lat/lng)
- **Self-healing automation:** CI gate (type check + lint + tests on all PRs), auto-issue filing from alerts, Claude AI triage + auto-fix workflows with confidence scoring and safe-zone constraints
