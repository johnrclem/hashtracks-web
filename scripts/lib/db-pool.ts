import pg from "pg";

/**
 * Create a PG pool for one-shot scripts with safe TLS defaults.
 *
 * Strict validation by default. Set BACKFILL_ALLOW_SELF_SIGNED_CERT=1 for
 * local Railway proxy dev — the public proxy uses a self-signed cert that
 * Node can't validate out of the box. The insecure mode is a deliberate
 * env-var toggle so it can never be silently active in production.
 */
export function createScriptPool(): pg.Pool {
  const allowSelfSigned = process.env.BACKFILL_ALLOW_SELF_SIGNED_CERT === "1";
  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: !allowSelfSigned },
  });
}
