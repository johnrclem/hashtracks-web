"use client";

import { useMemo, useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MapPin, Loader2, X } from "lucide-react";
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";
import { toggleArrayItem } from "@/lib/format";
import type { HarelineEvent } from "./EventCard";
import type { GeoState } from "@/hooks/useGeolocation";
import { DISTANCE_OPTIONS } from "@/lib/geo";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Small inline clear button used inside filter trigger buttons. */
function ClearFilterButton({ onClick, label }: Readonly<{ onClick: () => void; label: string }>) {
  return (
    <span
      className="ml-1 rounded-full p-0.5 hover:bg-muted"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      onMouseDown={(e) => { e.preventDefault(); }}
      aria-label={label}
    >
      <X className="h-3 w-3" />
    </span>
  );
}

interface EventFiltersProps {
  readonly events: HarelineEvent[];
  readonly isAuthenticated: boolean;
  readonly hasSubscriptions: boolean;
  readonly scope: "my" | "all";
  readonly onScopeChange: (scope: "my" | "all") => void;
  readonly selectedRegions: string[];
  readonly onRegionsChange: (regions: string[]) => void;
  readonly selectedKennels: string[];
  readonly onKennelsChange: (kennels: string[]) => void;
  readonly selectedDays: string[];
  readonly onDaysChange: (days: string[]) => void;
  readonly selectedCountry: string;
  readonly onCountryChange: (country: string) => void;
  readonly nearMeDistance: number | null;
  readonly onNearMeDistanceChange: (distance: number | null) => void;
  readonly geoState: GeoState;
  readonly onRequestLocation: () => void;
  readonly activeFilterCount: number;
  readonly onClearAll: () => void;
}

export function EventFilters({
  events,
  isAuthenticated,
  hasSubscriptions,
  scope,
  onScopeChange,
  selectedRegions,
  onRegionsChange,
  selectedKennels,
  onKennelsChange,
  selectedDays,
  onDaysChange,
  selectedCountry,
  onCountryChange,
  nearMeDistance,
  onNearMeDistanceChange,
  geoState,
  onRequestLocation,
  activeFilterCount,
  onClearAll,
}: EventFiltersProps) {
  // Derive available regions and kennels from events
  const regions = useMemo(() => {
    const regionSet = new Set(events.map((e) => e.kennel.region));
    return Array.from(regionSet).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const kennels = useMemo(() => {
    const kennelMap = new Map<string, { id: string; shortName: string; fullName: string; region: string }>();
    for (const e of events) {
      if (!kennelMap.has(e.kennel.id)) {
        kennelMap.set(e.kennel.id, {
          id: e.kennel.id,
          shortName: e.kennel.shortName,
          fullName: e.kennel.fullName,
          region: e.kennel.region,
        });
      }
    }
    // Filter by selected regions if any
    const all = Array.from(kennelMap.values());
    if (selectedRegions.length > 0) {
      return all.filter((k) => selectedRegions.includes(k.region));
    }
    return all.sort((a, b) => a.shortName.localeCompare(b.shortName));
  }, [events, selectedRegions]);

  const countries = useMemo(() => {
    const countrySet = new Set<string>();
    for (const e of events) {
      if (e.kennel.country) countrySet.add(e.kennel.country);
    }
    return Array.from(countrySet).sort((a, b) => a.localeCompare(b));
  }, [events]);

  function toggleRegion(region: string) {
    onRegionsChange(toggleArrayItem(selectedRegions, region));
  }

  function toggleKennel(kennelId: string) {
    onKennelsChange(toggleArrayItem(selectedKennels, kennelId));
  }

  function toggleDay(day: string) {
    onDaysChange(toggleArrayItem(selectedDays, day));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {/* My Kennels / All Kennels scope */}
        {isAuthenticated && hasSubscriptions && (
          <fieldset className="flex shrink-0 rounded-md border" aria-label="Kennel scope">
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scope === "my"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              } rounded-l-md`}
              onClick={() => onScopeChange("my")}
              aria-pressed={scope === "my"}
            >
              My Kennels
            </button>
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scope === "all"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              } rounded-r-md`}
              onClick={() => onScopeChange("all")}
              aria-pressed={scope === "all"}
            >
              All Kennels
            </button>
          </fieldset>
        )}

        {/* Region filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={selectedRegions.length > 0 ? "secondary" : "outline"}
              size="sm"
              className={`h-8 shrink-0 text-xs ${selectedRegions.length > 0 ? "border-primary/50" : ""}`}
            >
              {selectedRegions.length === 1 ? `Region: ${selectedRegions[0]}` : "Region"}
              {selectedRegions.length > 1 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedRegions.length}
                </Badge>
              )}
              {selectedRegions.length > 0 && (
                <ClearFilterButton onClick={() => onRegionsChange([])} label="Clear region filter" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search regions..." />
              <CommandList role="listbox">
                <CommandEmpty>No regions found.</CommandEmpty>
                <CommandGroup>
                  {regions.map((region) => (
                    <CommandItem
                      key={region}
                      onSelect={() => toggleRegion(region)}
                      role="option"
                      aria-selected={selectedRegions.includes(region)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedRegions.includes(region)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedRegions.includes(region) && "✓"}
                      </span>
                      {region}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Kennel filter */}
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant={selectedKennels.length > 0 ? "secondary" : "outline"}
              size="sm"
              className={`h-8 shrink-0 text-xs ${selectedKennels.length > 0 ? "border-primary/50" : ""}`}
            >
              Kennel
              {selectedKennels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedKennels.length}
                </Badge>
              )}
              {selectedKennels.length > 0 && (
                <ClearFilterButton onClick={() => onKennelsChange([])} label="Clear kennel filter" />
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search kennels..." />
              <CommandList role="listbox">
                <CommandEmpty>No kennels found.</CommandEmpty>
                <CommandGroup>
                  {kennels.map((kennel) => (
                    <CommandItem
                      key={kennel.id}
                      value={`${kennel.shortName} ${kennel.fullName} ${kennel.region}`}
                      onSelect={() => toggleKennel(kennel.id)}
                      role="option"
                      aria-selected={selectedKennels.includes(kennel.id)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedKennels.includes(kennel.id)
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedKennels.includes(kennel.id) && "✓"}
                      </span>
                      <KennelOptionLabel kennel={kennel} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>

        {/* Day of week chips */}
        <fieldset className="contents" aria-label="Day of week filter">
          <div className="flex shrink-0 gap-1">
            {DAYS_OF_WEEK.map((day) => (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                aria-pressed={selectedDays.includes(day)}
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  selectedDays.includes(day)
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border text-muted-foreground hover:text-foreground"
                }`}
              >
                {day}
              </button>
            ))}
          </div>
        </fieldset>

        {/* Country filter — only if >1 country */}
        {countries.length > 1 && (
          <fieldset className="contents" aria-label="Country filter">
            <div className="flex shrink-0 gap-1">
              {countries.map((country) => (
                <button
                  key={country}
                  onClick={() =>
                    onCountryChange(selectedCountry === country ? "" : country)
                  }
                  aria-pressed={selectedCountry === country}
                  className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                    selectedCountry === country
                      ? "bg-primary text-primary-foreground border-primary"
                      : "border text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {country}
                </button>
              ))}
            </div>
          </fieldset>
        )}

        {/* Near me filter */}
        <NearMeFilter
          nearMeDistance={nearMeDistance}
          onNearMeDistanceChange={onNearMeDistanceChange}
          geoState={geoState}
          onRequestLocation={onRequestLocation}
        />

        {/* Clear filters */}
        {activeFilterCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 text-xs"
            onClick={onClearAll}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}

interface NearMeFilterProps {
  nearMeDistance: number | null;
  onNearMeDistanceChange: (distance: number | null) => void;
  geoState: GeoState;
  onRequestLocation: () => void;
}

function NearMeFilter({ nearMeDistance, onNearMeDistanceChange, geoState, onRequestLocation }: NearMeFilterProps) {
  // Defer geolocation support check to after mount to avoid SSR/hydration mismatch.
  // Default to true so the button is rendered on both server and client during hydration.
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
                  onClick={() => onNearMeDistanceChange(km)}
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
          onClick={() => onNearMeDistanceChange(null)}
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
        Getting location…
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

  // Idle (and partially: granted but no distance set yet — shouldn't happen in practice)
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
