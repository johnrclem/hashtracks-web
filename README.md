# HashTracks

A community platform where hashers discover upcoming runs, track attendance, and view personal stats. Think: aggregated event calendar + personal logbook + kennel directory.

**Live:** [hashtracks.xyz](https://hashtracks.xyz)

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL (Railway) via Prisma 7 with versioned migrations
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS v4 + shadcn/ui
- **Jobs:** Vercel Cron triggers QStash fan-out for per-source scrape jobs
- **NAS infra:** Self-hosted Playwright browser-render + residential proxy (Synology + Tailscale) for JS-rendered and WAF-blocked sources
- **AI:** Gemini 2.0 Flash for parse recovery, column detection, and source research
- **Analytics:** PostHog (privacy-first), Sentry error tracking, Vercel Speed Insights
- **Testing:** Vitest (163 test files, 3900+ tests)
- **Deployment:** Vercel (auto-deploy from `main`, `prisma migrate deploy` on build)

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
| `npm test` | Run test suite |
| `npx prisma studio` | Visual database browser |
| `npm run prisma -- db push` | Push schema changes to **local dev** DB only (wrapper refuses non-local hosts; prod uses versioned migrations) |
| `npm run prisma -- migrate dev --name <change>` | Author a new versioned migration for a schema change (wrapper refuses non-local hosts) |
| `npx prisma migrate deploy` | Apply pending migrations (runs automatically in Vercel build) |
| `npx prisma db seed` | Seed kennels, aliases, and sources |

## Features

### Hareline (Event Calendar)
- Aggregated event list, calendar, and **map** views from 155+ data sources
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
- Browse and search 193+ kennels across 97 regions (US, UK, Ireland, Germany, Japan)
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
- Adapter types: HTML Scraper, Google Calendar, Google Sheets, iCal Feed, Hash Rego, Meetup, Harrier Central, Static Schedule (RRULE-based). HTML Scraper has implementation variants: Cheerio, browser-rendered (Wix/SPA), WordPress REST API, Blogger API, and a generic config-driven CSS selector scraper.
- **155+ live sources feeding 193+ kennels across 25+ regions** (US coast-to-coast, UK, Ireland, Germany, Japan). See [`.claude/rules/active-sources.md`](.claude/rules/active-sources.md) for the full per-region breakdown.
- Scrape dispatch: Vercel Cron fires a fan-out job → QStash publishes one message per due source → per-source endpoints run the adapter and merge results
- Merge pipeline with fingerprint dedup, trust levels, and kennel alias resolution
- Event reconciliation: detects and cancels stale events when sources change
- AI recovery layer: Gemini-powered parse error fallback with confidence tracking
- Shared adapter utilities for date parsing and field extraction

### Source Health Monitoring
- Rolling-window health analysis (event counts, field fill rates, structure fingerprints)
- Alert types: event count anomaly, field fill drop, structure change, scrape failure, consecutive failures, unmatched tags, source-kennel mismatch, excessive cancellations
- AI-assisted alert classification and repair suggestions
- Self-healing alert actions: one-click re-scrape, unmatched tag resolver with fuzzy matching, GitHub issue creation
- Self-healing automation loop: critical alerts auto-create GitHub issues → Claude AI triages with confidence scoring → high-confidence issues trigger auto-fix PRs → CI validates → human reviews
- Structured error display: per-adapter fetch/parse/merge error breakdown with row-level context
- Performance timing: fetch vs merge duration split per scrape
- Per-adapter diagnostic context (row counts, calendar IDs, sheet tabs)

### Admin Tools
- Source onboarding wizard: multi-phase guided setup with source type auto-detection, config panels, and live preview
- Source research pipeline: AI-powered URL discovery, classification, and proposal workflow
- Source coverage dashboard: kennel-to-source mapping matrix
- Config validation with ReDoS safety and per-adapter field enforcement
- Source management: scrape triggers, lookback configuration, structured scrape logs
- Kennel CRUD with auto-alias on rename, duplicate detection, kennel merge tool
- Alert dashboard with acknowledge/snooze/resolve workflow and repair history
- Analytics dashboard: community health, user engagement, and operational metrics with recharts
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

## Documentation

- [`CLAUDE.md`](CLAUDE.md) — AI assistant context: architecture, conventions, file map, active sources
- [`docs/`](docs/) — Roadmap, source-onboarding playbook, misman requirements, self-healing automation, residential-proxy spec, and regional kennel research

## Project Status

Active development. See [`docs/roadmap.md`](docs/roadmap.md) for what's next.
