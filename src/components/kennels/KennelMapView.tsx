"use client";

import { useMemo, useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { APIProvider, Map as GoogleMap, AdvancedMarker, InfoWindow, MapControl, ControlPosition, useMap } from "@vis.gl/react-google-maps";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { LocateFixed, Search } from "lucide-react";
import { REGION_CENTROIDS, getRegionColor, getEventCoords } from "@/lib/geo";
import { formatSchedule } from "@/lib/format";
import { ClusteredKennelMarkers, type KennelPin } from "./ClusteredKennelMarkers";
import { ColocatedKennelList } from "./ColocatedKennelList";
import type { KennelCardData } from "./KennelCard";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";
const VIEWPORT_STORAGE_KEY = "kennels-map-viewport";

interface KennelMapViewProps {
  kennels: KennelCardData[];
  onRegionSelect: (region: string) => void;
  onBoundsFilter?: (bounds: { south: number; north: number; west: number; east: number } | null) => void;
}

interface RegionPin {
  region: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
}

type MapBounds = { south: number; north: number; west: number; east: number };

/** Reset view button — fits map back to the initial bounds and clears saved viewport. */
function ResetViewControl({ bounds }: { bounds: MapBounds }) {
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
            try { sessionStorage.removeItem(VIEWPORT_STORAGE_KEY); } catch { /* noop */ }
          }}
          aria-label="Reset map to show all kennels"
        >
          <LocateFixed className="mr-1.5 h-3.5 w-3.5" />
          Reset view
        </Button>
      </div>
    </MapControl>
  );
}

/** Auto-zoom when pins change (e.g. filter applied). Skips if viewport was restored from session. */
function AutoZoom({ bounds, skipRef, autoZoomingRef }: { bounds: MapBounds | undefined; skipRef: React.RefObject<boolean>; autoZoomingRef: React.RefObject<boolean> }) {
  const map = useMap();
  const prevBoundsKeyRef = useRef("");
  const boundsKey = bounds ? `${bounds.south},${bounds.north},${bounds.west},${bounds.east}` : "";

  useEffect(() => {
    if (skipRef.current) {
      // Viewport was restored from sessionStorage — skip this auto-zoom cycle
      skipRef.current = false;
      prevBoundsKeyRef.current = boundsKey;
      return;
    }
    if (bounds && boundsKey !== prevBoundsKeyRef.current) {
      prevBoundsKeyRef.current = boundsKey;
      autoZoomingRef.current = true;
      map?.fitBounds(bounds, { top: 50, bottom: 50, left: 50, right: 50 });
    }
  }, [map, bounds, boundsKey, skipRef, autoZoomingRef]);

  return null;
}

/** Restore saved map viewport from sessionStorage on initial mount. */
function RestoreViewport({ onRestored }: { onRestored: () => void }) {
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

export default function KennelMapView({ kennels, onRegionSelect, onBoundsFilter }: KennelMapViewProps) {
  const [selectedKennelId, setSelectedKennelId] = useState<string | null>(null);
  const [colocatedList, setColocatedList] = useState<{ pins: KennelPin[]; position: { lat: number; lng: number } } | null>(null);
  const [showSearchButton, setShowSearchButton] = useState(false);
  const userInteractedRef = useRef(false);
  const skipAutoZoomRef = useRef(false);
  const autoZoomingRef = useRef(false);
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; // NOSONAR - NEXT_PUBLIC keys are intentionally browser-exposed

  const handleRestored = useCallback(() => {
    skipAutoZoomRef.current = true;
  }, []);

  // Build individual kennel pins (precise coords) and region aggregate pins (fallback)
  const { kennelPins, regionPins } = useMemo(() => {
    const kPins: KennelPin[] = [];
    const regionGroups = new Map<string, number>(); // region → count of imprecise kennels

    for (const kennel of kennels) {
      const coords = getEventCoords(kennel.latitude, kennel.longitude, kennel.region);
      if (!coords) {
        // No coords at all (no centroid) — skip
        continue;
      }

      if (coords.precise) {
        // Individual kennel pin
        kPins.push({
          id: kennel.id,
          shortName: kennel.shortName,
          fullName: kennel.fullName,
          slug: kennel.slug,
          region: kennel.region,
          schedule: formatSchedule(kennel),
          nextEvent: kennel.nextEvent,
          lat: coords.lat,
          lng: coords.lng,
          color: getRegionColor(kennel.region),
          precise: true,
        });
      } else {
        // Falls back to region centroid — aggregate into region pin
        regionGroups.set(kennel.region, (regionGroups.get(kennel.region) ?? 0) + 1);
      }
    }

    // Build region aggregate pins for imprecise kennels
    const rPins: RegionPin[] = [];
    for (const [region, count] of regionGroups.entries()) {
      const centroid = REGION_CENTROIDS[region];
      if (!centroid) continue;
      rPins.push({
        region,
        lat: centroid.lat,
        lng: centroid.lng,
        count,
        color: getRegionColor(region),
      });
    }

    return { kennelPins: kPins, regionPins: rPins };
  }, [kennels]);

  const allPinPositions = useMemo(() => {
    const positions: { lat: number; lng: number }[] = [
      ...kennelPins.map((p) => ({ lat: p.lat, lng: p.lng })),
      ...regionPins.map((p) => ({ lat: p.lat, lng: p.lng })),
    ];
    return positions;
  }, [kennelPins, regionPins]);

  // Compute bounding box
  const defaultBounds = useMemo(() => {
    if (allPinPositions.length === 0) return undefined;
    const pad = 1.0;
    const first = allPinPositions[0];
    let south = first.lat, north = first.lat, west = first.lng, east = first.lng;
    for (const p of allPinPositions) {
      if (p.lat < south) south = p.lat;
      if (p.lat > north) north = p.lat;
      if (p.lng < west) west = p.lng;
      if (p.lng > east) east = p.lng;
    }
    return {
      south: south - pad,
      north: north + pad,
      west: Math.max(-180, west - pad),
      east: Math.min(180, east + pad),
    };
  }, [allPinPositions]);

  const totalMapped = kennelPins.length + regionPins.reduce((sum, p) => sum + p.count, 0);
  const unmappedCount = kennels.length - totalMapped;

  // Map event handlers for "Search this area" + viewport persistence
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
      userInteractedRef.current = false; // Reset so button only reappears after next pan/zoom
    }
  }, []);

  if (!apiKey) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        Google Maps API key not configured.
      </div>
    );
  }

  if (allPinPositions.length === 0) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        No kennels to display on the map.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <APIProvider apiKey={apiKey}>
        <div className="h-[500px] overflow-hidden rounded-md border">
          <GoogleMap
            mapId={MAP_ID}
            defaultBounds={defaultBounds}
            gestureHandling="greedy"
            disableDefaultUI={false}
            mapTypeControl={false}
            streetViewControl={false}
            zoomControl={true}
            onClick={() => { setSelectedKennelId(null); setColocatedList(null); }}
            onDragend={handleDragEnd}
            onZoomChanged={handleZoomChanged}
            onIdle={handleIdle}
          >
            {/* Clustered individual kennel pins */}
            <ClusteredKennelMarkers
              pins={kennelPins}
              selectedPinId={selectedKennelId}
              onSelectPin={(id) => { setSelectedKennelId(id); setColocatedList(null); }}
              onShowColocated={(pinsAtLocation, position) => {
                setColocatedList({ pins: pinsAtLocation, position });
                setSelectedKennelId(null);
              }}
            />

            {/* InfoWindow for selected kennel */}
            {selectedKennelId && (() => {
              const pin = kennelPins.find((p) => p.id === selectedKennelId);
              if (!pin) return null;
              return (
                <InfoWindow
                  position={{ lat: pin.lat, lng: pin.lng }}
                  onCloseClick={() => setSelectedKennelId(null)}
                  pixelOffset={[0, -18]}
                >
                  <div className="min-w-[180px] max-w-[260px]" style={{ borderTop: `3px solid ${pin.color}`, paddingTop: 8 }}>
                    <p className="m-0 text-[14px] font-bold">{pin.shortName}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{pin.fullName}</p>
                    <Badge variant="outline" className="mt-1 text-[10px]">{pin.region}</Badge>
                    {pin.schedule && (
                      <p className="mt-1.5 text-xs text-muted-foreground">{pin.schedule}</p>
                    )}
                    <p className="mt-1 text-xs">
                      {pin.nextEvent ? (
                        <>
                          <span className="font-medium">Next run:</span>{" "}
                          {new Date(pin.nextEvent.date).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" })}
                          {pin.nextEvent.title && <span className="text-muted-foreground"> — {pin.nextEvent.title}</span>}
                        </>
                      ) : (
                        <span className="italic text-muted-foreground">No upcoming runs</span>
                      )}
                    </p>
                    <Link
                      href={`/kennels/${pin.slug}`}
                      className="mt-2 inline-block text-xs font-medium text-primary no-underline hover:underline"
                    >
                      View Kennel →
                    </Link>
                  </div>
                </InfoWindow>
              );
            })()}

            {/* Co-located kennel list overlay */}
            {colocatedList && (
              <AdvancedMarker
                position={colocatedList.position}
                zIndex={2000}
              >
                <div style={{ transform: "translate(-50%, -110%)" }}>
                  <ColocatedKennelList
                    pins={colocatedList.pins}
                    onSelectKennel={(id) => {
                      setSelectedKennelId(id);
                      setColocatedList(null);
                    }}
                    onClose={() => setColocatedList(null)}
                  />
                </div>
              </AdvancedMarker>
            )}

            {/* Reset view button */}
            {defaultBounds && <ResetViewControl bounds={defaultBounds} />}

            {/* "Search this area" button */}
            {showSearchButton && onBoundsFilter && (
              <SearchThisAreaButton onBoundsFilter={onBoundsFilter} onDone={() => setShowSearchButton(false)} />
            )}

            {/* Auto-zoom on filter change */}
            <AutoZoom bounds={defaultBounds} skipRef={skipAutoZoomRef} autoZoomingRef={autoZoomingRef} />

            {/* Restore viewport from sessionStorage on back-nav */}
            <RestoreViewport onRestored={handleRestored} />

            {/* Save viewport to sessionStorage on idle */}
            <SaveViewport />

            {/* Legend */}
            <MapControl position={ControlPosition.BOTTOM_LEFT}>
              <div className="m-2.5 rounded-md border bg-background/90 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
                <div className="flex items-center gap-3">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2.5 w-2.5 rounded-full bg-current" /> Kennel
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-3.5 w-3.5 rounded-full bg-current opacity-60" /> Region cluster
                  </span>
                </div>
              </div>
            </MapControl>

            {/* Region aggregate pins (for kennels without precise coords) */}
            {regionPins.map(({ region, lat, lng, count, color }) => {
              const size = Math.round(32 + Math.min(24, Math.log10(count + 1) * 24));
              return (
                <AdvancedMarker
                  key={`region-${region}`}
                  position={{ lat, lng }}
                  onClick={() => onRegionSelect(region)}
                  title={`${region} (${count} ${count === 1 ? "kennel" : "kennels"}) — click to filter`}
                >
                  <div
                    style={{
                      width: size,
                      height: size,
                      borderRadius: "50%",
                      backgroundColor: color,
                      border: "2px solid white",
                      boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontSize: size >= 40 ? "12px" : "10px",
                      fontWeight: "bold",
                      color: "white",
                      transition: "transform 0.15s ease",
                      userSelect: "none",
                      opacity: 0.8,
                    }}
                    onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.15)"; }}
                    onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
                  >
                    {count}
                  </div>
                </AdvancedMarker>
              );
            })}
          </GoogleMap>
        </div>
      </APIProvider>

      <p className="text-xs text-muted-foreground">
        {kennelPins.length} kennel {kennelPins.length === 1 ? "pin" : "pins"}
        {regionPins.length > 0 && ` · ${regionPins.length} region ${regionPins.length === 1 ? "cluster" : "clusters"}`}
        {unmappedCount > 0 && ` · ${unmappedCount} not on map`}
      </p>
    </div>
  );
}

/** Floating "Search this area" button — reads current map bounds and passes to parent. */
function SearchThisAreaButton({ onBoundsFilter, onDone }: { onBoundsFilter: (bounds: MapBounds) => void; onDone: () => void }) {
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
