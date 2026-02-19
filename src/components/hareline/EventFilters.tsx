"use client";

import { useMemo } from "react";
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
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";
import type { HarelineEvent } from "./EventCard";

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
}: EventFiltersProps) {
  // Derive available regions and kennels from events
  const regions = useMemo(() => {
    const regionSet = new Set(events.map((e) => e.kennel.region));
    return Array.from(regionSet).sort();
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
    return Array.from(countrySet).sort();
  }, [events]);

  function toggleRegion(region: string) {
    if (selectedRegions.includes(region)) {
      onRegionsChange(selectedRegions.filter((r) => r !== region));
    } else {
      onRegionsChange([...selectedRegions, region]);
    }
  }

  function toggleKennel(kennelId: string) {
    if (selectedKennels.includes(kennelId)) {
      onKennelsChange(selectedKennels.filter((k) => k !== kennelId));
    } else {
      onKennelsChange([...selectedKennels, kennelId]);
    }
  }

  function toggleDay(day: string) {
    if (selectedDays.includes(day)) {
      onDaysChange(selectedDays.filter((d) => d !== day));
    } else {
      onDaysChange([...selectedDays, day]);
    }
  }

  const activeFilterCount =
    selectedRegions.length + selectedKennels.length + selectedDays.length + (selectedCountry ? 1 : 0);

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
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Region
              {selectedRegions.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedRegions.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-56 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search regions..." />
              <CommandList>
                <CommandEmpty>No regions found.</CommandEmpty>
                <CommandGroup>
                  {regions.map((region) => (
                    <CommandItem
                      key={region}
                      onSelect={() => toggleRegion(region)}
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
            <Button variant="outline" size="sm" className="h-8 text-xs">
              Kennel
              {selectedKennels.length > 0 && (
                <Badge variant="secondary" className="ml-1 text-xs">
                  {selectedKennels.length}
                </Badge>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-80 p-0" align="start">
            <Command>
              <CommandInput placeholder="Search kennels..." />
              <CommandList>
                <CommandEmpty>No kennels found.</CommandEmpty>
                <CommandGroup>
                  {kennels.map((kennel) => (
                    <CommandItem
                      key={kennel.id}
                      value={`${kennel.shortName} ${kennel.fullName} ${kennel.region}`}
                      onSelect={() => toggleKennel(kennel.id)}
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
            }}
          >
            Clear filters
          </Button>
        )}
      </div>
    </div>
  );
}
