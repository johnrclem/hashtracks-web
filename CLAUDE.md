# CLAUDE.md — HashTracks

## What Is This?
HashTracks is the "Strava of Hashing" — a community platform where hashers discover
upcoming runs, track attendance, and view personal stats. Think: aggregated event
calendar + personal logbook + kennel directory.

## Quick Commands
- `npm run dev` — Start local dev server (http://localhost:3000)
- `npm run build` — Production build
- `npm test` — Run test suite (Vitest, 416 tests)
- `npx prisma studio` — Visual database browser
- `npx prisma db push` — Push schema changes to dev DB
- `npx prisma migrate dev` — Create migration
- `npx prisma db seed` — Seed launch kennels and aliases

## Architecture
- **Framework:** Next.js 16 App Router, TypeScript strict mode
- **Database:** PostgreSQL via Prisma ORM (Railway hosted)
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS + shadcn/ui components
- **Scraping:** HTTP fetch + Cheerio (NOT Playwright — hash sites are static HTML)
- **AI:** Gemini API for complex HTML parsing (low temp, cached results)
- **Deployment:** Vercel (auto-deploy from main branch)

## Data Flow
1. **Sources** (hashnyc.com, Google Calendar, Google Sheets, etc.) are scraped on cron schedule
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
- CRON_SECRET=            # Secret for Vercel Cron auth (set in Vercel dashboard)
- GOOGLE_CALENDAR_API_KEY= # For Google Calendar + Sheets APIs
- GITHUB_TOKEN=           # GitHub PAT with repo scope (for filing issues from alerts)

## Important Files
- `prisma/schema.prisma` — Full data model (THE source of truth for types)
- `prisma/seed.ts` — Launch kennel + alias data
- `prisma.config.ts` — Prisma 7 config (datasource URL, seed command)
- `src/lib/db.ts` — PrismaClient singleton (PrismaPg adapter + SSL)
- `src/lib/auth.ts` — `getOrCreateUser()` + `getAdminUser()` (Clerk→DB sync + admin role check)
- `src/lib/format.ts` — Shared utilities: time formatting, region config/colors, participation levels
- `src/lib/calendar.ts` — Google Calendar URL + .ics file generation (client-side)
- `src/middleware.ts` — Clerk route protection (public vs authenticated routes)
- `src/adapters/types.ts` — SourceAdapter interface + RawEventData types
- `src/adapters/registry.ts` — Adapter factory (SourceType → adapter instance)
- `src/adapters/html-scraper/hashnyc.ts` — hashnyc.com HTML scraper (Cheerio)
- `src/adapters/google-calendar/adapter.ts` — Google Calendar API v3 adapter (Boston Hash)
- `src/adapters/google-sheets/adapter.ts` — Google Sheets CSV adapter (Summit H3, config-driven)
- `src/pipeline/merge.ts` — Raw→Canonical merge pipeline (fingerprint dedup + source-kennel guard)
- `src/pipeline/kennel-resolver.ts` — Alias-based kennel name resolution (with pattern fallback)
- `src/pipeline/scrape.ts` — Shared `scrapeSource()` used by cron + admin routes
- `src/pipeline/health.ts` — Rolling-window health analysis + alert generation
- `src/pipeline/fill-rates.ts` — Per-field fill rate computation for RawEvents
- `src/pipeline/structure-hash.ts` — HTML structural fingerprinting (SHA-256)
- `src/app/admin/alerts/actions.ts` — Alert repair actions (re-scrape, create alias/kennel, link kennel to source, file GitHub issue)
- `src/app/admin/events/actions.ts` — Admin event management (delete, bulk delete with cascade)
- `src/app/admin/misman-requests/page.tsx` — Admin misman request approval (reuses misman server actions)
- `src/components/admin/AlertCard.tsx` — Alert card with repair actions, context display, repair history
- `src/app/misman/actions.ts` — Misman request/approve/reject server actions (used by both /misman and /admin)
- `src/app/misman/[slug]/roster/actions.ts` — Roster CRUD + search (roster group scope)
- `src/app/misman/[slug]/attendance/actions.ts` — Attendance recording, polling, quick-add
- `src/app/misman/[slug]/history/actions.ts` — Attendance history, hasher detail, roster seeding from hares
- `src/components/misman/KennelSwitcher.tsx` — Kennel dropdown switcher for misman layout (preserves active tab)
- `src/components/ui/alert-dialog.tsx` — Radix AlertDialog wrapper (confirmation dialogs)
- `src/lib/fuzzy.ts` — Levenshtein-based fuzzy string matching for kennel tag resolution
- `vercel.json` — Vercel Cron config (daily scrape at 6:00 AM UTC)
- `vitest.config.ts` — Test runner config (globals, path aliases)
- `src/test/factories.ts` — Shared test data builders

## Documentation
- `docs/source-onboarding-playbook.md` — Step-by-step guide for adding new data sources
- `docs/roadmap.md` — Implementation roadmap for source scaling, historical import, monitoring
- `docs/misman-attendance-requirements.md` — Kennel attendance management (misman tool) requirements
- `docs/misman-implementation-plan.md` — Sprint plan for misman feature (8a-8f)

## Active Sources (7)
- **hashnyc.com** → HTML_SCRAPER → 11 NYC-area kennels
- **Boston Hash Calendar** → GOOGLE_CALENDAR → 5 Boston kennels
- **Summit H3 Spreadsheet** → GOOGLE_SHEETS → 3 NJ kennels (Summit, SFM, ASSSH3)
- **BFM Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3 (config-driven kennelPatterns)
- **Philly H3 Google Calendar** → GOOGLE_CALENDAR → BFM, Philly H3 (config-driven kennelPatterns)
- **BFM Website** → HTML_SCRAPER → BFM
- **Philly H3 Website** → HTML_SCRAPER → Philly H3

See `docs/source-onboarding-playbook.md` for how to add new sources.
See `docs/roadmap.md` for implementation roadmap.

## Testing
- **Framework:** Vitest with `globals: true` (no explicit imports needed)
- **Config:** `vitest.config.ts` — path alias `@/` maps to `./src`
- **Run:** `npm test` (416 tests across 24 files)
- **Factories:** `src/test/factories.ts` — shared builders (`buildRawEvent`, `buildCalendarEvent`, `mockUser`)
- **Mocking pattern:** `vi.mock("@/lib/db")` + `vi.mocked(prisma.model.method)` with `as never` for partial returns
- **Exported helpers:** Pure functions in adapters/pipeline are exported for direct unit testing (additive-only, no behavior change)
- **Convention:** Test files live next to source files as `*.test.ts`
- **Coverage areas:**
  - Adapters: hashnyc HTML parsing, Google Calendar extraction, Google Sheets CSV parsing
  - Pipeline: merge dedup + trust levels + source-kennel guard, kennel resolution (4-stage), fingerprinting, scrape orchestration, health analysis + alert generation
  - Server actions: logbook CRUD, profile, kennel subscriptions, admin CRUD
  - Utilities: format helpers, calendar URL/ICS generation, auth (Clerk→DB sync)

## What NOT To Do
- Don't use Playwright for scraping (Cheerio is sufficient, 100x lighter)
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ yet — cron is sufficient for <50 sources