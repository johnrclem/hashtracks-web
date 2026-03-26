"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { MapControl, ControlPosition } from "@vis.gl/react-google-maps";

const STORAGE_KEY = "map-precision-dismissed";

/**
 * Dismissible banner explaining the filled vs hollow pin distinction on map views.
 * Shared across hareline and kennel maps — dismissing on either map dismisses both.
 */
export function MapPrecisionBanner() {
  const [dismissed, setDismissed] = useState(true); // default true to avoid flash
  useEffect(() => {
    setDismissed(localStorage.getItem(STORAGE_KEY) === "true");
  }, []);

  if (dismissed) return null;

  return (
    <MapControl position={ControlPosition.TOP_CENTER}>
      <div className="mx-2 mt-2.5 flex items-center gap-2 rounded-md border bg-background/95 px-3 py-1.5 text-xs shadow-sm backdrop-blur-sm">
        <span>
          Filled pins = exact locations · Hollow pins = approximate region
          centers
        </span>
        <button
          onClick={() => {
            setDismissed(true);
            localStorage.setItem(STORAGE_KEY, "true");
          }}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
          aria-label="Dismiss precision info"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </MapControl>
  );
}
