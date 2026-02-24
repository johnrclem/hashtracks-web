"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { Marker } from "@googlemaps/markerclusterer";
import type { HarelineEvent } from "./EventCard";

/** Event enriched with resolved coordinates and pin color for map rendering. */
export interface EventWithCoords {
  event: HarelineEvent;
  lat: number;
  lng: number;
  /** True if coordinates come from the event's DB record; false if using region centroid fallback. */
  precise: boolean;
  color: string;
}

interface ClusteredMarkersProps {
  events: EventWithCoords[];
  selectedEventId?: string | null;
  onSelectEvent: (event: HarelineEvent) => void;
}

export function ClusteredMarkers({ events, selectedEventId, onSelectEvent }: ClusteredMarkersProps) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const [markers, setMarkers] = useState<Record<string, Marker>>({});

  // Initialize clusterer when map is ready
  useEffect(() => {
    if (!map) return;
    if (!clustererRef.current) {
      clustererRef.current = new MarkerClusterer({ map });
    }
    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
    };
  }, [map]);

  // Sync markers to clusterer when markers collection changes
  useEffect(() => {
    if (!clustererRef.current) return;
    clustererRef.current.clearMarkers();
    clustererRef.current.addMarkers(Object.values(markers));
  }, [markers]);

  // Ref callback for each AdvancedMarker
  const setMarkerRef = useCallback((marker: Marker | null, eventId: string) => {
    setMarkers((prev) => {
      if (marker && prev[eventId] !== marker) {
        return { ...prev, [eventId]: marker };
      }
      if (!marker && eventId in prev) {
        const next = { ...prev };
        delete next[eventId];
        return next;
      }
      return prev;
    });
  }, []);

  return (
    <>
      {events.map(({ event, lat, lng, precise, color }) => {
        const isSelected = selectedEventId === event.id;
        const size = isSelected ? 24 : precise ? 18 : 14;
        return (
          <AdvancedMarker
            key={event.id}
            position={{ lat, lng }}
            onClick={() => onSelectEvent(event)}
            title={event.locationName ?? event.kennel.shortName ?? undefined}
            ref={(marker) => setMarkerRef(marker as Marker | null, event.id)}
          >
            {/* Teardrop pin: rounded top + sides, pointed bottom via rotated border-radius */}
            <div
              style={{
                width: size,
                height: size,
                backgroundColor: precise ? color : "transparent",
                border: `${isSelected ? 3 : 2}px solid ${color}`,
                borderRadius: "50% 50% 50% 0",
                transform: "rotate(-45deg)",
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
    </>
  );
}
