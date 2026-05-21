import { prisma } from "@/lib/db";

/**
 * Backfill `lastEventDate` for all kennels by computing MAX(date) across every
 * event the kennel is attached to — both the primary FK (`Event.kennelId`) and
 * co-host secondaries (`EventKennel.kennelId`). Returns rows updated.
 *
 * Including the EventKennel path fixes #1567: kennels whose newest event is
 * co-host-only otherwise see a stale cached date. The dual-write contract
 * (#1023) guarantees every primary event also has an `EventKennel(isPrimary=true)`
 * row, so this union is a strict superset of the old narrow predicate. UNION
 * ALL intentionally double-counts those primary-mirror rows (each event
 * contributes two `(kennelId, date)` tuples in the worst case) — `MAX`
 * collapses them so it doesn't affect correctness, and bypassing the
 * UNION dedup pass keeps the aggregate linear in `|Event|`.
 *
 * TODO(#1023 step 7): once `Event.kennelId` is dropped, remove the primary-
 * FK half of the UNION — the EventKennel half alone will be complete.
 *
 * The outer `Kennel k2 LEFT JOIN ...` wrapper preserves NULL-reset semantics:
 * kennels that lose all their events flip back to `lastEventDate = NULL`.
 *
 * The UNION ALL shape (vs. `OR EXISTS (...)` inside a LEFT JOIN) avoids a
 * per-Kennel nested-loop over Event — important for the daily audit cron.
 *
 * Called from:
 * - Admin action (manual trigger with auth)
 * - Audit cron (daily, ensures cache stays populated)
 */
export async function backfillLastEventDates(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE "Kennel" k
    SET "lastEventDate" = sub."maxDate", "updatedAt" = NOW()
    FROM (
      SELECT k2.id AS "kennelId", attachment_maxes."maxDate"
      FROM "Kennel" k2
      LEFT JOIN (
        SELECT "kennelId", MAX(date) AS "maxDate"
        FROM (
          SELECT e."kennelId", e.date
          FROM "Event" e
          WHERE e.status != 'CANCELLED' AND e."isManualEntry" != true
          UNION ALL
          SELECT ek."kennelId", e.date
          FROM "EventKennel" ek
          JOIN "Event" e ON e.id = ek."eventId"
          WHERE e.status != 'CANCELLED' AND e."isManualEntry" != true
        ) attachments
        GROUP BY "kennelId"
      ) attachment_maxes ON attachment_maxes."kennelId" = k2.id
    ) sub
    WHERE k.id = sub."kennelId"
    AND k."lastEventDate" IS DISTINCT FROM sub."maxDate"
  `;
}
