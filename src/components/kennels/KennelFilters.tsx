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
import type { KennelCardData } from "./KennelCard";
import { toggleArrayItem } from "@/lib/format";

const SCHEDULE_DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
  /** Selected region slugs. */
  selectedRegions: string[];
  onRegionsChange: (regions: string[]) => void;
  selectedDays: string[];
  onDaysChange: (days: string[]) => void;
  selectedFrequency: string;
  onFrequencyChange: (freq: string) => void;
  showUpcomingOnly: boolean;
  onUpcomingOnlyChange: (v: boolean) => void;
  selectedCountry: string;
  onCountryChange: (country: string) => void;
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
  selectedCountry,
  onCountryChange,
}: KennelFiltersProps) {
  // Derive available regions as {slug, name} from kennel list
  const regions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const k of kennels) {
      if (!seen.has(k.regionData.slug)) {
        seen.set(k.regionData.slug, k.regionData.name);
      }
    }
    return Array.from(seen.entries())
      .map(([slug, name]) => ({ slug, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
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

  function toggleRegion(slug: string) {
    onRegionsChange(toggleArrayItem(selectedRegions, slug));
  }

  function toggleDay(day: string) {
    onDaysChange(toggleArrayItem(selectedDays, day));
  }

  const activeFilterCount =
    selectedRegions.length +
    selectedDays.length +
    (selectedFrequency ? 1 : 0) +
    (showUpcomingOnly ? 1 : 0) +
    (selectedCountry ? 1 : 0);

  return (
    <div className="flex flex-wrap items-center gap-2">
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
                {regions.map((r) => (
                  <CommandItem
                    key={r.slug}
                    onSelect={() => toggleRegion(r.slug)}
                  >
                    <span
                      className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                        selectedRegions.includes(r.slug)
                          ? "bg-primary border-primary text-primary-foreground"
                          : "opacity-50"
                      }`}
                    >
                      {selectedRegions.includes(r.slug) && "✓"}
                    </span>
                    {r.name}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>

      {/* Run day chips */}
      <div className="flex gap-1">
        {SCHEDULE_DAYS.map((day) => (
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
        className={`rounded-md px-3 py-1 text-xs font-medium transition-colors ${
          showUpcomingOnly
            ? "bg-primary text-primary-foreground"
            : "border text-muted-foreground hover:text-foreground"
        }`}
      >
        Has upcoming
      </button>

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
            onDaysChange([]);
            onFrequencyChange("");
            onUpcomingOnlyChange(false);
            onCountryChange("");
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
