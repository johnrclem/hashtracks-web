import { snapRadiusToTier } from "@/lib/travel/limits";
import { DEFAULT_SEARCH_RADIUS_KM, isValidDateRange } from "@/lib/travel/url";
import type { InitialLegValues, LegState } from "./types";

export function makeEmptyLeg(id: string): LegState {
  return {
    id,
    destination: "",
    latitude: 0,
    longitude: 0,
    timezone: "",
    startDate: "",
    endDate: "",
    radiusKm: DEFAULT_SEARCH_RADIUS_KM,
    coordsResolved: false,
  };
}

export function makeLegFromInitial(
  id: string,
  initial: InitialLegValues | undefined,
): LegState {
  if (!initial) return makeEmptyLeg(id);
  return {
    id,
    destination: initial.destination,
    latitude: initial.latitude,
    longitude: initial.longitude,
    timezone: initial.timezone ?? "",
    startDate: initial.startDate,
    endDate: initial.endDate,
    radiusKm: snapRadiusToTier(initial.radiusKm),
    // Types mark latitude/longitude as required numbers; any LegState we
    // build from initialValues is coord-resolved by construction.
    coordsResolved: true,
    placeId: initial.placeId,
  };
}

/** Convert a LegState into the SaveDestinationParams shape the
 *  server action accepts. */
export function legToDestParams(leg: LegState) {
  return {
    label: leg.destination,
    latitude: leg.latitude,
    longitude: leg.longitude,
    radiusKm: leg.radiusKm,
    startDate: leg.startDate,
    endDate: leg.endDate,
    timezone: leg.timezone || undefined,
    placeId: leg.placeId,
  };
}

export function legDatesValid(leg: LegState): boolean {
  return isValidDateRange(leg.startDate, leg.endDate);
}

export function legReadyToSubmit(leg: LegState): boolean {
  return Boolean(leg.destination && leg.coordsResolved && legDatesValid(leg));
}
