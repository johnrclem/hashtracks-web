"use client";
/* eslint-disable react-hooks/refs */

import React, { useEffect, useRef, useCallback, useMemo } from "react";
import { useMapColorScheme } from "@/hooks/useMapColorScheme";
import { useMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { Cluster } from "@googlemaps/markerclusterer";
import { groupByCoordinates, parseCoordKey, toCoordKey, HashTracksClusterRenderer } from "@/lib/map-utils";

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

export function ClusteredKennelMarkers({ pins, selectedPinId, onSelectPin, onShowColocated }: Readonly<ClusteredKennelMarkersProps>) {
  const { markerBorder } = useMapColorScheme();
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, google.maps.marker.AdvancedMarkerElement>>(new Map());
  const refCallbacksRef = useRef<Map<string, (marker: google.maps.marker.AdvancedMarkerElement | null) => void>>(new Map());
  // Maps marker elements to their pin groups for cluster click handling
  const markerToPinsRef = useRef<Map<google.maps.marker.AdvancedMarkerElement, KennelPin[]>>(new Map());
  // Track pin count per group to detect single↔multi transitions that require ref invalidation
  const refPinCountsRef = useRef<Map<string, number>>(new Map());

  // Stable refs for callbacks so the cluster click handler can access them without re-creating
  const onShowColocatedRef = useRef(onShowColocated);
  onShowColocatedRef.current = onShowColocated;

  const onSelectPinRef = useRef(onSelectPin);
  onSelectPinRef.current = onSelectPin;

  // Ref that always holds the latest coordinate grouping — read by getRefCallback to avoid stale closures
  const groupDataRef = useRef<Map<string, KennelPin[]>>(new Map());

  // Group pins by rounded coordinates
  const pinGroups = useMemo<PinGroup[]>(() => {
    const grouped = groupByCoordinates(pins, (p) => ({ lat: p.lat, lng: p.lng }));
    const groups: PinGroup[] = [];
    for (const [key, groupPins] of grouped.entries()) {
      const { lat, lng } = parseCoordKey(key);
      groups.push({ key, pins: groupPins, lat, lng });
    }
    // Keep groupDataRef in sync with latest grouping
    groupDataRef.current = grouped;
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
        coordKeys.add(toCoordKey(pin.lat, pin.lng));
      }

      if (coordKeys.size === 1 && allPins.length > 1) {
        // All pins at same location — show co-located list
        const pos = cluster.position
          ? { lat: cluster.position.lat(), lng: cluster.position.lng() }
          : { lat: allPins[0].lat, lng: allPins[0].lng };
        onShowColocatedRef.current(allPins, pos);
      } else if (cluster.bounds) {
        // Mixed locations — zoom to fit
        _map.fitBounds(cluster.bounds);
      }
    },
    [],
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
      refPinCountsRef.current.clear();
    };
  }, [map, handleClusterClick]);

  // Deferred cluster render after pin groups change. Ref callbacks use noDraw
  // to avoid triggering N expensive re-clusters during mount. This effect waits
  // one animation frame for all async AdvancedMarker element creation to settle,
  // then triggers a single cluster recalculation.
  useEffect(() => {
    const rafId = requestAnimationFrame(() => {
      clustererRef.current?.render();
    });
    return () => cancelAnimationFrame(rafId);
  }, [pinGroups, map]);

  // Stable per-group ref callback factory — avoids new function identity on every render.
  // Reads from groupDataRef so the reverse lookup always has the latest data even if
  // the callback fires after a re-render (fixes stale closure).
  const getRefCallback = useCallback((groupKey: string) => {
    // Detect single↔multi transitions. When AdvancedMarker switches between
    // single-pin and multi-pin content, the underlying marker element may be
    // replaced. Invalidate the cached callback so React re-fires the ref with
    // the new element, allowing the clusterer to track it.
    const latestPins = groupDataRef.current.get(groupKey) ?? [];
    const prevCount = refPinCountsRef.current.get(groupKey) ?? 0;
    const newCount = latestPins.length;
    const compositionChanged = (prevCount <= 1) !== (newCount <= 1);
    refPinCountsRef.current.set(groupKey, newCount);
    if (compositionChanged) {
      refCallbacksRef.current.delete(groupKey);
    }

    let cb = refCallbacksRef.current.get(groupKey);
    if (cb) {
      // Existing callback — eagerly update the marker→pins mapping with latest data
      const existingMarker = markersRef.current.get(groupKey);
      if (existingMarker) {
        markerToPinsRef.current.set(existingMarker, latestPins);
      }
    } else {
      cb = (marker: google.maps.marker.AdvancedMarkerElement | null) => {
        const latestPins = groupDataRef.current.get(groupKey) ?? [];
        const prev = markersRef.current.get(groupKey);
        if (marker) {
          if (prev !== marker) {
            if (prev) {
              clustererRef.current?.removeMarker(prev, true); // noDraw — deferred effect renders
              markerToPinsRef.current.delete(prev);
            }
            markersRef.current.set(groupKey, marker);
            markerToPinsRef.current.set(marker, latestPins);
            clustererRef.current?.addMarker(marker, true); // noDraw — deferred effect renders
          } else {
            // Same marker element, but pins may have changed — update mapping
            markerToPinsRef.current.set(marker, latestPins);
          }
        } else if (prev) {
          clustererRef.current?.removeMarker(prev, true); // noDraw — deferred effect renders
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
      {pinGroups.map((group) => (
        <KennelPinMarker
          key={group.key}
          group={group}
          selectedPinId={selectedPinId}
          onSelectPin={onSelectPin}
          onShowColocated={onShowColocated}
          refCallback={getRefCallback(group.key)}
          markerBorder={markerBorder}
        />
      ))}
    </>
  );
}

// ── Extracted sub-component to reduce cognitive complexity ────────────────────

/** Build inline style for a multi-pin badge marker. */
function getMultiPinStyle(color: string, hasSelected: boolean, markerBorder: string): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: "50%",
    backgroundColor: color,
    border: hasSelected ? `3px solid ${markerBorder}` : `2px solid ${markerBorder}`,
    boxShadow: hasSelected
      ? `0 0 0 2px ${color}, 0 2px 6px rgba(0,0,0,0.4)`
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
  };
}

/** Build inline style for a single kennel pin marker. */
function getSinglePinStyle(color: string, isSelected: boolean, markerBorder: string): React.CSSProperties {
  const size = isSelected ? 32 : 28;
  return {
    width: size,
    height: size,
    borderRadius: "50%",
    backgroundColor: color,
    border: isSelected ? `3px solid ${markerBorder}` : `2px solid ${markerBorder}`,
    boxShadow: isSelected
      ? `0 0 0 2px ${color}, 0 2px 6px rgba(0,0,0,0.4)`
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
  };
}

function handleScaleUp(e: React.MouseEvent<HTMLDivElement>) {
  (e.currentTarget as HTMLDivElement).style.transform = "scale(1.2)";
}

function handleScaleDown(e: React.MouseEvent<HTMLDivElement>) {
  (e.currentTarget as HTMLDivElement).style.transform = "scale(1)";
}

/** Renders a single AdvancedMarker for a pin group (single or multi-kennel). */
function KennelPinMarker({
  group,
  selectedPinId,
  onSelectPin,
  onShowColocated,
  refCallback,
  markerBorder,
}: Readonly<{
  group: PinGroup;
  selectedPinId: string | null;
  onSelectPin: (id: string) => void;
  onShowColocated: (pins: KennelPin[], position: { lat: number; lng: number }) => void;
  refCallback: (marker: google.maps.marker.AdvancedMarkerElement | null) => void;
  markerBorder: string;
}>) {
  const isMulti = group.pins.length > 1;
  const primaryColor = group.pins[0].color;

  if (isMulti) {
    const hasSelectedPin = group.pins.some((p) => p.id === selectedPinId);
    return (
      <AdvancedMarker
        position={{ lat: group.lat, lng: group.lng }}
        onClick={() => onShowColocated(group.pins, { lat: group.lat, lng: group.lng })}
        title={`${group.pins.length} kennels: ${group.pins.map((p) => p.shortName).join(", ")}`}
        ref={refCallback}
      >
        <div
          style={getMultiPinStyle(primaryColor, hasSelectedPin, markerBorder)}
          onMouseEnter={handleScaleUp}
          onMouseLeave={handleScaleDown}
        >
          {group.pins.length}
        </div>
      </AdvancedMarker>
    );
  }

  const singlePin = group.pins[0];
  const isSelected = selectedPinId === singlePin.id;
  return (
    <AdvancedMarker
      position={{ lat: group.lat, lng: group.lng }}
      onClick={() => onSelectPin(singlePin.id)}
      title={singlePin.shortName}
      ref={refCallback}
    >
      <div
        style={getSinglePinStyle(primaryColor, isSelected, markerBorder)}
        onMouseEnter={handleScaleUp}
        onMouseLeave={handleScaleDown}
      />
    </AdvancedMarker>
  );
}
