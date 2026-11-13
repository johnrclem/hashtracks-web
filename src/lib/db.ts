import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
// Subpath import: the package root also loads cache, purge and websocket helpers.
import { attachDatabasePool } from "@vercel/functions/db-connections";
import { Pool } from "pg";

const isProduction = process.env.NODE_ENV === "production";

/** pg's default. Set explicitly: attachDatabasePool reads it to know how long to wait. */
const IDLE_TIMEOUT_MS = 10_000;

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Vercel serverless: keep pool small to avoid exhausting Railway's connection limit across many concurrent function instances
    max: isProduction ? 2 : 10,
    idleTimeoutMillis: IDLE_TIMEOUT_MS,
    // Fail fast when Postgres refuses or stalls, instead of hanging until the function times out.
    connectionTimeoutMillis: 10_000,
    ssl: isProduction ? { rejectUnauthorized: false } : undefined,
  });
  // An idle client whose connection drops (Railway proxy, server restart) emits
  // "error" on the pool; with no listener Node treats it as uncaught.
  pool.on("error", (err) => {
    console.error("[db] idle Postgres client error:", err.message);
  });
  // Fluid Compute suspends idle instances. Without this, a suspended instance keeps
  // its idle connections open, and they pile up across deploys until Postgres
  // refuses new clients ("sorry, too many clients already", Sentry 2026-11-09).
  // Keeps the instance alive until idle clients close. No-op outside Vercel.
  attachDatabasePool(pool);
  return new PrismaClient({ adapter: new PrismaPg(pool) });
}

// Cache in every environment, not just dev: Next.js can evaluate this module more
// than once per server process, and each evaluation would open its own pool.
export const prisma = globalForPrisma.prisma ?? createPrismaClient();
globalForPrisma.prisma = prisma;
