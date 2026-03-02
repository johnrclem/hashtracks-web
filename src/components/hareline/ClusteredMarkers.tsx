"use client";

import { useEffect, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useMap, AdvancedMarker, InfoWindow } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { Marker } from "@googlemaps/markerclusterer";
import type { HarelineEvent } from "./EventCard";
import { formatTimeCompact } from "@/lib/format";

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
  onSelectEvent: (event: HarelineEvent | null) => void;
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

  // Resolve selected event coordinates for InfoWindow positioning
  const selectedInfo = useMemo(() => {
    if (!selectedEventId) return null;
    return events.find((e) => e.event.id === selectedEventId) ?? null;
  }, [events, selectedEventId]);

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

      {selectedInfo && (
        <InfoWindow
          position={{ lat: selectedInfo.lat, lng: selectedInfo.lng }}
          onCloseClick={() => onSelectEvent(null)}
          pixelOffset={[0, -20]}
        >
          <div className="min-w-[160px] max-w-[240px]">
            <p className="m-0 text-[13px] font-semibold">{selectedInfo.event.kennel.shortName}</p>
            {selectedInfo.event.title && (
              <p className="mt-0.5 text-xs text-muted-foreground">{selectedInfo.event.title}</p>
            )}
            {selectedInfo.event.startTime && (
              <p className="mt-0.5 text-xs text-muted-foreground">{formatTimeCompact(selectedInfo.event.startTime)}</p>
            )}
            {selectedInfo.event.locationName && (
              <p className="mt-0.5 text-[11px] text-muted-foreground/70">{selectedInfo.event.locationName}</p>
            )}
            <Link
              href={`/hareline/${selectedInfo.event.id}`}
              className="mt-1.5 inline-block text-xs text-primary no-underline hover:underline"
            >
              View details →
            </Link>
          </div>
        </InfoWindow>
      )}
    </>
  );
}
