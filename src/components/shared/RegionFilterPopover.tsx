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
import { getStateGroup, groupRegionsByState } from "@/lib/region";

interface RegionFilterPopoverProps {
  /** Flat list of available metro region names. */
  readonly regions: string[];
  /** Currently selected region strings (may include "state:X" entries). */
  readonly selectedRegions: string[];
  readonly onRegionsChange: (regions: string[]) => void;
  /** Optional custom trigger content; defaults to "Region" with badge. */
  readonly trigger?: React.ReactNode;
}

export function RegionFilterPopover({
  regions,
  selectedRegions,
  onRegionsChange,
  trigger,
}: RegionFilterPopoverProps) {
  const regionsByState = useMemo(() => groupRegionsByState(regions), [regions]);
  const stateKeys = useMemo(
    () => Array.from(regionsByState.keys()).sort((a, b) => a.localeCompare(b)),
    [regionsByState],
  );

  function toggleRegion(region: string) {
    const state = getStateGroup(region);
    const stateKey = `state:${state}`;
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
    if (selectedRegions.includes(stateKey)) {
      onRegionsChange(selectedRegions.filter((r) => r !== stateKey && !metros.includes(r)));
    } else {
      onRegionsChange([...selectedRegions.filter((r) => !metros.includes(r)), stateKey]);
    }
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
            {stateKeys.map((state) => {
              const metros = regionsByState.get(state) ?? [];
              const stateKey = `state:${state}`;
              const isStateSelected = selectedRegions.includes(stateKey) ||
                metros.every((m) => selectedRegions.includes(m));
              return (
                <CommandGroup key={state} heading={state}>
                  {metros.length > 1 && (
                    <CommandItem
                      value={`${state} all`}
                      onSelect={() => toggleStateGroup(state)}
                    >
                      <span
                        className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                          isStateSelected
                            ? "bg-primary border-primary text-primary-foreground"
                            : "opacity-50"
                        }`}
                      >
                        {isStateSelected && "✓"}
                      </span>
                      <span className="font-medium">All {state}</span>
                    </CommandItem>
                  )}
                  {metros.map((region) => {
                    const isRegionSelected = selectedRegions.includes(region) ||
                      selectedRegions.includes(stateKey);
                    return (
                      <CommandItem
                        key={region}
                        value={region}
                        onSelect={() => toggleRegion(region)}
                      >
                        <span
                          className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                            isRegionSelected
                              ? "bg-primary border-primary text-primary-foreground"
                              : "opacity-50"
                          }`}
                        >
                          {isRegionSelected && "✓"}
                        </span>
                        <span className={metros.length > 1 ? "pl-2" : ""}>{region}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
