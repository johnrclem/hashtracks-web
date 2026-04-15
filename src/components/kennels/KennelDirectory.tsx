"use client";

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { SearchX } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { KennelCard, type KennelCardData } from "@/components/kennels/KennelCard";
import { FilterBar } from "@/components/shared/FilterBar";
import { DAY_FULL } from "@/lib/days";
import { useGeolocation } from "@/hooks/useGeolocation";
import { getEventCoords, haversineDistance } from "@/lib/geo";
import { groupRegionsByState, expandRegionSelections, regionAbbrev, resolveCountryName, regionDisplayName } from "@/lib/region";
import { LocationPrompt } from "@/components/hareline/LocationPrompt";
import { RegionQuickChips } from "@/components/hareline/RegionQuickChips";
import { getLocationPref, resolveLocationDefault, clearLocationPref } from "@/lib/location-pref";
import { parseList, parseRegionParam } from "@/lib/format";
import { getActivityStatus } from "@/lib/activity-status";

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

export function KennelDirectory({ kennels }: KennelDirectoryProps) {
  const searchParams = useSearchParams();
  const [geoState, requestLocation] = useGeolocation();

  // Initialize state from URL params
  const [search, setSearchState] = useState(searchParams.get("q") ?? "");
  const [selectedRegions, setSelectedRegionsState] = useState<string[]>(
    parseRegionParam(searchParams.get("regions")),
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
  const [showActiveOnly, setShowActiveOnlyState] = useState(
    searchParams.get("active") !== "false",
  );
  const [nearMeDistance, setNearMeDistanceState] = useState<number | null>(() => {
    const distParam = searchParams.get("distance");
    if (distParam == null) return null;
    const parsed = Number(distParam);
    return Number.isFinite(parsed) ? parsed : null;
  });
  const [sort, setSortState] = useState<"alpha" | "active" | "nearest">(() => {
    const sortParam = searchParams.get("sort");
    return sortParam === "active" || sortParam === "nearest" ? sortParam : "alpha";
  });
  const [displayView, setDisplayViewState] = useState<"grid" | "map">(
    searchParams.get("view") === "grid" ? "grid" : "map",
  );
  const [mapBounds, setMapBounds] = useState<{ south: number; north: number; west: number; east: number } | null>(null);

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
        active: showActiveOnly,
        distance: nearMeDistance,
        sort,
        view: displayView,
        ...overrides,
      };

      for (const [key, val] of Object.entries(state)) {
        let str: string;
        if (val == null) {
          str = "";
        } else if (typeof val === "boolean") {
          str = val ? "true" : "false";
        } else if (typeof val === "number") {
          str = String(val);
        } else if (Array.isArray(val)) {
          str = val.join("|");
        } else {
          str = val;
        }
        // Only add non-default values
        const isDefault =
          (key === "sort" && str === "alpha") ||
          (key === "view" && str === "map") ||
          (key === "upcoming" && str !== "true") ||
          (key === "active" && str !== "false") ||
          str === "";
        if (!isDefault) {
          params.set(key, str);
        }
      }

      const qs = params.toString();
      const newUrl = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
      window.history.replaceState(window.history.state, "", newUrl);
    },
    [search, selectedRegions, selectedDays, selectedFrequency, showUpcomingOnly, showActiveOnly, nearMeDistance, sort, displayView],
  );

  // Wrapper setters that sync URL
  function setSearch(v: string) {
    setSearchState(v);
    syncUrl({ q: v });
  }
  function setSelectedRegions(v: string[]) {
    setSelectedRegionsState(v);
    setPrefApplied(null);
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
  function setShowActiveOnly(v: boolean) {
    setShowActiveOnlyState(v);
    syncUrl({ active: v });
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
    if (v === "grid") setMapBounds(null); // Clear area filter when switching to grid
    syncUrl({ view: v });
  }
  function handleRegionSelect(region: string) {
    setSelectedRegionsState([region]);
    setDisplayViewState("grid");
    setMapBounds(null);
    syncUrl({ regions: [region], view: "grid" });
  }
  function clearAllFilters() {
    setSearchState("");
    setSelectedRegionsState([]);
    setSelectedDaysState([]);
    setSelectedFrequencyState("");
    setShowUpcomingOnlyState(false);
    setShowActiveOnlyState(true);
    setNearMeDistanceState(null);
    setMapBounds(null);
    syncUrl({ q: "", regions: [], days: [], freq: "", upcoming: false, active: true, distance: null });
  }

  // Compute distances for each kennel (when geolocation is available)
  const kennelDistances = useMemo(() => {
    if (geoState.status !== "granted") return new Map<string, number>();
    const map = new Map<string, number>();
    for (const k of kennels) {
      const coords = getEventCoords(k.latitude, k.longitude, k.region);
      if (coords?.precise) {
        map.set(k.id, haversineDistance(geoState.lat, geoState.lng, coords.lat, coords.lng));
      }
    }
    return map;
  }, [kennels, geoState]);

  // Expand state-level region selections to metro names
  const regionsByState = useMemo(
    () => groupRegionsByState(kennels.map((k) => k.region)),
    [kennels],
  );
  const expandedRegions = useMemo(
    () => expandRegionSelections(selectedRegions, regionsByState),
    [selectedRegions, regionsByState],
  );

  // Filter pipeline
  const filtered = useMemo(() => {
    const query = search.toLowerCase();
    const fullDaySet = selectedDays.length > 0
      ? new Set(selectedDays.map((d) => DAY_FULL[d]))
      : null;
    return kennels.filter((k) => {
      // Text search
      if (
        query &&
        !k.shortName.toLowerCase().includes(query) &&
        !k.fullName.toLowerCase().includes(query) &&
        !k.region.toLowerCase().includes(query) &&
        !k.stateGroup.toLowerCase().includes(query) &&
        !k.country.toLowerCase().includes(query) &&
        !(k.description && k.description.toLowerCase().includes(query))
      ) {
        return false;
      }
      // Region (expanding state-level selections)
      if (selectedRegions.length > 0 && !expandedRegions.has(k.region)) {
        return false;
      }
      // Run day (match on scheduleDayOfWeek)
      if (fullDaySet) {
        if (!k.scheduleDayOfWeek || !fullDaySet.has(k.scheduleDayOfWeek)) {
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
      // Active only
      if (showActiveOnly) {
        const status = getActivityStatus(k.lastEventDate ? new Date(k.lastEventDate) : null, !!k.nextEvent);
        if (status !== "active") return false;
      }
      // Near me distance filter
      if (nearMeDistance != null && geoState.status === "granted") {
        const dist = kennelDistances.get(k.id);
        if (dist == null || dist > nearMeDistance) return false;
      }
      // Map bounds filter ("Search this area")
      if (mapBounds) {
        const coords = getEventCoords(k.latitude, k.longitude, k.region);
        if (!coords || coords.lat < mapBounds.south || coords.lat > mapBounds.north || coords.lng < mapBounds.west || coords.lng > mapBounds.east) {
          return false;
        }
      }
      return true;
    });
  }, [kennels, search, selectedRegions, expandedRegions, selectedDays, selectedFrequency, showUpcomingOnly, showActiveOnly, nearMeDistance, geoState, kennelDistances, mapBounds]);

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
      // Alphabetical by shortName, grouped by state
      items.sort((a, b) => {
        const stateCmp = a.stateGroup.localeCompare(b.stateGroup);
        if (stateCmp !== 0) return stateCmp;
        const regionCmp = a.region.localeCompare(b.region);
        if (regionCmp !== 0) return regionCmp;
        return a.shortName.localeCompare(b.shortName);
      });
    }
    return items;
  }, [filtered, sort, geoState, kennelDistances]);

  // Group by state (only for alpha sort)
  const grouped = useMemo(() => {
    if (sort !== "alpha") return null;
    const groups: Record<string, KennelCardData[]> = {};
    for (const k of sorted) {
      if (!groups[k.stateGroup]) groups[k.stateGroup] = [];
      groups[k.stateGroup].push(k);
    }
    return groups;
  }, [sorted, sort]);

  const groupKeys = grouped ? Object.keys(grouped).sort((a, b) => a.localeCompare(b)) : [];

  // Show "Nearest" sort option only when geolocation is granted
  const showNearestSort = geoState.status === "granted";

  // Track when a stored preference was auto-applied (for return-visitor banner)
  const [prefApplied, setPrefApplied] = useState<{ region?: string } | null>(null);

  // On mount: apply stored location preference if no URL filters are present
  // Also handle backwards compat for ?country= URL param
  const locationPrefApplied = useRef(false);
  useEffect(() => {
    if (locationPrefApplied.current) return;
    locationPrefApplied.current = true;

    // Backwards compat: convert ?country=UK to region selection
    const countryParam = searchParams.get("country");
    if (countryParam) {
      const countryName = resolveCountryName(countryParam);
      if (countryName) {
        setSelectedRegions([`country:${countryName}`]);
        return;
      }
    }

    const pref = getLocationPref();
    const result = resolveLocationDefault(searchParams, pref);
    if (!result) return;

    if (result.regions) {
      setSelectedRegions(result.regions);
      setPrefApplied({ region: result.regions[0] });
    } else if (result.nearMeDistance) {
      setNearMeDistance(result.nearMeDistance);
      requestLocation();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Determine if URL has any filter params (for LocationPrompt)
  const hasUrlFilters = useMemo(() => {
    const filterParams = ["regions", "distance", "days", "q", "freq", "upcoming", "country"];
    return filterParams.some((p) => searchParams.has(p));
  }, [searchParams]);

  // Region data derived from kennels — single pass for both LocationPrompt and RegionQuickChips
  const { uniqueRegionNames, kennelRegionCounts } = useMemo(() => {
    const counts = new Map<string, number>();
    for (const k of kennels) {
      if (k.region) counts.set(k.region, (counts.get(k.region) ?? 0) + 1);
    }
    return {
      uniqueRegionNames: Array.from(counts.keys()).sort((a, b) => a.localeCompare(b)),
      kennelRegionCounts: counts,
    };
  }, [kennels]);

  // Callbacks for LocationPrompt
  const handleSetNearMeFromPrompt = useCallback(
    (distance: number) => {
      setNearMeDistance(distance);
      requestLocation();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncUrl],
  );

  const handleSetRegionFromPrompt = useCallback(
    (region: string) => {
      setSelectedRegions([region]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [syncUrl],
  );

  // Dynamic page title based on selected regions
  useEffect(() => {
    if (selectedRegions.length === 1) {
      document.title = `${regionAbbrev(selectedRegions[0])} Kennels | HashTracks`;
    } else {
      document.title = "Kennels | HashTracks";
    }
  }, [selectedRegions]);

  return (
    <div className="mt-6 space-y-4">
      {/* Location prompt for first-time / return visitors */}
      <LocationPrompt
        hasUrlFilters={hasUrlFilters}
        onSetNearMe={handleSetNearMeFromPrompt}
        onSetRegion={handleSetRegionFromPrompt}
        regionNames={uniqueRegionNames}
        page="kennels"
        prefApplied={!!prefApplied}
        appliedRegionName={prefApplied?.region}
        onClearRegion={() => {
          setSelectedRegions([]);
          clearLocationPref();
          setPrefApplied(null);
          syncUrl({ regions: [] });
        }}
      />

      <RegionQuickChips
        regionCounts={kennelRegionCounts}
        selectedRegions={selectedRegions}
        onRegionsChange={setSelectedRegions}
        label="kennels"
      />

      {/* Unified filter bar */}
      <FilterBar
        items={kennels}
        search={search}
        onSearchChange={setSearch}
        selectedRegions={selectedRegions}
        onRegionsChange={setSelectedRegions}
        selectedDays={selectedDays}
        onDaysChange={setSelectedDays}
        nearMeDistance={nearMeDistance}
        onNearMeDistanceChange={setNearMeDistance}
        geoState={geoState}
        onRequestLocation={requestLocation}
        selectedFrequency={selectedFrequency}
        onFrequencyChange={setSelectedFrequency}
        showUpcomingOnly={showUpcomingOnly}
        onUpcomingOnlyChange={setShowUpcomingOnly}
        showActiveOnly={showActiveOnly}
        onActiveOnlyChange={setShowActiveOnly}
        onClearAll={clearAllFilters}
        searchPlaceholder="Search kennels..."
      />

      {/* Sort + view toggles */}
      <div className="flex items-center gap-2">
        {displayView === "grid" && (
          <ToggleGroup
            type="single"
            value={sort}
            onValueChange={(v) => v && setSort(v as "alpha" | "active" | "nearest")}
            variant="outline"
            size="sm"
          >
            <ToggleGroupItem value="alpha">A-Z</ToggleGroupItem>
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

      {/* Dynamic scoping header + cross-link when a single region is selected */}
      {selectedRegions.length === 1 && (
        <>
          <h2 className="text-lg font-semibold">Kennels in {regionDisplayName(selectedRegions[0])}</h2>
        </>
      )}

      {/* Results count */}
      <p className="text-sm text-muted-foreground">
        {filtered.length} {filtered.length === 1 ? "kennel" : "kennels"}
        {mapBounds && (
          <>
            {" in this area · "}
            <button
              type="button"
              className="text-primary underline underline-offset-2"
              onClick={() => setMapBounds(null)}
            >
              Clear area filter
            </button>
          </>
        )}
      </p>

      {selectedRegions.length === 1 && (
        <Link
          href={`/hareline?regions=${encodeURIComponent(selectedRegions[0])}`}
          className="text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          View upcoming events in {regionDisplayName(selectedRegions[0])} &rarr;
        </Link>
      )}

      {/* Map or Grid */}
      {displayView === "map" ? (
        <KennelMapView kennels={filtered} onRegionSelect={handleRegionSelect} onBoundsFilter={setMapBounds} />
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <SearchX className="h-10 w-10 text-muted-foreground/50" />
          <p className="text-sm text-muted-foreground">
            {search
              ? `No kennels matching '${search}'.`
              : "No kennels match your filters."}
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button variant="outline" size="sm" onClick={clearAllFilters}>
              Clear all filters
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/suggest">Suggest a kennel</Link>
            </Button>
          </div>
        </div>
      ) : sort === "alpha" && grouped ? (
        // Grouped by region
        <div className="space-y-8">
          {groupKeys.map((group) => (
            <div key={group}>
              <h2 className="mb-3 text-lg font-semibold">
                {group}
                {group === "D.C. Metro" && (
                  <span className="text-xs font-normal text-muted-foreground"> (MD · DC · VA · WV)</span>
                )}{" "}
                <span className="text-sm font-normal text-muted-foreground">
                  ({grouped[group].length})
                </span>
              </h2>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
                {grouped[group].map((kennel) => (
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
