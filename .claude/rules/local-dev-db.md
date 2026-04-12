---
description: Local Postgres development database — how to set up a copy of Railway prod, refresh it, and point a worktree at it
globs:
  - prisma/**
  - .env*
  - prisma.config.ts
  - scripts/local-db-*
---

# Local Development Database

This repo supports (and encourages) running a **local Postgres instance** that mirrors the Railway production database. The local copy is used for running `prisma migrate dev` safely, testing migrations end-to-end, and reproducing bugs against real data without touching prod.

**Important context — why this exists:**
- Railway runs Postgres 17 via a public TCP proxy (`trolley.proxy.rlwy.net:18763`).
- The `scripts/safe-prisma.mjs` wrapper refuses `migrate dev` / `migrate reset` / `db push` against any non-local host, so running these commands requires a local DB.
- Without a local DB you cannot use Prisma's authoring workflow, only hand-write migration SQL. That is brittle and the safety wrapper is specifically designed to push you to the local-DB workflow.

## Prerequisites

- macOS with Homebrew
- **Postgres 17** (must match Railway's major version — `pg_dump` refuses cross-version dumps)
- Node 20 via `fnm`

## First-time setup

```bash
# 1. Install Postgres 17 (not 16 — Railway runs 17)
brew install postgresql@17
brew services start postgresql@17

# 2. Add to PATH for the shell (optional — use absolute path if you prefer not to modify shell rc)
echo 'export PATH="/opt/homebrew/opt/postgresql@17/bin:$PATH"' >> ~/.zshrc
exec zsh

# 3. Create the local database (no password, trust auth on localhost)
createdb hashtracks_dev

# 4. Dump Railway → restore local
cd /Users/johnclem/Developer/hashtracks-web   # or any worktree
RAILWAY_URL=$(grep '^DATABASE_URL' .env | sed 's/^DATABASE_URL=//' | tr -d '"')
mkdir -p /tmp/hashtracks-dump
pg_dump --format=custom --no-owner --no-privileges "$RAILWAY_URL" -f /tmp/hashtracks-dump/railway-$(date +%Y%m%d).dump
pg_restore --no-owner --no-privileges --dbname=hashtracks_dev /tmp/hashtracks-dump/railway-$(date +%Y%m%d).dump

# 5. Verify
psql -h localhost -d hashtracks_dev -c 'SELECT COUNT(*) FROM "Kennel";'
```

The full Railway dump is ~18 MB compressed and restores in under 2 seconds locally.

## Point a worktree at the local DB

In the worktree root (not the main repo), create a `.env` file with the local `DATABASE_URL`:

```bash
# From main repo .env, swap only DATABASE_URL. Everything else
# (Clerk keys, API keys, etc.) can be copied verbatim — the app still needs them.
cp /Users/johnclem/Developer/hashtracks-web/.env /path/to/worktree/.env
# Edit DATABASE_URL line to:
DATABASE_URL="postgresql://<you>@localhost:5432/hashtracks_dev"
```

The worktree's `.env` is gitignored via the repo-wide `.gitignore` (`.env*.local` and `.env` are both ignored).

**Verify the wrapper accepts it:**

```bash
eval "$(fnm env)" && fnm use 20
npm run prisma -- migrate status
# Should show "Database schema is up to date!" and reference localhost
```

## Common workflows

### Author a new migration locally

```bash
# Edit prisma/schema.prisma, then:
eval "$(fnm env)" && fnm use 20
npm run prisma -- migrate dev --name <descriptive_name>
# Wrapper verifies localhost, then prisma generates the migration file
# and applies it to the local DB. Review SQL, commit with schema change.
```

### Refresh local DB from Railway

The local copy drifts as Railway accumulates new events/scrapes. Refresh with a fresh dump:

```bash
eval "$(fnm env)" && fnm use 20
RAILWAY_URL=$(grep '^DATABASE_URL' /Users/johnclem/Developer/hashtracks-web/.env | sed 's/^DATABASE_URL=//' | tr -d '"')
dropdb hashtracks_dev && createdb hashtracks_dev
pg_dump --format=custom --no-owner --no-privileges "$RAILWAY_URL" -f /tmp/hashtracks-dump/railway-$(date +%Y%m%d).dump
pg_restore --no-owner --no-privileges --dbname=hashtracks_dev /tmp/hashtracks-dump/railway-$(date +%Y%m%d).dump
# If the local schema was ahead of prod, reapply your local migrations:
npm run prisma -- migrate deploy
```

### Reset local DB (no Railway copy — pure schema)

```bash
eval "$(fnm env)" && fnm use 20
dropdb hashtracks_dev && createdb hashtracks_dev
npm run prisma -- migrate deploy
npx prisma db seed   # optional — seeds 390+ kennels, 265 sources, 225 regions
```

## Safety guarantees

- `scripts/safe-prisma.mjs` blocks `migrate dev`/`migrate reset`/`db push` against any host not on the local-safe allowlist (`localhost`, `127.0.0.1`, `::1`, `0.0.0.0`, `host.docker.internal`, `postgres`, `db`)
- The wrapper **cannot** be bypassed by `npm run prisma` — any call goes through `scripts/safe-prisma.mjs`
- Running `npx prisma migrate dev` directly bypasses the wrapper and is **forbidden** — this is how PR #480 wiped `AuditLog` twice. Always use `npm run prisma -- migrate dev`.

## Version pinning

Railway currently runs **Postgres 17.x**. If Railway upgrades the major version, the local install must be upgraded in lockstep or `pg_dump` will refuse to run. Check Railway's version with:

```bash
RAILWAY_URL=$(grep '^DATABASE_URL' .env | sed 's/^DATABASE_URL=//' | tr -d '"')
psql "$RAILWAY_URL" -c 'SELECT version();'
```
