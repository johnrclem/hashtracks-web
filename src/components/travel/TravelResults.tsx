"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { capture } from "@/lib/analytics";
import {
  computeDayCounts,
  groupResultsByTier,
  passesDayFilter,
  getDayCode,
  toggleDay as toggleDayInSet,
  TIERS,
  type DayCode,
  type DistanceTier,
} from "@/lib/travel/filters";
import { formatDayHeader, cityToIata, extractCityName } from "@/lib/travel/format";
import {
  bucketDays,
  bucketStops,
  type MultiDestView,
} from "@/lib/travel/multi-destination";
import { ConfirmedCard } from "./ConfirmedCard";
import { LikelyCard } from "./LikelyCard";
import { PossibleSection } from "./PossibleSection";
import { PossibleRow } from "./PossibleRow";
import { TravelResultFilters } from "./TravelResultFilters";
import type {
  SerializedConfirmed,
  SerializedLikely,
  SerializedPossible,
  SerializedDestination,
} from "@/lib/travel/serialize";
export type { SerializedDestination };

interface TravelResultsProps {
  destination: string;
  results: {
    confirmed: SerializedConfirmed[];
    likely: SerializedLikely[];
    possible: SerializedPossible[];
  };
  /** Per-stop metadata. When length > 1 the multi-destination view
   * toggle renders; otherwise the distance-tier view takes over. */
  destinations?: SerializedDestination[];
}

const TIER_LABELS: Record<DistanceTier, { title: string; description: string }> = {
  nearby: { title: "Close by", description: "≤ 10 km" },
  area: { title: "Across town", description: "10–25 km" },
  drive: { title: "Day trip material", description: "25+ km" },
};

export function TravelResults({
  destination,
  results,
  destinations,
}: Readonly<TravelResultsProps>) {
  const { confirmed, likely, possible } = results;
  const isMultiStop = (destinations?.length ?? 0) > 1;

  const [includePossible, setIncludePossible] = useState(false);
  const [selectedDays, setSelectedDays] = useState<Set<DayCode>>(new Set());
  // Multi-stop view axis; single-stop trips keep the distance-tier render
  // below and ignore this state.
  const [viewMode, setViewMode] = useState<MultiDestView>("day-by-day");

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

  // Day-filtered rows shared by both multi-destination views. Multi-stop
  // views always include possibles (unlike the single-stop distance-tier
  // layout, which tucks them into a collapsed PossibleSection below). The
  // includePossible toggle is a single-stop-only affordance; multi-stop
  // shows per-stop "No trails on this leg" placeholders instead.
  const filteredForMultiStop = useMemo(() => {
    if (!isMultiStop) return null;
    return {
      confirmed: confirmed.filter((r) =>
        passesDayFilter(getDayCode(r.date), selectedDays),
      ),
      likely: likely.filter((r) =>
        passesDayFilter(getDayCode(r.date), selectedDays),
      ),
      possible: possible.filter((r) =>
        passesDayFilter(r.date ? getDayCode(r.date) : null, selectedDays),
      ),
    };
  }, [isMultiStop, confirmed, likely, possible, selectedDays]);

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

      {isMultiStop && (
        <ViewToggle
          viewMode={viewMode}
          onChange={(next) => {
            capture("travel_multidest_view_changed", { view: next });
            setViewMode(next);
          }}
        />
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

      {isMultiStop && filteredForMultiStop && viewMode === "day-by-day" && (
        <MultiDestDayView rows={filteredForMultiStop} />
      )}
      {isMultiStop && filteredForMultiStop && viewMode === "by-destination" && destinations && (
        <MultiDestDestinationView
          rows={filteredForMultiStop}
          destinations={destinations}
        />
      )}

      {!isMultiStop && (
      <>
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
        <PossibleSection
          results={filteredPossibleAll}
          confirmedCount={renderedTiers.reduce((sum, t) => sum + t.confirmed.length, 0)}
        />
      )}
      </>
      )}
    </div>
  );
}

/** Day-by-day / by-destination segmented control — appears only when multi-stop. */
function ViewToggle({
  viewMode,
  onChange,
}: {
  viewMode: MultiDestView;
  onChange: (next: MultiDestView) => void;
}) {
  return (
    <div
      role="tablist"
      aria-label="Results view"
      className="mt-4 inline-flex rounded-full border border-border bg-card p-0.5"
    >
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "day-by-day"}
        onClick={() => onChange("day-by-day")}
        className={`rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
          viewMode === "day-by-day"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        Day-by-day
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={viewMode === "by-destination"}
        onClick={() => onChange("by-destination")}
        className={`rounded-full px-4 py-1.5 font-mono text-[11px] uppercase tracking-[0.18em] transition ${
          viewMode === "by-destination"
            ? "bg-foreground text-background"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        By destination
      </button>
    </div>
  );
}

interface MultiDestRows {
  confirmed: SerializedConfirmed[];
  likely: SerializedLikely[];
  possible: SerializedPossible[];
}

/**
 * Day-by-day layout with LEG sub-bands on overlap days. Days sort
 * chronologically; overlap days (2+ legs share a date) split by
 * destinationIndex with a hairline ✈ perforation between bands.
 * Non-overlap days render flat.
 */
function MultiDestDayView({ rows }: { rows: MultiDestRows }) {
  const buckets = useMemo(() => bucketDays(rows), [rows]);

  if (buckets.length === 0) {
    return (
      <p className="mt-10 text-center text-sm text-muted-foreground">
        No results on any day.
      </p>
    );
  }

  return (
    <div className="mt-6 flex flex-col gap-10">
      {buckets.map((bucket) => {
        const orderedStops = [...bucket.bandsByStop.keys()].sort((a, b) => a - b);
        const hasOverlap = orderedStops.length > 1;
        return (
          <section key={bucket.dateKey ?? "cadence"} className="flex flex-col gap-4">
            <h2 className="font-display text-xl font-medium tracking-tight border-b border-border pb-2">
              {bucket.dateKey ? formatDayHeader(bucket.dateKey) : "Cadence-based"}
            </h2>
            {orderedStops.map((stopIndex, bandIdx) => {
              const band = bucket.bandsByStop.get(stopIndex)!;
              return (
                <div key={stopIndex} className="flex flex-col gap-3">
                  {hasOverlap && (
                    <>
                      {bandIdx > 0 && <Perforation />}
                      <LegSubHeader
                        destinationIndex={stopIndex}
                        destinationLabel={band.label}
                      />
                    </>
                  )}
                  <DayRows
                    confirmed={band.confirmed}
                    likely={band.likely}
                    possible={band.possible}
                  />
                </div>
              );
            })}
          </section>
        );
      })}
    </div>
  );
}

/**
 * By-destination layout — one boarding-pass panel per stop (1–3 column
 * grid). Stops with zero rows still render as an empty placeholder so
 * users can see which leg didn't land anything.
 */
function MultiDestDestinationView({
  rows,
  destinations,
}: {
  rows: MultiDestRows;
  destinations: SerializedDestination[];
}) {
  const stops = useMemo(() => bucketStops(rows), [rows]);

  return (
    <div className="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2 xl:grid-cols-3">
      {destinations.map((dest) => {
        const bucket = stops.get(dest.index);
        const total =
          (bucket?.confirmed.length ?? 0) +
          (bucket?.likely.length ?? 0) +
          (bucket?.possible.length ?? 0);

        return (
          <article
            key={dest.index}
            className="flex flex-col gap-4 rounded-xl border border-border bg-card p-5"
          >
            <header className="border-b border-dashed border-border pb-3">
              <div className="flex items-baseline justify-between gap-2">
                <LegSubHeader
                  destinationIndex={dest.index}
                  destinationLabel={dest.label}
                />
                <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
                  {dest.radiusKm} km
                </span>
              </div>
              <p className="mt-1 font-mono text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                {dest.startDate.slice(0, 10)} → {dest.endDate.slice(0, 10)}
              </p>
            </header>

            {total === 0 ? (
              <p className="text-sm italic text-muted-foreground">
                No trails on this leg.
              </p>
            ) : (
              <DayRows
                confirmed={bucket!.confirmed}
                likely={bucket!.likely}
                possible={bucket!.possible}
              />
            )}
          </article>
        );
      })}
    </div>
  );
}

/** LEG stamp header — sequence number + IATA. */
function LegSubHeader({
  destinationIndex,
  destinationLabel,
}: {
  destinationIndex: number;
  destinationLabel: string | null;
}) {
  const seq = String(destinationIndex + 1).padStart(2, "0");
  const iata = destinationLabel ? cityToIata(destinationLabel) : "—";
  const cityShort = destinationLabel ? extractCityName(destinationLabel) : "Stop";
  return (
    <div className="flex items-center gap-3">
      <span className="inline-flex items-center justify-center rounded-sm border-[1.5px] border-red-600/70 px-1.5 py-[1px] font-mono text-[10px] font-bold uppercase tracking-wider text-red-600 dark:border-red-400/70 dark:text-red-400">
        LEG {seq} · {iata}
      </span>
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
        {cityShort}
      </span>
    </div>
  );
}

/** Hairline ticket perforation with a rotated ✈ glyph. Renders between
 *  LEG sub-bands on overlap days so the split reads as a tear-strip. */
function Perforation() {
  return (
    <div className="relative my-2 h-px w-full bg-[length:6px_1px] bg-repeat-x bg-muted-foreground/35" aria-hidden="true">
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rotate-[-8deg] bg-background px-2.5 text-sm text-muted-foreground/80"
      >
        ✈
      </span>
    </div>
  );
}

/** Shared row render — confirmed + likely cards stacked; possibles dashed-indented. */
function DayRows({
  confirmed,
  likely,
  possible,
}: {
  confirmed: SerializedConfirmed[];
  likely: SerializedLikely[];
  possible: SerializedPossible[];
}) {
  return (
    <div className="flex flex-col gap-4">
      {confirmed.map((r) => (
        <ConfirmedCard key={r.eventId} result={r} />
      ))}
      {likely.map((r, i) => (
        <LikelyCard key={`${r.kennelId}-${r.date}-${i}`} result={r} />
      ))}
      {possible.length > 0 && (
        <div className="flex flex-col border-l-2 border-dashed border-border/60 pl-3">
          {possible.map((r, i) => (
            <PossibleRow key={`${r.kennelId}-${r.date ?? "cadence"}-${i}`} result={r} />
          ))}
        </div>
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
