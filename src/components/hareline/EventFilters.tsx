"use client";

import { useMemo, useState, useRef, useEffect } from "react";
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
import { X, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";
import { NearMeFilter } from "@/components/shared/NearMeFilter";
import { RegionFilterPopover } from "@/components/shared/RegionFilterPopover";
import { toggleArrayItem } from "@/lib/format";
import { groupRegionsByState, expandRegionSelections } from "@/lib/region";
import type { HarelineEvent } from "./EventCard";
import type { GeoState } from "@/hooks/useGeolocation";

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
  readonly searchText: string;
  readonly onSearchChange: (text: string) => void;
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
  searchText,
  onSearchChange,
  activeFilterCount,
  onClearAll,
}: EventFiltersProps) {
  // Derive available regions from events
  const regions = useMemo(() => {
    const regionSet = new Set(events.map((e) => e.kennel?.region).filter(Boolean) as string[]);
    return Array.from(regionSet).sort((a, b) => a.localeCompare(b));
  }, [events]);

  const regionsByState = useMemo(() => groupRegionsByState(regions), [regions]);

  const kennels = useMemo(() => {
    const kennelMap = new Map<string, { id: string; shortName: string; fullName: string; region: string }>();
    for (const e of events) {
      if (e.kennel && !kennelMap.has(e.kennel.id)) {
        kennelMap.set(e.kennel.id, {
          id: e.kennel.id,
          shortName: e.kennel.shortName,
          fullName: e.kennel.fullName,
          region: e.kennel.region,
        });
      }
    }
    // Filter by selected regions (expanding state-level selections)
    const all = Array.from(kennelMap.values());
    if (selectedRegions.length > 0) {
      const expanded = expandRegionSelections(selectedRegions, regionsByState);
      return all.filter((k) => expanded.has(k.region));
    }
    return all.sort((a, b) => a.shortName.localeCompare(b.shortName));
  }, [events, selectedRegions, regionsByState]);

  const countries = useMemo(() => {
    const countrySet = new Set<string>();
    for (const e of events) {
      if (e.kennel?.country) countrySet.add(e.kennel.country);
    }
    return Array.from(countrySet).sort((a, b) => a.localeCompare(b));
  }, [events]);

  function toggleKennel(kennelId: string) {
    onKennelsChange(toggleArrayItem(selectedKennels, kennelId));
  }

  function toggleDay(day: string) {
    onDaysChange(toggleArrayItem(selectedDays, day));
  }

  // Debounced search
  const [localSearch, setLocalSearch] = useState(searchText);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { setLocalSearch(searchText); }, [searchText]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);
  function handleSearchChange(value: string) {
    setLocalSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(value), 300);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 overflow-x-auto scrollbar-hide">
        {/* Search input */}
        <div className="relative shrink-0">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search events..."
            className="h-8 w-40 pl-8 pr-7 text-xs lg:w-56"
          />
          {localSearch && (
            <button
              onClick={() => { setLocalSearch(""); onSearchChange(""); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

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
        <RegionFilterPopover
          regions={regions}
          selectedRegions={selectedRegions}
          onRegionsChange={onRegionsChange}
          trigger={
            <Button
              variant={selectedRegions.length > 0 ? "secondary" : "outline"}
              size="sm"
              className={`h-8 shrink-0 text-xs ${selectedRegions.length > 0 ? "border-primary/50" : ""}`}
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
                <ClearFilterButton onClick={() => onRegionsChange([])} label="Clear region filter" />
              )}
            </Button>
          }
        />

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
                    : "border text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
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
                      : "border text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
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
