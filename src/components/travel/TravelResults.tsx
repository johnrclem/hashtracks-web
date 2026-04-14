"use client";

import { useMemo, useState } from "react";
import {
  computeDayCounts,
  groupResultsByTier,
  toggleDay as toggleDayInSet,
  TIERS,
  type DayCode,
  type DistanceTier,
} from "@/lib/travel/filters";
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
  locationCity: string | null;
  timezone: string | null;
  sourceUrl: string | null;
  distanceKm: number;
  distanceTier: "nearby" | "area" | "drive";
  sourceLinks: { url: string; label: string; type: string }[];
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
  sourceLinks: { url: string; label: string; type: string }[];
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
  sourceLinks: { url: string; label: string; type: string }[];
}

interface TravelResultsProps {
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

export function TravelResults({ results }: TravelResultsProps) {
  const { confirmed, likely, possible } = results;

  const [includePossible, setIncludePossible] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<DayCode>>(new Set());

  const { availableDays, dayCounts, datesByDay } = useMemo(
    () => computeDayCounts(confirmed, likely, possible),
    [confirmed, likely, possible],
  );

  const toggleDay = (day: DayCode) =>
    setSelectedDays((prev) => toggleDayInSet(prev, day));

  const clearDays = () => setSelectedDays(new Set());

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

  let cardIndex = 0;

  return (
    <div className="mt-2 border-l border-[var(--destination-pin,oklch(0.65_0.18_42))] pl-6 lg:pl-8">
      <TravelResultFilters
        includePossible={includePossible}
        onIncludePossibleChange={setIncludePossible}
        selectedDays={selectedDays}
        onToggleDay={toggleDay}
        onClearDays={clearDays}
        availableDays={availableDays}
        dayCounts={dayCounts}
        datesByDay={datesByDay}
        possibleCount={possible.length}
      />

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
          const label = TIER_LABELS[tier];

          return (
            <section key={tier} className="mb-10">
              <div className="mb-4 flex items-baseline gap-3 border-b border-border pb-2">
                <h2 className="font-display text-lg font-medium">{label.title}</h2>
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {total} trail{total !== 1 ? "s" : ""} · {label.description}
                </span>
              </div>

              <div className="flex flex-col gap-4">
                {tc.map((result) => {
                  const delay = cardIndex++ * 50;
                  return (
                    <AnimatedCard key={result.eventId} delay={delay}>
                      <ConfirmedCard result={result} />
                    </AnimatedCard>
                  );
                })}
                {tl.map((result) => {
                  const delay = cardIndex++ * 50;
                  return (
                    <AnimatedCard
                      key={`${result.kennelId}-${result.date}`}
                      delay={delay}
                    >
                      <LikelyCard result={result} />
                    </AnimatedCard>
                  );
                })}

                {shownPossible.length > 0 && (
                  <div className="flex flex-col border-l-2 border-dashed border-border/60 pl-3">
                    {shownPossible.map((result, i) => (
                      <PossibleRow
                        key={`${result.kennelId}-${result.date ?? "cadence"}-${i}`}
                        result={result}
                      />
                    ))}
                  </div>
                )}
              </div>
            </section>
          );
        })}
      </div>

      {!includePossible && filteredPossibleAll.length > 0 && (
        <PossibleSection results={filteredPossibleAll} />
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
