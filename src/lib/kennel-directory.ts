/**
 * Shared helpers for the kennel directory surfaces (`/kennels` global +
 * `/kennels/region/[slug]`). Centralizes the "next event per kennel" map
 * building (which attributes each event to every kennel on it via the
 * EventKennel join — co-host events surface on co-host kennels' cards
 * per #1023 spec D8) and the per-kennel serialization the directory UI
 * consumes.
 */
import type { Prisma } from "@/generated/prisma/client";
import { HIDE_STOPPED_SCHEDULE_RUNS } from "@/lib/event-filters";
import { SCHEDULE_ONLY_LABEL } from "@/lib/event-display";
import {
  serializeKennelEvidence,
  type KennelEvidence,
  type SerializedKennelEvidence,
} from "@/lib/kennel-status";
import { getStateGroup } from "@/lib/region";

export interface NextEvent {
  date: Date;
  title: string | null;
  /** True when the run was generated from the kennel's usual schedule. */
  isScheduleOnly: boolean;
}

/**
 * Events that make a kennel "have an upcoming run": confirmed, canonical, on
 * or after today. Shared by the Kennel Directory's next-run query. A stopped
 * kennel's generated runs are excluded.
 */
export function upcomingConfirmedEventWhere(todayUtcNoon: Date) {
  return {
    date: { gte: todayUtcNoon },
    status: "CONFIRMED",
    isCanonical: true,
    ...HIDE_STOPPED_SCHEDULE_RUNS,
  } as const satisfies Prisma.EventWhereInput;
}

/** Footer label for a directory card's next run. */
export function nextRunLabel(next: { isScheduleOnly: boolean }): string {
  return next.isScheduleOnly ? `${SCHEDULE_ONLY_LABEL}: ` : "Next run: ";
}

/** Minimal shape this helper needs from a Prisma upcoming-event row. */
export interface UpcomingEventForNextMap {
  date: Date;
  title: string | null;
  isScheduleOnly: boolean;
  eventKennels: ReadonlyArray<{ kennelId: string }>;
}

/**
 * Build a `Map<kennelId, firstUpcomingEvent>` keyed by every kennel on
 * each event. Caller MUST sort `events` by date ascending — first match
 * per kennel wins.
 *
 * The events should already be filtered (e.g. via
 * `eventKennels.where: { kennel: { region, isHidden: false } }`) so we
 * don't attribute to kennels the directory wouldn't render anyway.
 */
export function buildNextEventMap(
  events: ReadonlyArray<UpcomingEventForNextMap>,
): Map<string, NextEvent> {
  const map = new Map<string, NextEvent>();
  for (const event of events) {
    for (const ek of event.eventKennels) {
      if (!map.has(ek.kennelId)) {
        map.set(ek.kennelId, { date: event.date, title: event.title, isScheduleOnly: event.isScheduleOnly });
      }
    }
  }
  return map;
}

/** Minimal shape this helper needs from a Prisma kennel row. */
export interface KennelForDirectorySerialize extends KennelEvidence {
  id: string;
  region: string;
}

/**
 * Serialize a kennel for the directory client component: adds
 * `stateGroup`, `nextEvent` (from the map built above) and `evidence`
 * (ISO strings). Spreads the input so every other field passes through.
 */
export function serializeKennelWithNext<K extends KennelForDirectorySerialize>(
  kennel: K,
  nextEventMap: Map<string, NextEvent>,
): Omit<K, keyof KennelEvidence> & {
  stateGroup: string;
  nextEvent: { date: string; title: string | null; isScheduleOnly: boolean } | null;
  evidence: SerializedKennelEvidence;
} {
  const { lastRunSeenAt, nextRunPostedAt, lastConfirmedAt, stoppedAt, ...rest } = kennel;
  const next = nextEventMap.get(kennel.id);
  return {
    ...rest,
    stateGroup: getStateGroup(kennel.region),
    nextEvent: next
      ? { date: next.date.toISOString(), title: next.title, isScheduleOnly: next.isScheduleOnly }
      : null,
    evidence: serializeKennelEvidence({ lastRunSeenAt, nextRunPostedAt, lastConfirmedAt, stoppedAt }),
  };
}
