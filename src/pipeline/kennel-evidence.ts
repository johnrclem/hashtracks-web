import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Kennel Status evidence refresh (docs/superpowers/specs/2026-11-10-kennel-status-design.md §1–2).
 *
 * Two set-based SQL refreshes:
 * - `refreshScheduleOnlyFlags` caches `Event.isScheduleOnly`.
 * - `refreshKennelEvidence` caches the four `Kennel` evidence dates that
 *   `src/lib/kennel-status.ts` turns into a state.
 *
 * Run them in that order: kennel evidence reads the cached flag. Both write
 * only rows whose value changes, and return the number of rows written.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** `rawData.hares` with leading and trailing whitespace (spaces, tabs, newlines) removed. */
const RAW_HARES_TRIMMED_SQL = Prisma.sql`regexp_replace(r."rawData"->>'hares', '^[[:space:]]+|[[:space:]]+$', '', 'g')`;

/**
 * The RawEvent names no hares: `hares` is absent, null, blank, or a placeholder.
 * The placeholders are exactly the forms `isPlaceholderText` in
 * src/adapters/utils.ts rejects, case-insensitive after trimming, one pattern
 * each for PLACEHOLDER_TBD_RE, PLACEHOLDER_OTHER_RE and
 * PLACEHOLDER_HARES_NEEDED_RE (`[[:>:]]` is Postgres's end-of-word, JS `\b`).
 * Adapters keep placeholders like "TBD" in `hares` on purpose (hare-extraction.ts).
 */
const RAW_NO_HARES_SQL = Prisma.sql`(
  COALESCE(${RAW_HARES_TRIMMED_SQL}, '') = ''
  OR ${RAW_HARES_TRIMMED_SQL} ~* '^(venue[[:space:]-]+)?(tbd|tba|tbc)$'
  OR ${RAW_HARES_TRIMMED_SQL} ~* '^(n/a|none|null|needed|required|registration|sign[[:space:]_-]*up!?|volunteer|vacant|[?]{1,3})$'
  OR ${RAW_HARES_TRIMMED_SQL} ~* '^(hares?[[:space:]]+(needed|required|wanted)|needs?[[:space:]]+(a[[:space:]]+)?hares?)[[:>:]]'
)`;

/**
 * "This RawEvent is a posted run", for a RawEvent aliased `r` joined to its
 * Source aliased `s`. A RawEvent is a schedule projection, not a posted run,
 * when it comes from a STATIC_SCHEDULE source, or when it is an instance of a
 * repeating Google Calendar series (`rawData.recurringSeriesId`) that carries
 * nothing run-specific: no hares (placeholders count as none) and no run number.
 */
export const POSTED_RUN_RAW_SQL = Prisma.sql`(
  s.type <> 'STATIC_SCHEDULE'
  AND NOT (
    NULLIF(r."rawData"->>'recurringSeriesId', '') IS NOT NULL
    AND ${RAW_NO_HARES_SQL}
    AND r."rawData"->>'runNumber' IS NULL
  )
)`;

/**
 * The RawEvent aliased `r` is its source's current copy of that instance: no
 * RawEvent from the same source, with the same `rawData.sourceUrl`, linked to
 * the same event was scraped after it. RawEvents are immutable and merge never
 * unlinks an older one, so an older copy from the same source is superseded
 * and must not count. `sourceUrl` keeps same-day double-headers apart (a
 * Google Calendar `htmlLink` is unique per instance); a missing URL groups
 * with other missing URLs. Copies scraped at the same instant both count.
 */
const CURRENT_RAW_SQL = Prisma.sql`NOT EXISTS (
  SELECT 1
  FROM "RawEvent" newer
  WHERE newer."eventId" = r."eventId"
    AND newer."sourceId" = r."sourceId"
    AND (newer."rawData"->>'sourceUrl') IS NOT DISTINCT FROM (r."rawData"->>'sourceUrl')
    AND newer."scrapedAt" > r."scrapedAt"
)`;

export type ScheduleOnlyScope = "all" | { sourceId: string; since: Date };

/**
 * Recompute `Event.isScheduleOnly`: the event has ≥1 RawEvent and none of its
 * current RawEvents (the newest per source and `sourceUrl`, see
 * `CURRENT_RAW_SQL`) is a posted run. An event with no RawEvent is never
 * schedule-only.
 *
 * `"all"` covers every event. A source scope covers the events linked to that
 * source's RawEvents scraped at or after `since` (the scrape's start time).
 *
 * `updatedAt` is left alone: the flag is a derived classification, and a full
 * refresh would otherwise churn the sitemap `lastmod` of thousands of events.
 *
 * Returns the number of events whose flag changed.
 */
export async function refreshScheduleOnlyFlags(scope: ScheduleOnlyScope): Promise<number> {
  const eventFilter =
    scope === "all"
      ? Prisma.empty
      : Prisma.sql`
        WHERE ev.id IN (
          SELECT r."eventId"
          FROM "RawEvent" r
          WHERE r."sourceId" = ${scope.sourceId}
            AND r."scrapedAt" >= ${scope.since}
            AND r."eventId" IS NOT NULL
        )`;

  return prisma.$executeRaw(Prisma.sql`
    UPDATE "Event" e
    SET "isScheduleOnly" = sub."isScheduleOnly"
    FROM (
      SELECT
        ev.id,
        EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = ev.id)
        AND NOT EXISTS (
          SELECT 1
          FROM "RawEvent" r
          JOIN "Source" s ON s.id = r."sourceId"
          WHERE r."eventId" = ev.id AND ${POSTED_RUN_RAW_SQL} AND ${CURRENT_RAW_SQL}
        ) AS "isScheduleOnly"
      FROM "Event" ev
      ${eventFilter}
    ) sub
    WHERE e.id = sub.id
      AND e."isScheduleOnly" IS DISTINCT FROM sub."isScheduleOnly"
  `);
}

/**
 * Recompute each kennel's cached evidence dates:
 *
 * - `lastRunSeenAt`: the later of the newest real run dated today or earlier
 *   and the newest attended event dated today or earlier. Attendance is a
 *   CONFIRMED logbook check-in or any misman `KennelAttendance`, and counts
 *   even when the event is schedule-only.
 * - `nextRunPostedAt`: the earliest real run dated today or later that has
 *   ≥1 RawEvent. Any RawEvent will do: an event with one always has a current
 *   one, and whether it is a posted run is already in the cached flag.
 * - `lastConfirmedAt`: the newest un-reverted RUNNING confirmation.
 * - `stoppedAt`: the newest un-reverted STOPPED confirmation, kept only while
 *   no evidence date above is later than it; otherwise null, because kennels
 *   restart. A stop dated the same day as the evidence stands, matching the
 *   stop action, which refuses only when evidence is later than the stop.
 *
 * A real run is a canonical, non-cancelled, non-schedule-only event that is not
 * a manual entry. Runs and attendance count for every kennel attached to the
 * event: the primary `Event.kennelId` and co-host `EventKennel` rows, the same
 * union as `backfill-last-event.ts`.
 *
 * Reads the cached `Event.isScheduleOnly`, so run `refreshScheduleOnlyFlags`
 * first. "Today" is the UTC calendar day of `now`; event dates sit at UTC noon.
 *
 * With no ids it refreshes every kennel; an empty list is a no-op. Returns the
 * number of kennels whose evidence changed.
 */
export async function refreshKennelEvidence(
  kennelIds?: string[],
  now: Date = new Date(),
): Promise<number> {
  if (kennelIds?.length === 0) return 0;

  const todayStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  const tomorrowStart = new Date(todayStart.getTime() + DAY_MS);
  const kennelFilter = kennelIds
    ? Prisma.sql`WHERE k.id IN (${Prisma.join(kennelIds)})`
    : Prisma.empty;

  return prisma.$executeRaw(Prisma.sql`
    WITH target AS (
      SELECT k.id FROM "Kennel" k ${kennelFilter}
    ),
    attached AS (
      SELECT e."kennelId", e.id, e.date, e."isScheduleOnly", e."isManualEntry"
      FROM "Event" e
      JOIN target t ON t.id = e."kennelId"
      WHERE e."isCanonical" = true AND e.status <> 'CANCELLED'
      UNION ALL
      SELECT ek."kennelId", e.id, e.date, e."isScheduleOnly", e."isManualEntry"
      FROM "EventKennel" ek
      JOIN target t ON t.id = ek."kennelId"
      JOIN "Event" e ON e.id = ek."eventId"
      WHERE e."isCanonical" = true AND e.status <> 'CANCELLED'
    ),
    past_runs AS (
      SELECT a."kennelId", MAX(a.date) AS "maxDate"
      FROM attached a
      WHERE a."isScheduleOnly" = false
        AND a."isManualEntry" = false
        AND a.date < ${tomorrowStart}
      GROUP BY a."kennelId"
    ),
    next_runs AS (
      SELECT a."kennelId", MIN(a.date) AS "minDate"
      FROM attached a
      WHERE a."isScheduleOnly" = false
        AND a."isManualEntry" = false
        AND a.date >= ${todayStart}
        AND EXISTS (SELECT 1 FROM "RawEvent" r WHERE r."eventId" = a.id)
      GROUP BY a."kennelId"
    ),
    attended AS (
      SELECT a."kennelId", MAX(a.date) AS "maxDate"
      FROM attached a
      JOIN (
        SELECT ua."eventId" FROM "Attendance" ua WHERE ua.status = 'CONFIRMED'
        UNION
        SELECT ka."eventId" FROM "KennelAttendance" ka
      ) seen ON seen."eventId" = a.id
      WHERE a.date < ${tomorrowStart}
      GROUP BY a."kennelId"
    ),
    confirmations AS (
      SELECT
        c."kennelId",
        MAX(c."observedAt") FILTER (WHERE c.kind = 'RUNNING') AS "lastConfirmed",
        MAX(c."observedAt") FILTER (WHERE c.kind = 'STOPPED') AS "lastStopped"
      FROM "KennelConfirmation" c
      JOIN target t ON t.id = c."kennelId"
      WHERE c."revertedAt" IS NULL
      GROUP BY c."kennelId"
    ),
    evidence AS (
      SELECT
        t.id,
        GREATEST(pr."maxDate", ad."maxDate") AS "lastRunSeenAt",
        nr."minDate" AS "nextRunPostedAt",
        cf."lastConfirmed" AS "lastConfirmedAt",
        cf."lastStopped"
      FROM target t
      LEFT JOIN past_runs pr ON pr."kennelId" = t.id
      LEFT JOIN attended ad ON ad."kennelId" = t.id
      LEFT JOIN next_runs nr ON nr."kennelId" = t.id
      LEFT JOIN confirmations cf ON cf."kennelId" = t.id
    ),
    computed AS (
      SELECT
        ev.id,
        ev."lastRunSeenAt",
        ev."nextRunPostedAt",
        ev."lastConfirmedAt",
        CASE WHEN ev."lastStopped" >= COALESCE(GREATEST(ev."lastRunSeenAt", ev."lastConfirmedAt", ev."nextRunPostedAt"), ev."lastStopped") THEN ev."lastStopped" END AS "stoppedAt"
      FROM evidence ev
    )
    UPDATE "Kennel" k
    SET
      "lastRunSeenAt" = c."lastRunSeenAt",
      "nextRunPostedAt" = c."nextRunPostedAt",
      "lastConfirmedAt" = c."lastConfirmedAt",
      "stoppedAt" = c."stoppedAt",
      "updatedAt" = NOW() AT TIME ZONE 'UTC'
    FROM computed c
    WHERE k.id = c.id
      AND (
        k."lastRunSeenAt" IS DISTINCT FROM c."lastRunSeenAt"
        OR k."nextRunPostedAt" IS DISTINCT FROM c."nextRunPostedAt"
        OR k."lastConfirmedAt" IS DISTINCT FROM c."lastConfirmedAt"
        OR k."stoppedAt" IS DISTINCT FROM c."stoppedAt"
      )
  `);
}
