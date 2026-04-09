/**
 * Strava OAuth token encryption (at rest).
 *
 * Encrypts accessToken/refreshToken columns using AES-256-GCM with a key
 * derived from the STRAVA_TOKEN_KEY environment variable (32 bytes, hex).
 *
 * Ciphertext format: `enc:v1:<base64url(iv || authTag || ciphertext)>`.
 *
 * Backwards compatibility: `decryptToken()` transparently passes through
 * values that don't carry the `enc:v1:` prefix, so existing plaintext rows
 * continue to work during the rollover window. A one-off re-encryption
 * script (or a lazy re-encrypt on refresh) can migrate them over time.
 *
 * Production vs development: in `NODE_ENV=production` the module fails
 * closed if `STRAVA_TOKEN_KEY` is missing — `encryptToken()` throws instead
 * of silently storing plaintext. In local dev / CI the key can be unset
 * and encryption degrades to a no-op so tests and `npm run dev` keep
 * working without the secret.
 */
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // GCM standard
const AUTH_TAG_LENGTH = 16;
const PREFIX = "enc:v1:";

function loadKey(): Buffer | null {
  const keyHex = process.env.STRAVA_TOKEN_KEY;
  if (!keyHex) return null;
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error(
      "STRAVA_TOKEN_KEY must be exactly 64 hex characters (32 bytes)",
    );
  }
  return Buffer.from(keyHex, "hex");
}

/**
 * Encrypt a Strava OAuth token for storage. Throws in production if
 * `STRAVA_TOKEN_KEY` is not configured; no-ops to plaintext in dev/CI.
 */
export function encryptToken(plaintext: string): string {
  const key = loadKey();
  if (!key) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        "STRAVA_TOKEN_KEY is required in production for at-rest token encryption",
      );
    }
    return plaintext;
  }

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const authTag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, authTag, ciphertext]);
  return PREFIX + payload.toString("base64url");
}

/**
 * Decrypt a stored Strava OAuth token.
 * Passes plaintext through if the value doesn't carry the enc:v1: prefix
 * (legacy rows during rollover, or when STRAVA_TOKEN_KEY is not set).
 */
export function decryptToken(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    return stored;
  }
  const key = loadKey();
  if (!key) {
    throw new Error(
      "Stored token is encrypted but STRAVA_TOKEN_KEY is not configured",
    );
  }
  const payload = Buffer.from(stored.slice(PREFIX.length), "base64url");
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + AUTH_TAG_LENGTH);
  const ciphertext = payload.subarray(IV_LENGTH + AUTH_TAG_LENGTH);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}
