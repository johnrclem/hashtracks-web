/**
 * Shared helpers for the kennel directory surfaces (`/kennels` global +
 * `/kennels/region/[slug]`). Centralizes the "next event per kennel" map
 * building (which attributes each event to every kennel on it via the
 * EventKennel join — co-host events surface on co-host kennels' cards
 * per #1023 spec D8) and the per-kennel serialization the directory UI
 * consumes.
 */
import { getStateGroup } from "@/lib/region";

export interface NextEvent {
  date: Date;
  title: string | null;
}

/** Minimal shape this helper needs from a Prisma upcoming-event row. */
export interface UpcomingEventForNextMap {
  date: Date;
  title: string | null;
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
        map.set(ek.kennelId, { date: event.date, title: event.title });
      }
    }
  }
  return map;
}

/** Minimal shape this helper needs from a Prisma kennel row. */
export interface KennelForDirectorySerialize {
  id: string;
  region: string;
  lastEventDate: Date | null;
}

/**
 * Serialize a kennel for the directory client component: adds
 * `stateGroup`, `nextEvent` (from the map built above), and converts
 * `lastEventDate` to an ISO string. Spreads the input so every other
 * field on the kennel passes through.
 */
export function serializeKennelWithNext<K extends KennelForDirectorySerialize>(
  kennel: K,
  nextEventMap: Map<string, NextEvent>,
): Omit<K, "lastEventDate"> & {
  stateGroup: string;
  nextEvent: { date: string; title: string | null } | null;
  lastEventDate: string | null;
} {
  const next = nextEventMap.get(kennel.id);
  return {
    ...kennel,
    stateGroup: getStateGroup(kennel.region),
    nextEvent: next ? { date: next.date.toISOString(), title: next.title } : null,
    lastEventDate: kennel.lastEventDate ? kennel.lastEventDate.toISOString() : null,
  };
}
