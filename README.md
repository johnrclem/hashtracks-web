# HashTracks

The Strava of Hashing — a community platform where hashers discover upcoming runs, track attendance, and view personal stats.

**Live:** [hashtracks-web.vercel.app](https://hashtracks-web.vercel.app)

## Tech Stack

- **Framework:** Next.js 16 (App Router), React 19, TypeScript strict
- **Database:** PostgreSQL (Railway) via Prisma 7
- **Auth:** Clerk (Google OAuth + email/password)
- **UI:** Tailwind CSS v4 + shadcn/ui
- **Deployment:** Vercel (auto-deploy from `main`)

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
| `npx prisma studio` | Visual database browser |
| `npx prisma db push` | Push schema changes to DB |
| `npx prisma db seed` | Seed kennels, aliases, and sources |

## Project Status

**Sprints 1-4 complete.** See [HASHTRACKS_IMPLEMENTATION_PLAN.md](HASHTRACKS_IMPLEMENTATION_PLAN.md) for the full roadmap.

### Completed
- **Sprint 1:** Scaffold — Prisma 7, Clerk auth, seeded DB, Vercel deployment
- **Sprint 2:** Kennel directory — browse, search, subscribe, profiles, admin tools
- **Sprint 3:** Source engine — adapter framework, hashnyc.com HTML scraper, merge pipeline, admin scrape tools
- **Sprint 4:** Hareline — event list & calendar views, filters (time/region/kennel/day), event detail pages
- **Post-sprint polish:** Kennel full-name tooltips, AM/PM time format, filter URL persistence, kennel events page, NYC timezone display, Google Calendar adapter (Boston Hash)
