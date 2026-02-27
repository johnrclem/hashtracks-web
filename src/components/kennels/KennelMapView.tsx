"use client";

import { useMemo } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import type { KennelCardData } from "./KennelCard";

const MAP_ID = "6e8b0a11ead2ddaa6c87840c";

interface KennelMapViewProps {
  kennels: KennelCardData[];
  onRegionSelect: (regionSlug: string) => void;
}

interface RegionPin {
  slug: string;
  name: string;
  lat: number;
  lng: number;
  count: number;
  color: string;
}

export default function KennelMapView({ kennels, onRegionSelect }: KennelMapViewProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY; // NOSONAR - NEXT_PUBLIC keys are intentionally browser-exposed

  // Group kennels by region slug and compute pin positions
  const regionPins = useMemo<RegionPin[]>(() => {
    const groups = new Map<string, { name: string; count: number; lat: number; lng: number; color: string }>();
    for (const kennel of kennels) {
      const rd = kennel.regionData;
      const existing = groups.get(rd.slug);
      if (existing) {
        existing.count++;
      } else {
        if (rd.centroidLat == null || rd.centroidLng == null) continue;
        groups.set(rd.slug, {
          name: rd.name,
          count: 1,
          lat: rd.centroidLat,
          lng: rd.centroidLng,
          color: rd.pinColor,
        });
      }
    }

    const pins: RegionPin[] = [];
    for (const [slug, data] of groups.entries()) {
      pins.push({ slug, ...data });
    }
    return pins;
  }, [kennels]);

  // Compute bounding box (iterative to avoid spread stack overflow)
  const defaultBounds = useMemo(() => {
    if (regionPins.length === 0) return undefined;
    const pad = 1.0;
    const first = regionPins[0];
    let south = first.lat, north = first.lat, west = first.lng, east = first.lng;
    for (const p of regionPins) {
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
  }, [regionPins]);

  // Unmapped kennels (no centroid in region)
  const unmappedCount = useMemo(() => {
    const mappedSlugs = new Set(regionPins.map((p) => p.slug));
    return kennels.filter((k) => !mappedSlugs.has(k.regionData.slug)).length;
  }, [kennels, regionPins]);

  if (!apiKey) {
    return (
      <div className="flex h-[500px] items-center justify-center rounded-md border text-sm text-muted-foreground">
        Google Maps API key not configured.
      </div>
    );
  }

  if (regionPins.length === 0) {
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
            {regionPins.map(({ slug, name, lat, lng, count, color }) => {
              // Pin size scales logarithmically: 32px for 1 kennel, up to ~56px for 10+
              const size = Math.round(32 + Math.min(24, Math.log10(count + 1) * 24));
              return (
                <AdvancedMarker
                  key={slug}
                  position={{ lat, lng }}
                  onClick={() => onRegionSelect(slug)}
                  title={`${name} (${count} ${count === 1 ? "kennel" : "kennels"}) — click to filter`}
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
                      transform: "scale(1)",
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
        {regionPins.length} {regionPins.length === 1 ? "region" : "regions"} · {kennels.length - unmappedCount} kennels shown · click a pin to filter
        {unmappedCount > 0 && ` · ${unmappedCount} kennels not on map`}
      </p>
    </div>
  );
}
