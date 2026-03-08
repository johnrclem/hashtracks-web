/** Check whether a kennel is missing geocoordinates. */
export const isMissingCoords = (k: { latitude: number | null; longitude: number | null }) =>
  k.latitude == null || k.longitude == null;
