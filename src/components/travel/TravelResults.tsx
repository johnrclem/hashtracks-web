"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { SourceLink } from "@/lib/travel/search";
import { capture } from "@/lib/analytics";
import {
  computeDayCounts,
  groupResultsByTier,
  toggleDay as toggleDayInSet,
  TIERS,
  type DayCode,
  type DistanceTier,
} from "@/lib/travel/filters";
import { formatDayHeader } from "@/lib/travel/format";
import { ConfirmedCard } from "./ConfirmedCard";
import { LikelyCard } from "./LikelyCard";
import { PossibleSection } from "./PossibleSection";
import { PossibleRow } from "./PossibleRow";
import { TravelResultFilters } from "./TravelResultFilters";

interface SerializedConfirmed {
  type: "confirmed";
  eventId: string;
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelFullName: string;
  kennelRegion: string;
  kennelPinColor: string | null;
  date: string;
  startTime: string | null;
  title: string | null;
  runNumber: number | null;
  haresText: string | null;
  locationName: string | null;
  locationStreet: string | null;
  locationCity: string | null;
  timezone: string | null;
  sourceUrl: string | null;
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  sourceLinks: SourceLink[];
  weather: {
    highTempC: number;
    lowTempC: number;
    condition: string;
    conditionType: string;
    precipProbability: number;
  } | null;
  attendance: { status: string; participationLevel: string } | null;
}

interface SerializedLikely {
  type: "likely";
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelFullName: string;
  kennelRegion: string;
  kennelPinColor: string | null;
  date: string;
  startTime: string | null;
  confidence: "high" | "medium";
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  explanation: string;
  evidenceWindow: string;
  evidenceTimeline: { weeks: boolean[]; totalEvents: number };
  sourceLinks: SourceLink[];
}

interface SerializedPossible {
  type: "possible";
  kennelId: string;
  kennelSlug: string;
  kennelName: string;
  kennelFullName: string;
  kennelRegion: string;
  date: string | null;
  confidence: "low";
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  explanation: string;
  sourceLinks: SourceLink[];
}

interface TravelResultsProps {
  destination: string;
  results: {
    confirmed: SerializedConfirmed[];
    likely: SerializedLikely[];
    possible: SerializedPossible[];
  };
}

const TIER_LABELS: Record<DistanceTier, { title: string; description: string }> = {
  nearby: { title: "Close by", description: "≤ 10 km" },
  area: { title: "Across town", description: "10–25 km" },
  drive: { title: "Day trip material", description: "25+ km" },
};

export function TravelResults({ destination, results }: Readonly<TravelResultsProps>) {
  const { confirmed, likely, possible } = results;

  const [includePossible, setIncludePossible] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<DayCode>>(new Set());

  // Fire once per unique search result set. The string key captures every
  // distinct result shape (destination + counts), and the useEffect only
  // re-runs when that key changes — client-side filter toggles that don't
  // change the underlying results won't re-fire. The ref guard is a
  // defense-in-depth against React Strict Mode's double-mount in dev, which
  // would otherwise double-fire on the very first render.
  const viewedRef = useRef("");
  const viewedKey = `${destination}|${confirmed.length}|${likely.length}|${possible.length}`;
  useEffect(() => {
    if (viewedRef.current === viewedKey) return;
    viewedRef.current = viewedKey;
    capture("travel_search_results_viewed", {
      destination,
      confirmedCount: confirmed.length,
      likelyCount: likely.length,
      possibleCount: possible.length,
    });
  }, [viewedKey, destination, confirmed.length, likely.length, possible.length]);

  const { availableDays, dayCounts, datesByDay } = useMemo(
    () => computeDayCounts(confirmed, likely, possible),
    [confirmed, likely, possible],
  );

  const toggleDay = (day: DayCode) => {
    capture("travel_filter_applied", { filterType: "dow", value: day });
    setSelectedDays((prev) => toggleDayInSet(prev, day));
  };

  const clearDays = () => {
    capture("travel_filter_applied", { filterType: "dow", value: "clear" });
    setSelectedDays(new Set());
  };

  const handleIncludePossibleChange = (next: boolean) => {
    capture("travel_filter_applied", {
      filterType: "include_possible",
      value: next ? "on" : "off",
    });
    setIncludePossible(next);
  };

  const grouped = useMemo(
    () => groupResultsByTier({ confirmed, likely, possible, selectedDays }),
    [confirmed, likely, possible, selectedDays],
  );

  const renderedTiers = TIERS.map((tier) => ({
    tier,
    ...grouped[tier],
    shownPossible: includePossible ? grouped[tier].possible : [],
  })).filter(
    (t) => t.confirmed.length + t.likely.length + t.shownPossible.length > 0,
  );

  // Flat possible list (after filter) used by the collapsed section when the
  // "Include possible" toggle is off.
  const filteredPossibleAll = [
    ...grouped.nearby.possible,
    ...grouped.area.possible,
    ...grouped.drive.possible,
  ];

  // Total possibles surfaced alongside confirmed/likely when the toggle is on.
  // Drives the small acknowledgment line below the filter chips — explicit
  // effect-feedback without elevating low-confidence data to the headline.
  const shownPossibleTotal = renderedTiers.reduce(
    (sum, t) => sum + t.shownPossible.length,
    0,
  );

  let cardIndex = 0;

  return (
    <div className="mt-2 border-l border-[var(--destination-pin,oklch(0.65_0.18_42))] pl-6 lg:pl-8">
      <TravelResultFilters
        includePossible={includePossible}
        onIncludePossibleChange={handleIncludePossibleChange}
        selectedDays={selectedDays}
        onToggleDay={toggleDay}
        onClearDays={clearDays}
        availableDays={availableDays}
        dayCounts={dayCounts}
        datesByDay={datesByDay}
        possibleCount={possible.length}
      />

      {includePossible && shownPossibleTotal > 0 && (
        <p className="mt-2 text-xs italic text-muted-foreground">
          +{shownPossibleTotal} possible trail{shownPossibleTotal !== 1 ? "s" : ""} showing alongside confirmed results.
        </p>
      )}

      {/*
        Only show the "no matches" banner when the filter has truly hidden
        everything — including the collapsed PossibleSection below. Without
        this check, a search that surfaces only low-confidence possibles
        would stack "No results match the active filters" directly on top
        of "Possible activity · N kennels".
      */}
      {renderedTiers.length === 0 && filteredPossibleAll.length === 0 && (
        <div className="mt-10 text-center text-sm text-muted-foreground">
          No results match the active filters.{" "}
          <button
            type="button"
            onClick={() => {
              clearDays();
              setIncludePossible(false);
            }}
            className="underline underline-offset-2 hover:text-foreground"
          >
            Clear filters
          </button>
        </div>
      )}

      <div className="mt-6">
        {renderedTiers.map(({ tier, confirmed: tc, likely: tl, shownPossible }) => {
          const total = tc.length + tl.length + shownPossible.length;
          // Safe: `tier` is typed as the DistanceTier string-union (TIERS).
          const label = TIER_LABELS[tier];
          const dayGroups = groupTierByDay(tc, tl, shownPossible);

          return (
            <section key={tier} className="mb-10">
              <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
                <h2 className="font-display text-lg font-medium">{label.title}</h2>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {total} trail{total !== 1 ? "s" : ""} · {label.description}
                </span>
              </div>

              <div className="flex flex-col gap-6">
                {dayGroups.map((group) => (
                  <div key={group.dateKey ?? "cadence"} className="flex flex-col gap-3">
                    <h3 className="font-display text-sm font-medium text-muted-foreground">
                      {group.dateLabel}
                    </h3>
                    <div className="flex flex-col gap-4">
                      {group.confirmed.map((result) => {
                        // Clamp stagger at 30 cards (1500ms total). Dense result
                        // sets (50+ kennels) would otherwise push the tail to
                        // 2.5s+, giving compositor oddities room to hide cards.
                        const delay = Math.min(cardIndex, 30) * 50;
                        cardIndex++;
                        return (
                          <AnimatedCard key={result.eventId} delay={delay}>
                            <ConfirmedCard result={result} />
                          </AnimatedCard>
                        );
                      })}
                      {group.likely.map((result) => {
                        const delay = Math.min(cardIndex, 30) * 50;
                        cardIndex++;
                        return (
                          <AnimatedCard
                            key={`${result.kennelId}-${result.date}`}
                            delay={delay}
                          >
                            <LikelyCard result={result} />
                          </AnimatedCard>
                        );
                      })}
                      {group.possible.length > 0 && (
                        <div className="flex flex-col border-l-2 border-dashed border-border/60 pl-3">
                          {group.possible.map((result, i) => (
                            <PossibleRow
                              key={`${result.kennelId}-${result.date ?? "cadence"}-${i}`}
                              result={result}
                            />
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {!includePossible && filteredPossibleAll.length > 0 && (
        <PossibleSection results={filteredPossibleAll} confirmedCount={confirmed.length} />
      )}
    </div>
  );
}

function AnimatedCard({
  delay,
  children,
}: {
  delay: number;
  children: React.ReactNode;
}) {
  return (
    <div
      className="travel-animate"
      style={{
        opacity: 0,
        animation: `travel-card-enter 400ms ease-out forwards`,
        animationDelay: `${delay}ms`,
      }}
    >
      {children}
    </div>
  );
}

interface DayGroup {
  dateKey: string | null;
  dateLabel: string;
  confirmed: SerializedConfirmed[];
  likely: SerializedLikely[];
  possible: SerializedPossible[];
}

/**
 * Within a distance tier, group cards by day so travelers can scan "what's
 * happening on each day" without re-reading raw dates. Null-date possibles
 * (cadence-based, e.g. full-moon kennels) fall into a trailing
 * "Cadence-based" group. Day keys sort chronologically; cadence group sorts
 * last. This is the traveler's secondary reading axis — distance tier is
 * still primary. A true day-first primary grouping ships with multi-city.
 */
function groupTierByDay(
  confirmed: SerializedConfirmed[],
  likely: SerializedLikely[],
  possible: SerializedPossible[],
): DayGroup[] {
  const byDay = new Map<string | null, DayGroup>();
  const touchGroup = (date: string | null): DayGroup => {
    const key = date ? date.slice(0, 10) : null;
    let group = byDay.get(key);
    if (!group) {
      group = {
        dateKey: key,
        dateLabel: key ? formatDayHeader(key) : "Cadence-based",
        confirmed: [],
        likely: [],
        possible: [],
      };
      byDay.set(key, group);
    }
    return group;
  };

  for (const r of confirmed) touchGroup(r.date).confirmed.push(r);
  for (const r of likely) touchGroup(r.date).likely.push(r);
  for (const r of possible) touchGroup(r.date).possible.push(r);

  return [...byDay.values()].sort((a, b) => {
    if (a.dateKey === null) return 1;
    if (b.dateKey === null) return -1;
    return a.dateKey.localeCompare(b.dateKey);
  });
}
