"use client";

import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Command,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { NearMeFilter } from "@/components/shared/NearMeFilter";
import { RegionFilterPopover } from "@/components/shared/RegionFilterPopover";
import type { GeoState } from "@/hooks/useGeolocation";
import type { KennelCardData } from "./KennelCard";

const SCHEDULE_DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Map abbreviated day to full scheduleDayOfWeek values
const DAY_FULL: Record<string, string> = {
  Mon: "Monday",
  Tue: "Tuesday",
  Wed: "Wednesday",
  Thu: "Thursday",
  Fri: "Friday",
  Sat: "Saturday",
  Sun: "Sunday",
};

interface KennelFiltersProps {
  kennels: KennelCardData[];
  selectedRegions: string[];
  onRegionsChange: (regions: string[]) => void;
  selectedDays: string[];
  onDaysChange: (days: string[]) => void;
  selectedFrequency: string;
  onFrequencyChange: (freq: string) => void;
  showUpcomingOnly: boolean;
  onUpcomingOnlyChange: (v: boolean) => void;
  showActiveOnly: boolean;
  onActiveOnlyChange: (v: boolean) => void;
  selectedCountry: string;
  onCountryChange: (country: string) => void;
  nearMeDistance: number | null;
  onNearMeDistanceChange: (distance: number | null) => void;
  geoState: GeoState;
  onRequestLocation: () => void;
}

export function KennelFilters({
  kennels,
  selectedRegions,
  onRegionsChange,
  selectedDays,
  onDaysChange,
  selectedFrequency,
  onFrequencyChange,
  showUpcomingOnly,
  onUpcomingOnlyChange,
  showActiveOnly,
  onActiveOnlyChange,
  selectedCountry,
  onCountryChange,
  nearMeDistance,
  onNearMeDistanceChange,
  geoState,
  onRequestLocation,
}: KennelFiltersProps) {
  // Derive available regions from kennel list
  const regions = useMemo(() => {
    const regionSet = new Set(kennels.map((k) => k.region));
    return Array.from(regionSet).sort((a, b) => a.localeCompare(b));
  }, [kennels]);

  // Derive available frequencies
  const frequencies = useMemo(() => {
    const freqSet = new Set<string>();
    for (const k of kennels) {
      if (k.scheduleFrequency) freqSet.add(k.scheduleFrequency);
    }
    return Array.from(freqSet).sort((a, b) => a.localeCompare(b));
  }, [kennels]);

  // Derive countries (only show if >1)
  const countries = useMemo(() => {
    const countrySet = new Set<string>();
    for (const k of kennels) {
      if (k.country) countrySet.add(k.country);
    }
    return Array.from(countrySet).sort((a, b) => a.localeCompare(b));
  }, [kennels]);

  function toggleDay(day: string) {
    if (selectedDays.includes(day)) {
      onDaysChange(selectedDays.filter((d) => d !== day));
    } else {
      onDaysChange([...selectedDays, day]);
    }
  }

  const activeFilterCount =
    selectedRegions.length +
    selectedDays.length +
    (selectedFrequency ? 1 : 0) +
    (showUpcomingOnly ? 1 : 0) +
    (!showActiveOnly ? 1 : 0) +
    (selectedCountry ? 1 : 0) +
    (nearMeDistance != null ? 1 : 0);

  return (
    <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide md:flex-wrap">
      {/* Region filter */}
      <RegionFilterPopover
        regions={regions}
        selectedRegions={selectedRegions}
        onRegionsChange={onRegionsChange}
        trigger={
          <Button
            variant={selectedRegions.length > 0 ? "secondary" : "outline"}
            size="sm"
            className={`h-8 text-xs ${selectedRegions.length > 0 ? "border-primary/50" : ""}`}
          >
            {selectedRegions.length === 1
              ? `Region: ${selectedRegions[0].startsWith("state:") ? selectedRegions[0].slice(6) : selectedRegions[0]}`
              : "Region"}
            {selectedRegions.length > 1 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {selectedRegions.length}
              </Badge>
            )}
            {selectedRegions.length > 0 && (
              <button
                type="button"
                className="ml-1 appearance-none border-none bg-transparent cursor-pointer rounded-full p-0.5 hover:bg-muted"
                onClick={(e) => { e.stopPropagation(); onRegionsChange([]); }}
                onMouseDown={(e) => { e.preventDefault(); }}
                aria-label="Clear region filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </Button>
        }
      />

      {/* Run day chips */}
      <div className="flex gap-1">
        {SCHEDULE_DAYS.map((day) => (
          <button
            key={day}
            onClick={() => toggleDay(day)}
            aria-pressed={selectedDays.includes(day)}
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

      {/* Frequency filter */}
      {frequencies.length > 0 && (
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              {selectedFrequency || "Frequency"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-44 p-0" align="start">
            <Command>
              <CommandList>
                <CommandGroup>
                  <CommandItem onSelect={() => onFrequencyChange("")}>
                    <span
                      className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                        !selectedFrequency
                          ? "bg-primary border-primary text-primary-foreground"
                          : "opacity-50"
                      }`}
                    >
                      {!selectedFrequency && "✓"}
                    </span>
                    All
                  </CommandItem>
                  {frequencies.map((freq) => (
                    <CommandItem
                      key={freq}
                      onSelect={() => onFrequencyChange(freq)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          selectedFrequency === freq
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {selectedFrequency === freq && "✓"}
                      </span>
                      {freq}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      )}

      {/* Has upcoming events toggle */}
      <button
        onClick={() => onUpcomingOnlyChange(!showUpcomingOnly)}
        aria-pressed={showUpcomingOnly}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          showUpcomingOnly
            ? "bg-primary text-primary-foreground"
            : "border text-muted-foreground hover:text-foreground"
        }`}
      >
        Has upcoming
      </button>

      {/* Active only toggle */}
      <button
        onClick={() => onActiveOnlyChange(!showActiveOnly)}
        aria-pressed={showActiveOnly}
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          showActiveOnly
            ? "bg-primary text-primary-foreground"
            : "border text-muted-foreground hover:text-foreground"
        }`}
      >
        Active only
      </button>

      {/* Near me filter */}
      <NearMeFilter
        nearMeDistance={nearMeDistance}
        onNearMeDistanceChange={onNearMeDistanceChange}
        geoState={geoState}
        onRequestLocation={onRequestLocation}
      />

      {/* Country filter — only if >1 country */}
      {countries.length > 1 && (
        <div className="flex gap-1">
          {countries.map((country) => (
            <button
              key={country}
              onClick={() =>
                onCountryChange(selectedCountry === country ? "" : country)
              }
              aria-pressed={selectedCountry === country}
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

      {/* Clear filters */}
      {activeFilterCount > 0 && (
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs"
          onClick={() => {
            onRegionsChange([]);
            onDaysChange([]);
            onFrequencyChange("");
            onUpcomingOnlyChange(false);
            onActiveOnlyChange(true);
            onCountryChange("");
            onNearMeDistanceChange(null);
          }}
        >
          Clear filters
        </Button>
      )}
    </div>
  );
}

// Export DAY_FULL for use by KennelDirectory filtering logic
export { DAY_FULL };
