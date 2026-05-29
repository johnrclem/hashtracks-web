"use server";

import { prisma } from "@/lib/db";
import type { Prisma } from "@/generated/prisma/client";
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

/** Revalidate every cache surface affected by a series-link or kennel-
 *  attribution change: the admin list, the hareline list + tag, this event's
 *  detail page, and each kennel page whose membership shifted (old + new, or
 *  the host + co-host). Empty/duplicate slugs are de-duped and skipped. */
function revalidateAfterAttribution(eventId: string, kennelSlugs: string[]): void {
  revalidatePath("/admin/events");
  revalidatePath("/hareline");
  revalidateTag(HARELINE_EVENTS_TAG, { expire: 0 });
  revalidatePath(`/hareline/${eventId}`);
  for (const slug of new Set(kennelSlugs.filter(Boolean))) {
    revalidatePath(`/kennels/${slug}`);
  }
}

/** Take a row-level lock on an Event for the rest of the surrounding tx, so a
 *  concurrent admin mutation can't race the read-modify-write of its fields. */
function lockEvent(tx: Prisma.TransactionClient, eventId: string) {
  return tx.$executeRaw`SELECT id FROM "Event" WHERE id = ${eventId} FOR UPDATE`;
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
    await lockEvent(tx, eventId);

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
        ...(auditEntry === null
          ? {}
          : { adminAuditLog: appendAuditLog(event.adminAuditLog, auditEntry) }),
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
 * Accepts:
 *  - CONFIRMED rows (the typical case): transitions status to CANCELLED with
 *    the lock + reason fields and a `cancel` audit entry.
 *  - Reconciler-cancelled rows (status=CANCELLED, adminCancelledAt=null):
 *    direct elevation path — attaches the lock + reason in place without a
 *    status flip. Avoids the public-visibility flicker of un-cancel-then-
 *    recancel. The audit entry honestly records CANCELLED → CANCELLED for
 *    the status; the meaningful change is the lock + reason fields.
 *
 * Rejects:
 *  - Already admin-locked rows (adminCancelledAt set): forces un-cancel-then-
 *    recancel for reason changes, which preserves the explicit audit-log
 *    shape and prevents accidental reason overwrite.
 *
 * Atomic: read + check + append + update happen inside a single transaction
 * with `SELECT ... FOR UPDATE` so a concurrent admin can't lose the audit
 * entry via read-modify-write race.
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
    await lockEvent(tx, eventId);

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

// ---------------------------------------------------------------------------
// Umbrella series link/unlink (#1679)
// ---------------------------------------------------------------------------

/**
 * Recompute an umbrella's `endDate` so the public series header — which renders
 * `formatDateRange(event.date, event.endDate)` (see hareline/[eventId]/page.tsx)
 * — always covers its current children. Sets `endDate` to the latest child
 * date when a child extends beyond the umbrella's own date, otherwise null
 * (single-day display). Call inside a tx with the umbrella row already locked.
 *
 * Manual link/unlink must maintain this because the merge pipeline's
 * `linkMultiDaySeries` only sets parent/child pointers; endDate otherwise comes
 * from the adapter. A re-scrape re-asserts any adapter-supplied endDate via
 * `resolveEndDateUpdate`, so this never permanently fights a source-driven range.
 */
async function syncUmbrellaEndDate(
  tx: Prisma.TransactionClient,
  umbrellaId: string,
): Promise<void> {
  const [umbrella, children] = await Promise.all([
    tx.event.findUnique({ where: { id: umbrellaId }, select: { date: true } }),
    tx.event.findMany({ where: { parentEventId: umbrellaId }, select: { date: true } }),
  ]);
  if (!umbrella) return;
  const latestChild = children.reduce<Date | null>(
    (max, c) => (max === null || c.date > max ? c.date : max),
    null,
  );
  const endDate =
    latestChild !== null && latestChild > umbrella.date ? latestChild : null;
  await tx.event.update({ where: { id: umbrellaId }, data: { endDate } });
}

/**
 * Attach a standalone Event as a child of an umbrella (series-parent) Event by
 * setting `parentEventId`. Promotes the umbrella to `isSeriesParent=true` if it
 * isn't already (mirrors the merge pipeline's `linkMultiDaySeries`).
 *
 * Enforces a strict 2-level tree (parent → children): the umbrella may not
 * itself be a child, and the child may not already be a series parent. That
 * keeps cycles impossible and the UI grouping flat.
 *
 * Atomic: both rows are locked with `SELECT ... FOR UPDATE` ordered by id (so a
 * concurrent link in the opposite direction can't deadlock), then mutated.
 */
export async function linkChildToUmbrella(
  childEventId: string,
  umbrellaEventId: string,
): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  if (childEventId === umbrellaEventId) {
    return { error: "Cannot link an event to itself" };
  }

  type R =
    | { ok: true; kennelName: string; kennelSlug: string; date: string }
    | { ok: false; error: string };
  const result: R = await prisma.$transaction(async (tx) => {
    // Lock both rows in a deterministic (id-sorted) order to avoid deadlock
    // with a concurrent link running in the opposite direction.
    await tx.$executeRaw`SELECT id FROM "Event" WHERE id IN (${childEventId}, ${umbrellaEventId}) ORDER BY id FOR UPDATE`;

    const [child, umbrella] = await Promise.all([
      tx.event.findUnique({
        where: { id: childEventId },
        select: {
          parentEventId: true,
          isSeriesParent: true,
          date: true,
          adminAuditLog: true,
          kennel: { select: KENNEL_SELECT_FOR_OVERRIDE },
        },
      }),
      tx.event.findUnique({
        where: { id: umbrellaEventId },
        select: { parentEventId: true, isSeriesParent: true },
      }),
    ]);

    if (!child) return { ok: false, error: "Child event not found" };
    if (!umbrella) return { ok: false, error: "Umbrella event not found" };

    // Already linked to this umbrella — idempotent success.
    if (child.parentEventId === umbrellaEventId) {
      return {
        ok: true,
        kennelName: child.kennel.shortName,
        kennelSlug: child.kennel.slug,
        date: child.date.toISOString(),
      };
    }

    // Already a child of a DIFFERENT umbrella: refuse to silently re-parent.
    // Moving it would orphan the old umbrella's cached series view; force an
    // explicit unlink first so both umbrellas get revalidated.
    if (child.parentEventId !== null) {
      return { ok: false, error: "Event is already linked to a different umbrella — unlink it first" };
    }

    if (umbrella.parentEventId !== null) {
      return { ok: false, error: "Umbrella is itself a child of another event" };
    }
    if (child.isSeriesParent) {
      return { ok: false, error: "This event is a series parent — detach its children before attaching it" };
    }

    await tx.event.update({
      where: { id: childEventId },
      data: {
        parentEventId: umbrellaEventId,
        adminAuditLog: appendAuditLog(child.adminAuditLog, {
          action: "link_series",
          timestamp: new Date().toISOString(),
          userId: admin.clerkId,
          changes: { parentEventId: { old: child.parentEventId, new: umbrellaEventId } },
          details: { umbrellaEventId },
        }),
      },
    });

    if (!umbrella.isSeriesParent) {
      await tx.event.update({
        where: { id: umbrellaEventId },
        data: { isSeriesParent: true },
      });
    }

    // Keep the umbrella's date range covering the newly-linked child.
    await syncUmbrellaEndDate(tx, umbrellaEventId);

    return {
      ok: true,
      kennelName: child.kennel.shortName,
      kennelSlug: child.kennel.slug,
      date: child.date.toISOString(),
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] linkChildToUmbrella", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "link_series",
    childEventId,
    umbrellaEventId,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterAttribution(childEventId, [result.kennelSlug]);
  revalidatePath(`/hareline/${umbrellaEventId}`);
  return { success: true, kennelName: result.kennelName, date: result.date };
}

/**
 * Detach a child Event from its umbrella by clearing `parentEventId`. Does not
 * auto-demote the umbrella's `isSeriesParent` flag (demote-parent is a separate
 * concern, intentionally out of scope here).
 */
export async function unlinkChildFromUmbrella(
  childEventId: string,
): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  type R =
    | { ok: true; kennelName: string; kennelSlug: string; date: string; oldParentId: string }
    | { ok: false; error: string };
  const result: R = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, childEventId);

    const child = await tx.event.findUnique({
      where: { id: childEventId },
      select: {
        parentEventId: true,
        date: true,
        adminAuditLog: true,
        kennel: { select: KENNEL_SELECT_FOR_OVERRIDE },
      },
    });
    if (!child) return { ok: false, error: "Event not found" };
    if (child.parentEventId === null) return { ok: false, error: "Event is not linked to an umbrella" };

    const oldParentId = child.parentEventId;
    await tx.event.update({
      where: { id: childEventId },
      data: {
        parentEventId: null,
        adminAuditLog: appendAuditLog(child.adminAuditLog, {
          action: "unlink_series",
          timestamp: new Date().toISOString(),
          userId: admin.clerkId,
          changes: { parentEventId: { old: oldParentId, new: null } },
        }),
      },
    });

    // Shrink the old umbrella's date range to cover only its remaining
    // children (lock it first — low-concurrency admin path, no deadlock risk
    // vs. the pipeline which locks nothing here).
    await lockEvent(tx, oldParentId);
    await syncUmbrellaEndDate(tx, oldParentId);

    return {
      ok: true,
      kennelName: child.kennel.shortName,
      kennelSlug: child.kennel.slug,
      date: child.date.toISOString(),
      oldParentId,
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] unlinkChildFromUmbrella", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "unlink_series",
    childEventId,
    oldParentId: result.oldParentId,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterAttribution(childEventId, [result.kennelSlug]);
  revalidatePath(`/hareline/${result.oldParentId}`);
  return { success: true, kennelName: result.kennelName, date: result.date };
}

/**
 * Read-only search backing the "link to umbrella" picker. Matches `title` or
 * `kennel.shortName` (case-insensitive contains), newest first, capped at 25.
 * Returns an empty list for queries shorter than 2 chars.
 */
export async function searchEventsForUmbrella(
  query: string,
  excludeId?: string,
): Promise<
  | { success: true; events: { id: string; date: string; kennelName: string; title: string | null; isSeriesParent: boolean }[] }
  | { error: string }
> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  const trimmed = query.trim();
  if (trimmed.length < 2) return { success: true, events: [] };

  const events = await prisma.event.findMany({
    where: {
      AND: [
        excludeId ? { id: { not: excludeId } } : {},
        {
          OR: [
            { title: { contains: trimmed, mode: "insensitive" } },
            { kennel: { shortName: { contains: trimmed, mode: "insensitive" } } },
          ],
        },
      ],
    },
    select: {
      id: true,
      date: true,
      title: true,
      isSeriesParent: true,
      kennel: { select: { shortName: true } },
    },
    orderBy: { date: "desc" },
    take: 25,
  });

  return {
    success: true,
    events: events.map((e) => ({
      id: e.id,
      date: e.date.toISOString(),
      kennelName: e.kennel.shortName,
      title: e.title,
      isSeriesParent: e.isSeriesParent,
    })),
  };
}

// ---------------------------------------------------------------------------
// Kennel attribution (#1680)
// ---------------------------------------------------------------------------

/**
 * Change an Event's PRIMARY kennel (a true move). Deletes the old primary
 * `EventKennel` row, promotes/creates the new kennel's row as primary, and
 * mirrors `Event.kennelId`. Any existing co-host rows are left untouched.
 *
 * The old primary is deleted BEFORE the new one is promoted/created — the
 * partial unique index `EventKennel(eventId) WHERE isPrimary = true` rejects
 * two primaries even transiently (same recipe as `deduplicateEventKennels`).
 */
export async function reattributeEventKennel(
  eventId: string,
  newKennelCode: string,
): Promise<ActionResult<{ oldKennelName: string; newKennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  type R =
    | {
        ok: true;
        oldKennelName: string;
        oldKennelSlug: string;
        newKennelName: string;
        newKennelSlug: string;
        date: string;
      }
    | { ok: false; error: string };
  const result: R = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);

    // The kennel + event reads are independent — run them together.
    const [newKennel, event] = await Promise.all([
      tx.kennel.findUnique({
        where: { kennelCode: newKennelCode },
        select: { id: true, shortName: true, slug: true },
      }),
      tx.event.findUnique({
        where: { id: eventId },
        select: {
          kennelId: true,
          date: true,
          adminAuditLog: true,
          kennel: { select: { kennelCode: true, shortName: true, slug: true } },
          eventKennels: { select: { kennelId: true } },
        },
      }),
    ]);
    if (!newKennel) return { ok: false, error: `Kennel not found: ${newKennelCode}` };
    if (!event) return { ok: false, error: "Event not found" };
    if (event.kennelId === newKennel.id) {
      return { ok: false, error: `Event is already attributed to ${newKennel.shortName}` };
    }

    const oldKennelId = event.kennelId;

    // Delete the old primary first (see partial-unique-index note above).
    await tx.eventKennel.deleteMany({ where: { eventId, isPrimary: true } });

    const newAlreadyAttached = event.eventKennels.some((ek) => ek.kennelId === newKennel.id);
    if (newAlreadyAttached) {
      await tx.eventKennel.update({
        where: { eventId_kennelId: { eventId, kennelId: newKennel.id } },
        data: { isPrimary: true },
      });
    } else {
      await tx.eventKennel.create({
        data: { eventId, kennelId: newKennel.id, isPrimary: true },
      });
    }

    await tx.event.update({
      where: { id: eventId },
      data: {
        kennelId: newKennel.id,
        adminAuditLog: appendAuditLog(event.adminAuditLog, {
          action: "reattribute_kennel",
          timestamp: new Date().toISOString(),
          userId: admin.clerkId,
          changes: {
            kennelId: { old: oldKennelId, new: newKennel.id },
            kennelCode: { old: event.kennel.kennelCode, new: newKennelCode },
          },
        }),
      },
    });

    return {
      ok: true,
      oldKennelName: event.kennel.shortName,
      oldKennelSlug: event.kennel.slug,
      newKennelName: newKennel.shortName,
      newKennelSlug: newKennel.slug,
      date: event.date.toISOString(),
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] reattributeEventKennel", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "reattribute_kennel",
    eventId,
    newKennelCode,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterAttribution(eventId, [result.oldKennelSlug, result.newKennelSlug]);
  return {
    success: true,
    oldKennelName: result.oldKennelName,
    newKennelName: result.newKennelName,
    date: result.date,
  };
}

/**
 * Add a co-host kennel to an Event as a non-primary `EventKennel` row. Rejects
 * kennels already attributed (primary or existing co-host).
 */
export async function addCoHostKennel(
  eventId: string,
  kennelCode: string,
): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  type R =
    | { ok: true; eventSlug: string; coHostName: string; coHostSlug: string; date: string }
    | { ok: false; error: string };
  const result: R = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);

    const kennel = await tx.kennel.findUnique({
      where: { kennelCode },
      select: { id: true, shortName: true, slug: true },
    });
    if (!kennel) return { ok: false, error: `Kennel not found: ${kennelCode}` };

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        date: true,
        adminAuditLog: true,
        kennel: { select: { slug: true } },
        eventKennels: { select: { kennelId: true } },
      },
    });
    if (!event) return { ok: false, error: "Event not found" };
    if (event.eventKennels.some((ek) => ek.kennelId === kennel.id)) {
      return { ok: false, error: `${kennel.shortName} is already attributed to this event` };
    }

    await tx.eventKennel.create({
      data: { eventId, kennelId: kennel.id, isPrimary: false },
    });
    await tx.event.update({
      where: { id: eventId },
      data: {
        adminAuditLog: appendAuditLog(event.adminAuditLog, {
          action: "add_cohost",
          timestamp: new Date().toISOString(),
          userId: admin.clerkId,
          details: { kennelCode, kennelId: kennel.id },
        }),
      },
    });

    return {
      ok: true,
      eventSlug: event.kennel.slug,
      coHostName: kennel.shortName,
      coHostSlug: kennel.slug,
      date: event.date.toISOString(),
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] addCoHostKennel", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "add_cohost",
    eventId,
    kennelCode,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterAttribution(eventId, [result.eventSlug, result.coHostSlug]);
  return { success: true, kennelName: result.coHostName, date: result.date };
}

/**
 * Remove a co-host kennel from an Event. Rejects removing the primary (use
 * `reattributeEventKennel` to move the primary) or a kennel that isn't attached.
 */
export async function removeCoHostKennel(
  eventId: string,
  kennelCode: string,
): Promise<ActionResult<{ kennelName: string; date: string }>> {
  const admin = await getAdminUser();
  if (!admin) return { error: "Not authorized" };

  type R =
    | { ok: true; eventSlug: string; coHostName: string; coHostSlug: string; date: string }
    | { ok: false; error: string };
  const result: R = await prisma.$transaction(async (tx) => {
    await lockEvent(tx, eventId);

    const kennel = await tx.kennel.findUnique({
      where: { kennelCode },
      select: { id: true, shortName: true, slug: true },
    });
    if (!kennel) return { ok: false, error: `Kennel not found: ${kennelCode}` };

    const event = await tx.event.findUnique({
      where: { id: eventId },
      select: {
        date: true,
        adminAuditLog: true,
        kennel: { select: { slug: true } },
        eventKennels: { select: { kennelId: true, isPrimary: true } },
      },
    });
    if (!event) return { ok: false, error: "Event not found" };

    const row = event.eventKennels.find((ek) => ek.kennelId === kennel.id);
    if (!row) return { ok: false, error: `${kennel.shortName} is not attributed to this event` };
    if (row.isPrimary) {
      return { ok: false, error: "Cannot remove the primary kennel — use Change kennel to move it" };
    }

    await tx.eventKennel.delete({
      where: { eventId_kennelId: { eventId, kennelId: kennel.id } },
    });
    await tx.event.update({
      where: { id: eventId },
      data: {
        adminAuditLog: appendAuditLog(event.adminAuditLog, {
          action: "remove_cohost",
          timestamp: new Date().toISOString(),
          userId: admin.clerkId,
          details: { kennelCode, kennelId: kennel.id },
        }),
      },
    });

    return {
      ok: true,
      eventSlug: event.kennel.slug,
      coHostName: kennel.shortName,
      coHostSlug: kennel.slug,
      date: event.date.toISOString(),
    };
  });

  if (!result.ok) return { error: result.error };

  console.log("[admin-audit] removeCoHostKennel", JSON.stringify({
    adminId: admin.id,
    adminClerkId: admin.clerkId,
    action: "remove_cohost",
    eventId,
    kennelCode,
    timestamp: new Date().toISOString(),
  }));

  revalidateAfterAttribution(eventId, [result.eventSlug, result.coHostSlug]);
  return { success: true, kennelName: result.coHostName, date: result.date };
}
