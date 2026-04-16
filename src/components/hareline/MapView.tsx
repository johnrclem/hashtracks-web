"use client";

import { useMemo, useState, useEffect, useRef, useCallback, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { APIProvider, Map, MapControl, ControlPosition, useMap } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, LocateFixed, Search } from "lucide-react";
import { getEventCoords, getRegionColor } from "@/lib/geo";
import { useMapColorScheme } from "@/hooks/useMapColorScheme";
import { ClusteredMarkers, type EventWithCoords } from "./ClusteredMarkers";
import { ColocatedEventList } from "./ColocatedEventList";
import type { HarelineEvent } from "./EventCard";
import { MapPrecisionBanner as PrecisionBanner } from "@/components/shared/MapPrecisionBanner";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";
const VIEWPORT_STORAGE_KEY = "hareline-map-viewport";
const LG_BREAKPOINT = 1024;

/** Shared base styles for legend circle icons. */
const LEGEND_ICON_BASE: React.CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: "50%",
  opacity: 0.5,
};

type MapBounds = { south: number; north: number; west: number; east: number };

/** Reset view button — fits map back to the initial bounds, clears saved viewport, and clears bounds filter. */
function ResetViewControl({ bounds, onBoundsFilter }: Readonly<{ bounds: MapBounds; onBoundsFilter?: (bounds: MapBounds | null) => void }>) {
  const map = useMap();
  return (
    <MapControl position={ControlPosition.TOP_RIGHT}>
      <div className="m-2.5">
        <Button
          variant="outline"
          size="sm"
          className="bg-background shadow-sm"
          onClick={() => {
            map?.fitBounds(bounds);
            onBoundsFilter?.(null);
            try { sessionStorage.removeItem(VIEWPORT_STORAGE_KEY); } catch { /* noop */ }
          }}
          aria-label="Reset map to show all events"
        >
          <LocateFixed className="mr-1.5 h-3.5 w-3.5" />
          Reset view
        </Button>
      </div>
    </MapControl>
  );
}

// PrecisionBanner extracted to src/components/shared/MapPrecisionBanner.tsx

/** Auto-zoom when the events list changes (e.g. filter applied). Skips if viewport was restored from session. */
function AutoZoom({ bounds, skipRef, autoZoomingRef }: Readonly<{ bounds: { south: number; north: number; west: number; east: number } | undefined; skipRef?: RefObject<boolean>; autoZoomingRef?: RefObject<boolean> }>) {
  const map = useMap();
  const prevBoundsKeyRef = useRef("");
  const boundsKey = bounds ? `${bounds.south},${bounds.north},${bounds.west},${bounds.east}` : "";

  useEffect(() => {
    if (skipRef?.current) {
      skipRef.current = false;
      prevBoundsKeyRef.current = boundsKey;
      return;
    }
    if (bounds && boundsKey !== prevBoundsKeyRef.current) {
      prevBoundsKeyRef.current = boundsKey;
      if (autoZoomingRef) autoZoomingRef.current = true;
      map?.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
    }
  }, [map, bounds, boundsKey, skipRef, autoZoomingRef]);

  return null;
}

/** Restore saved map viewport from sessionStorage on initial mount. */
function RestoreViewport({ onRestored }: Readonly<{ onRestored: () => void }>) {
  const map = useMap();
  const restoredRef = useRef(false);

  useEffect(() => {
    if (!map || restoredRef.current) return;
    restoredRef.current = true;
    try {
      const saved = sessionStorage.getItem(VIEWPORT_STORAGE_KEY);
      if (saved) {
        const { center, zoom } = JSON.parse(saved);
        if (center?.lat != null && center?.lng != null && zoom != null) {
          map.setCenter(center);
          map.setZoom(zoom);
          onRestored();
        }
      }
    } catch { /* noop — corrupted or unavailable */ }
  }, [map, onRestored]);

  return null;
}

/** Floating "Search this area" button — reads current map bounds and passes to parent. */
function SearchThisAreaButton({ onBoundsFilter, onDone }: Readonly<{ onBoundsFilter: (bounds: MapBounds) => void; onDone: () => void }>) {
  const map = useMap();

  const handleClick = useCallback(() => {
    if (!map) return;
    const bounds = map.getBounds();
    if (!bounds) return;
    const sw = bounds.getSouthWest();
    const ne = bounds.getNorthEast();
    onBoundsFilter({
      south: sw.lat(),
      north: ne.lat(),
      west: sw.lng(),
      east: ne.lng(),
    });
    onDone();
  }, [map, onBoundsFilter, onDone]);

  return (
    <MapControl position={ControlPosition.TOP_CENTER}>
      <div className="mt-2.5">
        <Button
          variant="outline"
          size="sm"
          className="bg-background shadow-md"
          onClick={handleClick}
        >
          <Search className="mr-1.5 h-3.5 w-3.5" />
          Search this area
        </Button>
      </div>
    </MapControl>
  );
}

/** Saves the current map viewport to sessionStorage on every idle event. */
function SaveViewport() {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const listener = map.addListener("idle", () => {
      try {
        const center = map.getCenter();
        const zoom = map.getZoom();
        if (center && zoom != null) {
          sessionStorage.setItem(VIEWPORT_STORAGE_KEY, JSON.stringify({
            center: { lat: center.lat(), lng: center.lng() },
            zoom,
          }));
        }
      } catch { /* noop */ }
    });
    return () => { listener.remove(); };
  }, [map]);

  return null;
}

/** Props for the interactive MapView — renders hareline events as region-colored map pins. */
interface MapViewProps {
  readonly events: HarelineEvent[];
  /** Currently selected event ID (for highlighting its pin). */
  readonly selectedEventId?: string | null;
  /** Callback when a map pin is clicked. */
  readonly onSelectEvent: (event: HarelineEvent | null) => void;
  /** Filter events by region when a region cluster is clicked. */
  readonly onRegionFilter?: (region: string) => void;
  /** Callback when user clicks "Search this area" — passes visible map bounds for filtering. */
  readonly onBoundsFilter?: (bounds: MapBounds | null) => void;
}

/** State for the co-located event list overlay. */
interface ColocatedListState {
  events: EventWithCoords[];
  position: { lat: number; lng: number };
}

export default function MapView({ events, selectedEventId, onSelectEvent, onRegionFilter, onBoundsFilter }: Readonly<MapViewProps>) {
  const { colorScheme } = useMapColorScheme();
  const router = useRouter();
  const handleNavigate = useCallback((id: string) => router.push(`/hareline/${id}`), [router]);
  const skipAutoZoomRef = useRef(false);
  const autoZoomingRef = useRef(false);
  const userInteractedRef = useRef(false);
  const [showSearchButton, setShowSearchButton] = useState(false);
  const handleRestored = useCallback(() => { skipAutoZoomRef.current = true; }, []);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; // NOSONAR - NEXT_PUBLIC keys are intentionally browser-exposed

  // Mobile map expand/collapse state
  const [expanded, setExpanded] = useState(false);

  // Co-located event list overlay state
  const [colocatedList, setColocatedList] = useState<ColocatedListState | null>(null);

  const handleShowColocated = useCallback(
    (colocatedEvents: EventWithCoords[], position: { lat: number; lng: number }) => {
      setColocatedList({ events: colocatedEvents, position });
    },
    [],
  );

  const handleColocatedSelect = useCallback(
    (event: HarelineEvent) => {
      setColocatedList(null);
      if (globalThis.window && globalThis.window.innerWidth < LG_BREAKPOINT) {
        router.push(`/hareline/${event.id}`);
      } else {
        onSelectEvent(event);
      }
    },
    [onSelectEvent, router],
  );

  const handleColocatedClose = useCallback(() => {
    setColocatedList(null);
  }, []);

  // Map event handlers for "Search this area" interaction tracking
  const handleDragEnd = useCallback(() => {
    userInteractedRef.current = true;
  }, []);

  const handleZoomChanged = useCallback(() => {
    // Skip zoom events triggered by programmatic auto-zoom (fitBounds)
    if (!autoZoomingRef.current) {
      userInteractedRef.current = true;
    }
  }, []);

  const handleIdle = useCallback(() => {
    // Clear auto-zooming flag once the map settles after fitBounds
    autoZoomingRef.current = false;
    // Show "Search this area" button after user interaction
    if (userInteractedRef.current) {
      setShowSearchButton(true);
      userInteractedRef.current = false;
    }
  }, []);

  const eventsWithCoords = useMemo<EventWithCoords[]>(() => {
    return events.flatMap((event) => {
      const coords = getEventCoords(event.latitude, event.longitude, event.kennel?.region ?? "");
      if (!coords) return [];
      return [
        {
          event,
          lat: coords.lat,
          lng: coords.lng,
          precise: coords.precise,
          color: event.kennel?.region ? getRegionColor(event.kennel.region) : "#6b7280",
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
      <div className="flex h-[60vh] lg:h-[calc(100vh-14rem)] min-h-[300px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        Google Maps API key not configured.
      </div>
    );
  }

  if (eventsWithCoords.length === 0) {
    return (
      <div className="flex h-[60vh] lg:h-[calc(100vh-14rem)] min-h-[300px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        No events to display on the map.
      </div>
    );
  }

  return (
    <APIProvider apiKey={apiKey}>
      <div className={`relative ${expanded ? "h-[calc(100vh-8rem)]" : "h-[60vh]"} lg:h-[calc(100vh-14rem)] min-h-[300px] overflow-hidden rounded-md border transition-[height] duration-300`}>
        <Map
          mapId={MAP_ID}
          colorScheme={colorScheme}
          defaultBounds={defaultBounds}
          gestureHandling="greedy"
          disableDefaultUI={false}
          mapTypeControl={false}
          streetViewControl={false}
          zoomControl={true}
          onClick={() => {
            onSelectEvent(null);
            setColocatedList(null);
          }}
          onDragend={handleDragEnd}
          onZoomChanged={handleZoomChanged}
          onIdle={handleIdle}
        >
          <ClusteredMarkers
            events={eventsWithCoords}
            selectedEventId={selectedEventId}
            onSelectEvent={onSelectEvent}
            onNavigate={handleNavigate}
            onShowColocated={handleShowColocated}
            onRegionFilter={onRegionFilter}
          />

          {/* Reset view button */}
          {defaultBounds && (
            <ResetViewControl
              bounds={defaultBounds}
              onBoundsFilter={onBoundsFilter}
            />
          )}

          {/* "Search this area" button */}
          {showSearchButton && onBoundsFilter && (
            <SearchThisAreaButton
              onBoundsFilter={onBoundsFilter}
              onDone={() => setShowSearchButton(false)}
            />
          )}

          {/* Auto-zoom on filter change */}
          <AutoZoom bounds={defaultBounds} skipRef={skipAutoZoomRef} autoZoomingRef={autoZoomingRef} />

          {/* Restore viewport from sessionStorage on back-nav */}
          <RestoreViewport onRestored={handleRestored} />

          {/* Save viewport to sessionStorage on idle */}
          <SaveViewport />

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

        {/* Co-located event list overlay */}
        {colocatedList && (
          <div className="pointer-events-none absolute inset-0 z-10 flex items-end justify-center lg:items-center lg:justify-center">
            <div className="pointer-events-auto mb-4 w-full max-w-sm px-4 lg:mb-0 lg:px-0">
              <ColocatedEventList
                events={colocatedList.events}
                onSelectEvent={handleColocatedSelect}
                onClose={handleColocatedClose}
              />
            </div>
          </div>
        )}
      </div>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-center gap-1 w-full py-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors lg:hidden border-b"
      >
        {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        {expanded ? "Collapse map" : "Expand map"}
      </button>
    </APIProvider>
  );
}
