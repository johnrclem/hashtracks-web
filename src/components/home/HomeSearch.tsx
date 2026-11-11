"use client";

import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Crosshair, Loader2 } from "lucide-react";
import { geocodeDestination, resolveDestinationTimezone } from "@/app/travel/actions";
import { DestinationInput } from "@/components/travel/DestinationInput";
import { getBrowserLocation } from "@/hooks/useGeolocation";
import { capture } from "@/lib/analytics";
import { presetDateRange, type DateRange, type HomeDatePreset } from "@/lib/home-search";
import { buildTravelSearchUrl } from "@/lib/travel/url";

export interface HomeSearchPlace {
  label: string;
  latitude: number;
  longitude: number;
  timezone?: string | null;
}

type DateChoice = HomeDatePreset | "custom";

/** Same default radius as a Travel search and the Popular destinations cards. */
const SEARCH_RADIUS_KM = 50;
/** Same radius as Travel's own "near me" shortcut: the browser location is precise. */
const NEAR_ME_RADIUS_KM = 25;

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
  guessedPlace: HomeSearchPlace | null;
}

/**
 * The homepage's main action: a place, a date range and "Find runs", which
 * opens Travel results. "Near me" searches from the browser's location.
 */
export function HomeSearch({ guessedPlace }: Readonly<HomeSearchProps>) {
  const router = useRouter();
  const whereId = useId();
  const [place, setPlace] = useState<HomeSearchPlace | null>(guessedPlace);
  const [usingGuess, setUsingGuess] = useState(guessedPlace !== null);
  const [dateChoice, setDateChoice] = useState<DateChoice>("week");
  const [custom, setCustom] = useState<DateRange>(() => presetDateRange("week", new Date()));
  const [error, setError] = useState<string | null>(null);
  // Text typed into the place field, for a submit without a picked suggestion.
  const [typedText, setTypedText] = useState("");
  const [navigating, startNavigation] = useTransition();
  const [locating, setLocating] = useState(false);
  const [resolving, setResolving] = useState(false);
  const busy = navigating || locating || resolving;

  /** The chosen dates, or null (with an error shown) when a custom range is invalid. */
  function validDates(): DateRange | null {
    const dates = dateChoice === "custom" ? custom : presetDateRange(dateChoice, new Date());
    if (!dates.startDate || !dates.endDate || dates.startDate > dates.endDate) {
      setError("Pick a start date on or before the end date.");
      return null;
    }
    return dates;
  }

  function search(target: HomeSearchPlace, dates: DateRange, radiusKm: number, usedNearMe: boolean) {
    capture("home_search_submitted", {
      datePreset: dateChoice,
      usedNearMe,
      usedLocationGuess: !usedNearMe && usingGuess,
    });
    startNavigation(() => {
      router.push(
        buildTravelSearchUrl({
          latitude: target.latitude,
          longitude: target.longitude,
          startDate: dates.startDate,
          endDate: dates.endDate,
          label: target.label,
          radiusKm,
          timezone: target.timezone,
        }),
      );
    });
  }

  /** Look up a typed place the visitor didn't pick from the suggestions. */
  async function resolveTyped(text: string): Promise<HomeSearchPlace | null> {
    const found = await geocodeDestination(text);
    if ("error" in found) return null;
    const tz = await resolveDestinationTimezone(found.latitude, found.longitude).catch(() => null);
    return { ...found, timezone: tz && "timezone" in tz ? tz.timezone : null };
  }

  async function handleSubmit() {
    setError(null);
    const dates = validDates();
    if (!dates) return;
    let target = place;
    if (!target && typedText.trim()) {
      setResolving(true);
      try {
        target = await resolveTyped(typedText);
      } catch {
        target = null;
      } finally {
        setResolving(false);
      }
    }
    if (!target) {
      setError(
        typedText.trim()
          ? `We couldn't find "${typedText.trim()}". Try picking a town from the list.`
          : "Type a town, or use Near me.",
      );
      return;
    }
    search(target, dates, SEARCH_RADIUS_KM, false);
  }

  async function handleNearMe() {
    setError(null);
    const dates = validDates();
    if (!dates) return;
    setLocating(true);
    try {
      const { lat, lng } = await getBrowserLocation();
      search({ label: "Near me", latitude: lat, longitude: lng }, dates, NEAR_ME_RADIUS_KM, true);
    } catch {
      setError("We couldn't get your location. Search for a town instead.");
    } finally {
      setLocating(false);
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
            onTextChange={setTypedText}
            onChange={(selected) => {
              setPlace(selected);
              setUsingGuess(false);
              setError(null);
            }}
            onClear={() => {
              setPlace(null);
              setUsingGuess(false);
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
                From
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
                To
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
            {navigating || resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
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
            {locating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Crosshair className="h-3.5 w-3.5" />}
            {locating ? "Finding you…" : "Near me"}
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
