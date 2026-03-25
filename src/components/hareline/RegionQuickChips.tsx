"use client";

import { useMemo } from "react";
import { X } from "lucide-react";
import { regionAbbrev } from "@/lib/region";
import { getRegionColor } from "@/lib/geo";
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
        color: getRegionColor(name),
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

  return (
    <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pb-0.5">
      {topRegions.map((region) => {
        const isSelected = selectedRegions.includes(region.name);
        return (
          <button
            key={region.name}
            onClick={() => toggleRegion(region.name)}
            className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-all ${
              isSelected
                ? "bg-primary text-primary-foreground shadow-sm"
                : "border bg-background text-muted-foreground hover:text-foreground hover:border-foreground/20 cursor-pointer"
            }`}
            aria-pressed={isSelected}
            title={`${region.name} (${region.count} events)`}
          >
            {/* Region color dot */}
            <span
              className="shrink-0 rounded-full w-1.5 h-1.5"
              style={{
                backgroundColor: isSelected ? "currentColor" : region.color,
              }}
            />
            {region.abbrev}
            <span
              className={`font-mono text-[10px] ${
                isSelected
                  ? "text-primary-foreground/70"
                  : "text-muted-foreground/60"
              }`}
            >
              {region.count}
            </span>
          </button>
        );
      })}
      {selectedRegions.length > 0 && (
        <button
          onClick={() => onRegionsChange([])}
          className="shrink-0 inline-flex items-center gap-1 rounded-full border border-dashed bg-background px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground cursor-pointer"
        >
          <X className="h-3 w-3" />
          Clear
        </button>
      )}
    </div>
  );
}
