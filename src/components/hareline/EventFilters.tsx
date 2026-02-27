"use client";

import { useMemo, useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { MapPin, Loader2, X } from "lucide-react";
import { RegionFilterPopover } from "@/components/shared/RegionFilterPopover";
import { KennelFilterPopover } from "@/components/shared/KennelFilterPopover";
import type { HarelineEvent } from "./EventCard";
import type { GeoState } from "@/hooks/useGeolocation";
import { DISTANCE_OPTIONS } from "@/lib/geo";
import { toggleArrayItem } from "@/lib/format";

const DAYS_OF_WEEK = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

interface EventFiltersProps {
  events: HarelineEvent[];
  isAuthenticated: boolean;
  hasSubscriptions: boolean;
  scope: "my" | "all";
  onScopeChange: (scope: "my" | "all") => void;
  selectedRegions: string[];
  onRegionsChange: (regions: string[]) => void;
  selectedKennels: string[];
  onKennelsChange: (kennels: string[]) => void;
  selectedDays: string[];
  onDaysChange: (days: string[]) => void;
  selectedCountry: string;
  onCountryChange: (country: string) => void;
  nearMeDistance: number | null;
  onNearMeDistanceChange: (distance: number | null) => void;
  geoState: GeoState;
  onRequestLocation: () => void;
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
}: EventFiltersProps) {
  // Derive available regions as {slug, name} from events
  const regions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const e of events) {
      if (!seen.has(e.kennel.regionData.slug)) {
        seen.set(e.kennel.regionData.slug, e.kennel.regionData.name);
      }
    }
    return Array.from(seen.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [events]);

  const kennels = useMemo(() => {
    const kennelMap = new Map<string, { id: string; shortName: string; fullName: string; regionName: string; regionSlug: string }>();
    for (const e of events) {
      if (!kennelMap.has(e.kennel.id)) {
        kennelMap.set(e.kennel.id, {
          id: e.kennel.id,
          shortName: e.kennel.shortName,
          fullName: e.kennel.fullName,
          regionName: e.kennel.regionData.name,
          regionSlug: e.kennel.regionData.slug,
        });
      }
    }
    const all = Array.from(kennelMap.values());
    const filtered = selectedRegions.length > 0
      ? all.filter((k) => selectedRegions.includes(k.regionSlug))
      : all;
    return filtered.sort((a, b) => a.shortName.localeCompare(b.shortName));
  }, [events, selectedRegions]);

  const countries = useMemo(() => {
    const countrySet = new Set<string>();
    for (const e of events) {
      if (e.kennel.country) countrySet.add(e.kennel.country);
    }
    return Array.from(countrySet).sort((a, b) => a.localeCompare(b));
  }, [events]);

  function toggleRegion(slug: string) {
    onRegionsChange(toggleArrayItem(selectedRegions, slug));
  }

  function toggleKennel(kennelId: string) {
    onKennelsChange(toggleArrayItem(selectedKennels, kennelId));
  }

  function toggleDay(day: string) {
    onDaysChange(toggleArrayItem(selectedDays, day));
  }

  const activeFilterCount =
    selectedRegions.length + selectedKennels.length + selectedDays.length + (selectedCountry ? 1 : 0) + (nearMeDistance != null ? 1 : 0);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* My Kennels / All Kennels scope */}
        {isAuthenticated && hasSubscriptions && (
          <div className="flex rounded-md border">
            <button
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                scope === "my"
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              } rounded-l-md`}
              onClick={() => onScopeChange("my")}
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
            >
              All Kennels
            </button>
          </div>
        )}

        {/* Region filter */}
        <RegionFilterPopover
          regions={regions}
          selectedRegions={selectedRegions}
          onToggle={toggleRegion}
        />

        {/* Kennel filter */}
        <KennelFilterPopover
          kennels={kennels}
          selectedKennels={selectedKennels}
          onToggle={toggleKennel}
        />

        {/* Day of week chips */}
        <div className="flex gap-1">
          {DAYS_OF_WEEK.map((day) => (
            <button
              key={day}
              onClick={() => toggleDay(day)}
              className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                selectedDays.includes(day)
                  ? "bg-primary text-primary-foreground"
                  : "border text-muted-foreground hover:text-foreground"
              }`}
            >
              {day}
            </button>
          ))}
        </div>

        {/* Country filter — only if >1 country */}
        {countries.length > 1 && (
          <div className="flex gap-1">
            {countries.map((country) => (
              <button
                key={country}
                onClick={() =>
                  onCountryChange(selectedCountry === country ? "" : country)
                }
                className={`rounded-md px-2 py-1 text-xs font-medium transition-colors ${
                  selectedCountry === country
                    ? "bg-primary text-primary-foreground"
                    : "border text-muted-foreground hover:text-foreground"
                }`}
              >
                {country}
              </button>
            ))}
          </div>
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
            className="h-8 text-xs"
            onClick={() => {
              onRegionsChange([]);
              onKennelsChange([]);
              onDaysChange([]);
              onCountryChange("");
              onNearMeDistanceChange(null);
            }}
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
      <Tooltip>
        <TooltipTrigger asChild>
          <Button variant="outline" size="sm" className="h-8 cursor-not-allowed text-xs opacity-60" disabled>
            <MapPin className="mr-1.5 h-3 w-3" />
            Near me
          </Button>
        </TooltipTrigger>
        <TooltipContent>{geoState.error}</TooltipContent>
      </Tooltip>
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
