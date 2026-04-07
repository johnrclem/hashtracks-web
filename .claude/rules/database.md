---
description: Railway PostgreSQL database connection, Prisma workflow, and schema sync procedures
globs:
  - prisma/**
  - .env*
  - prisma.config.ts
---

# Database (Railway)

- **Host:** `trolley.proxy.rlwy.net:18763` (public TCP proxy -> PostgreSQL)
- **Connection:** `DATABASE_URL` in `.env` and `.env.local` (both must stay in sync)
- **Prisma config:** `prisma.config.ts` loads `DATABASE_URL` via `dotenv/config` (reads `.env`)
- **Node version:** Prisma 7 requires Node 20+ -- run `eval "$(fnm env)" && fnm use 20` before any `npx prisma` command
- **Schema sync:** Vercel builds run `npx prisma migrate deploy` to apply committed migrations under `prisma/migrations/`. Author new migrations locally with `npx prisma migrate dev --name <change>`. **`npx prisma db push` is strictly local dev only — never run it against the prod `DATABASE_URL`.** `npx prisma db seed` must still be run manually when new seed data is added (regions, kennels, sources, aliases).
- **Direct access:** The Railway DB is reachable from the dev environment (no VPN/SSH needed) -- just ensure Node 20 is active
