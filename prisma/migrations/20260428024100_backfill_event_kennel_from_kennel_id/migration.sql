-- Backfill one EventKennel row per existing Event with isPrimary=true.
-- ON CONFLICT DO UPDATE corrects the case where an EventKennel(eventId, kennelId)
-- row was pre-created with isPrimary=false (e.g. by a dual-write codepath
-- racing this backfill) — without this, the event would end up with zero
-- primaries while a naive count check still passes. See
-- docs/multi-kennel-events-spec.md §5 D17.
INSERT INTO "EventKennel" ("eventId", "kennelId", "isPrimary")
SELECT "id", "kennelId", true
FROM "Event"
ON CONFLICT ("eventId", "kennelId") DO UPDATE
  SET "isPrimary" = true;

-- Single-primary invariant. Prisma cannot express partial unique indexes in
-- schema.prisma, so it is hand-written here. Without this, a race between
-- two writers (pipeline create vs manual logbook create vs admin kennel
-- merge) could produce zero or multiple primaries — application-side
-- discipline is insufficient given multiple concurrent writers. See
-- docs/multi-kennel-events-spec.md §1 D13.
CREATE UNIQUE INDEX "EventKennel_eventId_isPrimary_unique"
  ON "EventKennel" ("eventId")
  WHERE "isPrimary" = true;
