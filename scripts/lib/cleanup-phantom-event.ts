/**
 * Shared driver for one-shot phantom-event cleanups (#1739).
 *
 * Removes a single already-ingested phantom canonical Event plus its phantom
 * RawEvent(s). Safety guarantees, identical across callers:
 *   - Verifies the target Event still matches the expected signature before
 *     deleting (refuses if the row drifted).
 *   - Deletes ONLY RawEvents linked to the target Event. Scans the source for
 *     signature-matching rows that are NOT linked and FAILS CLOSED if any
 *     exist (Codex adversarial review) — deleting by signature alone could
 *     erase unrelated source/audit data.
 *   - Deletes phantom RawEvents outright (not unlink) so they cannot re-merge.
 *   - No-op on re-run (Event already gone → reports clean, exit 0).
 *   - Dry run unless `apply` is true.
 */
import { prisma } from "@/lib/db";

/** Minimal Event projection passed to the per-caller verify/drift hooks. */
export interface PhantomEvent {
  id: string;
  title: string | null;
  locationName: string | null;
  status: string;
}

export interface PhantomCleanupConfig {
  /** Log prefix, e.g. "cleanup-abq". */
  logPrefix: string;
  /** GitHub issue number, surfaced in the audit line. */
  issue: number;
  /** Canonical Event id to remove. */
  eventId: string;
  /** Source name that owns the phantom RawEvents (provenance scope). */
  sourceName: string;
  /** Human label for logs, e.g. `"LYNNE OFF"`. */
  targetLabel: string;
  /** True when a RawEvent.rawData carries the phantom signature. */
  isPhantomRaw: (rawData: unknown) => boolean;
  /** True when the loaded Event still matches the expected phantom (drift guard). */
  verify: (event: PhantomEvent) => boolean;
  /** Drift detail for the refusal message when `verify` fails. */
  describeDrift: (event: PhantomEvent) => string;
}

export async function runPhantomCleanup(cfg: PhantomCleanupConfig, apply: boolean): Promise<void> {
  const log = (m: string) => console.log(`[${cfg.logPrefix}] ${m}`);
  log(`${apply ? "APPLY" : "DRY-RUN"} — target Event ${cfg.eventId} (${cfg.targetLabel})`);

  const source = await prisma.source.findFirst({ where: { name: cfg.sourceName }, select: { id: true } });
  if (!source) throw new Error(`Source not found: ${cfg.sourceName}`);

  const event = await prisma.event.findUnique({
    where: { id: cfg.eventId },
    select: { id: true, title: true, locationName: true, status: true },
  });

  const sourceRaws = await prisma.rawEvent.findMany({
    where: { sourceId: source.id },
    select: { id: true, eventId: true, rawData: true },
  });
  const phantomRawIds = sourceRaws.filter((r) => r.eventId === cfg.eventId).map((r) => r.id);
  const strayMatches = sourceRaws
    .filter((r) => r.eventId !== cfg.eventId && cfg.isPhantomRaw(r.rawData))
    .map((r) => r.id);
  if (strayMatches.length > 0) {
    throw new Error(
      `Found ${strayMatches.length} signature-matching RawEvent(s) NOT linked to ${cfg.eventId}: ` +
        `[${strayMatches.join(", ")}]. Refusing to delete unrelated source data — investigate manually.`,
    );
  }

  if (!event && phantomRawIds.length === 0) {
    log("Nothing to do — phantom Event and RawEvents already removed.");
    return;
  }
  if (event && !cfg.verify(event)) {
    throw new Error(
      `Refusing to delete: Event ${cfg.eventId} ${cfg.describeDrift(event)}. ` +
        `The row may have drifted — investigate manually.`,
    );
  }

  const eventDesc = event ? `${event.id} (status ${event.status})` : "none";
  log(`Would delete: Event=${eventDesc}, RawEvents=${phantomRawIds.length} [${phantomRawIds.join(", ")}]`);
  if (!apply) {
    log("DRY-RUN complete. Re-run with CLEANUP_APPLY=1 to delete.");
    return;
  }

  await prisma.$transaction([
    // Dependent records keyed on the Event (no onDelete cascade in schema).
    prisma.eventHare.deleteMany({ where: { eventId: cfg.eventId } }),
    prisma.attendance.deleteMany({ where: { eventId: cfg.eventId } }),
    prisma.kennelAttendance.deleteMany({ where: { eventId: cfg.eventId } }),
    // Defensive: orphan any child events that pointed at this one.
    prisma.event.updateMany({ where: { parentEventId: cfg.eventId }, data: { parentEventId: null } }),
    // Delete the phantom RawEvents (audit pollution — not legitimate data).
    prisma.rawEvent.deleteMany({ where: { id: { in: phantomRawIds } } }),
    // Delete the canonical Event (EventKennel + EventLink cascade in schema).
    prisma.event.deleteMany({ where: { id: cfg.eventId } }),
  ]);

  const eventStill = await prisma.event.findUnique({ where: { id: cfg.eventId }, select: { id: true } });
  const rawsStill = await prisma.rawEvent.count({ where: { id: { in: phantomRawIds } } });
  if (eventStill || rawsStill > 0) {
    throw new Error(`Post-delete check failed: event=${!!eventStill}, rawsRemaining=${rawsStill}`);
  }

  log(
    JSON.stringify({
      action: "delete_phantom_event",
      issue: cfg.issue,
      eventId: cfg.eventId,
      rawEventsDeleted: phantomRawIds.length,
      timestamp: new Date().toISOString(),
    }),
  );
  log("Done.");
}
