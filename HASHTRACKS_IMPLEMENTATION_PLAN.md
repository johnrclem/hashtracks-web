# HashTracks: Implementation Plan & Claude CLI Build Guide

**Date:** February 7, 2026
**Status:** Ready for Implementation
**Builder:** Claude CLI (with product owner refinement)
**Deployment:** Vercel (app) + Railway (PostgreSQL) + Clerk (auth)

---

## 1. Architecture Decisions (Final)

### Stack

| Layer | Choice | Rationale |
|:------|:-------|:----------|
| **Framework** | Next.js 15 (App Router) | Full-stack in one repo, serverless deployment, excellent DX |
| **Language** | TypeScript (strict) | Type safety across frontend/backend/schema |
| **UI** | Tailwind CSS + shadcn/ui | Zero runtime overhead, composable, accessible |
| **ORM** | Prisma | Type-safe DB access, excellent migration tooling |
| **Database** | PostgreSQL (Railway) | Managed, scalable, generous free tier → $5/mo hobby |
| **Auth** | Clerk | Google OAuth, sessions, user management — zero custom auth code |
| **Scraping** | HTTP fetch + Cheerio | 100x lighter than Playwright; hash sites are static HTML |
| **AI** | Google Gemini API (gemini-2.5-flash) | Low cost, structured extraction, already proven in GAS prototype |
| **Scheduling** | Vercel Cron + serverless functions | Simple for <50 sources; upgrade to BullMQ later if needed |
| **State** | React Query (TanStack Query) | Server state caching, reduces API calls |
| **Hosting** | Vercel | Free tier generous, auto-deploys from GitHub |

### What We're NOT Using (and Why)

| Rejected | Reason |
|:---------|:-------|
| Playwright | Overkill — hash sites are static HTML tables |
| BullMQ + Redis | Cron is sufficient for 5-20 sources at launch |
| PostGIS | Text-based region filtering handles v1 needs |
| GraphQL | REST via Next.js API routes is simpler for this domain |
| Custom auth | Clerk handles everything; don't reinvent the wheel |
| Microservices | Single Next.js app is simpler to deploy, debug, iterate |
| NAS deployment | Cloud-first for user accessibility; NAS as future scraping offload |

### Cost Projection

| Service | Free Tier Ceiling | Paid (est. 100 users) |
|:--------|:------------------|:----------------------|
| Vercel | 100 GB bandwidth, 100K fn invocations | $0-20/mo |
| Railway Postgres | 500 MB storage, $5 credit | $5-10/mo |
| Clerk | 10,000 MAU | $0 |
| Gemini API | 1,500 req/day free | $5-15/mo |
| Domain (hashtracks.run or similar) | — | $12/yr |
| **Total** | **$0 during development** | **~$10-30/mo at scale** |

---

## 2. Project Structure

```
hashtracks-web/
├── CLAUDE.md                          # ← Claude CLI reads this first
├── README.md
├── package.json
├── next.config.ts
├── tsconfig.json
├── tailwind.config.ts
├── .env.example                       # Environment variable template
├── .env.local                         # Local dev secrets (gitignored)
├── prisma/
│   ├── schema.prisma                  # Full schema from PRD Section 4
│   ├── seed.ts                        # Launch kennels + aliases from PRD Section 8
│   └── migrations/
├── src/
│   ├── app/                           # Next.js App Router pages
│   │   ├── layout.tsx                 # Root layout with Clerk provider
│   │   ├── page.tsx                   # Landing / public hareline
│   │   ├── sign-in/[[...sign-in]]/
│   │   ├── sign-up/[[...sign-up]]/
│   │   ├── hareline/                  # The Hareline (discovery)
│   │   │   ├── page.tsx              # Calendar/list view
│   │   │   └── [eventId]/page.tsx    # Event detail
│   │   ├── logbook/                   # The Logbook (personal)
│   │   │   ├── page.tsx              # My Runs list
│   │   │   ├── stats/page.tsx        # Stats dashboard
│   │   │   └── import/page.tsx       # CSV import
│   │   ├── kennels/                   # Kennel directory
│   │   │   ├── page.tsx              # Browse kennels
│   │   │   └── [kennelId]/page.tsx   # Kennel detail
│   │   ├── profile/                   # User profile
│   │   │   └── page.tsx
│   │   ├── admin/                     # Admin dashboard (protected)
│   │   │   ├── page.tsx              # Overview
│   │   │   ├── sources/page.tsx      # Source management
│   │   │   ├── kennels/page.tsx      # Kennel CRUD
│   │   │   └── requests/page.tsx     # Kennel request queue
│   │   └── api/                       # API routes
│   │       ├── health/route.ts
│   │       ├── events/route.ts
│   │       ├── attendance/route.ts
│   │       ├── kennels/route.ts
│   │       ├── sources/route.ts
│   │       ├── import/route.ts        # CSV import endpoint
│   │       ├── admin/
│   │       │   ├── scrape/route.ts    # Trigger manual scrape
│   │       │   └── requests/route.ts
│   │       └── cron/
│   │           └── scrape/route.ts    # Vercel Cron target
│   ├── lib/                           # Shared utilities
│   │   ├── db.ts                      # Prisma client singleton
│   │   ├── auth.ts                    # Clerk helpers
│   │   ├── utils.ts                   # General utilities
│   │   └── constants.ts               # App-wide constants
│   ├── adapters/                      # Source adapter framework
│   │   ├── types.ts                   # SourceAdapter interface, RawEventData
│   │   ├── registry.ts                # Adapter registry (type → adapter)
│   │   ├── html-scraper/
│   │   │   ├── hashnyc.ts            # hashnyc.com parser (port from GAS)
│   │   │   └── hashnj.ts             # hashnj.com parser
│   │   ├── google-calendar/
│   │   │   └── adapter.ts            # Google Calendar API v3
│   │   ├── google-sheets/
│   │   │   └── adapter.ts            # Sheets API v4
│   │   ├── ical/
│   │   │   └── adapter.ts            # iCal feed parser
│   │   └── manual/
│   │       └── adapter.ts            # Manual event submission
│   ├── pipeline/                      # Data processing pipeline
│   │   ├── merge.ts                   # Raw → Canonical merge logic
│   │   ├── kennel-resolver.ts         # kennelTag → Kennel record
│   │   ├── fingerprint.ts             # Change detection hashing
│   │   └── scheduler.ts              # Cron job orchestration
│   ├── components/                    # React components
│   │   ├── ui/                        # shadcn/ui primitives
│   │   ├── hareline/
│   │   │   ├── EventCard.tsx
│   │   │   ├── EventList.tsx
│   │   │   ├── CalendarView.tsx
│   │   │   └── EventFilters.tsx
│   │   ├── logbook/
│   │   │   ├── CheckInForm.tsx        # "I was there" form
│   │   │   ├── RunList.tsx
│   │   │   ├── StatsCards.tsx
│   │   │   └── MilestoneCard.tsx
│   │   ├── kennels/
│   │   │   ├── KennelCard.tsx
│   │   │   ├── KennelDirectory.tsx
│   │   │   └── SubscribeButton.tsx
│   │   └── admin/
│   │       ├── SourceHealthTable.tsx
│   │       └── KennelRequestQueue.tsx
│   └── hooks/                         # Custom React hooks
│       ├── useEvents.ts
│       ├── useAttendance.ts
│       └── useKennels.ts
├── scripts/
│   ├── seed-kennels.ts                # Seed launch kennels
│   └── test-scraper.ts                # Test individual adapters
└── vercel.json                        # Cron config
```

---

## 3. CLAUDE.md (For Claude CLI)

**This file goes in the project root. Claude CLI reads it on every session.**

```markdown
# CLAUDE.md — HashTracks

## What Is This?
HashTracks is the "Strava of Hashing" — a community platform where hashers discover
upcoming runs, track attendance, and view personal stats. Think: aggregated event
calendar + personal logbook + kennel directory.

## Quick Commands
- `npm run dev` — Start local dev server (http://localhost:3000)
- `npm run build` — Production build
- `npx prisma studio` — Visual database browser
- `npx prisma db push` — Push schema changes to dev DB
- `npx prisma migrate dev` — Create migration
- `npx prisma db seed` — Seed launch kennels and aliases
- `npm run test:scraper -- --source=hashnyc` — Test a specific scraper adapter

## Architecture
- **Framework:** Next.js 15 App Router, TypeScript strict mode
- **Database:** PostgreSQL via Prisma ORM (Railway hosted)
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS + shadcn/ui components
- **Scraping:** HTTP fetch + Cheerio (NOT Playwright — hash sites are static HTML)
- **AI:** Gemini API for complex HTML parsing (low temp, cached results)
- **Deployment:** Vercel (auto-deploy from main branch)

## Data Flow
1. **Sources** (hashnyc.com, Google Calendar, etc.) are scraped on cron schedule
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
- Kennel resolution: shortName exact match → alias case-insensitive match → flag for admin
- All scraper adapters implement the `SourceAdapter` interface in `src/adapters/types.ts`
- API routes return consistent shapes: `{ data, error?, meta? }`

## Environment Variables
```
DATABASE_URL=           # Railway PostgreSQL connection string
CLERK_SECRET_KEY=       # Clerk backend key
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=  # Clerk frontend key
GEMINI_API_KEY=         # Google AI API key
CRON_SECRET=            # Secret for Vercel Cron auth
GOOGLE_CALENDAR_API_KEY= # For public calendar reads
```

## Important Files
- `prisma/schema.prisma` — Full data model (THE source of truth for types)
- `prisma/seed.ts` — Launch kennel + alias data
- `src/adapters/types.ts` — SourceAdapter interface all adapters implement
- `src/pipeline/merge.ts` — Core dedup logic (kennel + date key)
- `src/pipeline/kennel-resolver.ts` — Alias-based kennel name resolution

## What NOT To Do
- Don't use Playwright for scraping (Cheerio is sufficient, 100x lighter)
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ yet — cron is sufficient for <50 sources
```

---

## 4. Sprint Plan

### Methodology
- **Sprint cadence:** 1-week sprints
- **Sprint ceremony:** Product owner reviews deliverables at end of each sprint, refines next sprint's stories
- **Definition of Done:** Feature works locally, tests pass, deployed to Vercel preview
- **Refinement markers:** 🔍 = needs product owner input before implementation

---

### Sprint 1: Project Scaffolding & Database

**Goal:** Deployable skeleton with working auth and seeded database.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 1.1 | Initialize Next.js 15 project with TypeScript strict, Tailwind, shadcn/ui | `npm run dev` works, shadcn components available |
| 1.2 | Set up Prisma with full schema from PRD Section 4 | All models, enums, relations, indexes defined. `npx prisma db push` succeeds |
| 1.3 | Create Railway PostgreSQL database | Connection string in `.env.local`, `prisma studio` connects |
| 1.4 | Write seed script for launch kennels (PRD Section 8) | All 18 kennels with shortNames, fullNames, regions seeded |
| 1.5 | Write seed script for kennel aliases (PRD Appendix D.3) | All aliases from mapping table seeded |
| 1.6 | Integrate Clerk authentication | Sign-in/sign-up pages work, Google OAuth enabled |
| 1.7 | Create User record on first Clerk sign-in (webhook or middleware) | User row created in DB with clerkId, email |
| 1.8 | Build basic layout (nav, sidebar, footer) | Responsive shell with placeholder pages for Hareline, Logbook, Kennels, Profile |
| 1.9 | Deploy to Vercel | Auto-deploy from GitHub main branch, production URL works |
| 1.10 | Add `/api/health` endpoint | Returns `{"status": "healthy", "timestamp": "..."}` |

**🔍 Refinement needed from product owner:**
- Confirm domain name choice (hashtracks.run? hashtracks.app? hashtracker.com?)
- Confirm Clerk branding (logo, colors for sign-in page)
- Profile setup flow: should new users be prompted for hash name on first login?

**Deliverable:** Working app shell at `https://hashtracks.vercel.app` with auth, empty pages, and seeded DB.

---

### Sprint 2: Kennel Directory & Subscriptions

**Goal:** Users can browse kennels and subscribe to their home kennels.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 2.1 | Build kennel directory page (`/kennels`) | Lists all kennels grouped by region, shows subscriber count |
| 2.2 | Build kennel detail page (`/kennels/[id]`) | Shows fullName, region, description, website link, subscriber count |
| 2.3 | "Subscribe" button on kennel pages | Creates UserKennel record with MEMBER role |
| 2.4 | "My Kennels" on user profile | Lists subscribed kennels, unsubscribe button |
| 2.5 | Build profile page (`/profile`) | Edit hash name, nerd name, bio. Privacy toggle for attendance history |
| 2.6 | Build kennel request form | User submits: kennel name, region, country, source URL, notes → creates KennelRequest |
| 2.7 | Admin: kennel request queue (`/admin/requests`) | List pending requests, approve/reject actions |
| 2.8 | Admin: kennel CRUD (`/admin/kennels`) | Create, edit, delete kennels. Manage aliases |

**🔍 Refinement needed from product owner:**
- Kennel card design: what info is most important at a glance?
- Should the directory be publicly visible (no auth) or require sign-in?
- How should regions be displayed? (grouped cards? filterable list? map?)

**Deliverable:** Browsable kennel directory, user profiles, subscription system working.

---

### Sprint 3: Source Engine — Adapter Framework & hashnyc.com

**Goal:** First scraper running, producing canonical events from hashnyc.com.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 3.1 | Define `SourceAdapter` interface and `RawEventData` types | Interface in `src/adapters/types.ts` matching PRD Section 6 |
| 3.2 | Build adapter registry (SourceType → adapter class) | `getAdapter(source)` returns correct adapter |
| 3.3 | Implement hashnyc.com HTML scraper | Ports PRD Appendix A logic: URL construction, HTML parsing, field extraction, kennel tag extraction, hare extraction, HTML entity decoding |
| 3.4 | Build kennel tag resolver (`src/pipeline/kennel-resolver.ts`) | shortName match → alias match → flag for review. Uses KennelAlias table |
| 3.5 | Build fingerprint generator (`src/pipeline/fingerprint.ts`) | Hash of (date + kennelTag + runNumber + title) for change detection |
| 3.6 | Build Raw → Canonical merge pipeline (`src/pipeline/merge.ts`) | New RawEvent with matching Event → update. No match → create. Fingerprint skip |
| 3.7 | Admin: source CRUD (`/admin/sources`) | Create, edit sources. Assign kennel relationships (SourceKennel) |
| 3.8 | Admin: manual scrape trigger | Button to trigger scrape for a specific source, shows results |
| 3.9 | Source health tracking | Updates `lastScrapeAt`, `lastSuccessAt`, `healthStatus` after each scrape |
| 3.10 | Test: scrape hashnyc.com `?days=30` and verify canonical events created | At least 20+ events created across multiple kennels, correctly deduplicated |

**🔍 Refinement needed from product owner:**
- How many days of history should initial scrape pull? (`days=all` is ~8 years of data)
- Should scraper run be visible in admin UI with progress/logs?
- When hashnyc.com has an event with an unknown kennel tag, what's the UX? (auto-create? queue for review?)

**Deliverable:** hashnyc.com scraper running, canonical events in database, admin dashboard showing source health.

---

### Sprint 4: The Hareline (Event Discovery UI)

**Goal:** Users can browse upcoming and past events in a clean calendar/list view.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 4.1 | Build event list view (`/hareline`) | Paginated list of events, newest first. Shows date, kennel, title, hares |
| 4.2 | Build event detail page (`/hareline/[eventId]`) | Full event info: date, kennel, run number, hares, description, location, source link |
| 4.3 | "My Kennels" default filter | Hareline defaults to showing events from subscribed kennels. "All Kennels" toggle |
| 4.4 | Filter by region | Dropdown/chip filter for region |
| 4.5 | Filter by kennel | Multi-select kennel filter |
| 4.6 | Filter by day of week | Useful for "I hash on Wednesdays" |
| 4.7 | Calendar month view | Visual month grid with event dots. Click day to expand events |
| 4.8 | "Upcoming" vs "Past" toggle | Split view — upcoming events (future dates) vs past events (history) |
| 4.9 | Link event to kennel detail page | Click kennel name → kennel page |
| 4.10 | Public landing page | Unauthenticated users see the Hareline (read-only). CTA to sign up for logging |

**🔍 Refinement needed from product owner:**
- List view card design: how much info per event? Compact vs detailed?
- Calendar view: is this a priority for v1 or can it wait?
- Should the landing page show all regions or focus on a default (e.g., NYC)?

**Deliverable:** Fully browsable event discovery experience with filtering.

---

### Sprint 5: The Logbook (Attendance Tracking)

**Goal:** Users can check in to events and see their personal stats.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 5.1 | "I Was There" check-in button on event detail page | Creates Attendance record. Only on past events. One per user per event |
| 5.2 | Participation level selector | R / H / BH / DC / BM / W / C — radio buttons or dropdown |
| 5.3 | Strava URL field (manual paste) | Optional text input, validates Strava activity URL format |
| 5.4 | "Beez There" checkbox | Boolean toggle on attendance form |
| 5.5 | Notes field | Optional textarea for personal notes |
| 5.6 | Edit/delete attendance | User can modify or remove their check-in |
| 5.7 | "My Runs" page (`/logbook`) | List of all attended events, filterable by kennel, region, date range |
| 5.8 | Stats dashboard (`/logbook/stats`) | Total runs, runs per kennel, runs per region, hare count |
| 5.9 | Milestone markers | Highlight 25th, 50th, 69th, 100th, 200th, etc. runs in stats and run list |
| 5.10 | "Log Unlisted Run" | User logs a run for kennel not in system: kennel name, region, date, participation level. Creates KennelRequest |

**🔍 Refinement needed from product owner:**
- Check-in UX: modal overlay on event page? Or separate check-in page?
- Stats: which milestones matter most in the hashing community?
- Should stats be public by default (visible on profile) or private?

**Deliverable:** Complete personal attendance tracking with stats and milestones.

---

### Sprint 6: CSV Import & Additional Adapters

**Goal:** Power users can bulk import history. Boston calendar live.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 6.1 | CSV upload page (`/logbook/import`) | File upload, column preview |
| 6.2 | Column mapping UI | User maps their columns to HashTracks fields (date, kennel, participation level, notes, strava URL) |
| 6.3 | Kennel name normalization during import | Alias matching resolves "NYC Hash" → NYCH3. Unmatched names flagged |
| 6.4 | Import preview + confirm | Show matched events, flagged issues. User confirms before saving |
| 6.5 | Batch create Attendance records | Import creates attendance for matching canonical events. Manual entries for unmatched |
| 6.6 | Google Calendar adapter | Ports PRD Appendix B: Boston calendar, event filtering, kennel extraction, hare extraction |
| 6.7 | Vercel Cron setup | Daily scrape of all active sources. `vercel.json` cron config + `/api/cron/scrape` |
| 6.8 | Source health dashboard (`/admin/sources`) | Table showing all sources with health status, last scrape, event count |

**🔍 Refinement needed from product owner:**
- CSV import: what column names do you use in your personal spreadsheet? (This informs smart defaults)
- Boston calendar IDs: are the BoBBH3, Beantown, Moon calendar IDs available?
- Cron schedule: daily at what time? (Consider time zones of source sites)

**Deliverable:** History backfill via CSV working. Two adapter types live (HTML + Calendar). Automated daily scraping.

---

### Sprint 7: Polish, Edge Cases & Soft Launch

**Goal:** Production-ready quality. Invite first users.

| # | Story | Acceptance Criteria |
|:--|:------|:-------------------|
| 7.1 | Error handling & loading states | All pages handle loading, empty, and error states gracefully |
| 7.2 | Mobile responsiveness pass | All pages usable on iPhone/Android |
| 7.3 | SEO basics | Page titles, meta descriptions, OG tags for sharing |
| 7.4 | Admin: manual event submission | Admin can create events manually (for Facebook-only kennels like Rumson) |
| 7.5 | Manual event submission for users | Verified users can submit events via form (MANUAL source type) |
| 7.6 | Double-header handling | Admin override for @@unique(kennelId, date) constraint |
| 7.7 | Event series support | Parent/child event linking for weekends/campouts |
| 7.8 | Performance: pagination, caching | React Query caching on all list views. API pagination |
| 7.9 | Rate limiting on API routes | Prevent abuse on public endpoints |
| 7.10 | Soft launch to 5-10 hashers | Invite friends, collect feedback |

**🔍 Refinement needed from product owner:**
- Who are your first 5-10 beta testers? (NYC hashers? Boston?)
- Feedback mechanism: in-app feedback form? Or just a shared doc/channel?
- Any remaining design/UX issues from using the app yourself?

**Deliverable:** Production-quality app ready for real users.

---

### Future Sprints (Backlog)

| Sprint | Focus | Key Stories |
|:-------|:------|:------------|
| 8 | Strava Integration | OAuth flow, activity fetch, auto-suggest matches, one-click attach |
| 9 | Additional Adapters | Google Sheets (Summit H3), iCal feeds, hashnj.com |
| 10 | AI Import | Gemini-based HTML parsing for unknown source formats |
| 11 | Social v2 | Activity feed, kudos, comments |
| 12 | Kennel Admin v2 | Scribe role, verified attendance, kennel admin tools |

---

## 5. Key Implementation References

These are the battle-tested patterns from the PRD appendices and our previous work that Claude CLI should follow closely.

### 5.1 hashnyc.com Scraper (PRD Appendix A)

The most complex adapter. Key implementation notes:

- **URL:** `https://hashnyc.com/?days={N}&backwards=true` for recent; `?days=all` for full history
- **No JS rendering needed** — plain HTTP fetch + Cheerio
- **HTML structure:** `<table class="past_hashes">`, rows in reverse chronological order
- **Field extraction order:** Year → Date → Kennel Name → Run Number → Hares → Source URL
- **Kennel regex ordering is critical:** Longer strings before shorter (Knickerbocker before Knick)
- **Three-tier hare extraction:** onin-adjacent cell → broader pattern → cell iteration → "N/A"
- **HTML entity decoding:** Handle named, hex numeric, AND decimal numeric entities
- **UTC noon dates:** `new Date(Date.UTC(year, month, day, 12, 0, 0))` prevents DST shifts
- **Early termination:** Rows are reverse-chronological — `break` (not continue) when past target range
- **Run ID format:** `nyc-{kenneltag}-{YYYYMMDD}-{suffix}`

Full implementation details: PRD Appendix A (Sections A.1 through A.7)

### 5.2 Boston Calendar Adapter (PRD Appendix B)

- **Calendar ID:** `bostonhash@gmail.com` (public, no OAuth needed)
- **Hash event filtering:** Check title/description against keyword list
- **Kennel extraction:** Regex on title prefix, then keyword fallback
- **Three-function hare chain:** extractFromDescription → extractFromTitle → Mystery Hare fallback
- **"Moom" is intentional** — alternate spelling for Boston Moon Hash

Full implementation details: PRD Appendix B (Sections B.1 through B.6)

### 5.3 Kennel Normalization (PRD Appendix D)

- **Pipeline:** Raw tag → regex cleanup → alias lookup → canonical shortName
- **Alias table is the source of truth** for fuzzy matching
- **Auto-detection for new kennels:** Strip "Hash"/"House"/"Harriers"/"H3" → extract initials → add "H3" suffix
- **Region fallback map** for kennels without event-level region data

Full implementation details: PRD Appendix D (Sections D.1 through D.5)

### 5.4 Data Merging (PRD Appendix F)

- **Dedup key:** `kennel_id + date` (handles 99%+ of cases)
- **Fingerprint:** Hash of (date + kennelTag + runNumber + title) for change detection
- **Multi-source resilience:** Each source fetched in its own try/catch — one failure doesn't block others
- **Date comparison:** Always normalize to UTC noon before comparing

Full implementation details: PRD Appendix F (Sections F.1 through F.5)

### 5.5 Known Integration Gotchas (PRD Section 10)

- **Strava timezone bug:** `start_date_local` has fake `Z` suffix — extract time directly from string
- **Strava deprecated fields:** `location_city`/`location_state` always return null — use `start_latlng`
- **Strava rate limits:** 100 req/15 min, 1000/day — batch fetch and cache server-side
- **HTML entities:** Three types (named, hex, decimal) each need separate decoding passes
- **Regex ordering:** Longer strings before shorter substrings in alternation patterns

---

## 6. Environment Setup Checklist

### Services to Create (Before Sprint 1)

| Service | Action | Result |
|:--------|:-------|:-------|
| GitHub | Create `hashtracks-web` repo | Code hosting |
| Vercel | Connect GitHub repo, enable auto-deploy | Hosting + preview deploys |
| Railway | Create PostgreSQL instance | Database URL |
| Clerk | Create application, enable Google OAuth | Auth keys |
| Google Cloud | Create project, enable Calendar API, get API key | Calendar adapter |
| Google AI Studio | Get Gemini API key | AI parsing (Sprint 10+) |

### Local Dev Setup

```bash
# Clone and install
git clone https://github.com/[you]/hashtracks-web.git
cd hashtracks-web
npm install

# Environment
cp .env.example .env.local
# Fill in DATABASE_URL, CLERK keys, etc.

# Database
npx prisma db push
npx prisma db seed

# Run
npm run dev
```

---

## 7. Refinement Tracker

All items marked 🔍 in the sprint plan, collected here for easy product owner review.

### Pre-Sprint 1
- [ ] Domain name decision
- [ ] Clerk branding (logo, colors)
- [ ] First-login flow: prompt for hash name?

### Pre-Sprint 2
- [ ] Kennel card design priorities
- [ ] Public vs auth-required directory
- [ ] Region display format

### Pre-Sprint 3
- [ ] Initial history scrape depth (30 days? all?)
- [ ] Admin scrape progress UX
- [ ] Unknown kennel tag handling

### Pre-Sprint 4
- [ ] Event card information density
- [ ] Calendar view priority for v1
- [ ] Landing page default region

### Pre-Sprint 5
- [ ] Check-in UX (modal vs page?)
- [ ] Milestone numbers important to hashers
- [ ] Stats privacy default

### Pre-Sprint 6
- [ ] Your CSV column names (for smart defaults)
- [ ] Boston calendar IDs for other kennels
- [ ] Cron schedule timing

### Pre-Sprint 7
- [ ] Beta tester list
- [ ] Feedback collection mechanism
- [ ] Outstanding design issues

---

## 8. What Carries Forward from Previous "Hash Hound" Work

Our earlier project planning produced valuable architecture decisions and code patterns. Here's what's relevant:

### ✅ Keep & Leverage
- **Hybrid AI approach:** Deterministic parsers for structured data, AI only for ambiguous HTML. The confidence scoring and progressive learning concepts are solid.
- **Adapter pattern:** Pluggable source adapters with a common interface. This is now codified in the PRD.
- **Kennel normalization pipeline:** The multi-stage approach (regex → alias → fallback) is proven.
- **Synology deployment patterns:** Keep in back pocket for when scraping moves to NAS (Option C hybrid).
- **Docker health monitoring patterns:** The auto-restart and health check patterns apply to any deployment.

### ❌ Discard / Defer
- **NAS-optimized memory constraints:** Not needed on Vercel/Railway.
- **Redis at launch:** Deferred per PRD. React Query handles client-side caching.
- **Local LLM processing:** Cloud API is sufficient and much simpler.
- **Complex job queues (BullMQ):** Cron is sufficient for v1.
- **Over-engineered learning system:** The progressive confidence system was interesting but premature. Start with deterministic parsers + simple Gemini fallback.

### 🔄 Evolved
- **Auth:** Was NextAuth → now Clerk (simpler, more features for hashing use case).
- **Schema:** Was simplified JSONB → now full Prisma schema with proper relations (PRD Section 4 is well-designed).
- **Naming:** "Hash Hound" → "HashTracks" (clearer branding).
- **Deployment:** NAS-first → Cloud-first with NAS as future scraping offload.
