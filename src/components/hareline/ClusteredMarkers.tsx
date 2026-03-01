"use client";

import { useEffect, useRef, useCallback } from "react";
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

/** Compute marker size based on selection and precision state. */
export function getMarkerSize(isSelected: boolean, precise: boolean): number {
  if (isSelected) return 24;
  if (precise) return 18;
  return 14;
}

/** Build inline style for a teardrop map pin marker. */
export function getMarkerStyle(
  size: number,
  color: string,
  precise: boolean,
  isSelected: boolean,
): React.CSSProperties {
  return {
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
  };
}

export function ClusteredMarkers({ events, selectedEventId, onSelectEvent }: ClusteredMarkersProps) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const refCallbacksRef = useRef<Map<string, (marker: Marker | null) => void>>(new Map());

  // Initialize clusterer when map is ready
  useEffect(() => {
    if (!map) return;
    if (!clustererRef.current) {
      clustererRef.current = new MarkerClusterer({ map });
    }
    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markersRef.current.clear();
      refCallbacksRef.current.clear();
    };
  }, [map]);

  // Stable per-event ref callback factory — avoids new function identity on every render
  const getRefCallback = useCallback((eventId: string) => {
    let cb = refCallbacksRef.current.get(eventId);
    if (!cb) {
      cb = (marker: Marker | null) => {
        const prev = markersRef.current.get(eventId);
        if (marker) {
          if (prev !== marker) {
            if (prev) clustererRef.current?.removeMarker(prev);
            markersRef.current.set(eventId, marker);
            clustererRef.current?.addMarker(marker);
          }
        } else if (prev) {
          clustererRef.current?.removeMarker(prev);
          markersRef.current.delete(eventId);
        }
      };
      refCallbacksRef.current.set(eventId, cb);
    }
    return cb;
  }, []);

  return (
    <>
      {events.map(({ event, lat, lng, precise, color }) => {
        const isSelected = selectedEventId === event.id;
        const size = getMarkerSize(isSelected, precise);
        return (
          <AdvancedMarker
            key={event.id}
            position={{ lat, lng }}
            onClick={() => onSelectEvent(event)}
            title={event.locationName ?? event.kennel.shortName ?? undefined}
            ref={getRefCallback(event.id) as React.Ref<never>}
          >
            <div style={getMarkerStyle(size, color, precise, isSelected)} />
          </AdvancedMarker>
        );
      })}
    </>
  );
}
