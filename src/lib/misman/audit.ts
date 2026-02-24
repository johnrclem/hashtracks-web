/**
 * Audit log utilities for KennelAttendance edit tracking.
 * Pure functions — no DB or auth dependencies.
 *
 * Follows the appendRepairLog pattern from src/app/admin/alerts/actions.ts.
 */

import type { Prisma } from "@/generated/prisma/client";

/** Actions that can be recorded in a KennelAttendance audit log. */
export type AuditAction =
  | "record"
  | "update"
  | "remove"
  | "clear"
  | "import"
  | "hare_sync";

/** A single entry in the KennelAttendance audit log (stored as JSON array). */
export interface AuditLogEntry {
  action: AuditAction;
  /** ISO 8601 timestamp of the action. */
  timestamp: string;
  /** Clerk user ID of the person who performed the action. */
  userId: string;
  /** Field-level before/after diffs (present for "update" actions). */
  changes?: Record<string, { old: unknown; new: unknown }>;
  /** Additional context (e.g. import batch size, sync source). */
  details?: Record<string, unknown>;
}

/** Append a new entry to an existing JSON audit log array (or start a new one). */
export function appendAuditLog(
  existing: Prisma.JsonValue | null,
  entry: AuditLogEntry,
): Prisma.InputJsonValue {
  const log = Array.isArray(existing) ? existing : [];
  return [...log, entry] as Prisma.InputJsonValue;
}

/**
 * Compare before/after snapshots for a set of tracked fields.
 * Returns a changes object if any field differs, or undefined if nothing changed.
 */
export function buildFieldChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  trackedFields: string[],
): Record<string, { old: unknown; new: unknown }> | undefined {
  const changes: Record<string, { old: unknown; new: unknown }> = {};
  for (const field of trackedFields) {
    if (before[field] !== after[field]) {
      changes[field] = { old: before[field], new: after[field] };
    }
  }
  return Object.keys(changes).length > 0 ? changes : undefined;
}

/** Fields tracked for audit logging on KennelAttendance updates. */
export const TRACKED_ATTENDANCE_FIELDS = [
  "paid",
  "haredThisTrail",
  "isVirgin",
  "isVisitor",
  "visitorLocation",
  "referralSource",
  "referralOther",
] as const;
