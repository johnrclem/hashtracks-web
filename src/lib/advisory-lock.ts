/**
 * Run a job under a Postgres transaction-level advisory lock, on a dedicated
 * short-lived connection outside the Prisma pool (`src/lib/db.ts` keeps only 2
 * connections in production, and holding one idle for a whole job would starve it).
 *
 * Why a transaction lock with an idle timeout, not a session lock: the lock
 * connection sits idle in its transaction while the job runs. If the function is
 * killed at `maxDuration`, or Fluid Compute suspends the instance, nothing ever
 * sends COMMIT. `idle_in_transaction_session_timeout` makes Postgres end that
 * session on its own, which releases the lock. A session-level lock on a
 * suspended connection could stay held indefinitely.
 */
import { Client } from "pg";
import { pgConnectionOptions } from "@/lib/db";

export type AdvisoryLockResult<T> = { acquired: true; result: T } | { acquired: false };

export async function withAdvisoryXactLock<T>(
  key: number,
  idleTimeoutMs: number,
  job: () => Promise<T>,
): Promise<AdvisoryLockResult<T>> {
  // SET takes no bind parameters, so the value is interpolated: refuse anything
  // that isn't a plain positive integer.
  if (!Number.isSafeInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error(`Invalid idle timeout: ${idleTimeoutMs}`);
  }
  const client = new Client(pgConnectionOptions());
  // A dropped connection emits "error"; without a listener Node treats it as uncaught.
  client.on("error", (err) => {
    console.error("[advisory-lock] connection error:", err.message);
  });

  let inTransaction = false;
  try {
    await client.connect();
    await client.query(`SET idle_in_transaction_session_timeout = ${idleTimeoutMs}`);
    await client.query("BEGIN");
    inTransaction = true;
    const { rows } = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_xact_lock($1) AS locked",
      [key],
    );
    if (!rows[0]?.locked) return { acquired: false };

    const result = await job();
    // COMMIT releases the lock. If Postgres already ended the session, the lock
    // is gone anyway, and the job's work is done; don't turn that into a failure.
    try {
      await client.query("COMMIT");
      inTransaction = false;
    } catch (err) {
      console.error("[advisory-lock] COMMIT failed (lock already released):", err);
    }
    return { acquired: true, result };
  } finally {
    if (inTransaction) {
      await client.query("ROLLBACK").catch(() => undefined);
    }
    await client.end().catch(() => undefined);
  }
}
