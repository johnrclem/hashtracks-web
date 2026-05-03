import { RADIUS_TIERS } from "@/lib/travel/limits";

export interface InitialLegValues {
  destination: string;
  latitude: number;
  longitude: number;
  startDate: string;
  endDate: string;
  radiusKm: number;
  timezone?: string;
  /** Google Places ID if the destination was picked from autocomplete.
   *  Round-tripped through the URL (`pid` param) so saved-trip lookups
   *  can match on placeId even when re-rendered from a stateless URL —
   *  geocoder fallback and autocomplete return coords that drift
   *  ~0.0001° apart for the same place. */
  placeId?: string;
}

export interface TravelSearchFormProps {
  variant: "hero" | "compact";
  initialValues?: InitialLegValues;
  /** Position-ordered legs for hydrating a saved multi-stop trip. When
   *  provided, overrides `initialValues` and seeds one LegState per
   *  entry. Omit for the single-leg (or blank) default path. */
  initialLegs?: InitialLegValues[];
  /** When set, the form is editing an existing saved trip: submit
   *  updates that row in place via `updateTravelSearch` instead of
   *  creating a new draft + navigating away. Adding/removing legs
   *  during an edit session still updates the same row. */
  savedTripId?: string;
  /** Multi-leg adds require auth (drafts persist server-side). When
   *  `false`, the ghost-leg row renders as a sign-in gate instead of
   *  expanding. Single-leg flow stays anonymous. */
  isAuthenticated?: boolean;
}

export interface LegState {
  id: string;
  destination: string;
  latitude: number;
  longitude: number;
  timezone: string;
  startDate: string;
  endDate: string;
  radiusKm: number;
  /** DestinationInput reported resolved coords — (0, 0) is a valid equatorial destination so this is not just `latitude !== 0`. */
  coordsResolved: boolean;
  /** Optional Google Places ID. Set when the destination was picked from
   *  autocomplete; absent on the geocode-fallback path. Threaded into
   *  the URL as `pid` so SSR saved-trip lookup can prefer placeId
   *  identity over coord equality. */
  placeId?: string;
}

export type BoardingStampVariant = "leg" | "ghost" | "required";

export const RADIUS_META: Record<
  (typeof RADIUS_TIERS)[number],
  { label: string; description: string }
> = {
  10: { label: "Close", description: "~6 mi" },
  25: { label: "Metro", description: "~15 mi" },
  50: { label: "Region", description: "~30 mi" },
  100: { label: "Far", description: "~60 mi" },
};

export const RADIUS_OPTIONS = RADIUS_TIERS.map((value) => ({
  value,
  ...RADIUS_META[value],
}));
