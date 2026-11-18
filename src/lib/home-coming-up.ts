/**
 * Data for the homepage "Coming up" section (server only: queries Prisma).
 * Selection rules live in `coming-up.ts`; this module fetches candidates.
 */

import type { Prisma } from "@/generated/prisma/client";
import { MAX_NEARBY_RADIUS_KM, pickNearby, pickWorld, type ComingUpCandidate } from "@/lib/coming-up";
import { getTodayUtcNoon } from "@/lib/date";
import { prisma } from "@/lib/db";
import { DISPLAY_EVENT_WHERE } from "@/lib/event-filters";
import { boundingBoxForRadiusKm, getEventCoordsFromRegionData } from "@/lib/geo";
import { composeUtcStart } from "@/lib/timezone";
import type { VisitorArea } from "@/lib/visitor-area";

const DAY_MS = 86_400_000;
const COMING_UP_LIMIT = 6;
/** "Your week" and "Coming up near you" both look a week ahead. */
const WEEK_DAYS = 7;
const WORLD_WINDOW_DAYS = 2;
// Generous caps: the candidate sets are filtered and sorted in memory.
const WEEK_CANDIDATE_CAP = 300;
const WORLD_CANDIDATE_CAP = 400;

const COMING_UP_SELECT = {
  id: true,
  date: true,
  dateUtc: true,
  timezone: true,
  latitude: true,
  longitude: true,
  runNumber: true,
  title: true,
  haresText: true,
  startTime: true,
  locationName: true,
  locationCity: true,
  // Generated from a usual schedule: the card shows a small "Usual schedule" tag.
  isScheduleOnly: true,
  kennel: {
    select: {
      shortName: true,
      fullName: true,
      region: true,
      latitude: true,
      longitude: true,
      regionRef: { select: { timezone: true, centroidLat: true, centroidLng: true } },
    },
  },
} satisfies Prisma.EventSelect;

type ComingUpRow = Prisma.EventGetPayload<{ select: typeof COMING_UP_SELECT }>;
export type ComingUpEvent = ComingUpRow & ComingUpCandidate;

export interface ComingUp {
  events: ComingUpEvent[];
  heading: string;
  subheading: string;
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS);
}

/**
 * The candidate date range from today's UTC noon to `days` ahead. It starts a
 * day back: west of UTC, "yesterday's" date can still be today locally.
 */
function dateWindow(now: Date, days: number): { from: Date; to: Date } {
  const todayUtcNoon = new Date(getTodayUtcNoon(now));
  return { from: addDays(todayUtcNoon, -1), to: addDays(todayUtcNoon, days) };
}

/** Where the run is: the event's own pin, else the kennel's, else its region's center. */
function toCandidate(row: ComingUpRow): ComingUpEvent {
  const coords =
    row.latitude != null && row.longitude != null
      ? { lat: row.latitude, lng: row.longitude }
      : getEventCoordsFromRegionData(row.kennel.latitude, row.kennel.longitude, row.kennel.regionRef);
  const timezone = row.timezone ?? row.kennel.regionRef.timezone;
  return {
    ...row,
    timezone,
    // Rebuild the start from the shown start time: a rescrape that drops the
    // time can leave the old startTime but reset dateUtc to UTC noon.
    dateUtc: composeUtcStart(row.date, row.startTime, timezone) ?? row.dateUtc,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  };
}

/**
 * Runs whose own pin is near the visitor, or whose kennel's pin (else its
 * region center) is. Exact distances are checked afterwards in pickNearby.
 */
function nearbyEventWhere(area: VisitorArea): Prisma.EventWhereInput {
  const box = boundingBoxForRadiusKm(area.latitude, area.longitude, MAX_NEARBY_RADIUS_KM);
  const lat = { gte: box.minLat, lte: box.maxLat };
  const lng = { gte: box.minLng, lte: box.maxLng };
  return {
    OR: [
      { latitude: lat, longitude: lng },
      {
        kennel: {
          OR: [
            { latitude: lat, longitude: lng },
            { OR: [{ latitude: null }, { longitude: null }], regionRef: { centroidLat: lat, centroidLng: lng } },
          ],
        },
      },
    ],
  };
}

async function findCandidates(
  from: Date,
  to: Date,
  take: number,
  /** Extra filter: runs near the visitor, or from given kennels. */
  scope?: Prisma.EventWhereInput,
): Promise<ComingUpEvent[]> {
  const rows = await prisma.event.findMany({
    where: {
      ...DISPLAY_EVENT_WHERE,
      date: { gte: from, lte: to },
      // AND keeps DISPLAY_EVENT_WHERE's hidden-kennel guard intact.
      ...(scope ? { AND: [scope] } : {}),
    },
    select: COMING_UP_SELECT,
    orderBy: [{ date: "asc" }, { id: "asc" }],
    take,
  });
  return rows.map(toCandidate);
}

/**
 * Runs for the "Coming up" section: near the visitor when Vercel's location
 * guess finds runs within range, otherwise the next runs anywhere.
 */
export async function getComingUp(area: VisitorArea | null, now: Date = new Date()): Promise<ComingUp> {
  if (area) {
    const week = dateWindow(now, WEEK_DAYS);
    const candidates = await findCandidates(week.from, week.to, WEEK_CANDIDATE_CAP, nearbyEventWhere(area));
    const nearby = pickNearby(candidates, area, now, COMING_UP_LIMIT);
    if (nearby) {
      return {
        events: nearby.events,
        heading: `Coming up near ${area.city ?? "you"}`,
        subheading: `Runs within ${nearby.radiusKm} km in the next ${WEEK_DAYS} days`,
      };
    }
  }

  const world = dateWindow(now, WORLD_WINDOW_DAYS);
  const candidates = await findCandidates(world.from, world.to, WORLD_CANDIDATE_CAP);
  return {
    events: pickWorld(candidates, now, COMING_UP_LIMIT),
    heading: "Coming up around the world",
    subheading: "The next runs anywhere, in each kennel's local time",
  };
}

/**
 * "Your week" for a signed-in hasher: the next runs from the kennels they
 * follow (as host or co-host) over the next seven days, in one query. Null
 * when none of their kennels has a run coming up (or they follow none).
 */
export async function getYourWeek(clerkId: string, now: Date = new Date()): Promise<ComingUp | null> {
  const week = dateWindow(now, WEEK_DAYS);
  const candidates = await findCandidates(week.from, week.to, WEEK_CANDIDATE_CAP, {
    eventKennels: { some: { kennel: { members: { some: { user: { clerkId } } } } } },
  });
  const events = pickWorld(candidates, now, COMING_UP_LIMIT);
  if (events.length === 0) return null;
  return {
    events,
    heading: "Your week",
    subheading: `Runs from the kennels you follow in the next ${WEEK_DAYS} days`,
  };
}

/**
 * The homepage's "Coming up" section: "Your week" for a signed-in hasher whose
 * kennels have runs on, otherwise runs near the visitor (or anywhere).
 */
export async function getHomeComingUp(
  clerkId: string | null,
  area: VisitorArea | null,
  now: Date = new Date(),
): Promise<ComingUp> {
  const yourWeek = clerkId ? await getYourWeek(clerkId, now) : null;
  return yourWeek ?? getComingUp(area, now);
}
