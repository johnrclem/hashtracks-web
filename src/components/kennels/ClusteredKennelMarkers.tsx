"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";

export interface KennelPin {
  id: string;
  shortName: string;
  fullName: string;
  slug: string;
  region: string;
  schedule: string | null;
  nextEvent: { date: string; title: string | null } | null;
  lat: number;
  lng: number;
  color: string;
  precise: boolean;
}

interface ClusteredKennelMarkersProps {
  pins: KennelPin[];
  selectedPinId: string | null;
  onSelectPin: (id: string) => void;
}

export function ClusteredKennelMarkers({ pins, selectedPinId, onSelectPin }: ClusteredKennelMarkersProps) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const refCallbacksRef = useRef<Map<string, (marker: google.maps.marker.AdvancedMarkerElement | null) => void>>(new Map());

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

  // Stable per-pin ref callback factory — avoids new function identity on every render
  const getRefCallback = useCallback((pinId: string) => {
    let cb = refCallbacksRef.current.get(pinId);
    if (!cb) {
      cb = (marker: google.maps.marker.AdvancedMarkerElement | null) => {
        const prev = markersRef.current.get(pinId);
        if (marker) {
          if (prev !== marker) {
            if (prev) clustererRef.current?.removeMarker(prev);
            markersRef.current.set(pinId, marker);
            clustererRef.current?.addMarker(marker);
          }
        } else if (prev) {
          clustererRef.current?.removeMarker(prev);
          markersRef.current.delete(pinId);
        }
      };
      refCallbacksRef.current.set(pinId, cb);
    }
    return cb;
  }, []);

  return (
    <>
      {pins.map((pin) => {
        const isSelected = selectedPinId === pin.id;
        return (
          <AdvancedMarker
            key={pin.id}
            position={{ lat: pin.lat, lng: pin.lng }}
            onClick={() => onSelectPin(pin.id)}
            title={pin.shortName}
            ref={getRefCallback(pin.id)}
          >
            <div
              style={{
                width: isSelected ? 32 : 28,
                height: isSelected ? 32 : 28,
                borderRadius: "50%",
                backgroundColor: pin.color,
                border: isSelected ? "3px solid white" : "2px solid white",
                boxShadow: isSelected
                  ? `0 0 0 2px ${pin.color}, 0 2px 6px rgba(0,0,0,0.4)`
                  : "0 1px 4px rgba(0,0,0,0.4)",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "9px",
                fontWeight: "bold",
                color: "white",
                transition: "all 0.15s ease",
                userSelect: "none",
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.2)"; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
            />
          </AdvancedMarker>
        );
      })}
    </>
  );
}
