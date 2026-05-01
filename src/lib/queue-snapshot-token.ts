/**
 * Queue-snapshot token for the deep-dive completion flow.
 *
 * Issue #1160: when an admin opens the "Mark deep dive complete"
 * dialog, the dropdown captures the kennel they're targeting at
 * dialog-open time. But the parent component re-derives the target
 * from `selectedCode` at submit time, and a queue change between
 * those two moments can cause the wrong kennel to receive the
 * deep-dive credit (~75% of the time per the issue report —
 * Galveston got marked complete for a click on GGFM).
 *
 * Defense:
 *
 *   1. **Snapshot ID** — `computeQueueSnapshotId(kennelCodes)`
 *      hashes the sorted kennelCode list. Stable across cosmetic
 *      reorders; changes when the queue's membership changes
 *      (insertion or removal).
 *   2. **Signed token** — `signQueueToken(payload)` produces an
 *      HMAC-SHA256 signature over `(kennelCode, queueSnapshotId,
 *      expiresAt)`. Server stamps a token at dialog-open; client
 *      sends it back at submit; server `verifyQueueToken` rejects
 *      tampering, expiry, and snapshot-mismatch.
 *
 * Pure helpers — no DB, no Clerk. Caller owns env validation
 * (the HMAC key lives in `AUDIT_QUEUE_TOKEN_SECRET`).
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/** TTL for a deep-dive queue token. Long enough that the admin can
 *  open the dialog and write a summary without rushing; short enough
 *  that a leaked token doesn't grant indefinite write authority. */
export const QUEUE_TOKEN_TTL_MS = 10 * 60 * 1000;

export interface QueueTokenPayload {
  kennelCode: string;
  /** SHA-256 of the sorted kennelCode list at dialog-open time. */
  queueSnapshotId: string;
  /** Unix epoch milliseconds. */
  expiresAt: number;
}

/**
 * Compute a stable snapshot ID for the deep-dive queue. Sorting
 * kennelCodes before hashing means two callers with the same
 * underlying queue (regardless of presentation order) produce the
 * same ID — only insertions and removals shift the hash, which is
 * exactly the change we care about for the dialog-bind contract.
 */
export function computeQueueSnapshotId(
  kennelCodes: readonly string[],
): string {
  const sorted = [...kennelCodes].sort((a, b) => a.localeCompare(b));
  return createHash("sha256").update(sorted.join("\n")).digest("hex");
}

function getSecret(): Buffer {
  const secret = process.env.AUDIT_QUEUE_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "AUDIT_QUEUE_TOKEN_SECRET env var is not set — required for deep-dive queue token signing",
    );
  }
  return Buffer.from(secret, "utf8");
}

/**
 * Sign a queue token. Output format is `<base64url-payload>.<hex-mac>`
 * where the payload is JSON-encoded. Both halves are needed by the
 * verifier — the payload to compare against current state, the MAC
 * to prove authenticity.
 */
export function signQueueToken(payload: QueueTokenPayload): string {
  const json = JSON.stringify(payload);
  const payloadB64 = Buffer.from(json, "utf8").toString("base64url");
  const mac = createHmac("sha256", getSecret()).update(payloadB64).digest("hex");
  return `${payloadB64}.${mac}`;
}

/** Reasons a token verification can fail. The dialog uses these to
 *  decide whether to refetch + retry (queue-changed) or surface a
 *  hard error (invalid / expired). */
export type QueueTokenError =
  | "malformed"
  | "invalid-signature"
  | "expired"
  | "malformed-payload";

export type QueueTokenVerification =
  | { ok: true; payload: QueueTokenPayload }
  | { ok: false; reason: QueueTokenError };

/**
 * Verify a queue token. Constant-time comparison on the MAC; explicit
 * shape + expiry checks on the payload. Returns a tagged result so
 * callers can branch on the failure mode.
 */
const HEX_RE = /^[0-9a-f]+$/;

export function verifyQueueToken(rawToken: string): QueueTokenVerification {
  const dot = rawToken.indexOf(".");
  if (dot === -1) return { ok: false, reason: "malformed" };

  const payloadB64 = rawToken.slice(0, dot);
  const macHex = rawToken.slice(dot + 1);
  if (!payloadB64 || !macHex) return { ok: false, reason: "malformed" };
  // `Buffer.from("not-hex", "hex")` silently truncates, which means
  // a same-length non-hex MAC would slip past the length check below
  // and crash `timingSafeEqual` (Codex bundle 6 finding). Validate
  // the hex shape upfront and treat anything else as a tampered MAC.
  if (!HEX_RE.test(macHex)) return { ok: false, reason: "invalid-signature" };

  // Recompute the MAC and compare in constant time.
  const expectedMac = createHmac("sha256", getSecret())
    .update(payloadB64)
    .digest("hex");
  if (
    expectedMac.length !== macHex.length ||
    !timingSafeEqual(Buffer.from(expectedMac, "hex"), Buffer.from(macHex, "hex"))
  ) {
    return { ok: false, reason: "invalid-signature" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
  } catch {
    return { ok: false, reason: "malformed-payload" };
  }
  if (!isQueueTokenPayload(parsed)) {
    return { ok: false, reason: "malformed-payload" };
  }
  if (parsed.expiresAt <= Date.now()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload: parsed };
}

function isQueueTokenPayload(value: unknown): value is QueueTokenPayload {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.kennelCode === "string" &&
    typeof v.queueSnapshotId === "string" &&
    typeof v.expiresAt === "number"
  );
}

/** Compute the expiration timestamp for a freshly-minted token. */
export function computeQueueTokenExpiresAt(
  ttlMs: number = QUEUE_TOKEN_TTL_MS,
): number {
  return Date.now() + ttlMs;
}
