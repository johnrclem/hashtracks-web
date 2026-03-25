"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { Cluster } from "@googlemaps/markerclusterer";
import { groupByCoordinates, parseCoordKey, HashTracksClusterRenderer } from "@/lib/map-utils";

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

/** A group of co-located kennel pins sharing the same rounded coordinates. */
interface PinGroup {
  key: string;
  pins: KennelPin[];
  lat: number;
  lng: number;
}

interface ClusteredKennelMarkersProps {
  pins: KennelPin[];
  selectedPinId: string | null;
  onSelectPin: (id: string) => void;
  onShowColocated: (pins: KennelPin[], position: { lat: number; lng: number }) => void;
}

export function ClusteredKennelMarkers({ pins, selectedPinId, onSelectPin, onShowColocated }: ClusteredKennelMarkersProps) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const refCallbacksRef = useRef<Map<string, (marker: google.maps.marker.AdvancedMarkerElement | null) => void>>(new Map());
  // Maps marker elements to their pin groups for cluster click handling
  const markerToPinsRef = useRef<Map<google.maps.marker.AdvancedMarkerElement, KennelPin[]>>(new Map());

  // Group pins by rounded coordinates
  const pinGroups = useMemo<PinGroup[]>(() => {
    const grouped = groupByCoordinates(pins, (p) => ({ lat: p.lat, lng: p.lng }));
    const groups: PinGroup[] = [];
    for (const [key, groupPins] of grouped.entries()) {
      const { lat, lng } = parseCoordKey(key);
      groups.push({ key, pins: groupPins, lat, lng });
    }
    return groups;
  }, [pins]);

  // Custom cluster click handler
  const handleClusterClick = useCallback(
    (_event: google.maps.MapMouseEvent, cluster: Cluster, _map: google.maps.Map) => {
      // Collect all pins from markers in this cluster
      const allPins: KennelPin[] = [];
      for (const marker of cluster.markers ?? []) {
        const grouped = markerToPinsRef.current.get(marker as google.maps.marker.AdvancedMarkerElement);
        if (grouped) allPins.push(...grouped);
      }

      // Check if all pins share the same rounded coordinates
      const coordKeys = new Set<string>();
      for (const pin of allPins) {
        const key = groupByCoordinates([pin], (p) => ({ lat: p.lat, lng: p.lng })).keys().next().value;
        if (key) coordKeys.add(key);
      }

      if (coordKeys.size === 1 && allPins.length > 1) {
        // All pins at same location — show co-located list
        const pos = cluster.position
          ? { lat: cluster.position.lat(), lng: cluster.position.lng() }
          : { lat: allPins[0].lat, lng: allPins[0].lng };
        onShowColocated(allPins, pos);
      } else if (cluster.bounds) {
        // Mixed locations — zoom to fit
        _map.fitBounds(cluster.bounds);
      }
    },
    [onShowColocated],
  );

  // Initialize clusterer when map is ready
  useEffect(() => {
    if (!map) return;
    if (!clustererRef.current) {
      clustererRef.current = new MarkerClusterer({
        map,
        algorithmOptions: { maxZoom: 16 },
        renderer: new HashTracksClusterRenderer(),
        onClusterClick: handleClusterClick,
      });
    }
    const markers = markersRef.current;
    const refCallbacks = refCallbacksRef.current;
    const markerToPins = markerToPinsRef.current;
    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markers.clear();
      refCallbacks.clear();
      markerToPins.clear();
    };
  }, [map, handleClusterClick]);

  // Stable per-group ref callback factory — avoids new function identity on every render
  const getRefCallback = useCallback((groupKey: string, groupPins: KennelPin[]) => {
    let cb = refCallbacksRef.current.get(groupKey);
    if (!cb) {
      cb = (marker: google.maps.marker.AdvancedMarkerElement | null) => {
        const prev = markersRef.current.get(groupKey);
        if (marker) {
          if (prev !== marker) {
            if (prev) {
              clustererRef.current?.removeMarker(prev);
              markerToPinsRef.current.delete(prev);
            }
            markersRef.current.set(groupKey, marker);
            markerToPinsRef.current.set(marker, groupPins);
            clustererRef.current?.addMarker(marker);
          } else {
            // Same marker element, but pins may have changed — update mapping
            markerToPinsRef.current.set(marker, groupPins);
          }
        } else if (prev) {
          clustererRef.current?.removeMarker(prev);
          markersRef.current.delete(groupKey);
          markerToPinsRef.current.delete(prev);
        }
      };
      refCallbacksRef.current.set(groupKey, cb);
    }
    return cb;
  }, []);

  return (
    <>
      {pinGroups.map((group) => {
        const isMulti = group.pins.length > 1;
        // For a single pin, check if it's selected
        const singlePin = !isMulti ? group.pins[0] : null;
        const isSelected = singlePin ? selectedPinId === singlePin.id : false;
        // For multi-pin groups, check if any pin is selected
        const hasSelectedPin = isMulti && group.pins.some((p) => p.id === selectedPinId);
        const primaryColor = group.pins[0].color;

        return (
          <AdvancedMarker
            key={group.key}
            position={{ lat: group.lat, lng: group.lng }}
            onClick={() => {
              if (isMulti) {
                onShowColocated(group.pins, { lat: group.lat, lng: group.lng });
              } else {
                onSelectPin(group.pins[0].id);
              }
            }}
            title={
              isMulti
                ? `${group.pins.length} kennels: ${group.pins.map((p) => p.shortName).join(", ")}`
                : singlePin?.shortName
            }
            ref={getRefCallback(group.key, group.pins)}
          >
            {isMulti ? (
              /* Multi-pin: circle with count badge */
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: "50%",
                  backgroundColor: primaryColor,
                  border: hasSelectedPin ? "3px solid white" : "2px solid white",
                  boxShadow: hasSelectedPin
                    ? `0 0 0 2px ${primaryColor}, 0 2px 6px rgba(0,0,0,0.4)`
                    : "0 1px 4px rgba(0,0,0,0.4)",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "11px",
                  fontWeight: "bold",
                  color: "white",
                  transition: "all 0.15s ease",
                  userSelect: "none",
                  position: "relative",
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.2)"; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
              >
                {group.pins.length}
              </div>
            ) : (
              /* Single pin: existing style */
              <div
                style={{
                  width: isSelected ? 32 : 28,
                  height: isSelected ? 32 : 28,
                  borderRadius: "50%",
                  backgroundColor: primaryColor,
                  border: isSelected ? "3px solid white" : "2px solid white",
                  boxShadow: isSelected
                    ? `0 0 0 2px ${primaryColor}, 0 2px 6px rgba(0,0,0,0.4)`
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
            )}
          </AdvancedMarker>
        );
      })}
    </>
  );
}
