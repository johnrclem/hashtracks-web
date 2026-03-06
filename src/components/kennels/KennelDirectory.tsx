"use client";

import { useState, useMemo, useCallback } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Input } from "@/components/ui/input";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KennelCard, type KennelCardData } from "@/components/kennels/KennelCard";
import { KennelFilters, DAY_FULL } from "@/components/kennels/KennelFilters";
import { useGeolocation } from "@/hooks/useGeolocation";
import { getEventCoords, haversineDistance } from "@/lib/geo";

const KennelMapView = dynamic(() => import("./KennelMapView"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[500px] items-center justify-center rounded-md border text-sm text-muted-foreground">
      Loading map...
    </div>
  ),
});

/** Props for the KennelDirectory — searchable, filterable, sortable directory of all kennels. */
interface KennelDirectoryProps {
  kennels: KennelCardData[];
}

function parseList(value: string | null): string[] {
  if (!value) return [];
  return value.split(",").filter(Boolean);
}

export function KennelDirectory({ kennels }: KennelDirectoryProps) {
  const searchParams = useSearchParams();
  const [geoState, requestLocation] = useGeolocation();

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
  const [nearMeDistance, setNearMeDistanceState] = useState<number | null>(
    searchParams.get("distance") ? Number(searchParams.get("distance")) : null,
  );
  const [sort, setSortState] = useState<"alpha" | "active" | "nearest">(
    (searchParams.get("sort") as "alpha" | "active" | "nearest") || "alpha",
  );
  const [displayView, setDisplayViewState] = useState<"grid" | "map">(
    searchParams.get("display") === "map" ? "map" : "grid",
  );

  // Sync state to URL via replaceState
  const syncUrl = useCallback(
    (overrides: Record<string, string | string[] | boolean | number | null>) => {
      const params = new URLSearchParams();
      const state: Record<string, string | string[] | boolean | number | null> = {
        q: search,
        regions: selectedRegions,
        days: selectedDays,
        freq: selectedFrequency,
        upcoming: showUpcomingOnly,
        country: selectedCountry,
        distance: nearMeDistance,
        sort,
        display: displayView,
        ...overrides,
      };

      for (const [key, val] of Object.entries(state)) {
        let str: string;
        if (val == null) {
          str = "";
        } else if (typeof val === "boolean") {
          str = val ? "true" : "";
        } else if (typeof val === "number") {
          str = String(val);
        } else if (Array.isArray(val)) {
          str = val.join(",");
        } else {
          str = val;
        }
        // Only add non-default values
        const isDefault =
          (key === "sort" && str === "alpha") ||
          (key === "display" && str === "grid") ||
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
    [search, selectedRegions, selectedDays, selectedFrequency, showUpcomingOnly, selectedCountry, nearMeDistance, sort, displayView],
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
  function setNearMeDistance(v: number | null) {
    setNearMeDistanceState(v);
    // Auto-switch to nearest sort when Near Me is activated
    if (v != null && sort !== "nearest") {
      setSortState("nearest");
      syncUrl({ distance: v, sort: "nearest" });
    } else if (v == null && sort === "nearest") {
      setSortState("alpha");
      syncUrl({ distance: v, sort: "alpha" });
    } else {
      syncUrl({ distance: v });
    }
  }
  function setSort(v: "alpha" | "active" | "nearest") {
    setSortState(v);
    syncUrl({ sort: v });
  }
  function setDisplayView(v: "grid" | "map") {
    setDisplayViewState(v);
    syncUrl({ display: v });
  }
  function handleRegionSelect(region: string) {
    setSelectedRegionsState([region]);
    setDisplayViewState("grid");
    syncUrl({ regions: [region], display: "grid" });
  }

  // Compute distances for each kennel (when geolocation is available)
  const kennelDistances = useMemo(() => {
    if (geoState.status !== "granted") return new Map<string, number>();
    const map = new Map<string, number>();
    for (const k of kennels) {
      const coords = getEventCoords(k.latitude, k.longitude, k.region);
      if (coords) {
        map.set(k.id, haversineDistance(geoState.lat, geoState.lng, coords.lat, coords.lng));
      }
    }
    return map;
  }, [kennels, geoState]);

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
      // Near me distance filter
      if (nearMeDistance != null && geoState.status === "granted") {
        const dist = kennelDistances.get(k.id);
        if (dist == null || dist > nearMeDistance) return false;
      }
      return true;
    });
  }, [kennels, search, selectedRegions, selectedDays, selectedFrequency, showUpcomingOnly, selectedCountry, nearMeDistance, geoState, kennelDistances]);

  // Sort
  const sorted = useMemo(() => {
    const items = [...filtered];
    if (sort === "nearest" && geoState.status === "granted") {
      // Sort by distance ascending, no-distance kennels last
      items.sort((a, b) => {
        const distA = kennelDistances.get(a.id) ?? Infinity;
        const distB = kennelDistances.get(b.id) ?? Infinity;
        return distA - distB;
      });
    } else if (sort === "active") {
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
  }, [filtered, sort, geoState, kennelDistances]);

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

  const regionKeys = grouped ? Object.keys(grouped).sort((a, b) => a.localeCompare(b)) : [];

  // Show "Nearest" sort option only when geolocation is granted
  const showNearestSort = geoState.status === "granted";

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

        <div className="flex items-center gap-2">
          {displayView === "grid" && (
            <ToggleGroup
              type="single"
              value={sort}
              onValueChange={(v) => v && setSort(v as "alpha" | "active" | "nearest")}
              variant="outline"
              size="sm"
            >
              <ToggleGroupItem value="alpha">A–Z</ToggleGroupItem>
              <ToggleGroupItem value="active">Recently Active</ToggleGroupItem>
              {showNearestSort && (
                <ToggleGroupItem value="nearest">Nearest</ToggleGroupItem>
              )}
            </ToggleGroup>
          )}

          <ToggleGroup
            type="single"
            value={displayView}
            onValueChange={(v) => v && setDisplayView(v as "grid" | "map")}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="grid">Grid</ToggleGroupItem>
            <ToggleGroupItem value="map">Map</ToggleGroupItem>
          </ToggleGroup>
        </div>
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
        nearMeDistance={nearMeDistance}
        onNearMeDistanceChange={setNearMeDistance}
        geoState={geoState}
        onRequestLocation={requestLocation}
      />

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "kennel" : "kennels"}
      </p>

      {/* Map or Grid */}
      {displayView === "map" ? (
        <KennelMapView kennels={filtered} onRegionSelect={handleRegionSelect} />
      ) : filtered.length === 0 ? (
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
        // Flat list (Recently Active / Nearest sort)
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {sorted.map((kennel) => (
            <KennelCard key={kennel.id} kennel={kennel} />
          ))}
        </div>
      )}
    </div>
  );
}
