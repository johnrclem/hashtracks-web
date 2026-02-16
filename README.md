# HashTracks

The Strava of Hashing — a community platform where hashers discover upcoming runs, track attendance, and view personal stats.

**Live:** [hashtracks-web.vercel.app](https://hashtracks-web.vercel.app)

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL (Railway) via Prisma 7
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS v4 + shadcn/ui
- **Testing:** Vitest (585 tests across 34 files)
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
| `npm test` | Run test suite (585 tests) |
| `npx prisma studio` | Visual database browser |
| `npx prisma db push` | Push schema changes to DB |
| `npx prisma db seed` | Seed kennels, aliases, and sources |

## Features

### Hareline (Event Calendar)
- Aggregated event list and calendar views from 7 data sources
- Filters: time scope (upcoming/past), region, kennel, day of week
- Master-detail layout with side panel on desktop
- Region-colored badges, calendar export (Google Calendar + .ics)

### The Logbook (Attendance Tracking)
- "I Was There" one-click check-in with participation level (Run, Hare, Both, etc.)
- "I'm Going" RSVP for future events with auto-upgrade on check-in
- Activity links (Strava, Garmin, etc.) and personal trail notes
- Stats dashboard: per-kennel, per-region breakdowns with milestone markers

### Kennel Directory
- Browse and search 24 kennels across 7 regions
- Kennel profiles with upcoming events, subscriber counts
- Subscribe to favorite kennels

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
- Adapter framework: HTML scraper, Google Calendar API, Google Sheets CSV
- 7 live sources feeding 25 source-kennel links across 24 kennels
- Automated daily scrapes via Vercel Cron
- Merge pipeline with fingerprint dedup, trust levels, and kennel alias resolution

### Source Health Monitoring
- Rolling-window health analysis (event counts, field fill rates, structure fingerprints)
- 6 alert types: event count anomaly, field fill drop, structure change, scrape failure, consecutive failures, unmatched tags
- Self-healing alert actions: one-click re-scrape, unmatched tag resolver with fuzzy matching, GitHub issue creation
- Structured error display: per-adapter fetch/parse/merge error breakdown with row-level context
- Performance timing: fetch vs merge duration split per scrape
- Per-adapter diagnostic context (row counts, calendar IDs, sheet tabs)

### Admin Tools
- Source management: scrape triggers, lookback configuration, structured scrape logs
- Kennel CRUD with auto-alias on rename, duplicate detection, kennel merge tool
- Alert dashboard with acknowledge/snooze/resolve workflow and repair history
- Misman request queue with approve/reject and invite link generation
- Roster group management: create, rename, dissolve, approve requests

## Data Sources

| Source | Type | Kennels |
|--------|------|---------|
| hashnyc.com | HTML Scraper | 11 NYC-area kennels |
| Boston Hash Calendar | Google Calendar API | 5 Boston kennels |
| Summit H3 Spreadsheet | Google Sheets CSV | 3 NJ kennels |
| BFM Google Calendar | Google Calendar API | BFM, Philly H3 |
| Philly H3 Google Calendar | Google Calendar API | BFM, Philly H3 |
| BFM Website | HTML Scraper | BFM |
| Philly H3 Website | HTML Scraper | Philly H3 |

## Documentation

- [`docs/roadmap.md`](docs/roadmap.md) — Implementation roadmap and what's next
- [`docs/source-onboarding-playbook.md`](docs/source-onboarding-playbook.md) — How to add new data sources
- [`docs/misman-attendance-requirements.md`](docs/misman-attendance-requirements.md) — Misman tool requirements
- [`CLAUDE.md`](CLAUDE.md) — AI assistant context (architecture, conventions, file map)

## Project Status

**Sprints 1-9 complete.** See [`docs/roadmap.md`](docs/roadmap.md) for the full roadmap.

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
