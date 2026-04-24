"use client";

import { memo, useCallback } from "react";
import { MapPin, Calendar, Compass, X } from "lucide-react";
import { formatNights } from "@/lib/travel/format";
import { DestinationInput } from "../DestinationInput";
import { BoardingStamp } from "./BoardingStamp";
import { legDatesValid } from "./helpers";
import { RADIUS_OPTIONS, type LegState } from "./types";

interface LegRowProps {
  leg: LegState;
  legIndex: number;
  isOnlyLeg: boolean;
  autoFocus: boolean;
  showRequiredStamps: boolean;
  updateLeg: (index: number, patch: Partial<LegState>) => void;
  removeLeg?: (index: number) => void;
}

/**
 * One boarding-pass row per leg. Memoized so typing into one leg's
 * date input doesn't re-render other legs — `updateLeg` / `removeLeg`
 * come from the parent as stable `useCallback` references that take
 * the leg index as an argument, so the row can bind per-row closures
 * without breaking referential equality.
 */
export const LegRow = memo(function LegRow({
  leg,
  legIndex,
  isOnlyLeg,
  autoFocus,
  showRequiredStamps,
  updateLeg,
  removeLeg,
}: Readonly<LegRowProps>) {
  const legLabel = `LEG ${String(legIndex + 1).padStart(2, "0")}`;
  const destInvalid = showRequiredStamps && (!leg.destination || !leg.coordsResolved);
  const datesInvalid = showRequiredStamps && !legDatesValid(leg);

  const onDestinationChange = useCallback(
    (place: { label: string; latitude: number; longitude: number; timezone?: string }) => {
      updateLeg(legIndex, {
        destination: place.label,
        latitude: place.latitude,
        longitude: place.longitude,
        coordsResolved: true,
        timezone: place.timezone ?? "",
      });
    },
    [updateLeg, legIndex],
  );
  const onDestinationClear = useCallback(() => {
    updateLeg(legIndex, {
      destination: "",
      latitude: 0,
      longitude: 0,
      coordsResolved: false,
      timezone: "",
    });
  }, [updateLeg, legIndex]);
  const onStartDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateLeg(legIndex, { startDate: e.target.value }),
    [updateLeg, legIndex],
  );
  const onEndDateChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => updateLeg(legIndex, { endDate: e.target.value }),
    [updateLeg, legIndex],
  );
  const onRadiusChange = useCallback(
    (value: number) => updateLeg(legIndex, { radiusKm: value }),
    [updateLeg, legIndex],
  );
  const onRemoveClick = useCallback(
    () => removeLeg?.(legIndex),
    [removeLeg, legIndex],
  );

  return (
    <div className="travel-animate">
      <div className="mb-2 grid grid-cols-3 gap-0 px-1 md:grid-cols-[auto_2.4fr_1.4fr_1fr_auto]">
        <div className="hidden items-center justify-center text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          &nbsp;
        </div>
        <div className="flex items-center gap-2 pl-5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
          <MapPin className="h-3 w-3" />
          Destination
          {destInvalid && <BoardingStamp label="Required" variant="required" />}
        </div>
        <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          <Calendar className="h-3 w-3" />
          Dates
          {datesInvalid && <BoardingStamp label="Required" variant="required" />}
        </div>
        <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          <Compass className="h-3 w-3" />
          Radius
        </div>
        <div />
      </div>
      <div
        className={`
          travel-grain relative rounded-xl border-[1.5px] border-border
          bg-card shadow-lg transition-all duration-300
          focus-within:border-ring focus-within:shadow-xl
          ${isOnlyLeg ? "md:-rotate-[0.5deg] md:focus-within:rotate-0" : ""}
        `}
        style={{ "--travel-grain-opacity": "0.04" } as React.CSSProperties}
      >
        <div className="grid grid-cols-1 md:grid-cols-[auto_2.4fr_1.4fr_1fr_auto]">
          <div className="flex items-start justify-center border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <BoardingStamp label={legLabel} variant="leg" />
          </div>

          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Leg {legIndex + 1} destination</legend>
            <DestinationInput
              value={leg.destination}
              autoFocus={autoFocus}
              onChange={onDestinationChange}
              onClear={onDestinationClear}
            />
            {leg.timezone && (
              <p className="mt-1 text-xs text-muted-foreground">
                {leg.destination.split(",").at(-1)?.trim()} · {leg.timezone.split("/").at(-1)?.replaceAll("_", " ")}
              </p>
            )}
          </fieldset>

          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Leg {legIndex + 1} dates</legend>
            <div className="flex gap-2">
              <input
                type="date"
                value={leg.startDate}
                onChange={onStartDateChange}
                aria-label={`Leg ${legIndex + 1} start date`}
                className="w-full bg-transparent font-mono text-sm focus:outline-none"
              />
              <span className="text-muted-foreground">→</span>
              <input
                type="date"
                value={leg.endDate}
                onChange={onEndDateChange}
                aria-label={`Leg ${legIndex + 1} end date`}
                className="w-full bg-transparent font-mono text-sm focus:outline-none"
              />
            </div>
            {legDatesValid(leg) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {formatNights(leg.startDate, leg.endDate)}
              </p>
            )}
          </fieldset>

          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Leg {legIndex + 1} radius</legend>
            <RadiusPicker value={leg.radiusKm} onChange={onRadiusChange} />
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {leg.radiusKm} km · ~{Math.round(leg.radiusKm * 0.621)} mi
            </p>
          </fieldset>

          <div className="flex items-start justify-center p-5">
            {removeLeg && (
              <button
                type="button"
                onClick={onRemoveClick}
                aria-label={`Remove leg ${legIndex + 1}`}
                className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-red-600/10 hover:text-red-600 dark:hover:text-red-400"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});

function RadiusPicker({ value, onChange }: Readonly<{ value: number; onChange: (v: number) => void }>) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {RADIUS_OPTIONS.map((opt) => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          aria-pressed={value === opt.value}
          className={`
            rounded-md px-2.5 py-1 text-xs font-medium transition-colors
            ${
              value === opt.value
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:bg-accent"
            }
          `}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}
