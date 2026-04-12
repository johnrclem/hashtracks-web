"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Crosshair, Loader2 } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";

export function NearMeShortcut() {
  const router = useRouter();
  const [geoState, requestLocation] = useGeolocation();
  const [navigating, setNavigating] = useState(false);

  const navigateToNearMe = useCallback((lat: number, lng: number) => {
    setNavigating(true);
    const today = new Date();
    const twoWeeksOut = new Date(today.getTime() + 14 * 24 * 60 * 60 * 1000);

    const params = new URLSearchParams({
      lat: lat.toString(),
      lng: lng.toString(),
      from: today.toISOString().slice(0, 10),
      to: twoWeeksOut.toISOString().slice(0, 10),
      q: "Near me",
      r: "25",
    });
    router.push(`/travel?${params.toString()}`);
  }, [router]);

  // Auto-navigate when geolocation resolves after the user clicks
  useEffect(() => {
    if (geoState.status === "granted" && !navigating) {
      navigateToNearMe(geoState.lat, geoState.lng);
    }
  }, [geoState, navigating, navigateToNearMe]);

  const handleClick = () => {
    if (geoState.status === "granted") {
      navigateToNearMe(geoState.lat, geoState.lng);
      return;
    }
    requestLocation();
  };

  if (geoState.status === "denied") {
    return (
      <p className="mt-4 text-center text-xs text-muted-foreground/50">
        Location access denied — search by city instead
      </p>
    );
  }

  return (
    <div
      className="travel-animate mt-8 text-center"
      style={{
        opacity: 0,
        animation: "travel-word-reveal 400ms ease-out forwards",
        animationDelay: "800ms",
      }}
    >
      <button
        type="button"
        onClick={handleClick}
        disabled={geoState.status === "loading"}
        className="
          group inline-flex items-center gap-2.5 rounded-full
          border border-border/50 bg-card/50 backdrop-blur-sm
          px-6 py-3 text-[13px] font-medium text-muted-foreground
          shadow-sm transition-all duration-300
          hover:border-emerald-500/30 hover:bg-card hover:text-foreground
          hover:shadow-md
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring
          disabled:opacity-50
        "
      >
        {geoState.status === "loading" ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Crosshair className="h-3.5 w-3.5 transition-colors group-hover:text-emerald-500" />
        )}
        {geoState.status === "loading"
          ? "Finding your location…"
          : "Or hash near me right now"}
        <span className="text-muted-foreground/40 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:text-emerald-500/60">→</span>
      </button>
    </div>
  );
}
