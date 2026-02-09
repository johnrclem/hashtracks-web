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

## Architecture
- **Framework:** Next.js 16 App Router, TypeScript strict mode
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
- DATABASE_URL=           # Railway PostgreSQL connection string
- CLERK_SECRET_KEY=       # Clerk backend key
- NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=  # Clerk frontend key
- NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
- NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
- GEMINI_API_KEY=         # Google AI API key (Sprint 10+)
- CRON_SECRET=            # Secret for Vercel Cron auth (Sprint 6+)
- GOOGLE_CALENDAR_API_KEY= # For public calendar reads (Sprint 6+)

## Important Files
- `prisma/schema.prisma` — Full data model (THE source of truth for types)
- `prisma/seed.ts` — Launch kennel + alias data
- `prisma.config.ts` — Prisma 7 config (datasource URL, seed command)
- `src/lib/db.ts` — PrismaClient singleton (PrismaPg adapter + SSL)
- `src/lib/auth.ts` — `getOrCreateUser()` + `getAdminUser()` (Clerk→DB sync + admin role check)
- `src/middleware.ts` — Clerk route protection (public vs authenticated routes)
- `src/adapters/types.ts` — SourceAdapter interface + RawEventData types
- `src/adapters/registry.ts` — Adapter factory (SourceType → adapter instance)
- `src/adapters/html-scraper/hashnyc.ts` — hashnyc.com HTML scraper (Cheerio)
- `src/pipeline/merge.ts` — Raw→Canonical merge pipeline (fingerprint dedup)
- `src/pipeline/kennel-resolver.ts` — Alias-based kennel name resolution

## What NOT To Do
- Don't use Playwright for scraping (Cheerio is sufficient, 100x lighter)
- Don't parse dates through `new Date()` without UTC normalization
- Don't store secrets in code — use environment variables
- Don't modify RawEvent records after creation (they're immutable audit trail)
- Don't build custom auth — Clerk handles everything
- Don't add Redis/BullMQ yet — cron is sufficient for <50 sources