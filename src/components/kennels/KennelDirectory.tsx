"use client";

import { useState, useMemo, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KennelCard, type KennelCardData } from "@/components/kennels/KennelCard";
import { KennelFilters, DAY_FULL } from "@/components/kennels/KennelFilters";

interface KennelDirectoryProps {
  kennels: KennelCardData[];
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

export function KennelDirectory({ kennels }: KennelDirectoryProps) {
  const searchParams = useSearchParams();

  // Initialize state from URL params
  const [search, setSearchState] = useState(searchParams.get("q") ?? "");
  const [selectedRegions, setSelectedRegionsState] = useState<string[]>(
    parseList(searchParams.get("regions")),
  );
  const [selectedDays, setSelectedDaysState] = useState<string[]>(
    parseList(searchParams.get("days")),
  );
  const [selectedFrequency, setSelectedFrequencyState] = useState(
    searchParams.get("freq") ?? "",
  );
  const [showUpcomingOnly, setShowUpcomingOnlyState] = useState(
    searchParams.get("upcoming") === "true",
  );
  const [selectedCountry, setSelectedCountryState] = useState(
    searchParams.get("country") ?? "",
  );
  const [sort, setSortState] = useState<"alpha" | "active">(
    (searchParams.get("sort") as "alpha" | "active") || "alpha",
  );

  // Sync state to URL via replaceState
  const syncUrl = useCallback(
    (overrides: Record<string, string | string[] | boolean>) => {
      const params = new URLSearchParams();
      const state: Record<string, string | string[] | boolean> = {
        q: search,
        regions: selectedRegions,
        days: selectedDays,
        freq: selectedFrequency,
        upcoming: showUpcomingOnly,
        country: selectedCountry,
        sort,
        ...overrides,
      };

      for (const [key, val] of Object.entries(state)) {
        let str: string;
        if (typeof val === "boolean") {
          str = val ? "true" : "";
        } else if (Array.isArray(val)) {
          str = val.join(",");
        } else {
          str = val;
        }
        // Only add non-default values
        const isDefault =
          (key === "sort" && str === "alpha") ||
          (key === "upcoming" && str !== "true") ||
          str === "";
        if (!isDefault) {
          params.set(key, str);
        }
      }

      const qs = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    },
    [search, selectedRegions, selectedDays, selectedFrequency, showUpcomingOnly, selectedCountry, sort],
  );

  // Wrapper setters that sync URL
  function setSearch(v: string) {
    setSearchState(v);
    syncUrl({ q: v });
  }
  function setSelectedRegions(v: string[]) {
    setSelectedRegionsState(v);
    syncUrl({ regions: v });
  }
  function setSelectedDays(v: string[]) {
    setSelectedDaysState(v);
    syncUrl({ days: v });
  }
  function setSelectedFrequency(v: string) {
    setSelectedFrequencyState(v);
    syncUrl({ freq: v });
  }
  function setShowUpcomingOnly(v: boolean) {
    setShowUpcomingOnlyState(v);
    syncUrl({ upcoming: v });
  }
  function setSelectedCountry(v: string) {
    setSelectedCountryState(v);
    syncUrl({ country: v });
  }
  function setSort(v: "alpha" | "active") {
    setSortState(v);
    syncUrl({ sort: v });
  }

  // Filter pipeline
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    return kennels.filter((k) => {
      // Text search
      if (
        query &&
        !k.shortName.toLowerCase().includes(query) &&
        !k.fullName.toLowerCase().includes(query) &&
        !k.region.toLowerCase().includes(query)
      ) {
        return false;
      }
      // Region
      if (selectedRegions.length > 0 && !selectedRegions.includes(k.region)) {
        return false;
      }
      // Run day (match on scheduleDayOfWeek)
      if (selectedDays.length > 0) {
        const fullDays = selectedDays.map((d) => DAY_FULL[d]);
        if (!k.scheduleDayOfWeek || !fullDays.includes(k.scheduleDayOfWeek)) {
          return false;
        }
      }
      // Frequency
      if (selectedFrequency && k.scheduleFrequency !== selectedFrequency) {
        return false;
      }
      // Upcoming only
      if (showUpcomingOnly && !k.nextEvent) {
        return false;
      }
      // Country
      if (selectedCountry && k.country !== selectedCountry) {
        return false;
      }
      return true;
    });
  }, [kennels, search, selectedRegions, selectedDays, selectedFrequency, showUpcomingOnly, selectedCountry]);

  // Sort
  const sorted = useMemo(() => {
    const items = [...filtered];
    if (sort === "active") {
      // Sort by next event date ascending, no-event kennels last
      items.sort((a, b) => {
        if (a.nextEvent && b.nextEvent) {
          return new Date(a.nextEvent.date).getTime() - new Date(b.nextEvent.date).getTime();
        }
        if (a.nextEvent && !b.nextEvent) return -1;
        if (!a.nextEvent && b.nextEvent) return 1;
        return a.shortName.localeCompare(b.shortName);
      });
    } else {
      // Alphabetical by shortName (already region-grouped from server ordering)
      items.sort((a, b) => {
        const regionCmp = a.region.localeCompare(b.region);
        if (regionCmp !== 0) return regionCmp;
        return a.shortName.localeCompare(b.shortName);
      });
    }
    return items;
  }, [filtered, sort]);

  // Group by region (only for alpha sort)
  const grouped = useMemo(() => {
    if (sort !== "alpha") return null;
    const groups: Record<string, KennelCardData[]> = {};
    for (const k of sorted) {
      if (!groups[k.region]) groups[k.region] = [];
      groups[k.region].push(k);
    }
    return groups;
  }, [sorted, sort]);

  const regionKeys = grouped ? Object.keys(grouped).sort() : [];

  return (
    <div className="mt-6 space-y-4">
      {/* Search + sort row */}
      <div className="flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search kennels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />

        <ToggleGroup
          type="single"
          value={sort}
          onValueChange={(v) => v && setSort(v as "alpha" | "active")}
          variant="outline"
          size="sm"
        >
          <ToggleGroupItem value="alpha">A–Z</ToggleGroupItem>
          <ToggleGroupItem value="active">Recently Active</ToggleGroupItem>
        </ToggleGroup>
      </div>

      {/* Filters */}
      <KennelFilters
        kennels={kennels}
        selectedRegions={selectedRegions}
        onRegionsChange={setSelectedRegions}
        selectedDays={selectedDays}
        onDaysChange={setSelectedDays}
        selectedFrequency={selectedFrequency}
        onFrequencyChange={setSelectedFrequency}
        showUpcomingOnly={showUpcomingOnly}
        onUpcomingOnlyChange={setShowUpcomingOnly}
        selectedCountry={selectedCountry}
        onCountryChange={setSelectedCountry}
      />

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "kennel" : "kennels"}
      </p>

      {/* Grid */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="text-muted-foreground">No kennels match your filters.</p>
        </div>
      ) : sort === "alpha" && grouped ? (
        // Grouped by region
        <div className="space-y-8">
          {regionKeys.map((region) => (
            <div key={region}>
              <h2 className="mb-3 text-lg font-semibold">
                {region}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({grouped[region].length})
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {grouped[region].map((kennel) => (
                  <KennelCard key={kennel.id} kennel={kennel} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // Flat list (Recently Active sort)
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((kennel) => (
            <KennelCard key={kennel.id} kennel={kennel} />
          ))}
        </div>
      )}
    </div>
  );
}
