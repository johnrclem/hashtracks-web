"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ElementType,
  type ReactNode,
} from "react";
import {
  APIProvider,
  Map,
  MapControl,
  ControlPosition,
  useMap,
} from "@vis.gl/react-google-maps";
import { GoogleMapsOverlay } from "@deck.gl/google-maps";
import { HeatmapLayer } from "@deck.gl/aggregation-layers";
import type { Color } from "@deck.gl/core";
import { Flame, LocateFixed, Maximize2, X } from "lucide-react";
import { getRegionColor } from "@/lib/region";
import { useMapColorScheme } from "@/hooks/useMapColorScheme";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { computeHeatmapBounds, type MapBounds } from "@/lib/heatmap-bounds";

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

/**
 * Warm orange→deep red ramp tuned for the light grayscale basemap.
 * Smooth early alpha climb so satellite clusters bleed into one another
 * instead of reading as discrete dots.
 */
const LIGHT_COLOR_RANGE: Color[] = [
  [255, 210, 140, 0],
  [255, 180, 95, 60],
  [255, 135, 60, 125],
  [245, 85, 40, 180],
  [220, 40, 25, 220],
  [170, 10, 10, 245],
];

/**
 * Brighter yellow-orange→hot magenta ramp for dark mode so the heat reads
 * against the deep gray basemap without compressing into mud.
 */
const DARK_COLOR_RANGE: Color[] = [
  [255, 225, 140, 0],
  [255, 200, 95, 70],
  [255, 155, 60, 130],
  [255, 95, 65, 190],
  [255, 55, 115, 225],
  [255, 95, 170, 245],
];

/**
 * Heatmap tuning. Tweak these to taste:
 *  - `radiusPixels` ↑  → bigger kernel per point → more connected blob
 *  - `threshold`     ↓  → low-density edges stay visible (more glow)
 *  - `weightsTextureSize` ↓ → coarser aggregation grid → smoother blend
 *  - `intensity`     ↑  → brighter overall, mid colors reach further out
 *
 * `colorDomain` is intentionally left to auto: deck.gl's aggregated pixel
 * weights are gaussian-blurred densities (not raw counts), so guessing a
 * fixed upper bound crushes the whole gradient into the low-alpha range.
 */
const HEATMAP_TUNING = {
  radiusPixels: 85,
  threshold: 0.005,
  intensity: 1.3,
  weightsTextureSize: 256,
  opacity: 0.9,
} as const;

/** Stable id so deck.gl can diff and patch the layer in place across updates. */
const HEATMAP_LAYER_ID = "trail-heatmap";

/** Delay before falling back from `idle`-event attach to projection polling. */
const ATTACH_FALLBACK_MS = 800;
/** Cadence at which we re-check `map.getProjection()` while polling. */
const ATTACH_POLL_MS = 150;

export interface TrailLocation {
  lat: number;
  lng: number;
}

interface TrailLocationMapProps {
  locations: TrailLocation[];
  region: string;
}

/** Factory: build a fresh deck.gl `HeatmapLayer` for the given data + theme. */
function buildHeatmapLayer(locations: TrailLocation[], colorRange: Color[]) {
  return new HeatmapLayer<TrailLocation>({
    id: HEATMAP_LAYER_ID,
    data: locations,
    getPosition: (l) => [l.lng, l.lat],
    getWeight: 1,
    aggregation: "SUM",
    colorRange,
    ...HEATMAP_TUNING,
  });
}

/**
 * deck.gl heatmap mounted onto the host Google Map via GoogleMapsOverlay.
 *
 * The overlay attach is **deferred until the map's first `idle` event** —
 * `<Map defaultBounds=...>` calls `fitBounds()` asynchronously, so if we
 * attached immediately deck.gl would render once against the pre-fitBounds
 * world viewport (heatmap pixels at world scale = invisible) and then sit
 * idle until a user gesture nudged it. By waiting for `idle` we attach
 * after the viewport has settled, so the first paint already has the right
 * frame. If `idle` is significantly delayed, a polling fallback gated on
 * `map.getProjection()` returning a real projection attaches instead.
 */
function HeatmapOverlay({
  locations,
  colorRange,
}: Readonly<{ locations: TrailLocation[]; colorRange: Color[] }>) {
  const map = useMap();
  const overlayRef = useRef<GoogleMapsOverlay | null>(null);
  const latestRef = useRef({ locations, colorRange });
  useEffect(() => {
    latestRef.current = { locations, colorRange };
  }, [locations, colorRange]);

  useEffect(() => {
    if (!map) return;
    let overlay: GoogleMapsOverlay | null = null;
    let attached = false;
    let pollHandle: number | null = null;

    const attach = () => {
      if (attached) return;
      attached = true;
      const { locations: l, colorRange: c } = latestRef.current;
      overlay = new GoogleMapsOverlay({ layers: [buildHeatmapLayer(l, c)] });
      overlay.setMap(map);
      overlayRef.current = overlay;
    };

    const idleListener = google.maps.event.addListenerOnce(map, "idle", attach);

    const pollForReady = () => {
      pollHandle = null;
      if (attached) return;
      if (map.getProjection()) {
        attach();
      } else {
        pollHandle = window.setTimeout(pollForReady, ATTACH_POLL_MS);
      }
    };
    pollHandle = window.setTimeout(pollForReady, ATTACH_FALLBACK_MS);

    return () => {
      // Teardown order matters: cancel pending attach paths (poll timer
      // + idle listener) BEFORE finalizing the overlay, otherwise either
      // could fire against a finalized instance.
      if (pollHandle !== null) window.clearTimeout(pollHandle);
      google.maps.event.removeListener(idleListener);
      overlay?.finalize();
      overlayRef.current = null;
    };
  }, [map]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers: [buildHeatmapLayer(locations, colorRange)],
    });
  }, [locations, colorRange]);

  return null;
}

/**
 * Reset-view control — re-fits to the IQR-trimmed bounds after the user
 * pans/zooms away. Rendered only inside the fullscreen Dialog (the card
 * map is locked so there's nothing to reset).
 */
function ResetViewControl({ bounds }: Readonly<{ bounds: MapBounds }>) {
  const map = useMap();
  return (
    <MapControl position={ControlPosition.RIGHT_BOTTOM}>
      <div className="m-2.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 bg-background/95 px-2.5 text-xs font-medium shadow-md ring-1 ring-border/40 backdrop-blur transition-colors hover:bg-background"
          onClick={() => map?.fitBounds(bounds)}
          aria-label="Reset trail heatmap to default view"
        >
          <LocateFixed className="h-3.5 w-3.5" />
          Reset view
        </Button>
      </div>
    </MapControl>
  );
}

interface HeatmapHeaderProps {
  regionColor: string;
  locationLabel: string;
  /**
   * Title element — defaults to `span` so the header is valid phrasing
   * content inside the card's `<button>` trigger. The dialog passes
   * `DialogTitle` (Radix handles the heading semantics there).
   */
  TitleAs?: ElementType;
  /** Tailwind tone class for the title (e.g. `"text-foreground/70"`). */
  titleToneClass?: string;
  /** Tailwind width class for the region-color accent strip (e.g. `"w-[3px]"`). */
  accentClass?: string;
  /**
   * Right-side adornment — caller owns its wrapper so each surface can use
   * its own padding/tap-target sizing (subtle hint icon in the card, full
   * close button in the dialog).
   */
  adornment?: ReactNode;
}

/** Shared eyebrow header used by both the card trigger and the fullscreen dialog. */
function HeatmapHeader({
  regionColor,
  locationLabel,
  TitleAs = "span",
  titleToneClass = "text-foreground/70",
  accentClass = "w-[3px]",
  adornment,
}: Readonly<HeatmapHeaderProps>) {
  return (
    <div className="flex items-stretch justify-between gap-3">
      <div className="flex items-stretch gap-3">
        <div
          aria-hidden
          className={`${accentClass} shrink-0`}
          style={{ backgroundColor: regionColor }}
        />
        <div className="flex flex-col justify-center gap-0.5 py-3">
          <TitleAs
            className={`flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.14em] uppercase ${titleToneClass}`}
          >
            <Flame
              className="h-3.5 w-3.5"
              style={{ color: regionColor }}
              aria-hidden
            />
            Trail Heatmap
          </TitleAs>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {locationLabel}
          </span>
        </div>
      </div>
      {adornment}
    </div>
  );
}

interface HeatmapSurfaceProps {
  interactive: boolean;
  locations: TrailLocation[];
  bounds: MapBounds | undefined;
  colorRange: Color[];
  mapStyles: google.maps.MapTypeStyle[];
}

/**
 * Unified `<Map>` surface — `interactive` toggles gestures, zoom controls,
 * zoom limits, and whether the reset-view button mounts. Used at the card
 * (interactive=false, locked teaser) and inside the dialog (interactive=true).
 */
function HeatmapSurface({
  interactive,
  locations,
  bounds,
  colorRange,
  mapStyles,
}: Readonly<HeatmapSurfaceProps>) {
  return (
    <Map
      defaultBounds={bounds}
      styles={mapStyles}
      gestureHandling={interactive ? "greedy" : "none"}
      disableDefaultUI={!interactive}
      zoomControl={interactive}
      mapTypeControl={false}
      streetViewControl={false}
      fullscreenControl={false}
      clickableIcons={false}
      keyboardShortcuts={interactive}
      minZoom={interactive ? 3 : undefined}
      maxZoom={interactive ? 16 : undefined}
    >
      <HeatmapOverlay locations={locations} colorRange={colorRange} />
      {interactive && bounds && <ResetViewControl bounds={bounds} />}
    </Map>
  );
}

export function TrailLocationMap({ locations, region }: TrailLocationMapProps) {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  const { colorScheme } = useMapColorScheme();
  const regionColor = getRegionColor(region);
  const isDark = colorScheme === "DARK";
  const mapStyles = isDark ? DARK_GRAYSCALE_STYLES : LIGHT_GRAYSCALE_STYLES;
  const colorRange = isDark ? DARK_COLOR_RANGE : LIGHT_COLOR_RANGE;
  const bounds = useMemo(() => computeHeatmapBounds(locations), [locations]);
  const [fullscreenOpen, setFullscreenOpen] = useState(false);

  if (!apiKey || locations.length === 0) return null;

  const locationLabel = `${locations.length.toLocaleString()} location${
    locations.length === 1 ? "" : "s"
  }`;

  // Single hoisted APIProvider — shared by the card and (when open) the
  // dialog's surface so the Maps JS API loader + library cache are shared.
  return (
    <APIProvider apiKey={apiKey}>
      <Dialog open={fullscreenOpen} onOpenChange={setFullscreenOpen}>
        <DialogTrigger asChild>
          <button
            type="button"
            className="group block w-full overflow-hidden rounded-xl border border-border/50 bg-card text-left shadow-sm transition-all hover:border-border hover:shadow-md focus-visible:ring-ring focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
            aria-label={`Open trail heatmap (${locationLabel}) in fullscreen`}
          >
            <HeatmapHeader
              regionColor={regionColor}
              locationLabel={locationLabel}
              adornment={
                <div className="flex items-center pr-3 sm:pr-4" aria-hidden>
                  <Maximize2 className="h-3.5 w-3.5 text-muted-foreground/40 transition-colors duration-200 group-hover:text-muted-foreground group-focus-visible:text-muted-foreground" />
                </div>
              }
            />

            {/* Locked map — pointer-events disabled so clicks bubble to the
                button. Unmounted while the Dialog is open so we don't hold
                two WebGL contexts at once. The Dialog is opaque, so the
                unmount is invisible to the user. */}
            <div
              className="relative h-[240px] sm:h-[300px] pointer-events-none"
              aria-hidden
            >
              {!fullscreenOpen && (
                <HeatmapSurface
                  interactive={false}
                  locations={locations}
                  bounds={bounds}
                  colorRange={colorRange}
                  mapStyles={mapStyles}
                />
              )}
            </div>
          </button>
        </DialogTrigger>
        <DialogContent
          aria-describedby={undefined}
          showCloseButton={false}
          className="grid h-[100dvh] max-h-[100dvh] w-screen max-w-[100vw] translate-x-[-50%] translate-y-[-50%] grid-rows-[auto_1fr] gap-0 rounded-none border-0 bg-background p-0"
        >
          <div className="border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
            <HeatmapHeader
              regionColor={regionColor}
              locationLabel={locationLabel}
              TitleAs={DialogTitle}
              titleToneClass="text-foreground/80"
              accentClass="w-1"
              adornment={
                <button
                  type="button"
                  onClick={() => setFullscreenOpen(false)}
                  className="ring-offset-background focus-visible:ring-ring inline-flex h-12 w-12 items-center justify-center text-muted-foreground transition-colors hover:bg-muted/60 hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
                  aria-label="Close fullscreen"
                >
                  <X className="h-4 w-4" />
                </button>
              }
            />
          </div>
          <div className="relative min-h-0">
            <HeatmapSurface
              interactive
              locations={locations}
              bounds={bounds}
              colorRange={colorRange}
              mapStyles={mapStyles}
            />
          </div>
        </DialogContent>
      </Dialog>
    </APIProvider>
  );
}
