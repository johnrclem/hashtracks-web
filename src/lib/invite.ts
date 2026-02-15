/**
 * Invite token utilities for misman invite links.
 * Pure functions — no DB or auth dependencies.
 */

import { randomBytes } from "crypto";

const INVITE_TOKEN_BYTES = 32; // 256 bits of randomness
const DEFAULT_EXPIRY_DAYS = 7;

/** Generate a cryptographically secure, URL-safe invite token. */
export function generateInviteToken(): string {
  return randomBytes(INVITE_TOKEN_BYTES).toString("base64url");
}

/** Compute an expiration date from now. */
export function computeExpiresAt(days: number = DEFAULT_EXPIRY_DAYS): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

/** Cookie name for persisting invite token across auth redirect. */
export const INVITE_COOKIE_NAME = "__ht_invite_token";

/** Maximum pending (unexpired, unredeemed) invites per kennel. */
export const MAX_PENDING_PER_KENNEL = 20;
