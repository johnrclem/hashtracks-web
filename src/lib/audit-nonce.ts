/**
 * Single-use, payload-bound nonces for the chrome-stream audit-issue
 * filing endpoints. Pure helpers — no DB, no Clerk, no fetch.
 *
 * Lifecycle:
 *   1. Admin opens /admin/audit and copies a chrome prompt. The
 *      prompt embeds instructions to call `/api/audit/mint-filing-nonce`
 *      with `(kennelCode, ruleSlug, payloadHash)`.
 *   2. Mint endpoint validates the admin session, generates a nonce,
 *      and persists `(nonceHash, adminUserId, kennelCode, ruleSlug,
 *      payloadHash, expiresAt)` in `AuditFilingNonce`.
 *   3. Agent assembles the issue payload and calls
 *      `/api/audit/file-finding` with the nonce + the same payload.
 *   4. File-finding endpoint atomically consumes the nonce (single
 *      use), recomputes payloadHash from the request body, and only
 *      proceeds if both match the stored row.
 *
 * The persisted row is the binding — we don't need HMAC because the
 * DB enforces single-use + payload-match atomically. Hash-not-raw:
 * only `sha256(nonce)` is persisted; the raw nonce never lives at
 * rest, so a DB leak doesn't expose live filing capability.
 */

import { createHash, randomBytes } from "node:crypto";

import { getCanonicalSiteUrl } from "@/lib/site-url";

/** Bytes of randomness — 32 bytes = 256 bits, more than enough for
 *  short-lived single-use tokens. */
const NONCE_BYTES = 32;

/** Default TTL on a freshly-minted nonce. Short enough that a stolen
 *  nonce window is small; long enough that a chrome agent can mint
 *  → assemble payload → consume without round-trip flakiness. */
export const NONCE_TTL_MS = 5 * 60 * 1000;

/** URL-safe base64 string suitable for inclusion in headers. */
export function generateNonce(): string {
  return randomBytes(NONCE_BYTES).toString("base64url");
}

/** SHA-256 hex of the raw nonce — what gets persisted. */
export function hashNonce(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Canonical payload shape that gets bound to a nonce. Order is fixed
 * for deterministic hashing across mint and consume — both sides must
 * sort `eventIds` identically before joining.
 */
export interface FilingPayload {
  stream: string;
  kennelCode: string;
  ruleSlug: string;
  /** GitHub issue title. Hash-bound so a caller holding a valid
   *  nonce can't substitute a different title post-mint. */
  title: string;
  /** Affected event IDs. Order doesn't matter — we sort before
   *  hashing. Empty array is allowed for prompt-only findings. */
  eventIds: readonly string[];
  /** Markdown body of the issue. Mint endpoint receives the hash
   *  (not the body); file-finding endpoint posts the body and we
   *  rehash to verify. */
  bodyMarkdown: string;
}

/**
 * Compute the canonical hash of a filing payload — used both at
 * mint time (agent → server: "I will file this exact payload") and
 * consume time (server: "the body I just received hashes to the
 * value the mint endpoint stored").
 *
 * Serialization uses `JSON.stringify` over a fixed-key array, which
 * gives us injective encoding: every distinct payload produces a
 * distinct canonical string. Earlier `\n`-delimited joins were
 * vulnerable to field-substitution attacks where a caller absorbed
 * the delimiter into one field to forge a different (kennelCode,
 * ruleSlug, …) tuple — Codex pass-2 finding. JSON's quoting +
 * escaping forecloses that.
 */
export function computePayloadHash(payload: FilingPayload): string {
  const sortedEventIds = [...payload.eventIds].sort((a, b) => a.localeCompare(b));
  const canonical = JSON.stringify([
    payload.stream,
    payload.kennelCode,
    payload.ruleSlug,
    payload.title,
    sortedEventIds,
    payload.bodyMarkdown,
  ]);
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Validate that the request originated from the configured app
 * origin. Defends against CSRF attacks where a malicious page in the
 * admin's browser tries to mint or consume nonces by riding the
 * Clerk session cookie.
 *
 * Pure function — pass `req.headers.get("origin")` from the route.
 * Returns false on missing/mismatched/malformed Origin.
 */
export function isValidOrigin(originHeader: string | null): boolean {
  if (!originHeader) return false;
  try {
    return new URL(originHeader).origin === getCanonicalSiteUrl();
  } catch {
    return false;
  }
}

/** Compute an expiration timestamp from now. */
export function computeNonceExpiresAt(ttlMs: number = NONCE_TTL_MS): Date {
  return new Date(Date.now() + ttlMs);
}
