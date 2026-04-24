"use server";

/**
 * Hareline server actions.
 *
 * - loadEventsForTimeMode: slim event list for a time mode. Called from
 *   both the initial server render (page.tsx) and lazy client tab-switches
 *   (HarelineView), so the two paths always use the same date boundaries,
 *   ordering, and serialization.
 * - getEventDetail: heavy fields (description, source URL, full address,
 *   eventLinks) fetched on detail-panel expand. Keeps the list payload slim.
 */

import { prisma } from "@/lib/db";
import { DISPLAY_EVENT_WHERE } from "@/lib/event-filters";

/** Matches the slim shape rendered by EventCard's list view. */
export interface HarelineListEvent {
  id: string;
  date: string; // ISO string
  dateUtc: Date | null;
  timezone: string | null;
  kennelId: string;
  kennel: {
    id: string;
    shortName: string;
    fullName: string;
    slug: string;
    region: string;
    country: string;
  } | null;
  runNumber: number | null;
  title: string | null;
  haresText: string | null;
  startTime: string | null;
  locationName: string | null;
  locationCity: string | null;
  status: string;
  latitude: number | null;
  longitude: number | null;
}

export type TimeMode = "upcoming" | "past";

/**
 * Past events are capped server-side to keep the payload bounded — 200 is
 * enough to fill several scroll pages while staying under ~400 KB wire.
 */
const PAST_EVENTS_LIMIT = 200;

/**
 * Fetch the slim event list for a time mode.
 *
 * Events are stored at UTC noon, so `>= yesterday 00:00 UTC` covers every
 * timezone's "today" (an SF user at 16:00 viewing a noon-UTC run that hasn't
 * happened locally yet) while `< today 00:00 UTC` covers "yesterday and
 * earlier" from every timezone's perspective.
 *
 * `nowMs` lets the initial-render path in `page.tsx` share a single clock
 * with the `serverNowMs` prop passed to the client — otherwise an HTTP
 * request that straddles UTC midnight could have the server compute its
 * boundary off one day and the client hydrate off the next. Omit for the
 * lazy client-driven tab switch, which recomputes fresh boundaries each
 * call.
 */
export async function loadEventsForTimeMode(
  mode: TimeMode,
  nowMs?: number,
): Promise<HarelineListEvent[]> {
  const now = new Date(nowMs ?? Date.now());
  const startOfTodayUtc = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const yesterdayUtc = new Date(startOfTodayUtc.getTime() - 24 * 60 * 60 * 1000);
  const isPast = mode === "past";

  const events = await prisma.event.findMany({
    where: {
      ...DISPLAY_EVENT_WHERE,
      date: isPast ? { lt: startOfTodayUtc } : { gte: yesterdayUtc },
    },
    include: {
      kennel: {
        select: { id: true, shortName: true, fullName: true, slug: true, region: true, country: true },
      },
    },
    orderBy: { date: isPast ? "desc" : "asc" },
    ...(isPast ? { take: PAST_EVENTS_LIMIT } : {}),
  });

  return events.map((e) => ({
    id: e.id,
    date: e.date.toISOString(),
    dateUtc: e.dateUtc,
    timezone: e.timezone,
    kennelId: e.kennelId,
    kennel: e.kennel,
    runNumber: e.runNumber,
    title: e.title,
    haresText: e.haresText,
    startTime: e.startTime,
    locationName: e.locationName,
    locationCity: e.locationCity,
    status: e.status,
    latitude: e.latitude ?? null,
    longitude: e.longitude ?? null,
  }));
}

export interface EventDetailFields {
  description: string | null;
  sourceUrl: string | null;
  locationStreet: string | null;
  locationAddress: string | null;
  eventLinks: { id: string; url: string; label: string }[];
}

/**
 * Fetch heavy fields for a single event on detail-panel expand. Returns
 * `null` if the event doesn't exist or isn't visible (same
 * DISPLAY_EVENT_WHERE predicate used everywhere else).
 */
export async function getEventDetail(eventId: string): Promise<EventDetailFields | null> {
  if (!eventId) return null;
  return prisma.event.findFirst({
    where: { id: eventId, ...DISPLAY_EVENT_WHERE },
    select: {
      description: true,
      sourceUrl: true,
      locationStreet: true,
      locationAddress: true,
      eventLinks: { select: { id: true, url: true, label: true } },
    },
  });
}
