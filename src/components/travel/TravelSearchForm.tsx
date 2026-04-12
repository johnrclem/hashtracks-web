"use client";

import { useState, useCallback, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MapPin, Calendar, Compass, Search, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatDateCompact, daysBetween } from "@/lib/travel/format";

interface TravelSearchFormProps {
  variant: "hero" | "compact";
  initialValues?: {
    destination: string;
    latitude: number;
    longitude: number;
    startDate: string;
    endDate: string;
    radiusKm: number;
    timezone?: string;
  };
}

const RADIUS_OPTIONS = [
  { value: 10, label: "Close", description: "~6 mi" },
  { value: 25, label: "Metro", description: "~15 mi" },
  { value: 50, label: "Region", description: "~30 mi" },
  { value: 100, label: "Far", description: "~60 mi" },
] as const;

export function TravelSearchForm({ variant, initialValues }: TravelSearchFormProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [destination, setDestination] = useState(initialValues?.destination ?? "");
  const [latitude, setLatitude] = useState(initialValues?.latitude ?? 0);
  const [longitude, setLongitude] = useState(initialValues?.longitude ?? 0);
  const [startDate, setStartDate] = useState(initialValues?.startDate ?? "");
  const [endDate, setEndDate] = useState(initialValues?.endDate ?? "");
  const [radiusKm, setRadiusKm] = useState(initialValues?.radiusKm ?? 50);
  const [timezone, setTimezone] = useState(initialValues?.timezone ?? "");
  const [isExpanded, setIsExpanded] = useState(variant === "hero");

  const canSubmit = destination && startDate && endDate && latitude !== 0;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    const params = new URLSearchParams({
      lat: latitude.toString(),
      lng: longitude.toString(),
      from: startDate,
      to: endDate,
      r: radiusKm.toString(),
      q: destination,
    });
    if (timezone) params.set("tz", timezone);
    startTransition(() => {
      router.push(`/travel?${params.toString()}`);
    });
    if (variant === "compact") setIsExpanded(false);
  }, [canSubmit, latitude, longitude, startDate, endDate, radiusKm, destination, timezone, router, variant]);

  // ── Compact variant: single-row pill ──
  if (variant === "compact" && !isExpanded) {
    return (
      <button
        onClick={() => setIsExpanded(true)}
        className="
          flex w-full items-center gap-3 rounded-full border border-border
          bg-card px-6 py-3 text-left transition-colors hover:bg-accent
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
        "
        aria-label="Edit travel search"
      >
        <MapPin className="h-4 w-4 text-muted-foreground" />
        <span className="font-medium">{destination || "Search"}</span>
        <span className="text-muted-foreground">·</span>
        <Calendar className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-sm text-muted-foreground">
          {startDate && endDate
            ? `${formatDateCompact(startDate)} → ${formatDateCompact(endDate)}`
            : "Dates"}
        </span>
        <span className="text-muted-foreground">·</span>
        <Compass className="h-4 w-4 text-muted-foreground" />
        <span className="font-mono text-sm text-muted-foreground">{radiusKm} km</span>
        <span className="ml-auto flex items-center gap-1.5 rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
          <Pencil className="h-3 w-3" />
          Edit
        </span>
      </button>
    );
  }

  // ── Hero / Expanded variant: boarding pass form ──
  return (
    <div className="travel-animate">
      {/* Margin labels above the card border */}
      <div className="mb-2 grid grid-cols-3 gap-0 px-1 md:grid-cols-[1.8fr_1.4fr_1fr]">
        <div className="flex items-center gap-2 pl-5 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70">
          <MapPin className="h-3 w-3" />
          Destination
        </div>
        <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          <Calendar className="h-3 w-3" />
          Dates
        </div>
        <div className="hidden items-center gap-2 text-[10px] font-medium uppercase tracking-[0.15em] text-muted-foreground/70 md:flex">
          <Compass className="h-3 w-3" />
          Radius
        </div>
      </div>

      {/* The boarding pass card */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          handleSubmit();
        }}
        className="
          travel-grain relative overflow-hidden rounded-xl border-[1.5px] border-border
          bg-card shadow-lg transition-all duration-300
          focus-within:border-ring focus-within:shadow-xl
          md:-rotate-[0.5deg] md:focus-within:rotate-0
        "
        style={{ "--travel-grain-opacity": "0.04" } as React.CSSProperties}
        role="search"
        aria-label="Travel search"
      >
        <div className="grid grid-cols-1 md:grid-cols-[1.8fr_1.4fr_1fr_auto]">
          {/* Destination section */}
          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Destination</legend>
            <input
              type="text"
              value={destination}
              onChange={(e) => setDestination(e.target.value)}
              placeholder="Where are you going?"
              aria-label="Destination"
              className="
                w-full bg-transparent font-display text-lg font-medium
                placeholder:text-muted-foreground/40
                focus:outline-none
              "
              autoFocus={variant === "hero"}
            />
            {timezone && (
              <p className="mt-1 text-xs text-muted-foreground">
                {destination.split(",").slice(-1)[0]?.trim()} · {timezone.split("/").pop()?.replace(/_/g, " ")}
              </p>
            )}
          </fieldset>

          {/* Dates section */}
          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Dates</legend>
            <div className="flex gap-2">
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Start date"
                className="w-full bg-transparent font-mono text-sm focus:outline-none"
              />
              <span className="text-muted-foreground">→</span>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="End date"
                className="w-full bg-transparent font-mono text-sm focus:outline-none"
              />
            </div>
            {startDate && endDate && (
              <p className="mt-1 text-xs text-muted-foreground">
                {daysBetween(startDate, endDate)} nights
              </p>
            )}
          </fieldset>

          {/* Radius section */}
          <fieldset className="border-b border-dashed border-border p-5 md:border-b-0 md:border-r">
            <legend className="sr-only">Radius</legend>
            <div className="flex flex-wrap gap-1.5">
              {RADIUS_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setRadiusKm(opt.value)}
                  aria-pressed={radiusKm === opt.value}
                  className={`
                    rounded-md px-2.5 py-1 text-xs font-medium transition-colors
                    ${
                      radiusKm === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-muted-foreground hover:bg-accent"
                    }
                  `}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="mt-1.5 font-mono text-xs text-muted-foreground">
              {radiusKm} km · ~{Math.round(radiusKm * 0.621)} mi
            </p>
          </fieldset>

          {/* Submit section with barcode decoration */}
          <div className="flex flex-col items-end justify-between gap-3 p-5">
            {/* Decorative barcode */}
            <div className="hidden items-end gap-px opacity-40 md:flex" aria-hidden="true">
              {[60, 100, 70, 90, 50, 100, 65, 80, 45, 95, 70, 100].map((h, i) => (
                <span
                  key={i}
                  className="block bg-muted-foreground"
                  style={{ width: i % 3 === 1 ? 2 : 1, height: `${h * 0.22}px` }}
                />
              ))}
            </div>
            <Button
              type="submit"
              disabled={!canSubmit || isPending}
              className="
                group gap-2 rounded-lg px-6 uppercase tracking-wider
                transition-colors
              "
            >
              {isPending ? "Searching…" : "Search"}
              <Search className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </div>
        </div>
      </form>

      {/* ISSUED microlabel */}
      <div className="mt-2 flex justify-between px-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground/40" aria-hidden="true">
        <span>
          ISSUED {new Date().toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "2-digit" }).toUpperCase()} · HASHTRACKS
        </span>
        <span>REF HT-{destination ? destination.slice(0, 3).toUpperCase() : "XXX"}</span>
      </div>

      {/* Collapse button when in expanded compact mode */}
      {variant === "compact" && isExpanded && (
        <div className="mt-3 text-center">
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}

