"use client";

import { useMemo } from "react";
import { APIProvider, Map, AdvancedMarker } from "@vis.gl/react-google-maps";
import { getEventCoords, getRegionColor } from "@/lib/geo";
import type { HarelineEvent } from "./EventCard";
import type { AttendanceData } from "@/components/logbook/CheckInButton";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";

interface MapViewProps {
  events: HarelineEvent[];
  selectedEventId?: string | null;
  onSelectEvent: (event: HarelineEvent) => void;
  attendanceMap: Record<string, AttendanceData>;
}

interface EventWithCoords {
  event: HarelineEvent;
  lat: number;
  lng: number;
  precise: boolean;
  color: string;
}

export default function MapView({
  events,
  selectedEventId,
  onSelectEvent,
}: MapViewProps) {
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

  // Compute bounding box for all events to auto-fit the map
  const defaultBounds = useMemo(() => {
    if (eventsWithCoords.length === 0) return undefined;
    const lats = eventsWithCoords.map((e) => e.lat);
    const lngs = eventsWithCoords.map((e) => e.lng);
    const pad = 0.5;
    return {
      south: Math.min(...lats) - pad,
      north: Math.max(...lats) + pad,
      west: Math.min(...lngs) - pad,
      east: Math.max(...lngs) + pad,
    };
  }, [eventsWithCoords]);

  const preciseCount = eventsWithCoords.filter((e) => e.precise).length;
  const centroidCount = eventsWithCoords.length - preciseCount;

  if (!apiKey) {
    return (
      <div className="flex h-96 items-center justify-center rounded-md border text-sm text-muted-foreground">
        Google Maps API key not configured.
      </div>
    );
  }

  if (eventsWithCoords.length === 0) {
    return (
      <div className="flex h-96 items-center justify-center rounded-md border text-sm text-muted-foreground">
        No events to display on the map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <APIProvider apiKey={apiKey}>
        <div className="h-[600px] overflow-hidden rounded-md border">
          <Map
            mapId={MAP_ID}
            defaultBounds={defaultBounds}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={false}
            streetViewControl={false}
          >
            {eventsWithCoords.map(({ event, lat, lng, precise, color }) => {
              const isSelected = selectedEventId === event.id;
              const size = isSelected ? 24 : precise ? 18 : 14;
              return (
                <AdvancedMarker
                  key={event.id}
                  position={{ lat, lng }}
                  onClick={() => onSelectEvent(event)}
                  title={event.locationName ?? event.kennel.shortName ?? undefined}
                >
                  <div
                    style={{
                      width: size,
                      height: size,
                      borderRadius: "50%",
                      backgroundColor: precise ? color : "transparent",
                      border: `${isSelected ? 3 : 2}px solid ${color}`,
                      boxShadow: isSelected
                        ? `0 0 0 2px white, 0 0 0 4px ${color}`
                        : "0 1px 4px rgba(0,0,0,0.4)",
                      cursor: "pointer",
                      transition: "all 0.15s ease",
                    }}
                  />
                </AdvancedMarker>
              );
            })}
          </Map>
        </div>
      </APIProvider>

      <p className="text-xs text-muted-foreground">
        {preciseCount > 0 && (
          <span>
            <span
              className="mr-1 inline-block h-2.5 w-2.5 rounded-full bg-foreground/50 align-middle"
            />
            {preciseCount} {preciseCount === 1 ? "event" : "events"} with exact location
          </span>
        )}
        {preciseCount > 0 && centroidCount > 0 && <span className="mx-1.5">·</span>}
        {centroidCount > 0 && (
          <span>
            <span
              className="mr-1 inline-block h-2.5 w-2.5 rounded-full border border-foreground/50 align-middle"
            />
            {centroidCount} shown at approximate region center
          </span>
        )}
      </p>
    </div>
  );
}
