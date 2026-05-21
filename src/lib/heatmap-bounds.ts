export interface LatLng {
  lat: number;
  lng: number;
}

export interface MapBounds {
  south: number;
  north: number;
  west: number;
  east: number;
}

const DEFAULT_PADDING = 0.015;
const IQR_MIN_SAMPLES = 8;
const IQR_FENCE = 1.5;

/**
 * Compute a padded bounding box around a set of points, filtering geocoding
 * outliers via Tukey fences (1.5×IQR) when we have at least 8 samples — so a
 * single bad geocode doesn't zoom the map out to show the entire globe.
 *
 * Returns `undefined` for an empty input so callers can branch on it.
 */
export function computeHeatmapBounds(
  locations: readonly LatLng[],
  padding: number = DEFAULT_PADDING,
): MapBounds | undefined {
  // Sanitize `padding` — it's a public parameter, and negative or non-finite
  // values would produce inverted (`south > north`) or `NaN` bounds that
  // Google Maps refuses to fit. Fall back to `DEFAULT_PADDING` for both.
  const safePadding =
    Number.isFinite(padding) && padding >= 0 ? padding : DEFAULT_PADDING;

  // Drop any NaN / ±Infinity coordinates upfront — bad geocoding output
  // (rare but possible) would otherwise propagate through sort + min/max
  // and produce a `NaN` bounding box, which Google Maps then refuses to
  // fit to. Filter first, then short-circuit if nothing usable remains.
  const finite = locations.filter(
    (l) => Number.isFinite(l.lat) && Number.isFinite(l.lng),
  );
  if (finite.length === 0) return undefined;

  let pts: readonly LatLng[] = finite;
  if (finite.length >= IQR_MIN_SAMPLES) {
    const lats = finite.map((l) => l.lat).sort((a, b) => a - b);
    const lngs = finite.map((l) => l.lng).sort((a, b) => a - b);
    const q1 = (arr: number[]) => arr[Math.floor(arr.length * 0.25)];
    const q3 = (arr: number[]) => arr[Math.floor(arr.length * 0.75)];

    const latQ1 = q1(lats);
    const latQ3 = q3(lats);
    const lngQ1 = q1(lngs);
    const lngQ3 = q3(lngs);
    const latIqr = latQ3 - latQ1;
    const lngIqr = lngQ3 - lngQ1;

    const inliers = finite.filter(
      (l) =>
        l.lat >= latQ1 - IQR_FENCE * latIqr &&
        l.lat <= latQ3 + IQR_FENCE * latIqr &&
        l.lng >= lngQ1 - IQR_FENCE * lngIqr &&
        l.lng <= lngQ3 + IQR_FENCE * lngIqr,
    );
    if (inliers.length > 0) pts = inliers;
  }

  let south = pts[0].lat;
  let north = pts[0].lat;
  let west = pts[0].lng;
  let east = pts[0].lng;
  for (const loc of pts) {
    if (loc.lat < south) south = loc.lat;
    if (loc.lat > north) north = loc.lat;
    if (loc.lng < west) west = loc.lng;
    if (loc.lng > east) east = loc.lng;
  }
  return {
    south: south - safePadding,
    north: north + safePadding,
    west: west - safePadding,
    east: east + safePadding,
  };
}
