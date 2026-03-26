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
import { getLocationPref, setLocationPref, clearLocationPref } from "@/lib/location-pref";

const SESSION_KEY = "hashtracks:locationPromptDismissed";
const DISMISS_COUNT_KEY = "hashtracks:locationPromptDismissCount";
const PERMANENT_DISMISS_KEY = "hashtracks:locationPromptPermanentlyDismissed";
const RETURN_BANNER_DISMISSED_KEY = "hashtracks:returnBannerDismissed";
const PERMANENT_DISMISS_THRESHOLD = 3;

interface LocationPromptProps {
  readonly hasUrlFilters: boolean;
  readonly onSetNearMe: (distance: number) => void;
  readonly onSetRegion: (region: string) => void;
  readonly regionNames: string[];
  /** Which page this prompt is shown on (for analytics). */
  readonly page?: "hareline" | "kennels";
  /** True when a stored preference was auto-applied (return visitor). */
  readonly prefApplied?: boolean;
  /** The region name that was auto-applied. */
  readonly appliedRegionName?: string;
  /** Clears the region filter and preference. */
  readonly onClearRegion?: () => void;
}

export function LocationPrompt({
  hasUrlFilters,
  onSetNearMe,
  onSetRegion,
  regionNames,
  page = "hareline",
  prefApplied = false,
  appliedRegionName,
  onClearRegion,
}: LocationPromptProps) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [returnBannerDismissed, setReturnBannerDismissed] = useState(false);
  const [regionOpen, setRegionOpen] = useState(false);
  const [geoState, requestLocation] = useGeolocation();
  const handledRef = useRef(false);

  // SSR-safe mount check + visibility determination
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMounted(true);

    // Check if return banner was previously dismissed this session
    try {
      if (sessionStorage.getItem(RETURN_BANNER_DISMISSED_KEY)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setReturnBannerDismissed(true);
      }
    } catch {
      // sessionStorage unavailable
    }

    // Don't show if URL already has filters
    if (hasUrlFilters) return;

    // Don't show if user has a stored preference (they'll see the return banner instead)
    const pref = getLocationPref();
    if (pref) return;

    // Don't show if permanently dismissed (3+ times)
    try {
      if (localStorage.getItem(PERMANENT_DISMISS_KEY) === "true") return;
    } catch {
      // localStorage unavailable
    }

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

  if (!mounted) return null;

  // Return visitor banner: shown when a stored preference was auto-applied
  const showReturnBanner = prefApplied && appliedRegionName && !returnBannerDismissed;

  // First-visit prompt: shown when no preference exists and not dismissed
  const showFirstVisit = visible && !prefApplied;

  if (!showReturnBanner && !showFirstVisit) return null;

  function handleDismiss() {
    // Session dismiss
    try {
      sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      // Best-effort
    }
    // Count dismissals — after 3, make it permanent
    try {
      const count = parseInt(localStorage.getItem(DISMISS_COUNT_KEY) ?? "0", 10);
      const newCount = count + 1;
      localStorage.setItem(DISMISS_COUNT_KEY, String(newCount));
      if (newCount >= PERMANENT_DISMISS_THRESHOLD) {
        localStorage.setItem(PERMANENT_DISMISS_KEY, "true");
      }
    } catch {
      // Best-effort
    }
    setVisible(false);
    track("location_prompt_action", { action: "dismiss" });
  }

  function handleReturnBannerDismiss() {
    try {
      sessionStorage.setItem(SESSION_KEY, "true");
    } catch {
      // Best-effort
    }
    try {
      sessionStorage.setItem(RETURN_BANNER_DISMISSED_KEY, "true");
    } catch {
      // Best-effort
    }
    setReturnBannerDismissed(true);
    track("location_prompt_action", { action: "dismiss_return_banner" });
  }

  function handleShowAll() {
    track("location_prompt_action", { action: "show_all" });
    onClearRegion?.();
    clearLocationPref();
    setReturnBannerDismissed(true);
  }

  function handleChangeRegion() {
    track("location_prompt_action", { action: "change_region" });
    setRegionOpen(true);
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
    setReturnBannerDismissed(true);
  }

  const isLoading = geoState.status === "loading";
  const isDenied = geoState.status === "denied";

  // Return visitor banner
  if (showReturnBanner) {
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/50 bg-muted/40 px-3 py-2.5 sm:gap-3 sm:px-4">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <MapPin className="h-4 w-4 shrink-0 text-orange-500" />
          <span className="font-medium">Showing events near {appliedRegionName}</span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Change region — opens the region picker */}
          <Popover open={regionOpen} onOpenChange={setRegionOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={handleChangeRegion}
              >
                Change
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

          {/* Show all — clears region filter and preference */}
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={handleShowAll}
          >
            Show all
          </Button>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={handleReturnBannerDismiss}
          className="ml-auto rounded p-1 text-muted-foreground/60 transition-colors hover:text-foreground"
          aria-label="Dismiss location banner"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  // First-visit prompt
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
