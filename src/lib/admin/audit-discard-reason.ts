/**
 * Validation for the reason recorded when a queued audit finding is discarded.
 * Kept free of server imports so the `/admin/audit` client form can share the
 * length limit with the server action and the agent API.
 */

/** Longest discard reason stored, in characters. */
export const DISCARD_REASON_MAX = 500;

/** The trimmed reason, or null when it's missing, blank or too long. */
export function normalizeDiscardReason(reason: unknown): string | null {
  if (typeof reason !== "string") return null;
  const trimmed = reason.trim();
  if (trimmed.length === 0 || trimmed.length > DISCARD_REASON_MAX) return null;
  return trimmed;
}
