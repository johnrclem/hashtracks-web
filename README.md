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

Sprint 1 complete — scaffold, database schema, Clerk auth, seeded data, deployment. See [HASHTRACKS_IMPLEMENTATION_PLAN.md](HASHTRACKS_IMPLEMENTATION_PLAN.md) for the full roadmap.
