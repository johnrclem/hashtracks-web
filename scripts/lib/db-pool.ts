import pg from "pg";

// URL.hostname keeps IPv6 brackets.
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * TLS settings for a one-shot script's database connection.
 *
 * Strict validation by default. Set BACKFILL_ALLOW_SELF_SIGNED_CERT=1 for
 * local Railway proxy dev — the public proxy uses a self-signed cert that
 * Node can't validate out of the box. The insecure mode is a deliberate
 * env-var toggle so it can never be silently active in production.
 * A local database (localhost, or `sslmode=disable` in the URL) gets no TLS.
 */
export function scriptSslConfig(url: string): pg.ClientConfig["ssl"] {
  // A key=value connection string isn't a URL: it falls through to TLS.
  const host = URL.canParse(url) ? new URL(url).hostname.toLowerCase() : "";
  if (url.includes("sslmode=disable") || LOCAL_HOSTS.has(host)) return false;
  return { rejectUnauthorized: process.env.BACKFILL_ALLOW_SELF_SIGNED_CERT !== "1" };
}

/** Create a PG pool for one-shot scripts with safe TLS defaults (see scriptSslConfig). */
export function createScriptPool(): pg.Pool {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error("DATABASE_URL environment variable is required");
  }
  return new pg.Pool({ connectionString: url, ssl: scriptSslConfig(url) });
}
