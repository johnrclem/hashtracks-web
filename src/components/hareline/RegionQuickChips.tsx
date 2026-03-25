"use client";

import { useMemo } from "react";
import { regionAbbrev } from "@/lib/region";
import type { HarelineEvent } from "./EventCard";

interface RegionQuickChipsProps {
  events: HarelineEvent[];
  selectedRegions: string[];
  onRegionsChange: (regions: string[]) => void;
}

export function RegionQuickChips({
  events,
  selectedRegions,
  onRegionsChange,
}: RegionQuickChipsProps) {
  // Compute top 6 regions by event count
  const topRegions = useMemo(() => {
    const counts = new Map<string, number>();
    for (const e of events) {
      const region = e.kennel?.region;
      if (region) {
        counts.set(region, (counts.get(region) ?? 0) + 1);
      }
    }
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([name, count]) => ({
        name,
        abbrev: regionAbbrev(name),
        count,
      }));
  }, [events]);

  if (topRegions.length === 0) return null;

  function toggleRegion(regionName: string) {
    if (selectedRegions.includes(regionName)) {
      onRegionsChange(selectedRegions.filter((r) => r !== regionName));
    } else {
      onRegionsChange([...selectedRegions, regionName]);
    }
  }

  function clearRegions() {
    onRegionsChange([]);
  }

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide">
      {topRegions.map((region) => {
        const isSelected = selectedRegions.includes(region.name);
        return (
          <button
            key={region.name}
            onClick={() => toggleRegion(region.name)}
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              isSelected
                ? "bg-primary text-primary-foreground"
                : "border bg-background text-muted-foreground hover:text-foreground hover:bg-accent cursor-pointer"
            }`}
            aria-pressed={isSelected}
          >
            {region.abbrev}
          </button>
        );
      })}
      {selectedRegions.length > 0 && (
        <button
          onClick={clearRegions}
          className="shrink-0 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        >
          All regions
        </button>
      )}
    </div>
  );
}
