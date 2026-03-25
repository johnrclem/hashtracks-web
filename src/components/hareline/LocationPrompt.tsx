"use client";

import { useState, useEffect, useRef } from "react";
import { track } from "@vercel/analytics";
import { MapPin, Loader2, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useGeolocation } from "@/hooks/useGeolocation";
import { getLocationPref, setLocationPref } from "@/lib/location-pref";

const SESSION_KEY = "hashtracks:locationPromptDismissed";

interface LocationPromptProps {
  readonly hasUrlFilters: boolean;
  readonly onSetNearMe: (distance: number) => void;
  readonly onSetRegion: (region: string) => void;
  readonly regionNames: string[];
  /** Which page this prompt is shown on (for analytics). */
  readonly page?: "hareline" | "kennels";
}

export function LocationPrompt({
  hasUrlFilters,
  onSetNearMe,
  onSetRegion,
  regionNames,
  page = "hareline",
}: LocationPromptProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [geoState, requestLocation] = useGeolocation();
  const handledRef = useRef(false);

  // SSR-safe mount check + visibility determination
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);

    // Don't show if URL already has filters
    if (hasUrlFilters) return;

    // Don't show if user has a stored preference
    const pref = getLocationPref();
    if (pref) return;

    // Don't show if dismissed this session
    try {
      if (sessionStorage.getItem(SESSION_KEY)) return;
    } catch {
      // sessionStorage unavailable
    }

    setVisible(true);
    track("location_prompt_shown", { page });
  }, [hasUrlFilters, page]);

  // When geolocation is granted after user clicks "Use my location", apply the filter
  useEffect(() => {
    if (geoState.status === "granted" && !handledRef.current) {
      handledRef.current = true;
      setLocationPref({ type: "nearMe", distance: 50 });
      onSetNearMe(50);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setVisible(false);
    }
  }, [geoState.status, onSetNearMe]);

  if (!mounted || !visible) return null;

  function handleDismiss() {
    track("location_prompt_action", { action: "dismiss" });
    try {
      sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      // Best-effort
    }
    setVisible(false);
  }

  function handleUseLocation() {
    track("location_prompt_action", { action: "geolocation" });
    requestLocation();
  }

  function handleSelectRegion(region: string) {
    track("location_prompt_action", { action: "region" });
    setLocationPref({ type: "region", name: region });
    onSetRegion(region);
    setRegionOpen(false);
    setVisible(false);
  }

  const isLoading = geoState.status === "loading";
  const isDenied = geoState.status === "denied";

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5 sm:gap-3 sm:px-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
        <span className="font-medium">Find runs near you</span>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {/* Use my location button */}
        <Button
          variant="outline"
          size="sm"
          className="h-7 text-xs"
          onClick={handleUseLocation}
          disabled={isLoading}
        >
          {isLoading ? (
            <>
              <Loader2 className="mr-1 h-3 w-3 animate-spin" />
              Locating...
            </>
          ) : (
            <>
              <MapPin className="mr-1 h-3 w-3" />
              Use my location
            </>
          )}
        </Button>

        {isDenied && (
          <span className="text-xs text-destructive">Location blocked</span>
        )}

        <span className="text-xs text-muted-foreground">or</span>

        {/* Region picker */}
        <Popover open={regionOpen} onOpenChange={setRegionOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
            >
              Pick a region
              <ChevronDown className="ml-1 h-3 w-3" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-64 max-w-[calc(100vw-2rem)] p-0" align="start">
            <Command>
              <CommandInput placeholder="Search regions..." />
              <CommandList>
                <CommandEmpty>No regions found.</CommandEmpty>
                {regionNames.map((region) => (
                  <CommandItem
                    key={region}
                    value={region}
                    onSelect={() => handleSelectRegion(region)}
                  >
                    {region}
                  </CommandItem>
                ))}
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      </div>

      {/* Dismiss */}
      <button
        type="button"
        onClick={handleDismiss}
        className="ml-auto rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
        aria-label="Dismiss location prompt"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
