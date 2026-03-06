"use client";

import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MapPin, Loader2, X } from "lucide-react";
import type { GeoState } from "@/hooks/useGeolocation";
import { DISTANCE_OPTIONS } from "@/lib/geo";

interface NearMeFilterProps {
  readonly nearMeDistance: number | null;
  readonly onNearMeDistanceChange: (distance: number | null) => void;
  readonly geoState: GeoState;
  readonly onRequestLocation: () => void;
}

export function NearMeFilter({ nearMeDistance, onNearMeDistanceChange, geoState, onRequestLocation }: NearMeFilterProps) {
  // Defer geolocation support check to after mount to avoid SSR/hydration mismatch.
  const [geoSupported, setGeoSupported] = useState(true);
  useEffect(() => {
    setGeoSupported("geolocation" in navigator);
  }, []);

  if (!geoSupported) return null;

  // Active state: granted + distance selected
  if (geoState.status === "granted" && nearMeDistance != null) {
    return (
      <div className="flex items-center gap-1 rounded-md border bg-primary/5 px-2 py-1">
        <MapPin className="h-3 w-3 text-primary" />
        <span className="text-xs text-primary">Within</span>
        <div className="flex gap-0.5">
          {DISTANCE_OPTIONS.map((km) => (
            <Tooltip key={km}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => { onNearMeDistanceChange(km); }}
                  className={`rounded px-1.5 py-0.5 text-xs font-medium transition-colors ${
                    nearMeDistance === km
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {km} km
                </button>
              </TooltipTrigger>
              <TooltipContent>≈ {Math.round(km * 0.621)} mi</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <button
          onClick={() => { onNearMeDistanceChange(null); }}
          className="ml-0.5 rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Clear near me filter"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    );
  }

  // Loading state
  if (geoState.status === "loading") {
    return (
      <Button variant="outline" size="sm" className="h-8 text-xs" disabled>
        <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
        Getting location...
      </Button>
    );
  }

  // Denied state
  if (geoState.status === "denied") {
    return (
      <div className="flex shrink-0 items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-8 cursor-not-allowed text-xs opacity-60" disabled>
          <MapPin className="mr-1.5 h-3 w-3" />
          Near me
        </Button>
        <span className="text-xs text-destructive">Location blocked</span>
      </div>
    );
  }

  // Idle state
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-8 text-xs"
      onClick={() => {
        onRequestLocation();
        onNearMeDistanceChange(25); // default 25km
      }}
    >
      <MapPin className="mr-1.5 h-3 w-3" />
      Near me
    </Button>
  );
}
