"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
import { X, Search, SlidersHorizontal } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { NearMeFilter } from "@/components/shared/NearMeFilter";
import { RegionFilterPopover } from "@/components/shared/RegionFilterPopover";
import { DayOfWeekSelect } from "@/components/shared/DayOfWeekSelect";
import { ClearFilterButton } from "@/components/shared/ClearFilterButton";
import { KennelOptionLabel } from "@/components/kennels/KennelOptionLabel";
import { toggleArrayItem, collectKennelFrequencies, type ScheduleSlot } from "@/lib/format";
import { regionDisplayName } from "@/lib/region";
import type { GeoState } from "@/hooks/useGeolocation";

interface FilterBarProps {
  /** Data items to derive available filter options from. */
  readonly items: {
    region: string;
    scheduleDayOfWeek?: string | null;
    scheduleFrequency?: string | null;
    /** #1390: multi-cadence schedule slots — when present, derive frequency
     *  dropdown choices from these too so migrated kennels stay filterable. */
    scheduleRules?: ScheduleSlot[] | null;
    id: string;
    latitude?: number | null;
    longitude?: number | null;
  }[];

  // Tier 1 — always visible
  readonly search: string;
  readonly onSearchChange: (v: string) => void;
  readonly selectedRegions: string[];
  readonly onRegionsChange: (v: string[]) => void;
  readonly nearMeDistance: number | null;
  readonly onNearMeDistanceChange: (v: number | null) => void;
  readonly geoState: GeoState;
  readonly onRequestLocation: () => void;

  // Tier 2 — expandable (always present)
  readonly selectedDays: string[];
  readonly onDaysChange: (v: string[]) => void;

  // Tier 2 — optional per-page
  readonly selectedFrequency?: string;
  readonly onFrequencyChange?: (v: string) => void;
  readonly showActiveOnly?: boolean;
  readonly onActiveOnlyChange?: (v: boolean) => void;
  readonly showUpcomingOnly?: boolean;
  readonly onUpcomingOnlyChange?: (v: boolean) => void;
  readonly selectedKennels?: string[];
  readonly onKennelsChange?: (v: string[]) => void;
  readonly kennelOptions?: { id: string; shortName: string; fullName: string; region: string }[];

  readonly onClearAll: () => void;

  /** Placeholder text for search input. Default: "Search..." */
  readonly searchPlaceholder?: string;
}

export function FilterBar({
  items,
  search,
  onSearchChange,
  selectedRegions,
  onRegionsChange,
  nearMeDistance,
  onNearMeDistanceChange,
  geoState,
  onRequestLocation,
  selectedDays,
  onDaysChange,
  selectedFrequency,
  onFrequencyChange,
  showActiveOnly,
  onActiveOnlyChange,
  showUpcomingOnly,
  onUpcomingOnlyChange,
  selectedKennels,
  onKennelsChange,
  kennelOptions,
  onClearAll,
  searchPlaceholder = "Search...",
}: FilterBarProps) {
  const [expanded, setExpanded] = useState(false);

  // Debounced search
  const [localSearch, setLocalSearch] = useState(search);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { setLocalSearch(search); }, [search]);
  useEffect(() => () => clearTimeout(debounceRef.current), []);
  function handleSearchChange(value: string) {
    setLocalSearch(value);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => onSearchChange(value), 300);
  }

  // Derive available regions
  const regions = useMemo(() => {
    const regionSet = new Set(items.map((i) => i.region).filter(Boolean));
    return Array.from(regionSet).sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Derive available frequencies — union of legacy `scheduleFrequency` flat
  // fields AND any `scheduleRules`-derived labels (#1390). A migrated kennel
  // with nulled flat fields must still surface its frequency in the dropdown.
  const frequencies = useMemo(() => {
    if (!onFrequencyChange) return [];
    const freqSet = new Set<string>();
    for (const i of items) {
      for (const label of collectKennelFrequencies(i)) {
        freqSet.add(label);
      }
    }
    return Array.from(freqSet).sort((a, b) => a.localeCompare(b));
  }, [items, onFrequencyChange]);

  // Count active Tier 2 filters
  const tier2Count =
    selectedDays.length +
    (selectedFrequency ? 1 : 0) +
    (selectedKennels?.length ?? 0) +
    (showUpcomingOnly ? 1 : 0) +
    (onActiveOnlyChange && showActiveOnly === false ? 1 : 0); // "active only off" is the non-default

  // Total active filter count (for clear all)
  const totalActiveCount =
    selectedRegions.length +
    (nearMeDistance != null ? 1 : 0) +
    tier2Count;

  // Build active filter chips for collapsed state
  const activeChips: { key: string; label: string; onClear: () => void }[] = [];
  if (selectedDays.length > 0) {
    activeChips.push({ key: "days", label: selectedDays.join(", "), onClear: () => onDaysChange([]) });
  }
  if (selectedFrequency && onFrequencyChange) {
    activeChips.push({ key: "frequency", label: selectedFrequency, onClear: () => onFrequencyChange?.("") });
  }
  if (selectedKennels && selectedKennels.length > 0 && onKennelsChange) {
    const count = selectedKennels.length;
    activeChips.push({
      key: "kennels",
      label: `${count} kennel${count > 1 ? "s" : ""}`,
      onClear: () => onKennelsChange?.([]),
    });
  }
  if (showUpcomingOnly && onUpcomingOnlyChange) {
    activeChips.push({ key: "upcoming", label: "Has upcoming", onClear: () => onUpcomingOnlyChange?.(false) });
  }
  if (onActiveOnlyChange && showActiveOnly === false) {
    activeChips.push({ key: "inactive", label: "Including inactive", onClear: () => onActiveOnlyChange?.(true) });
  }

  return (
    <div className="space-y-2">
      {/* Tier 1: Always visible */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        {/* Search */}
        <div className="relative w-full sm:max-w-[280px]">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={localSearch}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="h-8 pl-8 pr-7 text-xs"
          />
          {localSearch && (
            <button
              onClick={() => { clearTimeout(debounceRef.current); setLocalSearch(""); onSearchChange(""); }}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              aria-label="Clear search"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Region + Near Me + Filters button */}
        <div className="flex items-center gap-2">
          <RegionFilterPopover
            regions={regions}
            selectedRegions={selectedRegions}
            onRegionsChange={onRegionsChange}
            enableCountryGrouping
            trigger={
              <Button
                variant={selectedRegions.length > 0 ? "secondary" : "outline"}
                size="sm"
                className={`h-8 text-xs ${selectedRegions.length > 0 ? "border-primary/50" : ""}`}
              >
                {selectedRegions.length === 1
                  ? regionDisplayName(selectedRegions[0])
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

          <NearMeFilter
            nearMeDistance={nearMeDistance}
            onNearMeDistanceChange={onNearMeDistanceChange}
            geoState={geoState}
            onRequestLocation={onRequestLocation}
          />

          {/* Filters expand toggle */}
          <Button
            variant={expanded ? "default" : "outline"}
            size="sm"
            className="h-8 text-xs"
            onClick={() => setExpanded(!expanded)}
          >
            <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
            Filters
            {tier2Count > 0 && !expanded && (
              <Badge variant="secondary" className="ml-1 text-xs">
                {tier2Count}
              </Badge>
            )}
          </Button>

          {/* Clear all */}
          {totalActiveCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={onClearAll}
            >
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Tier 2: Expandable filter row */}
      {expanded && (
        <div className="flex flex-col gap-3 border-t pt-3 sm:flex-row sm:items-center sm:gap-2">
          {/* Day of week */}
          <DayOfWeekSelect selectedDays={selectedDays} onDaysChange={onDaysChange} />

          {/* Frequency (kennels only) */}
          {onFrequencyChange && frequencies.length > 0 && (
            <>
              <div className="hidden sm:block w-px h-5 bg-border" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={selectedFrequency ? "secondary" : "outline"}
                    size="sm"
                    className={`h-8 text-xs ${selectedFrequency ? "border-primary/50" : ""}`}
                  >
                    {selectedFrequency || "Frequency"}
                    {selectedFrequency && (
                      <ClearFilterButton onClick={() => onFrequencyChange?.("")} label="Clear frequency filter" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-44 p-0" align="start">
                  <Command>
                    <CommandList>
                      <CommandGroup>
                        <CommandItem onSelect={() => onFrequencyChange?.("")}>
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
                            onSelect={() => onFrequencyChange?.(freq)}
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
            </>
          )}

          {/* Kennel picker (hareline only) */}
          {onKennelsChange && kennelOptions && (
            <>
              <div className="hidden sm:block w-px h-5 bg-border" />
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant={selectedKennels && selectedKennels.length > 0 ? "secondary" : "outline"}
                    size="sm"
                    className={`h-8 text-xs ${selectedKennels && selectedKennels.length > 0 ? "border-primary/50" : ""}`}
                  >
                    Kennel
                    {selectedKennels && selectedKennels.length > 0 && (
                      <Badge variant="secondary" className="ml-1 text-xs">
                        {selectedKennels.length}
                      </Badge>
                    )}
                    {selectedKennels && selectedKennels.length > 0 && (
                      <ClearFilterButton onClick={() => onKennelsChange?.([])} label="Clear kennel filter" />
                    )}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-72 p-0" align="start">
                  <Command>
                    <CommandInput placeholder="Search kennels..." />
                    <CommandList role="listbox">
                      <CommandEmpty>No kennels found.</CommandEmpty>
                      <CommandGroup>
                        {kennelOptions.map((kennel) => (
                          <CommandItem
                            key={kennel.id}
                            value={`${kennel.shortName} ${kennel.fullName} ${kennel.region}`}
                            onSelect={() => onKennelsChange?.(toggleArrayItem(selectedKennels ?? [], kennel.id))}
                            role="option"
                            aria-selected={selectedKennels?.includes(kennel.id)}
                          >
                            <span
                              className={`mr-2 flex h-4 w-4 items-center justify-center rounded-sm border ${
                                selectedKennels?.includes(kennel.id)
                                  ? "bg-primary border-primary text-primary-foreground"
                                  : "opacity-50"
                              }`}
                            >
                              {selectedKennels?.includes(kennel.id) && "✓"}
                            </span>
                            <KennelOptionLabel kennel={kennel} />
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    </CommandList>
                  </Command>
                </PopoverContent>
              </Popover>
            </>
          )}

          {/* Toggle switches */}
          {(onActiveOnlyChange || onUpcomingOnlyChange) && (
            <>
              <div className="hidden sm:block w-px h-5 bg-border" />
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
                {onActiveOnlyChange && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Switch
                      checked={showActiveOnly ?? true}
                      onCheckedChange={onActiveOnlyChange}
                      className="scale-75"
                    />
                    Active only
                  </label>
                )}
                {onUpcomingOnlyChange && (
                  <label className="flex items-center gap-2 text-xs cursor-pointer">
                    <Switch
                      checked={showUpcomingOnly ?? false}
                      onCheckedChange={onUpcomingOnlyChange}
                      className="scale-75"
                    />
                    Has upcoming
                  </label>
                )}
              </div>
            </>
          )}
        </div>
      )}

      {/* Active filter chips (shown when Tier 2 is collapsed and has active filters) */}
      {!expanded && activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              {chip.label}
              <button
                onClick={chip.onClear}
                className="text-muted-foreground hover:text-foreground"
                aria-label={`Clear ${chip.label} filter`}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
