/**
 * Data for the homepage "Coming up" section (server only: queries Prisma).
 * Selection rules live in `coming-up.ts`; this module fetches candidates.
 */

import type { Prisma } from "@/generated/prisma/client";
import { MAX_NEARBY_RADIUS_KM, pickNearby, pickWorld, type ComingUpCandidate } from "@/lib/coming-up";
import { prisma } from "@/lib/db";
import { DISPLAY_EVENT_WHERE } from "@/lib/event-filters";
import { boundingBoxForRadiusKm, getEventCoordsFromRegionData } from "@/lib/geo";
import { composeUtcStart } from "@/lib/timezone";
import type { VisitorArea } from "@/lib/visitor-area";

const DAY_MS = 86_400_000;
const COMING_UP_LIMIT = 6;
const NEARBY_WINDOW_DAYS = 7;
const YOUR_WEEK_WINDOW_DAYS = 7;
const WORLD_WINDOW_DAYS = 2;
// Generous caps: the candidate sets are filtered and sorted in memory.
const NEARBY_CANDIDATE_CAP = 300;
const YOUR_WEEK_CANDIDATE_CAP = 300;
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

function utcNoonOf(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
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
  const todayUtcNoon = utcNoonOf(now);
  // A day of slack: west of UTC, "yesterday's" date can still be today locally.
  const from = addDays(todayUtcNoon, -1);

  if (area) {
    const candidates = await findCandidates(
      from,
      addDays(todayUtcNoon, NEARBY_WINDOW_DAYS),
      NEARBY_CANDIDATE_CAP,
      nearbyEventWhere(area),
    );
    const nearby = pickNearby(candidates, area, now, COMING_UP_LIMIT);
    if (nearby) {
      return {
        events: nearby.events,
        heading: `Coming up near ${area.city ?? "you"}`,
        subheading: `Runs within ${nearby.radiusKm} km in the next ${NEARBY_WINDOW_DAYS} days`,
      };
    }
  }

  const candidates = await findCandidates(from, addDays(todayUtcNoon, WORLD_WINDOW_DAYS), WORLD_CANDIDATE_CAP);
  return {
    events: pickWorld(candidates, now, COMING_UP_LIMIT),
    heading: "Coming up around the world",
    subheading: "The next runs anywhere, in each kennel's local time",
  };
}

/**
 * "Your week" for a signed-in hasher: the next runs from the kennels they
 * follow (as host or co-host) over the next seven days. Null when they follow
 * no kennels or none of them has a run coming up, so the caller can fall back
 * to `getComingUp`.
 */
export async function getYourWeek(kennelIds: string[], now: Date = new Date()): Promise<ComingUp | null> {
  if (kennelIds.length === 0) return null;
  const todayUtcNoon = utcNoonOf(now);
  const candidates = await findCandidates(
    addDays(todayUtcNoon, -1),
    addDays(todayUtcNoon, YOUR_WEEK_WINDOW_DAYS),
    YOUR_WEEK_CANDIDATE_CAP,
    { eventKennels: { some: { kennelId: { in: kennelIds } } } },
  );
  const events = pickWorld(candidates, now, COMING_UP_LIMIT);
  if (events.length === 0) return null;
  return {
    events,
    heading: "Your week",
    subheading: `Runs from the kennels you follow in the next ${YOUR_WEEK_WINDOW_DAYS} days`,
  };
}
