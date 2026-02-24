"use client";

import { useMemo } from "react";
import { APIProvider, Map } from "@vis.gl/react-google-maps";
import { getEventCoords, getRegionColor } from "@/lib/geo";
import { ClusteredMarkers, type EventWithCoords } from "./ClusteredMarkers";
import type { HarelineEvent } from "./EventCard";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";

/** Props for the interactive MapView — renders hareline events as region-colored map pins. */
interface MapViewProps {
  events: HarelineEvent[];
  /** Currently selected event ID (for highlighting its pin). */
  selectedEventId?: string | null;
  /** Callback when a map pin is clicked. */
  onSelectEvent: (event: HarelineEvent) => void;
}

export default function MapView({ events, selectedEventId, onSelectEvent }: MapViewProps) {
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
    const pad = 0.5;
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
      <div className="flex h-[calc(100vh-16rem)] min-h-[400px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        Google Maps API key not configured.
      </div>
    );
  }

  if (eventsWithCoords.length === 0) {
    return (
      <div className="flex h-[calc(100vh-16rem)] min-h-[400px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        No events to display on the map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <APIProvider apiKey={apiKey}>
        <div className="h-[calc(100vh-16rem)] min-h-[400px] overflow-hidden rounded-md border">
          <Map
            mapId={MAP_ID}
            defaultBounds={defaultBounds}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={false}
            streetViewControl={false}
          >
            <ClusteredMarkers
              events={eventsWithCoords}
              selectedEventId={selectedEventId}
              onSelectEvent={onSelectEvent}
            />
          </Map>
        </div>
      </APIProvider>

      <p className="text-xs text-muted-foreground">
        {preciseCount > 0 && (
          <span>
            <span
              className="mr-1 inline-block align-middle"
              style={{
                width: 10,
                height: 10,
                backgroundColor: "currentColor",
                borderRadius: "50% 50% 50% 0",
                transform: "rotate(-45deg)",
                opacity: 0.5,
              }}
            />
            {preciseCount} {preciseCount === 1 ? "event" : "events"} with exact location
          </span>
        )}
        {preciseCount > 0 && centroidCount > 0 && <span className="mx-1.5">·</span>}
        {centroidCount > 0 && (
          <span>
            <span
              className="mr-1 inline-block align-middle"
              style={{
                width: 10,
                height: 10,
                backgroundColor: "transparent",
                border: "1.5px solid currentColor",
                borderRadius: "50% 50% 50% 0",
                transform: "rotate(-45deg)",
                opacity: 0.5,
              }}
            />
            {centroidCount} shown at approximate region center
          </span>
        )}
      </p>
    </div>
  );
}
