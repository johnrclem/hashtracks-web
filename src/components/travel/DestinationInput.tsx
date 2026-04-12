"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { APIProvider, useMapsLibrary } from "@vis.gl/react-google-maps";
import { MapPin, X, Loader2 } from "lucide-react";
import {
  geocodeDestination,
  resolveDestinationTimezone,
} from "@/app/travel/actions";

interface PlaceSelection {
  label: string;
  latitude: number;
  longitude: number;
  placeId?: string;
  timezone?: string;
}

interface DestinationInputProps {
  value: string;
  onChange: (place: PlaceSelection) => void;
  onClear: () => void;
  autoFocus?: boolean;
}

const API_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

export function DestinationInput(props: DestinationInputProps) {
  if (!API_KEY) {
    return <DestinationInputFallback {...props} />;
  }

  return (
    <APIProvider apiKey={API_KEY} libraries={["places"]}>
      <DestinationAutocomplete {...props} />
    </APIProvider>
  );
}

/**
 * Primary: Places Autocomplete using the new Places API.
 * Falls back to server-side geocoding if Places API calls fail.
 */
function DestinationAutocomplete({
  value,
  onChange,
  onClear,
  autoFocus,
}: DestinationInputProps) {
  const placesLib = useMapsLibrary("places") as typeof google.maps.places | null;
  const inputRef = useRef<HTMLInputElement>(null);
  const [inputValue, setInputValue] = useState(value);
  const [suggestions, setSuggestions] = useState<
    { placeId: string; mainText: string; secondaryText: string; description: string }[]
  >([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const [isLoading, setIsLoading] = useState(false);
  const [isResolved, setIsResolved] = useState(!!value);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const fetchSuggestions = useCallback(
    async (input: string) => {
      if (!placesLib || !input.trim() || input.length < 2) {
        setSuggestions([]);
        setShowDropdown(false);
        return;
      }

      try {
        const { suggestions: results } =
          await placesLib.AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            includedPrimaryTypes: ["(cities)"],
          });

        const mapped = results
          .filter((s) => s.placePrediction != null)
          .map((s) => ({
            placeId: s.placePrediction!.placeId,
            mainText: s.placePrediction!.mainText?.text ?? "",
            secondaryText: s.placePrediction!.secondaryText?.text ?? "",
            description: s.placePrediction!.text?.text ?? "",
          }));

        setSuggestions(mapped);
        setShowDropdown(mapped.length > 0);
        setSelectedIndex(-1);
      } catch {
        // Places API failed — user can still press Enter for server-side geocoding
        setSuggestions([]);
        setShowDropdown(false);
      }
    },
    [placesLib],
  );

  const debouncedFetch = useCallback(
    (input: string) => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => fetchSuggestions(input), 300);
    },
    [fetchSuggestions],
  );

  const selectPlace = useCallback(
    async (suggestion: (typeof suggestions)[number]) => {
      if (!placesLib) return;

      setIsLoading(true);
      setShowDropdown(false);
      setInputValue(suggestion.description);

      try {
        const place = new placesLib.Place({ id: suggestion.placeId });
        await place.fetchFields({ fields: ["location", "formattedAddress", "displayName"] });

        const lat = place.location?.lat() ?? 0;
        const lng = place.location?.lng() ?? 0;
        const label = place.formattedAddress ?? suggestion.description;

        setInputValue(label);
        setIsResolved(true);

        // Report place immediately so the form enables Search, then
        // resolve timezone async and update when it arrives
        onChange({ label, latitude: lat, longitude: lng, placeId: suggestion.placeId });
        resolveDestinationTimezone(lat, lng).then((tzResult) => {
          if ("timezone" in tzResult) {
            onChange({ label, latitude: lat, longitude: lng, placeId: suggestion.placeId, timezone: tzResult.timezone });
          }
        });
      } catch {
        // Place details failed — fall back to server-side geocoding
        await fallbackGeocode(suggestion.description);
      } finally {
        setIsLoading(false);
      }
    },
    [onChange, placesLib],
  );

  // Server-side geocoding fallback (Enter key or Places failure)
  const fallbackGeocode = useCallback(
    async (query: string) => {
      if (!query.trim()) return;
      setIsLoading(true);

      const geoResult = await geocodeDestination(query);
      if ("error" in geoResult) {
        setIsLoading(false);
        return;
      }

      setInputValue(geoResult.label);
      setIsResolved(true);

      let timezone: string | undefined;
      const tzResult = await resolveDestinationTimezone(geoResult.latitude, geoResult.longitude);
      if ("timezone" in tzResult) timezone = tzResult.timezone;

      onChange({ label: geoResult.label, latitude: geoResult.latitude, longitude: geoResult.longitude, timezone });
      setIsLoading(false);
    },
    [onChange],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      if (showDropdown && selectedIndex >= 0 && suggestions[selectedIndex]) {
        selectPlace(suggestions[selectedIndex]);
      } else if (inputValue.trim() && !isResolved) {
        // No suggestion selected — geocode server-side
        fallbackGeocode(inputValue);
      }
      return;
    }
    if (!showDropdown || suggestions.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setShowDropdown(false);
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          type="text"
          value={inputValue}
          onChange={(e) => {
            const val = e.target.value;
            setInputValue(val);
            if (isResolved) {
              setIsResolved(false);
              onClear();
            }
            debouncedFetch(val);
            if (!val.trim()) { onClear(); setSuggestions([]); setShowDropdown(false); }
          }}
          onFocus={() => {
            if (suggestions.length > 0) setShowDropdown(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="City or destination"
          aria-label="Destination"
          aria-autocomplete="list"
          aria-expanded={showDropdown}
          aria-controls="destination-listbox"
          autoComplete="off"
          autoFocus={autoFocus}
          className="
            w-full bg-transparent font-display text-lg font-medium
            placeholder:text-muted-foreground/40
            focus:outline-none
          "
        />
        {isLoading && (
          <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin text-muted-foreground" />
        )}
        {inputValue && !isLoading && (
          <button
            type="button"
            onClick={() => {
              setInputValue("");
              setSuggestions([]);
              setShowDropdown(false);
              setIsResolved(false);
              onClear();
              inputRef.current?.focus();
            }}
            className="flex-shrink-0 rounded-full p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Clear destination"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Resolved indicator */}
      {isResolved && !isLoading && (
        <div className="mt-1 flex items-center gap-1.5 text-xs text-emerald-600 dark:text-emerald-400">
          <MapPin className="h-3 w-3" />
          Location confirmed
        </div>
      )}

      {/* Autocomplete dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <ul
          id="destination-listbox"
          role="listbox"
          className="
            absolute left-0 right-0 top-full z-50 mt-2
            overflow-hidden rounded-lg border border-border bg-popover
            shadow-lg
          "
        >
          {suggestions.map((sug, i) => (
            <li
              key={sug.placeId}
              role="option"
              aria-selected={i === selectedIndex}
              className={`
                flex cursor-pointer items-center gap-3 px-4 py-3 text-sm
                transition-colors
                ${i === selectedIndex ? "bg-accent text-accent-foreground" : "hover:bg-muted"}
              `}
              onMouseDown={() => selectPlace(sug)}
              onMouseEnter={() => setSelectedIndex(i)}
            >
              <MapPin className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <div className="truncate font-medium">{sug.mainText}</div>
                <div className="truncate text-xs text-muted-foreground">
                  {sug.secondaryText}
                </div>
              </div>
            </li>
          ))}
          <li className="border-t border-border px-4 py-2 text-[10px] text-muted-foreground/50">
            Powered by Google
          </li>
        </ul>
      )}
    </div>
  );
}

/** Fallback when Google Maps API key is not configured. */
function DestinationInputFallback({
  value,
  onChange,
  onClear,
  autoFocus,
}: DestinationInputProps) {
  const [inputValue, setInputValue] = useState(value);
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async () => {
    if (!inputValue.trim()) return;
    setIsLoading(true);
    const result = await geocodeDestination(inputValue);
    if (!("error" in result)) {
      onChange({ label: result.label, latitude: result.latitude, longitude: result.longitude });
    }
    setIsLoading(false);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={inputValue}
        onChange={(e) => {
          setInputValue(e.target.value);
          if (!e.target.value.trim()) onClear();
        }}
        onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleSubmit(); } }}
        placeholder="City or destination"
        aria-label="Destination"
        autoFocus={autoFocus}
        className="
          w-full bg-transparent font-display text-lg font-medium
          placeholder:text-muted-foreground/40
          focus:outline-none
        "
      />
      {isLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
    </div>
  );
}
