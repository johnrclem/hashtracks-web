/**
 * Client-safe metadata for the AuditStream enum.
 *
 * `AuditStreamPanel` is a `"use client"` component, so it cannot import from
 * `@/generated/prisma/client` (pulls in Node-only Prisma engine bindings) or
 * from `actions.ts` (`"use server"` file with a `prisma` import). This module
 * provides the same string union + display order without any server-only
 * dependencies. Server code (`actions.ts`, the sync library) keeps using the
 * Prisma-generated enum at runtime; the values are identical strings so the
 * two stay interoperable.
 */

export const AUDIT_STREAM = {
  AUTOMATED: "AUTOMATED",
  CHROME_EVENT: "CHROME_EVENT",
  CHROME_KENNEL: "CHROME_KENNEL",
  UNKNOWN: "UNKNOWN",
} as const;

export type AuditStream = (typeof AUDIT_STREAM)[keyof typeof AUDIT_STREAM];

/** Display order for the dashboard panel — most-meaningful streams first. */
export const DASHBOARD_STREAMS: readonly AuditStream[] = [
  AUDIT_STREAM.AUTOMATED,
  AUDIT_STREAM.CHROME_EVENT,
  AUDIT_STREAM.CHROME_KENNEL,
  AUDIT_STREAM.UNKNOWN,
];

/** The three "real" forward streams — UNKNOWN is hidden by default. */
export const PRIMARY_STREAMS: readonly AuditStream[] = [
  AUDIT_STREAM.AUTOMATED,
  AUDIT_STREAM.CHROME_EVENT,
  AUDIT_STREAM.CHROME_KENNEL,
];
