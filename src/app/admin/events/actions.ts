"use server";

import { prisma } from "@/lib/db";
import { getAdminUser } from "@/lib/auth";
import type { ActionResult } from "@/lib/actions";
import { revalidatePath, revalidateTag } from "next/cache";
import { HARELINE_EVENTS_TAG } from "@/lib/cache-tags";
import { appendAuditLog, type AuditLogEntry } from "@/lib/misman/audit";
import {
  CANCELLATION_REASON_MIN,
  CANCELLATION_REASON_MAX,
} from "./constants";

const DELETE_BATCH_SIZE = 100;

/** Shared kennel-projection used by both adminCancelEvent and uncancelEvent
 *  to fetch the slug for revalidation and the shortName for toast messages. */
const KENNEL_SELECT_FOR_OVERRIDE = { shortName: true, slug: true } as const;

/** Revalidate every cache surface affected by a cancel/uncancel toggle:
 *  - /admin/events: this page
 *  - /hareline + HARELINE_EVENTS_TAG: list pages
 *  - /hareline/[eventId]: event detail page
 *  - /kennels/[slug]: public kennel page (filters CANCELLED events directly)
 *  Five invalidations — each targets a distinct cache that the others don't
 *  subsume. Pre-code adversarial review specifically required the slug path. */
function revalidateAfterCancelToggle(eventId: string, kennelSlug: string): void {
  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  revalidatePath(`/hareline/${eventId}`);
  revalidatePath(`/kennels/${kennelSlug}`);
}

/**
 * Cascade-delete events: unlink RawEvents, remove dependents, delete events.
 * RawEvents are preserved (immutable audit trail) but unlinked.
 * Processes in batches to avoid timeouts with large sets (590+ events).
 * Returns the number of events deleted.
 */
async function deleteEventsCascade(eventIds: string[]): Promise<number> {
  let deleted = 0;
  for (let i = 0; i < eventIds.length; i += DELETE_BATCH_SIZE) {
    const batch = eventIds.slice(i, i + DELETE_BATCH_SIZE);
    const [
      ,, // rawEvent unlink, parentEventId nulling
      ,, // eventHare, attendance deletes
      , // kennelAttendance delete
      eventDeleteResult,
    ] = await prisma.$transaction([
      // Unlink RawEvents (preserve immutable audit trail)
      prisma.rawEvent.updateMany({
        where: { eventId: { in: batch } },
        data: { eventId: null, processed: false },
      }),
      // Null out self-referential parentEventId (avoids FK violation on delete)
      prisma.event.updateMany({
        where: { parentEventId: { in: batch } },
        data: { parentEventId: null },
      }),
      // Delete dependent records
      prisma.eventHare.deleteMany({ where: { eventId: { in: batch } } }),
      prisma.attendance.deleteMany({ where: { eventId: { in: batch } } }),
      prisma.kennelAttendance.deleteMany({ where: { eventId: { in: batch } } }),
      // Delete events (EventLink cascades via onDelete: Cascade in schema)
      prisma.event.deleteMany({ where: { id: { in: batch } } }),
    ]);
    deleted += eventDeleteResult.count;
  }
  return deleted;
}

/**
 * Delete a single canonical Event and cascade-clean related records.
 * RawEvents are preserved (immutable audit trail) but unlinked.
 */
export async function deleteEvent(eventId: string): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const event = await prisma.event.findUnique({
    where: { id: eventId },
    include: { kennel: { select: { shortName: true } } },
  });
  if (!event) return { error: "Event not found" };

  try {
    await deleteEventsCascade([eventId]);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error("[admin-audit] deleteEvent failed", { eventId, error: err });
    return { error: `Delete failed: ${msg}` };
  }

  console.log("[admin-audit] deleteEvent", JSON.stringify({
    adminId: admin.id,
    action: "delete_event",
    eventId,
    kennelName: event.kennel.shortName,
    eventDate: event.date.toISOString(),
    timestamp: new Date().toISOString(),
  }));

  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  return {
    success: true,
    kennelName: event.kennel.shortName,
    date: event.date.toISOString(),
  };
}

/**
 * Preview bulk delete — returns count and sample events without mutating.
 */
export async function previewBulkDelete(filters: {
  kennelId?: string;
  sourceId?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const where = buildEventWhere(filters);
  if (!where) return { error: "At least one filter is required" };

  const [count, sampleEvents] = await Promise.all([
    prisma.event.count({ where }),
    prisma.event.findMany({
      where,
      include: {
        kennel: { select: { shortName: true } },
        _count: { select: { attendances: true } },
      },
      orderBy: { date: "desc" },
      take: 5,
    }),
  ]);

  const totalAttendances = sampleEvents.reduce(
    (sum, e) => sum + e._count.attendances,
    0,
  );

  return {
    success: true,
    count,
    totalAttendances,
    sampleEvents: sampleEvents.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      kennelName: e.kennel.shortName,
      title: e.title,
      attendanceCount: e._count.attendances,
    })),
  };
}

/**
 * Bulk delete events matching filters.
 */
export async function bulkDeleteEvents(filters: {
  kennelId?: string;
  sourceId?: string;
  dateStart?: string;
  dateEnd?: string;
}): Promise<ActionResult<{ deletedCount: number }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const where = buildEventWhere(filters);
  if (!where) return { error: "At least one filter is required" };

  const events = await prisma.event.findMany({
    where,
    select: { id: true },
  });

  if (events.length === 0) return { success: true, deletedCount: 0 };
  if (events.length > 5000) return { error: `Too many events to delete (${events.length}). Max 5000 per bulk operation.` };

  const eventIds = events.map((e) => e.id);

  let deletedCount: number;
  try {
    deletedCount = await deleteEventsCascade(eventIds);
  } catch (err) {
    console.error("[admin-audit] bulkDeleteEvents failed", { filters, error: err });
    return { error: `Delete failed: ${err instanceof Error ? err.message : "Unknown error"}. Some events may have been deleted — re-run to clean up remaining.` };
  }

  console.log("[admin-audit] bulkDeleteEvents", JSON.stringify({
    adminId: admin.id,
    action: "bulk_delete_events",
    count: deletedCount,
    filters,
    timestamp: new Date().toISOString(),
  }));

  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  return { success: true, deletedCount };
}

/**
 * Delete specific events by ID (for multi-select bulk delete).
 */
export async function deleteSelectedEvents(eventIds: string[]): Promise<ActionResult<{ deletedCount: number }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (eventIds.length === 0) return { success: true, deletedCount: 0 };
  if (eventIds.length > 1000) return { error: "Too many events selected (max 1000)" };

  let deletedCount: number;
  try {
    deletedCount = await deleteEventsCascade(eventIds);
  } catch (err) {
    console.error("[admin-audit] deleteSelectedEvents failed", { count: eventIds.length, error: err });
    return { error: `Delete failed: ${err instanceof Error ? err.message : "Unknown error"}. Some events may have been deleted — re-run to clean up remaining.` };
  }

  console.log("[admin-audit] deleteSelectedEvents", JSON.stringify({
    adminId: admin.id,
    action: "delete_selected_events",
    count: deletedCount,
    timestamp: new Date().toISOString(),
  }));

  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  return { success: true, deletedCount };
}

type TxOk = {
  ok: true;
  kennelName: string;
  kennelSlug: string;
  date: string;
  wasAdminCancelled?: boolean;
};
type TxErr = { ok: false; error: string };
type TxResult = TxOk | TxErr;

/**
 * Restore a CANCELLED event back to CONFIRMED. Works for both reconciler-set
 * and admin-set CANCELLED. Clears any admin-override lock fields and, if the
 * event was admin-cancelled, appends an "uncancel" entry to the audit log.
 *
 * Atomic: read + check + append + update happen inside a single transaction
 * with `SELECT ... FOR UPDATE` so a concurrent admin can't lose the audit
 * entry via read-modify-write race.
 *
 * Spec: docs/superpowers/specs/2026-05-01-cancellation-override-design.md
 */
export async function uncancelEvent(eventId: string): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const result: TxResult = await prisma.$transaction(async (tx) => {
    // Row-level lock prevents two concurrent uncancel/cancel actions from
    // racing on the audit-log append. The lock is released on commit/rollback.
    await tx.$executeRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;

    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: { kennel: { select: KENNEL_SELECT_FOR_OVERRIDE } },
    });
    if (!event) return { ok: false, error: "Event not found" };
    if (event.status !== "CANCELLED") return { ok: false, error: "Event is not cancelled" };

    const wasAdminCancelled = event.adminCancelledAt !== null;
    // Append an audit entry whenever this is an admin-driven uncancel of a
    // row that has any admin-cancellation history (current lock OR prior
    // cancel/uncancel cycles). Without this, a reconciler-cancellation that
    // follows a prior admin-cycle silently drops the next manual uncancel
    // from the audit trail. Codex re-review #2.
    const hasPriorAuditHistory =
      Array.isArray(event.adminAuditLog) && event.adminAuditLog.length > 0;
    const shouldAppendAudit = wasAdminCancelled || hasPriorAuditHistory;
    const auditEntry: AuditLogEntry | null = shouldAppendAudit
      ? {
          action: "uncancel",
          timestamp: new Date().toISOString(),
          userId: admin.clerkId,
          changes: { status: { old: "CANCELLED", new: "CONFIRMED" } },
        }
      : null;

    await tx.event.update({
      where: { id: eventId },
      data: {
        status: "CONFIRMED",
        adminCancelledAt: null,
        adminCancelledBy: null,
        adminCancellationReason: null,
        ...(auditEntry !== null
          ? { adminAuditLog: appendAuditLog(event.adminAuditLog, auditEntry) }
          : {}),
      },
    });

    return {
      ok: true,
      kennelName: event.kennel.shortName,
      kennelSlug: event.kennel.slug,
      date: event.date.toISOString(),
      wasAdminCancelled,
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] uncancelEvent", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "uncancel_event",
    eventId,
    kennelName: result.kennelName,
    eventDate: result.date,
    wasAdminCancelled: result.wasAdminCancelled,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterCancelToggle(eventId, result.kennelSlug);
  return {
    success: true,
    kennelName: result.kennelName,
    date: result.date,
  };
}

/**
 * Admin override: mark an event CANCELLED with a required reason. The override
 * survives all subsequent merge/reconcile passes via the merge pipeline's
 * `isAdminLocked` guard. Un-cancel via `uncancelEvent`.
 *
 * Atomic: read + check + append + update happen inside a single transaction
 * with `SELECT ... FOR UPDATE` so a concurrent admin can't lose the audit
 * entry via read-modify-write race. Rejects already-CANCELLED rows (whether
 * reconciler-set or admin-set) — admin-cancellation is for transitioning a
 * CONFIRMED event to a CANCELLED-with-reason state, not for re-flagging an
 * existing cancellation.
 *
 * Spec: docs/superpowers/specs/2026-05-01-cancellation-override-design.md
 */
export async function adminCancelEvent(
  eventId: string,
  reason: string,
): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const trimmed = reason.trim();
  if (trimmed.length < CANCELLATION_REASON_MIN) {
    return { error: `Reason must be at least ${CANCELLATION_REASON_MIN} characters` };
  }
  if (trimmed.length > CANCELLATION_REASON_MAX) {
    return { error: `Reason must be ${CANCELLATION_REASON_MAX} characters or fewer` };
  }

  const result: TxResult = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;

    const event = await tx.event.findUnique({
      where: { id: eventId },
      include: { kennel: { select: KENNEL_SELECT_FOR_OVERRIDE } },
    });
    if (!event) return { ok: false, error: "Event not found" };
    if (event.adminCancelledAt) {
      // Already admin-locked: reject and force un-cancel-then-recancel for
      // reason changes (prevents accidental reason overwrite + preserves the
      // explicit "I'm changing my mind" audit-log shape).
      return {
        ok: false,
        error: "Event already admin-cancelled — un-cancel first to change reason",
      };
    }
    // Reconciler-cancelled rows (status=CANCELLED, adminCancelledAt=null) ARE
    // accepted as a direct elevation path: attach the admin lock + reason
    // without a status flip. The previous design forced un-cancel → recancel,
    // which briefly made the event publicly visible if step 2 was abandoned.
    // The audit entry honestly records status: { old: "CANCELLED", new: "CANCELLED" }
    // for the elevation case; the meaningful change is the lock + reason.

    const auditEntry: AuditLogEntry = {
      action: "cancel",
      timestamp: new Date().toISOString(),
      userId: admin.clerkId,
      changes: { status: { old: event.status, new: "CANCELLED" } },
      details: { reason: trimmed },
    };

    await tx.event.update({
      where: { id: eventId },
      data: {
        status: "CANCELLED",
        adminCancelledAt: new Date(),
        adminCancelledBy: admin.clerkId,
        adminCancellationReason: trimmed,
        adminAuditLog: appendAuditLog(event.adminAuditLog, auditEntry),
      },
    });

    return {
      ok: true,
      kennelName: event.kennel.shortName,
      kennelSlug: event.kennel.slug,
      date: event.date.toISOString(),
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] adminCancelEvent", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "admin_cancel_event",
    eventId,
    kennelName: result.kennelName,
    eventDate: result.date,
    reason: trimmed,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterCancelToggle(eventId, result.kennelSlug);

  return {
    success: true,
    kennelName: result.kennelName,
    date: result.date,
  };
}

/**
 * Build Prisma where clause from filters.
 * Returns null if no filters are provided (safety guard against accidental mass delete).
 */
function buildEventWhere(filters: {
  kennelId?: string;
  sourceId?: string;
  dateStart?: string;
  dateEnd?: string;
}) {
  const conditions: Record<string, unknown>[] = [];

  if (filters.kennelId) {
    // #1023 step 5: include co-hosted events when filtering by kennel.
    // OR-fallback against the legacy `Event.kennelId` denorm so admins
    // never lose an event from the filter view if (hypothetically) an
    // EventKennel row is missing for it.
    conditions.push({
      OR: [
        { eventKennels: { some: { kennelId: filters.kennelId } } },
        { kennelId: filters.kennelId },
      ],
    });
  }

  if (filters.sourceId === "none") {
    conditions.push({ rawEvents: { none: {} } });
  } else if (filters.sourceId) {
    conditions.push({
      rawEvents: { some: { sourceId: filters.sourceId } },
    });
  }

  if (filters.dateStart) {
    conditions.push({
      date: { gte: new Date(filters.dateStart + "T00:00:00Z") },
    });
  }

  if (filters.dateEnd) {
    conditions.push({
      date: { lte: new Date(filters.dateEnd + "T23:59:59Z") },
    });
  }

  if (conditions.length === 0) return null;

  return { AND: conditions };
}
