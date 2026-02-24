"use client";

import { useState, useCallback } from "react";

export type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "granted"; lat: number; lng: number }
  | { status: "denied"; error: string };

/**
 * Browser Geolocation API hook.
 * Returns [state, requestLocation].
 * Location is only requested when the user calls requestLocation() — never on mount.
 */
export function useGeolocation(): [GeoState, () => void] {
  const [state, setState] = useState<GeoState>({ status: "idle" });

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setState({ status: "denied", error: "Geolocation is not supported by your browser." });
      return;
    }

    setState({ status: "loading" });

    navigator.geolocation.getCurrentPosition( // NOSONAR - user-initiated, privacy-first; only called on explicit user action
      (position) => {
        setState({
          status: "granted",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
      },
      (error) => {
        const message =
          error.code === error.PERMISSION_DENIED
            ? "Location access denied — check browser settings."
            : "Unable to determine your location.";
        setState({ status: "denied", error: message });
      },
      { timeout: 10000, maximumAge: 5 * 60 * 1000 }, // 5-min cache
    );
  }, []);

  return [state, requestLocation];
}
