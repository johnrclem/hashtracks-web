/**
 * Serialize an `executeTravelSearch` result set for the RSC→client
 * boundary. Dates become ISO strings; confirmed rows get their
 * attendance record merged in.
 *
 * Two modes:
 *   - `mergeBroader: true` — multi-stop. Every stop's broader-pass rows
 *     append to the flat confirmed/likely/possible arrays. No top-level
 *     `broaderResults` key (each row already carries its destinationIndex).
 *   - `mergeBroader: false` — single-stop. Flat arrays hold primary only;
 *     `broaderResults` carries destinations[0]'s broader so the existing
 *     `selectResultsToRender` swap on `no_nearby` works unchanged.
 */

import type { executeTravelSearch, NearestConfirmed } from "./search";

type SearchResults = Awaited<ReturnType<typeof executeTravelSearch>>;
type ConfirmedRow = SearchResults["confirmed"][number];
type LikelyRow = SearchResults["likely"][number];
type PossibleRow = SearchResults["possible"][number];

export type AttendanceEntry = { status: string; participationLevel: string };
export type AttendanceMap = Record<string, AttendanceEntry>;

export interface SerializedDestination {
  index: number;
  label: string | null;
  startDate: string;
  endDate: string;
  radiusKm: number;
  broaderRadiusKm?: number;
}

export interface SerializedConfirmed extends Omit<ConfirmedRow, "date"> {
  date: string;
  attendance: AttendanceEntry | null;
}

export interface SerializedLikely extends Omit<LikelyRow, "date" | "checkedRunningAt"> {
  date: string;
  checkedRunningAt: string | null;
}

export interface SerializedPossible
  extends Omit<PossibleRow, "date" | "lastConfirmedAt"> {
  date: string | null;
  lastConfirmedAt: string | null;
}

export interface SerializedTravelResults {
  emptyState: SearchResults["emptyState"];
  meta: SearchResults["meta"];
  destinations: SerializedDestination[];
  confirmed: SerializedConfirmed[];
  likely: SerializedLikely[];
  possible: SerializedPossible[];
  broaderResults?: {
    confirmed: SerializedConfirmed[];
    likely: SerializedLikely[];
    possible: SerializedPossible[];
  };
  /** Single-stop only (the search computes it only then): nearest confirmed runs outside the radius. */
  nearestConfirmed?: NearestConfirmed<SerializedConfirmed>;
}

function serializeConfirmed(
  r: ConfirmedRow,
  attendanceMap: AttendanceMap,
): SerializedConfirmed {
  return {
    ...r,
    date: r.date.toISOString(),
    attendance: attendanceMap[r.eventId] ?? null,
  };
}

function serializeLikely(r: LikelyRow): SerializedLikely {
  return {
    ...r,
    date: r.date.toISOString(),
    checkedRunningAt: r.checkedRunningAt?.toISOString() ?? null,
  };
}

function serializePossible(r: PossibleRow): SerializedPossible {
  return {
    ...r,
    date: r.date?.toISOString() ?? null,
    lastConfirmedAt: r.lastConfirmedAt?.toISOString() ?? null,
  };
}

function serializeDestinations(
  destinations: SearchResults["destinations"],
): SerializedDestination[] {
  return destinations.map((d) => ({
    index: d.index,
    label: d.label,
    startDate: d.startDate.toISOString(),
    endDate: d.endDate.toISOString(),
    radiusKm: d.radiusKm,
    broaderRadiusKm: d.broaderRadiusKm,
  }));
}

export function serializeTravelResults(
  results: SearchResults,
  attendanceMap: AttendanceMap,
  { mergeBroader }: { mergeBroader: boolean },
): SerializedTravelResults {
  if (mergeBroader) {
    // Multi-stop: flatten all stops' broader rows into the primary arrays.
    const allBroaderConfirmed = results.destinations.flatMap(
      (d) => d.broaderResults?.confirmed ?? [],
    );
    const allBroaderLikely = results.destinations.flatMap(
      (d) => d.broaderResults?.likely ?? [],
    );
    const allBroaderPossible = results.destinations.flatMap(
      (d) => d.broaderResults?.possible ?? [],
    );
    return {
      emptyState: results.emptyState,
      meta: results.meta,
      destinations: serializeDestinations(results.destinations),
      confirmed: [...results.confirmed, ...allBroaderConfirmed].map((r) =>
        serializeConfirmed(r, attendanceMap),
      ),
      likely: [...results.likely, ...allBroaderLikely].map(serializeLikely),
      possible: [...results.possible, ...allBroaderPossible].map(serializePossible),
    };
  }

  // Single-stop: primary-only flat arrays; destination[0]'s broader goes
  // into its own `broaderResults` key so the selectResultsToRender swap
  // on `no_nearby` keeps working as it does on main today.
  const stopBroader = results.destinations[0]?.broaderResults;
  const stopNearest = results.destinations[0]?.nearestConfirmed;
  return {
    emptyState: results.emptyState,
    meta: results.meta,
    destinations: serializeDestinations(results.destinations),
    confirmed: results.confirmed.map((r) => serializeConfirmed(r, attendanceMap)),
    likely: results.likely.map(serializeLikely),
    possible: results.possible.map(serializePossible),
    broaderResults: stopBroader
      ? {
          confirmed: stopBroader.confirmed.map((r) =>
            serializeConfirmed(r, attendanceMap),
          ),
          likely: stopBroader.likely.map(serializeLikely),
          possible: stopBroader.possible.map(serializePossible),
        }
      : undefined,
    nearestConfirmed: stopNearest
      ? {
          radiusKm: stopNearest.radiusKm,
          confirmed: stopNearest.confirmed.map((r) => serializeConfirmed(r, attendanceMap)),
        }
      : undefined,
  };
}
