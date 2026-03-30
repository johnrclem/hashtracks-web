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
- **Schema sync:** `npx prisma db push` runs automatically during Vercel builds, but **`npx prisma db seed` must be run manually** when new seed data is added (regions, kennels, sources, aliases)
- **Direct access:** The Railway DB is reachable from the dev environment (no VPN/SSH needed) -- just ensure Node 20 is active
