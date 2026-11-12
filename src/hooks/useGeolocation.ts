"use client";

import { useState, useCallback } from "react";

export type GeoState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "granted"; lat: number; lng: number }
  | { status: "denied"; error: string };

/**
 * Ask the browser for the visitor's position. Call it only from a user action.
 * Resolves with the coordinates; rejects with an Error whose message is ready
 * to show.
 */
export function getBrowserLocation(): Promise<{ lat: number; lng: number }> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) {
      reject(new Error("Geolocation is not supported by your browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition( // NOSONAR - user-initiated, privacy-first; only called on explicit user action
      (position) => resolve({ lat: position.coords.latitude, lng: position.coords.longitude }),
      (error) =>
        reject(
          new Error(
            error.code === error.PERMISSION_DENIED
              ? "Location access denied — check browser settings."
              : "Unable to determine your location.",
          ),
        ),
      { timeout: 10000, maximumAge: 5 * 60 * 1000 }, // 5-min cache
    );
  });
}

/**
 * Browser Geolocation API hook.
 * Returns [state, requestLocation].
 * Location is only requested when the user calls requestLocation() — never on mount.
 */
export function useGeolocation(): [GeoState, () => void] {
  const [state, setState] = useState<GeoState>({ status: "idle" });

  const requestLocation = useCallback(() => {
    setState({ status: "loading" });
    getBrowserLocation().then(
      ({ lat, lng }) => setState({ status: "granted", lat, lng }),
      (error: Error) => setState({ status: "denied", error: error.message }),
    );
  }, []);

  return [state, requestLocation];
}
