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
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  const allowSelfSigned = process.env.BACKFILL_ALLOW_SELF_SIGNED_CERT === "1";
  
  // Default to strict TLS. If the connection string explicitly disables SSL
  // (e.g. for local dev), we respect that. Otherwise, we enforce TLS with
  // configurable certificate validation.
  const ssl = url.includes("sslmode=disable")
    ? false
    : { rejectUnauthorized: !allowSelfSigned };

  return new pg.Pool({
    connectionString: url,
    ssl,
  });
}
