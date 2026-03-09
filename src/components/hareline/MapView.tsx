"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { APIProvider, Map, MapControl, ControlPosition, useMap } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { LocateFixed, X } from "lucide-react";
import { getEventCoords, getRegionColor } from "@/lib/geo";
import { ClusteredMarkers, type EventWithCoords } from "./ClusteredMarkers";
import type { HarelineEvent } from "./EventCard";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";

/** Shared base styles for legend circle icons. */
const LEGEND_ICON_BASE: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  opacity: 0.5,
};

/** Reset view button — fits map back to the initial bounds. */
function ResetViewControl({ bounds }: { bounds: { south: number; north: number; west: number; east: number } }) {
  const map = useMap();
  return (
    <MapControl position={ControlPosition.TOP_RIGHT}>
      <div className="m-2.5">
        <Button
          variant="outline"
          size="sm"
          className="bg-background shadow-sm"
          onClick={() => map?.fitBounds(bounds)}
          aria-label="Reset map to show all events"
        >
          <LocateFixed className="mr-1.5 h-3.5 w-3.5" />
          Reset view
        </Button>
      </div>
    </MapControl>
  );
}

/** First-time precision banner — dismissible, persisted via localStorage. */
function PrecisionBanner() {
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash
  useEffect(() => {
    setDismissed(localStorage.getItem("map-precision-dismissed") === "true");
  }, []);

  if (dismissed) return null;

  return (
    <MapControl position={ControlPosition.TOP_CENTER}>
      <div className="mx-2 mt-2.5 flex items-center gap-2 rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <span>Filled pins = exact locations · Hollow pins = approximate region centers</span>
        <button
          onClick={() => {
            setDismissed(true);
            localStorage.setItem("map-precision-dismissed", "true");
          }}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss precision info"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </MapControl>
  );
}

/** Auto-zoom when the events list changes (e.g. filter applied). */
function AutoZoom({ bounds }: { bounds: { south: number; north: number; west: number; east: number } | undefined }) {
  const map = useMap();
  const prevBoundsKeyRef = useRef("");
  const boundsKey = bounds ? `${bounds.south},${bounds.north},${bounds.west},${bounds.east}` : "";

  useEffect(() => {
    if (bounds && boundsKey !== prevBoundsKeyRef.current) {
      prevBoundsKeyRef.current = boundsKey;
      map?.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
    }
  }, [map, bounds, boundsKey]);

  return null;
}

/** Props for the interactive MapView — renders hareline events as region-colored map pins. */
interface MapViewProps {
  readonly events: HarelineEvent[];
  /** Currently selected event ID (for highlighting its pin). */
  readonly selectedEventId?: string | null;
  /** Callback when a map pin is clicked. */
  readonly onSelectEvent: (event: HarelineEvent | null) => void;
}

export default function MapView({ events, selectedEventId, onSelectEvent }: MapViewProps) {
  const router = useRouter();
  const handleNavigate = useCallback((id: string) => router.push(`/hareline/${id}`), [router]);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; // NOSONAR - NEXT_PUBLIC keys are intentionally browser-exposed

  const eventsWithCoords = useMemo<EventWithCoords[]>(() => {
    return events.flatMap((event) => {
      const coords = getEventCoords(event.latitude, event.longitude, event.kennel.region);
      if (!coords) return [];
      return [
        {
          event,
          lat: coords.lat,
          lng: coords.lng,
          precise: coords.precise,
          color: getRegionColor(event.kennel.region),
        },
      ];
    });
  }, [events]);

  // Compute bounding box for all events to auto-fit the map (iterative to avoid spread stack limit)
  const defaultBounds = useMemo(() => {
    if (eventsWithCoords.length === 0) return undefined;
    const pad = 1.0;
    const first = eventsWithCoords[0];
    let south = first.lat, north = first.lat, west = first.lng, east = first.lng;
    for (const e of eventsWithCoords) {
      if (e.lat < south) south = e.lat;
      if (e.lat > north) north = e.lat;
      if (e.lng < west) west = e.lng;
      if (e.lng > east) east = e.lng;
    }
    return { south: south - pad, north: north + pad, west: west - pad, east: east + pad };
  }, [eventsWithCoords]);

  const preciseCount = eventsWithCoords.filter((e) => e.precise).length;
  const centroidCount = eventsWithCoords.length - preciseCount;

  if (!apiKey) {
    return (
      <div className="flex h-[calc(100vh-14rem)] min-h-[400px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        Google Maps API key not configured.
      </div>
    );
  }

  if (eventsWithCoords.length === 0) {
    return (
      <div className="flex h-[calc(100vh-14rem)] min-h-[400px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        No events to display on the map.
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div className="h-[calc(100vh-14rem)] min-h-[400px] overflow-hidden rounded-md border">
        <Map
          mapId={MAP_ID}
          defaultBounds={defaultBounds}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapTypeControl={false}
          streetViewControl={false}
          onClick={() => { onSelectEvent(null); }}
        >
          <ClusteredMarkers
            events={eventsWithCoords}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
            onNavigate={handleNavigate}
          />

          {/* Reset view button */}
          {defaultBounds && <ResetViewControl bounds={defaultBounds} />}

          {/* Auto-zoom on filter change */}
          <AutoZoom bounds={defaultBounds} />

          {/* First-time precision info banner */}
          <PrecisionBanner />

          {/* Legend overlay */}
          <MapControl position={ControlPosition.BOTTOM_LEFT}>
            <div className="m-2.5 rounded-md border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
              {preciseCount > 0 && (
                <span>
                  <span
                    className="mr-1 inline-block align-middle"
                    style={{ ...LEGEND_ICON_BASE, backgroundColor: "currentColor" }}
                  />
                  {preciseCount} with exact location
                </span>
              )}
              {preciseCount > 0 && centroidCount > 0 && <span className="mx-1.5">·</span>}
              {centroidCount > 0 && (
                <span>
                  <span
                    className="mr-1 inline-block align-middle"
                    style={{ ...LEGEND_ICON_BASE, backgroundColor: "transparent", border: "1.5px solid currentColor" }}
                  />
                  {centroidCount} at region center (approx.)
                </span>
              )}
            </div>
          </MapControl>
        </Map>
      </div>
    </APIProvider>
  );
}
