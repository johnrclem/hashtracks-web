/**
 * Compact static map image for event detail pages.
 * Uses Google Maps Static API — renders as a plain <img>, no JS required.
 * Works in both server and client components.
 * Accepts precise lat/lng OR a text address (locationName) as fallback.
 */
interface EventLocationMapProps {
  lat?: number | null;
  lng?: number | null;
  locationName?: string | null;
  /** If provided, clicking the map links here; otherwise falls back to a coords-based or text-search Maps link. */
  locationAddress?: string | null;
}

export function EventLocationMap({
  lat,
  lng,
  locationName,
  locationAddress,
}: EventLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; // NOSONAR - NEXT_PUBLIC keys are intentionally browser-exposed
  if (!apiKey) return null;

  const hasCoords = lat != null && lng != null;
  const center = hasCoords
    ? `${lat},${lng}`
    : locationName
      ? encodeURIComponent(locationName)
      : null;

  if (!center) return null;

  const src =
    `https://maps.googleapis.com/maps/api/staticmap` +
    `?center=${center}&zoom=15&size=600x300&scale=2` +
    `&markers=color:red%7C${center}&key=${apiKey}`; // NOSONAR - Maps Static API requires key in URL; key is browser-public by design

  const mapsUrl =
    locationAddress && /^https?:\/\//.test(locationAddress)
      ? locationAddress
      : hasCoords
        ? `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`
        : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(locationName ?? "")}`;

  return (
    <a
      href={mapsUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="mt-2 block overflow-hidden rounded-md border"
      title="Open in Google Maps"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={locationName ? `Map showing ${locationName}` : "Event location map"}
        loading="lazy"
        className="h-48 w-full object-cover"
      />
    </a>
  );
}
