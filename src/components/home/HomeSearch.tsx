"use client";

import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Crosshair, Loader2 } from "lucide-react";
import { geocodeDestinationWithTimezone } from "@/app/travel/actions";
import { DestinationInput, type PlaceSelection } from "@/components/travel/DestinationInput";
import { getBrowserLocation } from "@/hooks/useGeolocation";
import { capture } from "@/lib/analytics";
import { presetDateRange, type DateRange, type HomeDatePreset } from "@/lib/home-search";
import {
  buildTravelSearchUrl,
  DEFAULT_SEARCH_RADIUS_KM,
  isValidDateRange,
  NEAR_ME_RADIUS_KM,
} from "@/lib/travel/url";

type DateChoice = HomeDatePreset | "custom";

const DATE_CHOICES: { value: DateChoice; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "weekend", label: "This weekend" },
  { value: "custom", label: "Pick dates" },
];

const FIELD_LABEL = "font-mono text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
const CHIP = "rounded-full border px-3.5 py-2 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";
const CHIP_ON = "border-foreground bg-foreground font-semibold text-background";
const CHIP_OFF = "border-foreground/20 bg-background font-medium hover:border-foreground/40";

interface HomeSearchProps {
  /** The visitor's approximate area from their IP, prefilled when known. */
  guessedPlace: PlaceSelection | null;
}

/**
 * The homepage's main action: a place, a date range and "Find runs", which
 * opens Travel results. "Near me" searches from the browser's location.
 */
export function HomeSearch({ guessedPlace }: Readonly<HomeSearchProps>) {
  const router = useRouter();
  const whereId = useId();
  const [place, setPlace] = useState<PlaceSelection | null>(guessedPlace);
  const usingGuess = guessedPlace !== null && place === guessedPlace;
  // Text typed into the place field, for a submit without a picked suggestion.
  // A ref, not state: only submit reads it, so keystrokes needn't re-render the form.
  const typedText = useRef("");
  const [dateChoice, setDateChoice] = useState<DateChoice>("week");
  const [custom, setCustom] = useState<DateRange>(() => presetDateRange("week", new Date()));
  const [error, setError] = useState<string | null>(null);
  const [navigating, startNavigation] = useTransition();
  /** A lookup in flight before navigating: the browser location or a typed place. */
  const [pending, setPending] = useState<"locate" | "resolve" | null>(null);
  const busy = navigating || pending !== null;

  /** The chosen dates, or null (with an error shown) when a custom range is invalid. */
  function validDates(): DateRange | null {
    const dates = dateChoice === "custom" ? custom : presetDateRange(dateChoice, new Date());
    if (isValidDateRange(dates.startDate, dates.endDate)) return dates;
    setError("Pick a start date on or before the end date.");
    return null;
  }

  function search(target: PlaceSelection, dates: DateRange, nearMe: boolean) {
    capture("home_search_submitted", {
      datePreset: dateChoice,
      usedNearMe: nearMe,
      usedLocationGuess: !nearMe && usingGuess,
    });
    startNavigation(() => {
      router.push(
        buildTravelSearchUrl({
          latitude: target.latitude,
          longitude: target.longitude,
          startDate: dates.startDate,
          endDate: dates.endDate,
          label: target.label,
          radiusKm: nearMe ? NEAR_ME_RADIUS_KM : DEFAULT_SEARCH_RADIUS_KM,
          timezone: target.timezone,
        }),
      );
    });
  }

  /** Look up a typed place the visitor didn't pick from the suggestions. */
  async function resolveTyped(text: string): Promise<PlaceSelection | null> {
    setPending("resolve");
    try {
      const found = await geocodeDestinationWithTimezone(text);
      return "error" in found ? null : found;
    } catch {
      return null;
    } finally {
      setPending(null);
    }
  }

  async function handleSubmit() {
    setError(null);
    const dates = validDates();
    if (!dates) return;
    const text = typedText.current.trim();
    const target = place ?? (text ? await resolveTyped(text) : null);
    // The visitor edited the field while the lookup ran: that result is stale.
    if (!place && typedText.current.trim() !== text) return;
    if (target) {
      search(target, dates, false);
      return;
    }
    setError(text ? `We couldn't find "${text}". Try picking a town from the list.` : "Type a town, or use Near me.");
  }

  async function handleNearMe() {
    setError(null);
    const dates = validDates();
    if (!dates) return;
    setPending("locate");
    try {
      const { lat, lng } = await getBrowserLocation();
      search({ label: "Near me", latitude: lat, longitude: lng }, dates, true);
    } catch {
      setError("We couldn't get your location. Search for a town instead.");
    } finally {
      setPending(null);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        handleSubmit().catch(() => {});
      }}
      aria-label="Find runs"
      className="mx-auto mt-8 w-full max-w-4xl rounded-2xl border bg-card p-3 text-left shadow-lg sm:p-4"
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-stretch">
        <div className="min-w-0 flex-1 rounded-xl bg-muted/60 px-3 py-2">
          <label htmlFor={whereId} className={FIELD_LABEL}>
            Where
          </label>
          <DestinationInput
            id={whereId}
            value={guessedPlace?.label ?? ""}
            onTextChange={(text) => {
              typedText.current = text;
              if (error) setError(null);
            }}
            submitOnEnter
            onChange={(selected) => {
              setPlace(selected);
              setError(null);
            }}
            onClear={() => {
              setPlace(null);
              setError(null);
            }}
            resolvedHint={usingGuess ? "Your approximate location" : undefined}
          />
        </div>

        <fieldset className="min-w-0 rounded-xl bg-muted/60 px-3 py-2 md:flex-1">
          <legend className={`float-left ${FIELD_LABEL}`}>When</legend>
          <div className="clear-both flex flex-wrap gap-1.5 pt-1.5">
            {DATE_CHOICES.map((choice) => (
              <button
                key={choice.value}
                type="button"
                aria-pressed={dateChoice === choice.value}
                onClick={() => {
                  setDateChoice(choice.value);
                  setError(null);
                }}
                className={`${CHIP} ${dateChoice === choice.value ? CHIP_ON : CHIP_OFF}`}
              >
                {choice.label}
              </button>
            ))}
          </div>
          {dateChoice === "custom" && (
            <div className="mt-2 flex flex-wrap gap-2 text-sm">
              <label className="flex items-center gap-1.5">
                <span>From</span>
                <input
                  type="date"
                  value={custom.startDate}
                  onChange={(e) => {
                    setCustom((c) => ({ ...c, startDate: e.target.value }));
                    setError(null);
                  }}
                  className="rounded-md border bg-background px-2 py-1"
                />
              </label>
              <label className="flex items-center gap-1.5">
                <span>To</span>
                <input
                  type="date"
                  value={custom.endDate}
                  min={custom.startDate || undefined}
                  onChange={(e) => {
                    setCustom((c) => ({ ...c, endDate: e.target.value }));
                    setError(null);
                  }}
                  className="rounded-md border bg-background px-2 py-1"
                />
              </label>
            </div>
          )}
        </fieldset>

        <div className="flex flex-col justify-center gap-1">
          <button
            type="submit"
            disabled={busy}
            className="group inline-flex h-12 items-center justify-center gap-2 rounded-full bg-orange-600 px-7 text-base font-semibold text-white transition-colors hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-70"
          >
            {navigating || pending === "resolve" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Find runs
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
          </button>
          <button
            type="button"
            onClick={() => {
              handleNearMe().catch(() => {});
            }}
            disabled={busy}
            className="inline-flex items-center justify-center gap-1.5 rounded-full px-3 py-2 text-sm font-medium text-foreground/80 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            {pending === "locate" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
            {pending === "locate" ? "Finding you…" : "Near me"}
          </button>
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 px-1 text-sm text-red-700 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
