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
import { getStateGroup, groupRegionsByState, getCountryGroup, groupRegionsByCountry } from "@/lib/region";

interface RegionFilterPopoverProps {
  /** Flat list of available metro region names. */
  readonly regions: string[];
  /** Currently selected region strings (may include "state:X" or "country:X" entries). */
  readonly selectedRegions: string[];
  readonly onRegionsChange: (regions: string[]) => void;
  /** Optional custom trigger content; defaults to "Region" with badge. */
  readonly trigger?: React.ReactNode;
  /** Enable 3-level country → state → metro grouping. Default: false (state → metro only). */
  readonly enableCountryGrouping?: boolean;
}

export function RegionFilterPopover({
  regions,
  selectedRegions,
  onRegionsChange,
  trigger,
  enableCountryGrouping = false,
}: RegionFilterPopoverProps) {
  const regionsByState = useMemo(() => groupRegionsByState(regions), [regions]);
  const regionsByCountry = useMemo(
    () => (enableCountryGrouping ? groupRegionsByCountry(regions) : null),
    [regions, enableCountryGrouping],
  );

  // For non-country mode, flat list of state keys
  const stateKeys = useMemo(
    () => Array.from(regionsByState.keys()).sort((a, b) => a.localeCompare(b)),
    [regionsByState],
  );

  // For country mode, sorted country keys
  const countryKeys = useMemo(
    () => (regionsByCountry ? Array.from(regionsByCountry.keys()).sort((a, b) => a.localeCompare(b)) : []),
    [regionsByCountry],
  );

  function isMetroSelected(region: string): boolean {
    if (selectedRegions.includes(region)) return true;
    const state = getStateGroup(region);
    if (selectedRegions.includes(`state:${state}`)) return true;
    if (enableCountryGrouping) {
      const country = getCountryGroup(state);
      if (selectedRegions.includes(`country:${country}`)) return true;
    }
    return false;
  }

  function isStateSelected(state: string): boolean {
    const stateKey = `state:${state}`;
    const metros = regionsByState.get(state) ?? [];
    return selectedRegions.includes(stateKey) ||
      metros.every((m) => selectedRegions.includes(m)) ||
      (enableCountryGrouping && selectedRegions.includes(`country:${getCountryGroup(state)}`));
  }

  function isCountrySelected(country: string): boolean {
    if (!regionsByCountry) return false;
    const countryKey = `country:${country}`;
    if (selectedRegions.includes(countryKey)) return true;
    const stateMap = regionsByCountry.get(country);
    if (!stateMap) return false;
    return Array.from(stateMap.keys()).every((state) => isStateSelected(state));
  }

  function toggleRegion(region: string) {
    const state = getStateGroup(region);
    const stateKey = `state:${state}`;
    const country = enableCountryGrouping ? getCountryGroup(state) : null;
    const countryKey = country ? `country:${country}` : null;

    // If country is selected, explode to states minus this metro's state, then explode that state minus this metro
    if (countryKey && selectedRegions.includes(countryKey) && regionsByCountry) {
      const stateMap = regionsByCountry.get(country!) ?? new Map();
      const otherStateKeys = Array.from(stateMap.keys())
        .filter((s) => s !== state)
        .map((s) => `state:${s}`);
      const sameStateMetros = (regionsByState.get(state) ?? []).filter((m) => m !== region);
      onRegionsChange([
        ...selectedRegions.filter((r) => r !== countryKey),
        ...otherStateKeys,
        ...sameStateMetros,
      ]);
      return;
    }

    if (selectedRegions.includes(stateKey)) {
      // State is selected — explode to individual metros minus this one
      const metros = regionsByState.get(state) ?? [];
      onRegionsChange([
        ...selectedRegions.filter((r) => r !== stateKey),
        ...metros.filter((m) => m !== region),
      ]);
    } else if (selectedRegions.includes(region)) {
      onRegionsChange(selectedRegions.filter((r) => r !== region));
    } else {
      onRegionsChange([...selectedRegions, region]);
    }
  }

  function toggleStateGroup(state: string) {
    const stateKey = `state:${state}`;
    const metros = regionsByState.get(state) ?? [];
    const country = enableCountryGrouping ? getCountryGroup(state) : null;
    const countryKey = country ? `country:${country}` : null;

    const selected = isStateSelected(state);
    if (selected) {
      // If country was selected, explode to other states
      if (countryKey && selectedRegions.includes(countryKey) && regionsByCountry) {
        const stateMap = regionsByCountry.get(country!) ?? new Map();
        const otherStateKeys = Array.from(stateMap.keys())
          .filter((s) => s !== state)
          .map((s) => `state:${s}`);
        onRegionsChange([
          ...selectedRegions.filter((r) => r !== countryKey),
          ...otherStateKeys,
        ]);
      } else {
        onRegionsChange(selectedRegions.filter((r) => r !== stateKey && !metros.includes(r)));
      }
    } else {
      onRegionsChange([...selectedRegions.filter((r) => !metros.includes(r)), stateKey]);
    }
  }

  function toggleCountryGroup(country: string) {
    if (!regionsByCountry) return;
    const countryKey = `country:${country}`;
    const stateMap = regionsByCountry.get(country) ?? new Map();
    const allStateKeys = Array.from(stateMap.keys()).map((s) => `state:${s}`);
    const allMetros = Array.from(stateMap.values()).flat();

    const selected = isCountrySelected(country);
    if (selected) {
      onRegionsChange(
        selectedRegions.filter((r) =>
          r !== countryKey && !allStateKeys.includes(r) && !allMetros.includes(r)
        ),
      );
    } else {
      onRegionsChange([
        ...selectedRegions.filter((r) => !allStateKeys.includes(r) && !allMetros.includes(r)),
        countryKey,
      ]);
    }
  }

  function renderStateGroup(state: string, metros: string[], indentMetros: boolean) {
    return (
      <CommandGroup key={state} heading={state}>
        {metros.length > 1 && (
          <CommandItem
            value={`${state} all`}
            onSelect={() => toggleStateGroup(state)}
          >
            <span
              className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                isStateSelected(state)
                  ? "bg-primary border-primary text-primary-foreground"
                  : "opacity-50"
              }`}
            >
              {isStateSelected(state) && "✓"}
            </span>
            <span className="font-medium">All {state}</span>
          </CommandItem>
        )}
        {metros.map((region) => (
          <CommandItem
            key={region}
            value={`${state} ${region}`}
            onSelect={() => toggleRegion(region)}
          >
            <span
              className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                isMetroSelected(region)
                  ? "bg-primary border-primary text-primary-foreground"
                  : "opacity-50"
              }`}
            >
              {isMetroSelected(region) && "✓"}
            </span>
            <span className={indentMetros && metros.length > 1 ? "pl-2" : ""}>{region}</span>
          </CommandItem>
        ))}
      </CommandGroup>
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="outline" size="sm" className="h-8 text-xs">
            Region
            {selectedRegions.length > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {selectedRegions.length}
              </Badge>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-72 max-w-[calc(100vw-2rem)] p-0" align="start">
        <Command>
          <CommandInput placeholder="Search regions..." />
          <CommandList>
            <CommandEmpty>No regions found.</CommandEmpty>
            {enableCountryGrouping && regionsByCountry ? (
              // 3-level: country → state → metro
              countryKeys.map((country) => {
                const stateMap = regionsByCountry.get(country)!;
                const sortedStates = Array.from(stateMap.keys()).sort((a, b) => a.localeCompare(b));
                const totalStates = sortedStates.length;

                return (
                  <CommandGroup key={country} heading={country}>
                    {/* "All Country" toggle */}
                    {totalStates > 1 && (
                      <CommandItem
                        value={`${country} all`}
                        onSelect={() => toggleCountryGroup(country)}
                      >
                        <span
                          className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                            isCountrySelected(country)
                              ? "bg-primary border-primary text-primary-foreground"
                              : "opacity-50"
                          }`}
                        >
                          {isCountrySelected(country) && "✓"}
                        </span>
                        <span className="font-semibold">All {country}</span>
                      </CommandItem>
                    )}
                    {/* State sub-groups */}
                    {sortedStates.map((state) => {
                      const metros = stateMap.get(state) ?? [];
                      // For single-state countries, skip the state heading
                      if (totalStates === 1) {
                        return metros.map((region) => (
                          <CommandItem
                            key={region}
                            value={`${country} ${state} ${region}`}
                            onSelect={() => toggleRegion(region)}
                          >
                            <span
                              className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                                isMetroSelected(region)
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "opacity-50"
                              }`}
                            >
                              {isMetroSelected(region) && "✓"}
                            </span>
                            {region}
                          </CommandItem>
                        ));
                      }
                      // Multi-state countries: show state sub-heading
                      return (
                        <div key={state}>
                          {metros.length > 1 && (
                            <CommandItem
                              value={`${country} ${state} all`}
                              onSelect={() => toggleStateGroup(state)}
                            >
                              <span
                                className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                                  isStateSelected(state)
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "opacity-50"
                                }`}
                              >
                                {isStateSelected(state) && "✓"}
                              </span>
                              <span className="font-medium pl-1">All {state}</span>
                            </CommandItem>
                          )}
                          {metros.map((region) => (
                            <CommandItem
                              key={region}
                              value={`${country} ${state} ${region}`}
                              onSelect={() => toggleRegion(region)}
                            >
                              <span
                                className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                                  isMetroSelected(region)
                                    ? "bg-primary border-primary text-primary-foreground"
                                    : "opacity-50"
                                }`}
                              >
                                {isMetroSelected(region) && "✓"}
                              </span>
                              <span className="pl-3">{region}</span>
                            </CommandItem>
                          ))}
                        </div>
                      );
                    })}
                  </CommandGroup>
                );
              })
            ) : (
              // 2-level: state → metro (backwards compatible)
              stateKeys.map((state) => {
                const metros = regionsByState.get(state) ?? [];
                return renderStateGroup(state, metros, true);
              })
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
