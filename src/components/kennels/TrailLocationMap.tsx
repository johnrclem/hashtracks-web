"use client";

import { useMemo, useEffect, useRef } from "react";
import { APIProvider, Map, useMap, useMapsLibrary } from "@vis.gl/react-google-maps";
import { getRegionColor } from "@/lib/region";
import { useMapColorScheme } from "@/hooks/useMapColorScheme";
import { Flame } from "lucide-react";

/** Grayscale basemap so the warm heatmap pops against muted terrain (light mode). */
const LIGHT_GRAYSCALE_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ saturation: -100 }, { lightness: 10 }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#666666" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#f5f5f5" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#e0e0e0" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ lightness: 20 }] },
];

/** Grayscale basemap for dark mode. */
const DARK_GRAYSCALE_STYLES: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ saturation: -100 }, { lightness: -70 }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#aaaaaa" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#1a1a1a" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#2a2a2a" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ lightness: -60 }] },
];

interface TrailLocation {
  lat: number;
  lng: number;
}

interface TrailHeatmapProps {
  locations: TrailLocation[];
  region: string;
}

/** Inner component that creates the native HeatmapLayer (must be inside APIProvider + Map). */
function HeatmapOverlay({ locations }: { locations: TrailLocation[] }) {
  const map = useMap();
  const visualization = useMapsLibrary("visualization");
  const heatmapRef = useRef<google.maps.visualization.HeatmapLayer | null>(null);

  useEffect(() => {
    if (!map || !visualization) return;

    const data = locations.map(
      (l) => new google.maps.LatLng(l.lat, l.lng),
    );

    const heatmap = new visualization.HeatmapLayer({
      data,
      map,
      radius: 35,
      opacity: 0.8,
      gradient: [
        "rgba(0, 0, 0, 0)",
        "rgba(255, 140, 50, 0.2)",
        "rgba(255, 100, 40, 0.4)",
        "rgba(240, 60, 30, 0.6)",
        "rgba(220, 30, 20, 0.8)",
        "rgba(180, 10, 10, 0.95)",
      ],
    });

    heatmapRef.current = heatmap;

    return () => {
      heatmap.setMap(null);
      heatmapRef.current = null;
    };
  }, [map, visualization, locations]);

  return null;
}

export function TrailLocationMap({ locations, region }: TrailHeatmapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const { colorScheme: scheme } = useMapColorScheme();
  const regionColor = getRegionColor(region);
  const mapStyles = scheme === "DARK" ? DARK_GRAYSCALE_STYLES : LIGHT_GRAYSCALE_STYLES;

  const bounds = useMemo(() => {
    if (locations.length === 0) return undefined;
    const pad = 0.015;

    // Filter geocoding outliers using IQR (Tukey fences) so bad geocodes
    // don't zoom the map out to show the entire globe.
    // Skip filtering for small datasets where IQR can be overly aggressive.
    let pts = locations;
    if (locations.length >= 8) {
      const sorted = (vals: number[]) => [...vals].sort((a, b) => a - b);
      const lats = sorted(locations.map((l) => l.lat));
      const lngs = sorted(locations.map((l) => l.lng));
      const q1 = (arr: number[]) => arr[Math.floor(arr.length * 0.25)];
      const q3 = (arr: number[]) => arr[Math.floor(arr.length * 0.75)];

      const latQ1 = q1(lats), latQ3 = q3(lats);
      const lngQ1 = q1(lngs), lngQ3 = q3(lngs);
      const latIqr = latQ3 - latQ1;
      const lngIqr = lngQ3 - lngQ1;

      const inliers = locations.filter(
        (l) =>
          l.lat >= latQ1 - 1.5 * latIqr && l.lat <= latQ3 + 1.5 * latIqr &&
          l.lng >= lngQ1 - 1.5 * lngIqr && l.lng <= lngQ3 + 1.5 * lngIqr,
      );
      if (inliers.length > 0) pts = inliers;
    }

    let south = pts[0].lat, north = pts[0].lat;
    let west = pts[0].lng, east = pts[0].lng;
    for (const loc of pts) {
      if (loc.lat < south) south = loc.lat;
      if (loc.lat > north) north = loc.lat;
      if (loc.lng < west) west = loc.lng;
      if (loc.lng > east) east = loc.lng;
    }
    return {
      south: south - pad,
      north: north + pad,
      west: west - pad,
      east: east + pad,
    };
  }, [locations]);

  if (!apiKey || locations.length === 0) return null;

  return (
    <div className="rounded-xl border border-border/50 bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 sm:px-5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold tracking-wide text-foreground/70 uppercase">
          <Flame className="h-3.5 w-3.5" style={{ color: regionColor }} />
          Trail Heatmap
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {locations.length} location{locations.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Heatmap */}
      <APIProvider apiKey={apiKey} libraries={["visualization"]}>
        <div className="h-[240px] sm:h-[300px]">
          <Map
            defaultBounds={bounds}
            styles={mapStyles}
            gestureHandling="none"
            disableDefaultUI
            zoomControl={false}
            mapTypeControl={false}
            streetViewControl={false}
            fullscreenControl={false}
            clickableIcons={false}
          >
            <HeatmapOverlay locations={locations} />
          </Map>
        </div>
      </APIProvider>
    </div>
  );
}
