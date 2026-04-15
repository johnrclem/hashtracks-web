"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { capture } from "@/lib/analytics";
import { daysBetween } from "@/lib/travel/format";
import { saveTravelSearch } from "@/app/travel/actions";

interface TravelAutoSaveProps {
  destination: string;
  startDate: string;
  endDate: string;
  latitude: number;
  longitude: number;
  radiusKm: number;
  timezone?: string;
}

/**
 * Mounted on /travel when `?saved=1` is present in the URL. Fires once on
 * mount: calls saveTravelSearch, shows a toast, and strips the `saved`
 * param from the URL so a page refresh doesn't re-save the same trip.
 *
 * The ref guard handles React Strict Mode's double-mount in development.
 */
export function TravelAutoSave({
  destination,
  startDate,
  endDate,
  latitude,
  longitude,
  radiusKm,
  timezone,
}: TravelAutoSaveProps) {
  const router = useRouter();
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;

    (async () => {
      const result = await saveTravelSearch({
        label: destination,
        latitude,
        longitude,
        radiusKm,
        startDate,
        endDate,
        timezone,
      });
      if ("success" in result && result.success) {
        capture("travel_saved_search_created", {
          destination,
          dateRangeDays: daysBetween(startDate, endDate),
        });
        toast.success("Saved to your trips", {
          description: "View all your saved trips any time.",
        });
      } else {
        toast.error("Couldn't save this trip", {
          description: "error" in result ? result.error : "Please try again.",
        });
      }
      // Strip the `saved` flag so subsequent refreshes don't re-fire.
      const url = new URL(window.location.href);
      url.searchParams.delete("saved");
      router.replace(url.pathname + url.search);
    })();
  }, [destination, startDate, endDate, latitude, longitude, radiusKm, timezone, router]);

  return null;
}
