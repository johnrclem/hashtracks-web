/**
 * Data for the homepage "Coming up" section (server only: queries Prisma).
 * Selection rules live in `coming-up.ts`; this module fetches candidates.
 */

import type { Prisma } from "@/generated/prisma/client";
import { MAX_NEARBY_RADIUS_KM, pickNearby, pickWorld, type ComingUpCandidate } from "@/lib/coming-up";
import { prisma } from "@/lib/db";
import { DISPLAY_EVENT_WHERE } from "@/lib/event-filters";
import { boundingBoxForRadiusKm, getEventCoordsFromRegionData } from "@/lib/geo";
import type { VisitorArea } from "@/lib/visitor-area";

const DAY_MS = 86_400_000;
const COMING_UP_LIMIT = 6;
const NEARBY_WINDOW_DAYS = 7;
const WORLD_WINDOW_DAYS = 2;
// Generous caps: the candidate sets are filtered and sorted in memory.
const NEARBY_CANDIDATE_CAP = 300;
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

/** Where the run is: the event's own pin, else the kennel's, else its region's center. */
function toCandidate(row: ComingUpRow): ComingUpEvent {
  const coords =
    row.latitude != null && row.longitude != null
      ? { lat: row.latitude, lng: row.longitude }
      : getEventCoordsFromRegionData(row.kennel.latitude, row.kennel.longitude, row.kennel.regionRef);
  return {
    ...row,
    timezone: row.timezone ?? row.kennel.regionRef.timezone,
    latitude: coords?.lat ?? null,
    longitude: coords?.lng ?? null,
  };
}

/** Kennels whose own pin, or region center when they have none, is near the visitor. */
function nearbyKennelWhere(area: VisitorArea): Prisma.KennelWhereInput {
  const box = boundingBoxForRadiusKm(area.latitude, area.longitude, MAX_NEARBY_RADIUS_KM);
  const lat = { gte: box.minLat, lte: box.maxLat };
  const lng = { gte: box.minLng, lte: box.maxLng };
  return {
    OR: [
      { latitude: lat, longitude: lng },
      { OR: [{ latitude: null }, { longitude: null }], regionRef: { centroidLat: lat, centroidLng: lng } },
    ],
  };
}

async function findCandidates(
  from: Date,
  to: Date,
  take: number,
  kennel?: Prisma.KennelWhereInput,
): Promise<ComingUpEvent[]> {
  const rows = await prisma.event.findMany({
    where: {
      ...DISPLAY_EVENT_WHERE,
      date: { gte: from, lte: to },
      // AND keeps DISPLAY_EVENT_WHERE's hidden-kennel guard instead of replacing its `kennel` key.
      ...(kennel ? { AND: [{ kennel }] } : {}),
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
  const todayUtcNoon = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12));
  // A day of slack: west of UTC, "yesterday's" date can still be today locally.
  const from = addDays(todayUtcNoon, -1);

  if (area) {
    const candidates = await findCandidates(
      from,
      addDays(todayUtcNoon, NEARBY_WINDOW_DAYS),
      NEARBY_CANDIDATE_CAP,
      nearbyKennelWhere(area),
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
