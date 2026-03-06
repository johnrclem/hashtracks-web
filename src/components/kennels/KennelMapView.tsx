"use client";

import { useMemo } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker, MapControl, ControlPosition } from "@vis.gl/react-google-maps";
import { REGION_CENTROIDS, getRegionColor, getEventCoords } from "@/lib/geo";
import type { KennelCardData } from "./KennelCard";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";

interface KennelMapViewProps {
  kennels: KennelCardData[];
  onRegionSelect: (region: string) => void;
}

interface KennelPin {
  id: string;
  shortName: string;
  slug: string;
  lat: number;
  lng: number;
  color: string;
  precise: boolean;
}

interface RegionPin {
  region: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
}

export default function KennelMapView({ kennels, onRegionSelect }: KennelMapViewProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; // NOSONAR - NEXT_PUBLIC keys are intentionally browser-exposed

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
          slug: kennel.slug,
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
          >
            {/* Individual kennel pins */}
            {kennelPins.map((pin) => (
              <AdvancedMarker
                key={pin.id}
                position={{ lat: pin.lat, lng: pin.lng }}
                onClick={() => {
                  window.location.href = `/kennels/${pin.slug}`;
                }}
                title={pin.shortName}
              >
                <div
                  style={{
                    width: 28,
                    height: 28,
                    borderRadius: "50%",
                    backgroundColor: pin.color,
                    border: "2px solid white",
                    boxShadow: "0 1px 4px rgba(0,0,0,0.4)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: "9px",
                    fontWeight: "bold",
                    color: "white",
                    transition: "transform 0.15s ease",
                    userSelect: "none",
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1.2)"; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLDivElement).style.transform = "scale(1)"; }}
                />
              </AdvancedMarker>
            ))}

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
