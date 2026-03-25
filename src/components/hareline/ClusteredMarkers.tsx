"use client";
/* eslint-disable react-hooks/refs */

import { useEffect, useRef, useCallback, useMemo } from "react";
import { useMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { MarkerClusterer } from "@googlemaps/markerclusterer";
import type { Marker, Cluster, onClusterClickHandler } from "@googlemaps/markerclusterer";
import { groupByCoordinates, parseCoordKey, toCoordKey, HashTracksClusterRenderer } from "@/lib/map-utils";
import { LG_BREAKPOINT } from "@/hooks/useIsMobile";
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

/** A group of co-located events that share the same rounded coordinates. */
interface CoordGroup {
  key: string;
  events: EventWithCoords[];
  lat: number;
  lng: number;
}

interface ClusteredMarkersProps {
  events: EventWithCoords[];
  selectedEventId?: string | null;
  onSelectEvent: (event: HarelineEvent | null) => void;
  /** Called on mobile (<lg) to navigate to the event detail page. */
  onNavigate?: (eventId: string) => void;
  /** Called when a stacked pin or co-located cluster is clicked. */
  onShowColocated: (events: EventWithCoords[], position: { lat: number; lng: number }) => void;
  /** Called when a cluster contains events from a single region — applies region filter. */
  onRegionFilter?: (region: string) => void;
}

/** Compute marker size based on selection and precision state. */
export function getMarkerSize(isSelected: boolean, precise: boolean): number {
  if (isSelected) return 24;
  if (precise) return 18;
  return 14;
}

/** Build inline style for a circle map pin marker. */
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
    borderRadius: "50%",
    boxShadow: isSelected
      ? `0 0 0 2px white, 0 0 0 4px ${color}`
      : "0 1px 4px rgba(0,0,0,0.4)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };
}

/** Build inline style for a co-located group badge (circle with count overlay). */
function getGroupBadgeStyle(color: string, isSelected: boolean): React.CSSProperties {
  const size = isSelected ? 28 : 24;
  return {
    width: size,
    height: size,
    backgroundColor: color,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    color: "#ffffff",
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: "11px",
    fontWeight: "600",
    boxShadow: isSelected
      ? `0 0 0 2px white, 0 0 0 4px ${color}`
      : "0 1px 4px rgba(0,0,0,0.4)",
    cursor: "pointer",
    transition: "all 0.15s ease",
  };
}

export function ClusteredMarkers({
  events,
  selectedEventId,
  onSelectEvent,
  onNavigate,
  onShowColocated,
  onRegionFilter,
}: Readonly<ClusteredMarkersProps>) {
  const map = useMap();
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const markersRef = useRef<Map<string, Marker>>(new Map());
  const refCallbacksRef = useRef<Map<string, (marker: Marker | null) => void>>(new Map());
  // Reverse lookup: marker element → events at that marker's coordinate group
  const markerToEventsRef = useRef<Map<Marker, EventWithCoords[]>>(new Map());

  // Stable ref for the onShowColocated callback so the cluster click handler can access it
  const onShowColocatedRef = useRef(onShowColocated);
  onShowColocatedRef.current = onShowColocated;

  // Stable ref for the onRegionFilter callback
  const onRegionFilterRef = useRef(onRegionFilter);
  onRegionFilterRef.current = onRegionFilter;

  // Ref that always holds the latest coordinate grouping — read by getRefCallback to avoid stale closures
  const groupDataRef = useRef<Map<string, EventWithCoords[]>>(new Map());

  // Group events by rounded coordinates
  const groups = useMemo<CoordGroup[]>(() => {
    const grouped = groupByCoordinates(events, (e) => ({ lat: e.lat, lng: e.lng }));
    const result: CoordGroup[] = [];
    for (const [key, groupEvents] of grouped) {
      const { lat, lng } = parseCoordKey(key);
      result.push({ key, events: groupEvents, lat, lng });
    }
    // Keep groupDataRef in sync with latest grouping
    groupDataRef.current = grouped;
    return result;
  }, [events]);

  // Handle cluster click: show co-located list if all events share same coords, else zoom
  const handleClusterClick: onClusterClickHandler = useCallback(
    (_event: google.maps.MapMouseEvent, cluster: Cluster, clusterMap: google.maps.Map) => {
      // Collect all events from markers in this cluster
      const allEvents: EventWithCoords[] = [];
      if (cluster.markers) {
        for (const marker of cluster.markers) {
          const evts = markerToEventsRef.current.get(marker);
          if (evts) allEvents.push(...evts);
        }
      }

      // Check if all events share the same rounded coords
      const coordKeys = new Set(
        allEvents.map((e) => toCoordKey(e.lat, e.lng)),
      );

      if (coordKeys.size === 1 && allEvents.length > 0) {
        // All same location — show colocated list
        onShowColocatedRef.current(allEvents, { lat: allEvents[0].lat, lng: allEvents[0].lng });
      } else {
        // Multiple locations — check if all events share a single region
        const regions = new Set(
          allEvents.map((e) => e.event.kennel?.region).filter(Boolean) as string[],
        );
        if (regions.size === 1 && onRegionFilterRef.current) {
          // All events in cluster are from the same region — apply region filter
          const [region] = regions;
          onRegionFilterRef.current(region);
        } else {
          // Mixed regions — default zoom
          if (cluster.bounds) {
            clusterMap.fitBounds(cluster.bounds);
          }
        }
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
    const markerToEvents = markerToEventsRef.current;
    return () => {
      clustererRef.current?.clearMarkers();
      clustererRef.current = null;
      markers.clear();
      refCallbacks.clear();
      markerToEvents.clear();
    };
  }, [map, handleClusterClick]);

  // Stable per-group ref callback factory — avoids new function identity on every render.
  // Reads from groupDataRef so the reverse lookup always has the latest data even if
  // the callback fires after a re-render (fixes stale closure).
  const getRefCallback = useCallback((groupKey: string) => {
    let cb = refCallbacksRef.current.get(groupKey);
    if (cb) {
      // Existing callback — eagerly update the marker→events mapping with latest data
      const existingMarker = markersRef.current.get(groupKey);
      if (existingMarker) {
        const latestEvents = groupDataRef.current.get(groupKey) ?? [];
        markerToEventsRef.current.set(existingMarker, latestEvents);
      }
    } else {
      cb = (marker: Marker | null) => {
        const latestEvents = groupDataRef.current.get(groupKey) ?? [];
        const prev = markersRef.current.get(groupKey);
        if (marker) {
          if (prev !== marker) {
            if (prev) {
              clustererRef.current?.removeMarker(prev);
              markerToEventsRef.current.delete(prev);
            }
            markersRef.current.set(groupKey, marker);
            markerToEventsRef.current.set(marker, latestEvents);
            clustererRef.current?.addMarker(marker);
          } else {
            // Same marker element, just update the events mapping
            markerToEventsRef.current.set(marker, latestEvents);
          }
        } else if (prev) {
          clustererRef.current?.removeMarker(prev);
          markersRef.current.delete(groupKey);
          markerToEventsRef.current.delete(prev);
        }
      };
      refCallbacksRef.current.set(groupKey, cb);
    }
    return cb;
  }, []);

  return (
    <>
      {groups.map((group) => {
        const isSingle = group.events.length === 1;
        const firstEvent = group.events[0];

        if (isSingle) {
          // Single event at this location — render standard pin
          const { event, precise, color } = firstEvent;
          const isSelected = selectedEventId === event.id;
          const size = getMarkerSize(isSelected, precise);
          return (
            <AdvancedMarker
              key={group.key}
              position={{ lat: group.lat, lng: group.lng }}
              onClick={() => {
                if (onNavigate && typeof window !== "undefined" && window.innerWidth < LG_BREAKPOINT) {
                  onNavigate(event.id);
                } else {
                  onSelectEvent(event);
                }
              }}
              title={`${event.kennel?.shortName ?? ""}${event.title ? ` \u2014 ${event.title}` : ""}${event.startTime ? ` \u00B7 ${event.startTime}` : ""}`}
              ref={getRefCallback(group.key) as React.Ref<never>}
            >
              <div style={getMarkerStyle(size, color, precise, isSelected)} />
            </AdvancedMarker>
          );
        }

        // Multiple events at this location — render count badge
        // Use first event's color, or slate-500 if mixed
        const colors = new Set(group.events.map((e) => e.color));
        const badgeColor = colors.size === 1 ? firstEvent.color : "#64748b"; // slate-500
        const hasSelected = group.events.some((e) => selectedEventId === e.event.id);
        const kennelNames = group.events
          .map((e) => e.event.kennel?.shortName ?? "")
          .filter(Boolean)
          .join(", ");

        return (
          <AdvancedMarker
            key={group.key}
            position={{ lat: group.lat, lng: group.lng }}
            onClick={() => {
              onShowColocated(group.events, { lat: group.lat, lng: group.lng });
            }}
            title={`${group.events.length} events: ${kennelNames}`}
            ref={getRefCallback(group.key) as React.Ref<never>}
          >
            <div style={getGroupBadgeStyle(badgeColor, hasSelected)}>
              {group.events.length}
            </div>
          </AdvancedMarker>
        );
      })}
    </>
  );
}
